#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const OUTPUT_JSON = path.join(ROOT_DIR, 'data', 'isesaki-road-network.json');
const OUTPUT_JS = path.join(ROOT_DIR, 'data', 'isesaki-road-network.js');
const CACHE_DIR = path.join(os.tmpdir(), 'arbo-isesaki-road-cache-v1');

// 伊勢崎市境界（OpenStreetMap relation 1865315）の外側に約2kmの余白を追加。
// 市境付近の経路が途中で切れないよう、隣接地域の道路も少し含める。
const BBOX = {
  south: 36.2225,
  west: 139.111,
  north: 36.4285,
  east: 139.308
};

const TILE_SIZE = 0.05;
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter'
];

const HIGHWAY_TYPES = [
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'track',
  'road'
];

const HIGHWAY_TYPE_INDEX = new Map(HIGHWAY_TYPES.map((type, index) => [type, index]));
const EXCLUDED_ACCESS = new Set(['no']);

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const clampCoordinate = value => Math.round(Number(value) * 1_000_000);

function tileRanges() {
  const result = [];
  let row = 0;
  for (let south = BBOX.south; south < BBOX.north - 1e-9; south += TILE_SIZE, row++) {
    let column = 0;
    for (let west = BBOX.west; west < BBOX.east - 1e-9; west += TILE_SIZE, column++) {
      result.push({
        row,
        column,
        south: Number(south.toFixed(6)),
        west: Number(west.toFixed(6)),
        north: Number(Math.min(BBOX.north, south + TILE_SIZE).toFixed(6)),
        east: Number(Math.min(BBOX.east, west + TILE_SIZE).toFixed(6))
      });
    }
  }
  return result;
}

function buildQuery(tile) {
  const bbox = [tile.south, tile.west, tile.north, tile.east].join(',');
  return `[out:json][timeout:180];
way["highway"]["highway"!~"^(footway|cycleway|path|steps|pedestrian|bridleway|corridor|platform|raceway|proposed|construction)$"](${bbox});
out body geom;`;
}

