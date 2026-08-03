import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const require = createRequire(import.meta.url);
const Core = require('../src/mvp-third-core.js');

const LG_CODE = '102041';
const SCALE = 1_000_000;
const DATASET_NAMES = [
  'mt_town',
  'mt_town_pos',
  'mt_rsdtdsp_blk',
  'mt_rsdtdsp_blk_pos',
  'mt_parcel',
  'mt_parcel_pos'
];

function datasetUrl(name) {
  return `https://data.address-br.digital.go.jp/${name}/city/${name}_city${LG_CODE}.csv.zip`;
}

function rowReader(csv) {
  const rows = Core.parseCsv(csv);
  const headers = rows.shift();
  const index = Object.fromEntries(headers.map((header, column) => [header, column]));
  return {
    rows,
    value(row, name) {
      const column = index[name];
      return column == null ? '' : String(row[column] ?? '').trim();
    }
  };
}

function compactNumber(value) {
  const source = String(value || '').trim();
  if (!source) return 0;
  return /^\d+$/.test(source) ? Number(source) : source;
}

function coordinateRecord(row, read, idField) {
  const lat = Number(read.value(row, 'rep_lat'));
  const lon = Number(read.value(row, 'rep_lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    key: `${read.value(row, 'machiaza_id')}\u0000${read.value(row, idField)}`,
    lat: Math.round(lat * SCALE),
    lon: Math.round(lon * SCALE),
    sourceScale: Number(read.value(row, 'rep_scale')) || Infinity
  };
}

function positionMap(csv, idField) {
  const read = rowReader(csv);
  const positions = new Map();
  for (const row of read.rows) {
    const candidate = coordinateRecord(row, read, idField);
    if (!candidate) continue;
    const current = positions.get(candidate.key);
    if (!current) {
      positions.set(candidate.key, { ...candidate, ambiguous: false });
      continue;
    }
    const ambiguous = current.ambiguous || current.lat !== candidate.lat || current.lon !== candidate.lon;
    if (candidate.sourceScale < current.sourceScale) positions.set(candidate.key, { ...candidate, ambiguous });
    else current.ambiguous = ambiguous;
  }
  return positions;
}

function buildCompactData(csvByName, sourceFiles) {
  const areas = [];
  const areaIndex = new Map();
  const ensureArea = (machiazaId, oaza, chome, koaza, residentialAddressFlag = false) => {
    const key = String(machiazaId || '').trim();
    if (areaIndex.has(key)) {
      const index = areaIndex.get(key);
      if (residentialAddressFlag) areas[index][3] = 1;
      return index;
    }
    const index = areas.length;
    areas.push([
      String(oaza || '').trim(),
      String(chome || '').trim(),
      String(koaza || '').trim(),
      residentialAddressFlag ? 1 : 0
    ]);
    areaIndex.set(key, index);
    return index;
  };

  const parcelPositions = positionMap(csvByName.mt_parcel_pos, 'prc_id');
  const parcelRead = rowReader(csvByName.mt_parcel);
  const parcelById = new Map();
  for (const row of parcelRead.rows) {
    if (parcelRead.value(row, 'ablt_date')) continue;
    const machiazaId = parcelRead.value(row, 'machiaza_id');
    const parcelId = parcelRead.value(row, 'prc_id');
    const key = `${machiazaId}\u0000${parcelId}`;
    if (parcelById.has(key)) continue;
    const area = ensureArea(
      machiazaId,
      parcelRead.value(row, 'oaza_cho'),
      parcelRead.value(row, 'chome'),
      parcelRead.value(row, 'koaza'),
      parcelRead.value(row, 'rsdt_addr_flg') === '1'
    );
    const position = parcelPositions.get(key);
    const compactParcel = [
      area,
      compactNumber(parcelRead.value(row, 'prc_num1')),
      compactNumber(parcelRead.value(row, 'prc_num2')),
      compactNumber(parcelRead.value(row, 'prc_num3')),
      position?.lat || 0,
      position?.lon || 0
    ];
    if (position?.ambiguous) compactParcel.push(1);
    parcelById.set(key, compactParcel);
  }
  const parcels = [...parcelById.values()].sort((left, right) => (
    left[0] - right[0]
      || String(left[1]).localeCompare(String(right[1]), 'ja', { numeric: true })
      || String(left[2]).localeCompare(String(right[2]), 'ja', { numeric: true })
      || String(left[3]).localeCompare(String(right[3]), 'ja', { numeric: true })
  ));

  const blockPositions = positionMap(csvByName.mt_rsdtdsp_blk_pos, 'blk_id');
  const blockRead = rowReader(csvByName.mt_rsdtdsp_blk);
  const blockById = new Map();
  for (const row of blockRead.rows) {
    if (blockRead.value(row, 'ablt_date')) continue;
    const machiazaId = blockRead.value(row, 'machiaza_id');
    const blockId = blockRead.value(row, 'blk_id');
    const key = `${machiazaId}\u0000${blockId}`;
    if (blockById.has(key)) continue;
    const position = blockPositions.get(key);
    if (!position) continue;
    const area = ensureArea(
      machiazaId,
      blockRead.value(row, 'oaza_cho'),
      blockRead.value(row, 'chome'),
      blockRead.value(row, 'koaza'),
      true
    );
    const compactBlock = [area, compactNumber(blockRead.value(row, 'blk_num')), position.lat, position.lon];
    if (position.ambiguous) compactBlock.push(1);
    blockById.set(key, compactBlock);
  }
  const blocks = [...blockById.values()].sort((left, right) => (
    left[0] - right[0] || String(left[1]).localeCompare(String(right[1]), 'ja', { numeric: true })
  ));

  const townPositionRead = rowReader(csvByName.mt_town_pos);
  const townPositions = new Map();
  for (const row of townPositionRead.rows) {
    const lat = Number(townPositionRead.value(row, 'rep_lat'));
    const lon = Number(townPositionRead.value(row, 'rep_lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = townPositionRead.value(row, 'machiaza_id');
    const sourceScale = Number(townPositionRead.value(row, 'rep_scale')) || Infinity;
    const current = townPositions.get(key);
    if (!current || sourceScale < current.sourceScale) {
      townPositions.set(key, { lat: Math.round(lat * SCALE), lon: Math.round(lon * SCALE), sourceScale });
    }
  }
  const townRead = rowReader(csvByName.mt_town);
  const townById = new Map();
  for (const row of townRead.rows) {
    if (townRead.value(row, 'ablt_date')) continue;
    const machiazaId = townRead.value(row, 'machiaza_id');
    const position = townPositions.get(machiazaId);
    if (!position) continue;
    const area = ensureArea(
      machiazaId,
      townRead.value(row, 'oaza_cho'),
      townRead.value(row, 'chome'),
      townRead.value(row, 'koaza'),
      townRead.value(row, 'rsdt_addr_flg') === '1'
    );
    townById.set(machiazaId, [area, position.lat, position.lon]);
  }
  const towns = [...townById.values()].sort((left, right) => left[0] - right[0]);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    municipality: { lgCode: LG_CODE, name: '群馬県伊勢崎市' },
    coordinateScale: SCALE,
    source: {
      name: 'デジタル庁 アドレス・ベース・レジストリ',
      page: 'https://www.digital.go.jp/policies/base_registry_address',
      files: sourceFiles
    },
    areas,
    parcels,
    blocks,
    towns,
    stats: {
      areaCount: areas.length,
      parcelCount: parcels.length,
      parcelPositionCount: parcels.filter(row => row[4] && row[5]).length,
      residentialBlockCount: blocks.length,
      townPositionCount: towns.length
    }
  };
}

async function downloadDataset(name, directory) {
  const url = datasetUrl(name);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const zipPath = path.join(directory, `${name}.zip`);
  await fs.writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
  const csv = execFileSync('unzip', ['-p', zipPath], { encoding: 'utf8', maxBuffer: 160 * 1024 * 1024 });
  return {
    csv,
    metadata: {
      name,
      url,
      lastModified: response.headers.get('last-modified') || '',
      etag: response.headers.get('etag') || ''
    }
  };
}

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'albo-abr-'));
  try {
    const downloaded = await Promise.all(DATASET_NAMES.map(name => downloadDataset(name, tempDir)));
    const csvByName = Object.fromEntries(downloaded.map((result, index) => [DATASET_NAMES[index], result.csv]));
    const sourceFiles = downloaded.map(result => result.metadata);
    const output = buildCompactData(csvByName, sourceFiles);
    const outputPath = path.join(projectDir, 'data', 'isesaki-abr-address-points.json');
    await fs.writeFile(outputPath, JSON.stringify(output), 'utf8');
    const stat = await fs.stat(outputPath);
    console.log(JSON.stringify({ output: outputPath, bytes: stat.size, ...output.stats }, null, 2));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

await main();
