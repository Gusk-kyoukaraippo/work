import fs from 'node:fs';

const FULL_DB_PATH = 'data/isesaki-address-db.json';
const FALLBACK_CSV_PATH = 'data/isesaki-town-and-chome-master.csv';
const OUTPUT_JSON_PATH = 'data/isesaki-address-db-lite.json';
const OUTPUT_JS_PATH = 'data/isesaki-address-db-lite.js';

const PREFECTURE = '群馬県';
const CITY = '伊勢崎市';
const CITY_FULL = `${PREFECTURE}${CITY}`;
const DEFAULT_MAP = {
  src: 'assets/isesaki-kuwamap-overview.png',
  width: 447,
  height: 496
};

function normalizeAddressForMatch(text) {
  return String(text || '')
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[－−―‐]/g, '-')
    .replace(/[　\s]/g, '');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
      continue;
    }

    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    if (ch !== '\r') field += ch;
  }

  row.push(field);
  rows.push(row);
  return rows.filter(r => r.some(cell => String(cell).trim() !== ''));
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function uniqueByName(towns) {
  const map = new Map();
  for (const town of towns) {
    if (!town?.name) continue;
    const key = String(town.name);
    if (!map.has(key)) map.set(key, town);
  }
  return [...map.values()];
}

function hasUsableMapPoint(item) {
  return Number.isFinite(item?.x) && Number.isFinite(item?.y) && item.x > 0 && item.y > 0;
}

function hasLatLng(item) {
  return Number.isFinite(item?.lat) && Number.isFinite(item?.lng);
}

function estimatePointFromNearbyTowns(town, sourceTowns, map) {
  if (!hasLatLng(town)) return null;
  const candidates = sourceTowns
    .filter(item => item !== town && hasUsableMapPoint(item) && hasLatLng(item))
    .map(item => {
      const latKm = (town.lat - item.lat) * 111;
      const lngKm = (town.lng - item.lng) * 90;
      return {
        town: item,
        distance: Math.hypot(latKm, lngKm)
      };
    })
    .filter(item => item.distance > 0)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);

  if (!candidates.length) return null;

  const weighted = candidates.reduce((acc, item) => {
    const weight = 1 / (item.distance ** 2);
    acc.x += item.town.x * weight;
    acc.y += item.town.y * weight;
    acc.weight += weight;
    return acc;
  }, { x: 0, y: 0, weight: 0 });

  const x = Math.round(weighted.x / weighted.weight);
  const y = Math.round(weighted.y / weighted.weight);
  return {
    x: Math.max(1, Math.min(map.width - 1, x)),
    y: Math.max(1, Math.min(map.height - 1, y)),
    source: `estimated-nearby:${candidates.slice(0, 3).map(item => item.town.name).join('/')}`
  };
}

function fillMissingTownCoordinates(towns, map) {
  return towns.map(town => {
    if (hasUsableMapPoint(town)) return town;
    const estimated = estimatePointFromNearbyTowns(town, towns, map);
    if (!estimated) return town;
    return {
      ...town,
      x: estimated.x,
      y: estimated.y,
      xRatio: Number((estimated.x / map.width).toFixed(6)),
      yRatio: Number((estimated.y / map.height).toFixed(6)),
      mapSource: estimated.source,
      note: '町域代表点を周辺町域から概略補完'
    };
  });
}

function loadFromJson() {
  if (!fs.existsSync(FULL_DB_PATH)) return [];
  const raw = JSON.parse(fs.readFileSync(FULL_DB_PATH, 'utf8'));
  const sourceMap = raw?.map || {};
  const entries = Array.isArray(raw?.entries) ? raw.entries : [];
  const townEntries = entries
    .filter(item => item?.level === 'town')
    .map(item => {
      const name = String(item.name || '').trim();
      const fullAddress = String(item.fullAddress || `${CITY_FULL}${name}`).trim();
      const x = toNumber(item?.map?.x);
      const y = toNumber(item?.map?.y);
      const xRatio = toNumber(item?.map?.xRatio);
      const yRatio = toNumber(item?.map?.yRatio);
      return {
        name,
        fullAddress,
        lat: toNumber(item?.lat),
        lng: toNumber(item?.lng),
        x,
        y,
        xRatio,
        yRatio,
        source: item?.source || 'geolonia-japanese-addresses',
        mapSource: item?.map?.source || 'manual-overview'
      };
    })
    .filter(item => item.name && item.fullAddress && Number.isFinite(item.x) && Number.isFinite(item.y));

  if (townEntries.length > 0) {
    return {
      map: sourceMap,
      towns: uniqueByName(townEntries)
    };
  }

  return null;
}

