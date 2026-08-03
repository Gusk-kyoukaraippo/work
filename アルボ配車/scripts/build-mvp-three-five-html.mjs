import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const require = createRequire(import.meta.url);
const Core = require('../src/mvp-three-five-core.js');

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(projectDir, relativePath), 'utf8'));
}

function compactAddresses(database, abr) {
  const scale = 1_000_000;
  const exactByKey = new Map();
  const townByKey = new Map();

  for (const entry of database.entries || []) {
    if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lng)) continue;
    const key = Core.normalizeAddress(entry.fullAddress || entry.name);
    if (!key) continue;
    const compact = [key, Math.round(entry.lat * scale), Math.round(entry.lng * scale), entry.fullAddress || entry.name || key];
    if (entry.source === 'gsi-address-search') exactByKey.set(key, compact);
    if (entry.level === 'town' || entry.lotNum == null && entry.source === 'geolonia-japanese-addresses') {
      townByKey.set(key, compact);
    }
  }

  // 発着地点は国土地理院アドレスサーチで個別確認した座標を優先する。
  exactByKey.set(Core.normalizeAddress('群馬県伊勢崎市太田町366'), [
    Core.normalizeAddress('群馬県伊勢崎市太田町366'),
    Math.round(36.327358 * scale),
    Math.round(139.181168 * scale),
    '群馬県伊勢崎市太田町366'
  ]);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    coordinateScale: scale,
    area: database.area,
    exactSource: '国土地理院アドレスサーチAPIで取得済みの番地代表点',
    townSource: 'Geolonia住所データ等による町域代表点',
    abr,
    exact: [...exactByKey.values()].sort((a, b) => a[0].localeCompare(b[0], 'ja')),
    towns: [...townByKey.values()].sort((a, b) => a[0].localeCompare(b[0], 'ja'))
  };
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

async function main() {
  const [template, core, app, mockData2, roadNetwork, addressDatabase, abrAddressPoints] = await Promise.all([
    fs.readFile(path.join(projectDir, 'src/mvp_three_five.template.html'), 'utf8'),
    fs.readFile(path.join(projectDir, 'src/mvp-three-five-core.js'), 'utf8'),
    fs.readFile(path.join(projectDir, 'src/mvp-three-five-app.js'), 'utf8'),
    fs.readFile(path.join(projectDir, 'MVP3.5/mock-data-2.csv'), 'utf8'),
    readJson('data/isesaki-road-network.json'),
    readJson('data/isesaki-address-db.json'),
    readJson('data/isesaki-abr-address-points.json')
  ]);

  const compactAddress = compactAddresses(addressDatabase, abrAddressPoints);
  let html = template
    .replace('__MOCK_DATA_2__', () => mockData2.replace(/</g, '\\u003c'))
    .replace('__ROAD_DATA__', () => safeJson(roadNetwork))
    .replace('__ADDRESS_DATA__', () => safeJson(compactAddress))
    .replace('__CORE_JS__', () => core)
    .replace('__APP_JS__', () => app);

  if (/__(?:MOCK_DATA_2|ROAD_DATA|ADDRESS_DATA|CORE_JS|APP_JS)__/.test(html)) {
    throw new Error('HTMLテンプレートに未置換のプレースホルダーがあります。');
  }
  const outputPath = path.join(projectDir, 'MVP3.5', 'index.html');
  await fs.writeFile(outputPath, html, 'utf8');
  const stat = await fs.stat(outputPath);
  console.log(JSON.stringify({
    output: outputPath,
    bytes: stat.size,
    roadNodes: roadNetwork.stats.nodeCount,
    roadWays: roadNetwork.stats.wayCount,
    exactAddresses: compactAddress.exact.length,
    townAddresses: compactAddress.towns.length,
    abrParcels: compactAddress.abr.stats.parcelCount,
    abrParcelPositions: compactAddress.abr.stats.parcelPositionCount,
    abrResidentialBlocks: compactAddress.abr.stats.residentialBlockCount
  }, null, 2));
}

await main();