async function fetchTile(tile, index, total, depth = 0) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `tile-${tile.row}-${tile.column}.json`);
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    if (Array.isArray(cached.elements)) {
      process.stdout.write(`[${index + 1}/${total}] cache ${tile.row},${tile.column} (${cached.elements.length} ways)\n`);
      return cached;
    }
  } catch {
    // Cache miss or incomplete cache. Download it again.
  }

  const query = buildQuery(tile);
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 75_000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'ArboDispatchMVP/0.1 local-road-network-builder'
        },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (!Array.isArray(json.elements)) throw new Error('Overpass response has no elements array');
      await fs.writeFile(cachePath, JSON.stringify(json));
      process.stdout.write(`[${index + 1}/${total}] download ${tile.row},${tile.column} (${json.elements.length} ways)\n`);
      return json;
    } catch (error) {
      lastError = error;
      process.stderr.write(`[${index + 1}/${total}] retry ${attempt + 1}: ${endpoint} - ${error.message}\n`);
      await sleep(3_000 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  if (depth < 2) {
    process.stderr.write(`[${index + 1}/${total}] split tile ${tile.row},${tile.column}\n`);
    const middleLat = Number(((tile.south + tile.north) / 2).toFixed(6));
    const middleLon = Number(((tile.west + tile.east) / 2).toFixed(6));
    const subtiles = [
      { ...tile, row: `${tile.row}a`, column: `${tile.column}a`, north: middleLat, east: middleLon },
      { ...tile, row: `${tile.row}a`, column: `${tile.column}b`, west: middleLon, north: middleLat },
      { ...tile, row: `${tile.row}b`, column: `${tile.column}a`, south: middleLat, east: middleLon },
      { ...tile, row: `${tile.row}b`, column: `${tile.column}b`, south: middleLat, west: middleLon }
    ];
    const merged = new Map();
    const timestamps = [];
    for (const subtile of subtiles) {
      const json = await fetchTile(subtile, index, total, depth + 1);
      if (json.osm3s?.timestamp_osm_base) timestamps.push(json.osm3s.timestamp_osm_base);
      for (const element of json.elements || []) {
        if (element.type === 'way' && element.id != null) merged.set(String(element.id), element);
      }
    }
    const combined = {
      osm3s: { timestamp_osm_base: timestamps.sort().at(-1) || '' },
      elements: [...merged.values()]
    };
    await fs.writeFile(cachePath, JSON.stringify(combined));
    return combined;
  }
  throw new Error(`Failed to download tile ${tile.row},${tile.column}: ${lastError?.message || 'unknown error'}`);
}

function isUsableRoad(way) {
  const tags = way.tags || {};
  if (!HIGHWAY_TYPE_INDEX.has(tags.highway)) return false;
  if (!Array.isArray(way.nodes) || !Array.isArray(way.geometry)) return false;
  if (way.nodes.length < 2 || way.nodes.length !== way.geometry.length) return false;
  if (EXCLUDED_ACCESS.has(tags.access)) return false;
  if (EXCLUDED_ACCESS.has(tags.vehicle)) return false;
  if (EXCLUDED_ACCESS.has(tags.motor_vehicle)) return false;
  return way.geometry.every(point => Number.isFinite(point?.lat) && Number.isFinite(point?.lon));
}

function detectOneway(tags) {
  const value = String(tags.oneway || '').toLowerCase();
  if (value === '-1' || value === 'reverse') return -1;
  if (['yes', 'true', '1'].includes(value)) return 1;
  if (tags.junction === 'roundabout' || tags.highway === 'motorway') return 1;
  return 0;
}

function roadFlags(tags) {
  let flags = 0;
  if (['private', 'destination', 'customers', 'delivery'].includes(tags.access)) flags |= 1;
  if (tags.bridge && tags.bridge !== 'no') flags |= 2;
  if (tags.tunnel && tags.tunnel !== 'no') flags |= 4;
  if (tags.surface && /^(unpaved|gravel|dirt|ground|grass|sand|mud)$/.test(tags.surface)) flags |= 8;
  return flags;
}

function haversineMeters(a, b) {
  const toRadians = degrees => degrees * Math.PI / 180;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(b.lon - a.lon);
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function compactNetwork(rawWays, timestamps) {
  const nodeIndexByOsmId = new Map();
  const nodes = [];
  const names = [];
  const nameIndex = new Map();
  const ways = [];
  const countsByType = Object.fromEntries(HIGHWAY_TYPES.map(type => [type, 0]));
  let totalLengthMeters = 0;
  let directedEdgeCount = 0;

  const getNameIndex = name => {
    const normalized = String(name || '').trim();
    if (!normalized) return -1;
    if (!nameIndex.has(normalized)) {
      nameIndex.set(normalized, names.length);
      names.push(normalized);
    }
    return nameIndex.get(normalized);
  };

  const getNodeIndex = (osmId, point) => {
    const key = String(osmId);
    if (!nodeIndexByOsmId.has(key)) {
      nodeIndexByOsmId.set(key, nodes.length);
      nodes.push([clampCoordinate(point.lat), clampCoordinate(point.lon)]);
    }
    return nodeIndexByOsmId.get(key);
  };

  for (const way of rawWays) {
    if (!isUsableRoad(way)) continue;
    const tags = way.tags || {};
    const typeIndex = HIGHWAY_TYPE_INDEX.get(tags.highway);
    const oneway = detectOneway(tags);
    const flags = roadFlags(tags);
    const labelIndex = getNameIndex(tags.name || tags.ref || '');
    const compactNodes = way.nodes.map((osmId, index) => getNodeIndex(osmId, way.geometry[index]));
    if (compactNodes.length < 2) continue;

    ways.push([typeIndex, oneway, flags, labelIndex, ...compactNodes]);
    countsByType[tags.highway]++;
    directedEdgeCount += (compactNodes.length - 1) * (oneway === 0 ? 2 : 1);
    for (let index = 1; index < way.geometry.length; index++) {
      totalLengthMeters += haversineMeters(way.geometry[index - 1], way.geometry[index]);
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      name: 'OpenStreetMap',
      attribution: '© OpenStreetMap contributors',
      license: 'ODbL 1.0',
      licenseUrl: 'https://www.openstreetmap.org/copyright',
      osmDataTimestamps: [...new Set(timestamps.filter(Boolean))].sort()
    },
    coverage: {
      name: '伊勢崎市と周辺約2km',
      bbox: [BBOX.south, BBOX.west, BBOX.north, BBOX.east]
    },
    facility: {
      address: '群馬県伊勢崎市太田町366',
      lat: 36.327358,
      lon: 139.181168,
      coordinateSource: '国土地理院 住所検索'
    },
    encoding: {
      coordinateScale: 1_000_000,
      way: ['highwayTypeIndex', 'oneway(-1|0|1)', 'flags', 'nameIndex', 'nodeIndex...'],
      flags: {
        1: 'restricted/private access',
        2: 'bridge',
        4: 'tunnel',
        8: 'unpaved'
      }
    },
    highwayTypes: HIGHWAY_TYPES,
    names,
    nodes,
    ways,
    stats: {
      nodeCount: nodes.length,
      wayCount: ways.length,
      directedEdgeCount,
      namedRoadCount: names.length,
      approximateRoadKilometers: Math.round(totalLengthMeters / 100) / 10,
      countsByType
    }
  };
}

async function main() {
  const tiles = tileRanges();
  const mergedWays = new Map();
  const timestamps = [];

  process.stdout.write(`Downloading ${tiles.length} tiles for ${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}\n`);
  for (let index = 0; index < tiles.length; index++) {
    const json = await fetchTile(tiles[index], index, tiles.length);
    if (json.osm3s?.timestamp_osm_base) timestamps.push(json.osm3s.timestamp_osm_base);
    for (const element of json.elements) {
      if (element.type === 'way' && element.id != null) mergedWays.set(String(element.id), element);
    }
    await sleep(350);
  }

  const rawWays = [...mergedWays.values()].sort((a, b) => Number(a.id) - Number(b.id));
  const network = compactNetwork(rawWays, timestamps);
  const json = JSON.stringify(network);
  await fs.writeFile(OUTPUT_JSON, json);
  await fs.writeFile(OUTPUT_JS, `window.ISESAKI_ROAD_NETWORK=${json};\n`);

  process.stdout.write(`Saved ${OUTPUT_JSON}\n`);
  process.stdout.write(`Saved ${OUTPUT_JS}\n`);
  process.stdout.write(`${JSON.stringify(network.stats, null, 2)}\n`);
  process.stdout.write(`JSON bytes: ${Buffer.byteLength(json)}\n`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