function loadFromCsvFallback() {
  if (!fs.existsSync(FALLBACK_CSV_PATH)) return null;
  const rows = parseCsv(fs.readFileSync(FALLBACK_CSV_PATH, 'utf8'));
  const towns = rows
    .slice(1)
    .filter(cols => cols?.[0] === 'town')
    .map(cols => {
      const fullAddress = cols[1] || '';
      const name = fullAddress.replace(CITY_FULL, '');
      return {
        name,
        fullAddress,
        lat: toNumber(cols[3]),
        lng: toNumber(cols[4]),
        x: toNumber(cols[5]),
        y: toNumber(cols[6]),
        xRatio: toNumber(cols[7]),
        yRatio: toNumber(cols[8]),
        source: cols[9] || 'iseasaki-master'
      };
    })
    .filter(item => item.name && item.fullAddress && Number.isFinite(item.x) && Number.isFinite(item.y));

  if (towns.length === 0) return null;

  return {
    map: DEFAULT_MAP,
    towns: uniqueByName(towns)
  };
}

async function buildLiteDb() {
  const loaded = loadFromJson() || loadFromCsvFallback();
  if (!loaded) {
    throw new Error('軽量DB生成元データが見つかりませんでした。full DBまたはCSVを用意してください。');
  }

  const map = {
    id: 'isesaki-kuwamap-overview',
    src: loaded.map?.src || DEFAULT_MAP.src,
    width: loaded.map?.width || DEFAULT_MAP.width,
    height: loaded.map?.height || DEFAULT_MAP.height
  };

  const towns = fillMissingTownCoordinates(uniqueByName(loaded.towns), map)
    .map(item => {
      const fullAddress = String(item.fullAddress).trim();
      return {
        name: String(item.name).trim(),
        fullAddress,
        key: normalizeAddressForMatch(fullAddress),
        lat: item.lat,
        lng: item.lng,
        x: item.x,
        y: item.y,
        xRatio: item.xRatio ?? Number((item.x / map.width).toFixed(6)),
        yRatio: item.yRatio ?? Number((item.y / map.height).toFixed(6)),
        source: item.source || 'light-compact-seed',
        mapSource: item.mapSource || 'manual-overview',
        ...(item.note ? { note: item.note } : {})
      };
    })
    .sort((a, b) => {
      if (a.name === b.name) return 0;
      return a.name < b.name ? -1 : 1;
    });

  const liteDb = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString().slice(0, 10),
    mode: 'light-two-stage',
    area: {
      prefecture: PREFECTURE,
      city: CITY
    },
    map,
    sources: [{
      id: 'light-compact-seed',
      name: '軽量版: 伊勢崎市 町域代表点',
      url: 'data/isesaki-address-db.json',
      license: 'CC BY 4.0 / MIT',
      note: '番地は町域＋擬似オフセット計算で表示。町域の地図座標が欠ける場合は周辺町域から概略補完'
    }],
    matching: {
      cityPrefix: CITY_FULL,
      lotTokens: ['0-9', '甲', '乙', '丙'],
      normalize: '半角数字・漢数字をASCIIに変換し、都道府県/市名を正規化後に一致'
    },
    towns
  };

  const jsonText = `${JSON.stringify(liteDb, null, 2)}\n`;
  const jsText = `window.ISESAKI_ADDRESS_DB_LIGHT = ${jsonText}`;

  await Promise.all([
    fs.promises.writeFile(OUTPUT_JSON_PATH, jsonText),
    fs.promises.writeFile(OUTPUT_JS_PATH, jsText)
  ]);
  console.log(`ライト版DB生成: 町域=${towns.length}件`);
  console.log(`output: ${OUTPUT_JSON_PATH}, ${OUTPUT_JS_PATH}`);
}

buildLiteDb().catch(error => {
  console.error(error);
  process.exit(1);
});
