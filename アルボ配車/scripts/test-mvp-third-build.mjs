import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await fs.readFile(path.join(projectDir, 'MVP3rd', 'index.html'), 'utf8');

assert.match(html, /^<!doctype html>/i);
assert.doesNotMatch(html, /__(?:MOCK_DATA_2|ROAD_DATA|ADDRESS_DATA|CORE_JS|APP_JS)__/);
assert.doesNotMatch(html, /<script[^>]+src=/i);
assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|https?:\/\/[^"']+\.(?:js|css)(?:[?"'])/i);
assert.ok(Buffer.byteLength(html) < 20_000_000, '単体HTMLが想定サイズを超えています');

function embeddedJson(id) {
  const pattern = new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)<\\/script>`);
  const match = html.match(pattern);
  assert.ok(match, `${id} が見つかりません`);
  return JSON.parse(match[1]);
}

const road = embeddedJson('roadData');
const address = embeddedJson('addressData');
assert.equal(road.nodes.length, road.stats.nodeCount);
assert.equal(road.ways.length, road.stats.wayCount);
assert.ok(road.stats.nodeCount > 200_000);
assert.ok(road.stats.directedEdgeCount > 450_000);
assert.equal(road.facility.address, '群馬県伊勢崎市太田町366');
assert.ok(address.exact.length > 3_000);
assert.equal(address.towns.length, 123);
const facilityAddress = address.exact.find(entry => entry[0] === '太田町366');
assert.deepEqual(facilityAddress, ['太田町366', 36327358, 139181168, '群馬県伊勢崎市太田町366']);
assert.equal(address.abr.municipality.lgCode, '102041');
assert.equal(address.abr.stats.parcelCount, 288962);
assert.equal(address.abr.stats.parcelPositionCount, 71895);
assert.equal(address.abr.stats.residentialBlockCount, 200);
assert.ok(address.abr.areas.some(area => area[0] === '今泉町' && area[1] === '二丁目'));

const mockData2Match = html.match(/<script id="mockData2" type="text\/csv">([\s\S]*?)<\/script>/);
assert.ok(mockData2Match, '模擬データ2が見つかりません');
const mockData2Lines = mockData2Match[1].trim().split(/\r?\n/);
assert.equal(mockData2Lines.length, 28);
assert.match(mockData2Lines[0], /車いす利用/);
assert.match(mockData2Lines[0], /座標情報元/);
const mockData2Rows = mockData2Lines.slice(1).map(line => line.split(','));
assert.ok(mockData2Rows.every(row => row[5] === 'いいえ'), '模擬データ2のミラー条件を確認してください');
assert.ok(mockData2Rows.every(row => row[6] && row[7]), '模擬データ2は27人全員の座標を持つこと');
assert.equal(mockData2Rows.filter(row => row[8] === 'GSI番地代表点').length, 18);
assert.equal(mockData2Rows.filter(row => row[8] === 'ABR地番代表点').length, 8);
assert.equal(mockData2Rows.filter(row => row[8] === 'ABR街区代表点').length, 1);
assert.deepEqual(mockData2Rows.find(row => row[0] === 'M2-025')?.slice(6, 9), ['36.317518', '139.165096', 'ABR地番代表点']);
assert.match(html, /id="addressList"/);
assert.match(html, /id="mapCorrectionButton"/);
assert.match(html, /id="exportCoordinatesButton"/);
assert.match(html, /id="matchedAddressText"/);
assert.match(html, /id="addressMatchText"/);
assert.match(html, /id="unmatchedAddressText"/);
assert.match(html, /id="coordinateMatchedAddressText"/);
assert.match(html, /安全な駐車位置は今回の対象/);

const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
assert.equal(inlineScripts.length, 2);
for (const [index, source] of inlineScripts.entries()) new vm.Script(source, { filename: `inline-${index + 1}.js` });

console.log('mvp-third-build: all tests passed');
