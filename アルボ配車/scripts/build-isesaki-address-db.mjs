import fs from 'node:fs';

const PREFECTURE = '群馬県';
const CITY = '伊勢崎市';
const CITY_FULL = `${PREFECTURE}${CITY}`;
const GEOLONIA_API = 'https://geolonia.github.io/japanese-addresses/api/ja/群馬県/伊勢崎市.json';
const GSI_API = 'https://msearch.gsi.go.jp/address-search/AddressSearch';
const envMaxLot = Number(process.env.MAX_LOT);
const MAX_LOT = Number.isFinite(envMaxLot) && envMaxLot > 0 ? Math.floor(envMaxLot) : 500;
const envConsecutiveMissLimit = Number(process.env.CONSECUTIVE_MISS_LIMIT);
const CONSECUTIVE_MISS_LIMIT = Number.isFinite(envConsecutiveMissLimit) && envConsecutiveMissLimit > 0
  ? Math.floor(envConsecutiveMissLimit)
  : 20;
const envSparseScanStart = Number(process.env.SPARSE_SCAN_START);
const SPARSE_SCAN_START = Number.isFinite(envSparseScanStart) && envSparseScanStart > 0
  ? Math.floor(envSparseScanStart)
  : 250;

const KNOWN_MAP_WIDTH = 447;
const KNOWN_MAP_HEIGHT = 496;
const DATA_JSON_PATH = 'data/isesaki-address-db.json';
const DATA_JS_PATH = 'data/isesaki-address-db.js';

const KANJI_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '二十一', '二十二', '二十三', '二十四', '二十五', '二十六', '二十七', '二十八', '二十九', '三十'];
const KANJI_TO_ARABIC = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

function toKanji(n) {
  return KANJI_DIGITS[n] ?? String(n);
}

function kanjiToArabic(text) {
  if (/^\d+$/.test(text)) return Number(text);
  if (!text) return NaN;
  if (text.length === 1) return KANJI_TO_ARABIC[text] || NaN;
  if (text === '十') return 10;
  if (text.startsWith('十')) return 10 + (KANJI_TO_ARABIC[text[1]] || 0);
  if (text.endsWith('十')) return (KANJI_TO_ARABIC[text[0]] || 0) * 10;
  if (text.includes('十')) {
    const head = KANJI_TO_ARABIC[text[0]] || 0;
    const tail = KANJI_TO_ARABIC[text[2]] || 0;
    return head * 10 + tail;
  }
  return NaN;
}

function normalizeAddressForLookup(text) {
  return String(text || '')
    .replace(/([一二三四五六七八九十]+)丁目/g, (_, raw) => String(kanjiToArabic(raw)))
    .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/丁目/g, '')
    .replace(/-/g, '');
}

function normalizeAddressForMatch(text) {
  return String(text || '')
    .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[−－―]/g, '-')
    .replace(/[　\s]/g, '')
    .replace(/[-－‐]$/g, '');
}

function toFullWidthDigits(value) {
  return String(value).replace(/\d/g, char => String.fromCharCode(char.charCodeAt(0) + 0xFEE0));
}

function parseNumericToken(token) {
  if (!token) return null;
  const num = kanjiToArabic(token);
  if (Number.isFinite(num)) return num;
  const parsed = Number(token);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractLotNumberFromTitle(title, town) {
  const base = normalizeAddressForMatch(`${CITY_FULL}${town}`);
  const normalized = normalizeAddressForMatch(String(title || ''));
  if (!normalized.startsWith(base)) return null;
  const tail = normalized.slice(base.length);
  const [chomePart, ...restParts] = tail.split('丁目');
  const rest = restParts.join('丁目');

  if (rest) {
    const matchedByRest = rest.match(/([0-9一二三四五六七八九十]+)/);
    if (matchedByRest) {
      const lot = parseNumericToken(matchedByRest[1]);
      if (lot !== null) return lot;
    }
  }

  if (rest) {
    const matchedByDirect = tail.match(/^([0-9一二三四五六七八九十]+)(?:[-−－]|番地|番|号)/);
    if (matchedByDirect) {
      return parseNumericToken(matchedByDirect[1]);
    }
  } else {
    const directLot = chomePart.match(/^([0-9一二三四五六七八九十]+)(?:番地|番|号|-)/);
    if (directLot) {
      return parseNumericToken(directLot[1]);
    }
  }

  return null;
}

function buildLotQueryVariants(town, n) {
  const arabic = String(n);
  const kanji = toKanji(n);
  const fullWidth = toFullWidthDigits(arabic);
  return [
    `${town}${arabic}丁目${arabic}番地`,
    `${town}${kanji}丁目${arabic}番地`,
    `${town}${arabic}丁目${arabic}`,
    `${town}${kanji}丁目${arabic}`,
    `${town}${arabic}番地`,
    `${town}${kanji}番地`,
    `${town}${arabic}-${arabic}`,
    `${town}${arabic}`,
    `${town}${kanji}`,
    `${town}${fullWidth}丁目${fullWidth}番地`,
    `${town}${fullWidth}番地`,
    `${town}${fullWidth}`
  ];
}

function buildSparseScanQueryVariants(town, n) {
  const arabic = String(n);
  return [
    `${town}${arabic}番地`,
    `${town}${arabic}`
  ];
}

async function findGsiLotMatch(town, n) {
  const queries = buildLotQueryVariants(town, n);
  for (const query of queries) {
    const queryResults = await searchAddress(query);
    if (!Array.isArray(queryResults) || queryResults.length === 0) continue;
    const found = queryResults.find(item => {
      const title = item?.properties?.title || '';
      return extractLotNumberFromTitle(title, town) === n;
    });
    if (found) return found;
  }
  return null;
}

async function findGsiLotMatchSparse(town, n) {
  const queries = buildSparseScanQueryVariants(town, n);
  for (const query of queries) {
    const queryResults = await searchAddress(query);
    if (!Array.isArray(queryResults) || queryResults.length === 0) continue;
    const found = queryResults.find(item => {
      const title = item?.properties?.title || '';
      return extractLotNumberFromTitle(title, town) === n;
    });
    if (found) return found;
  }
  return null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashSeed(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function estimateLotOffset(parent, key) {
  const hashed = hashSeed(key);
  const angle = (hashed % 360) * Math.PI / 180;
  const radius = 9 + (parent.lotNum % 6) * 2;
  return {
    x: Math.round(Math.cos(angle) * radius),
    y: Math.round(Math.sin(angle) * radius)
  };
}

async function fetchJson(url, retry = 2) {
  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') {
        console.warn('timeout:', url);
      } else if (error?.message) {
        console.warn(error.message, url);
      }
      if (attempt >= retry) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 + attempt * 200));
    }
  }
  return null;
}

async function searchAddress(query) {
  const q = encodeURIComponent(query);
  const url = `${GSI_API}?q=${q}`;
  const result = await fetchJson(url);
  if (!Array.isArray(result) || result.length === 0) return null;
  return result;
}

function createEntry({
  source,
  fullAddress,
  townName,
  lat,
  lng,
  map,
  level,
  lotNum = null,
  note = ''
}) {
  const idSeed = `${PREFECTURE}|${CITY}|${fullAddress}|${level}|${lotNum ?? ''}`;
  const idSuffix = hashSeed(idSeed).toString(36).padStart(8, '0').slice(0, 10);
  return {
    id: `isesaki-${idSuffix}`,
    prefecture: PREFECTURE,
    city: CITY,
    name: lotNum ? `${townName}${lotNum}番地` : townName,
    fullAddress,
    baseTown: townName,
    koaza: '',
    level,
    lotNum,
    lat,
    lng,
    map,
    source
  };
}

function mapFromParentWithOffset(parent, key, lotNum) {
  if (!parent || !Number.isFinite(parent.x) || !Number.isFinite(parent.y)) {
    return {
      x: null,
      y: null,
      xRatio: null,
      yRatio: null,
      source: 'gsi-estimated'
    };
  }
  const offset = estimateLotOffset({ lotNum }, key);
  const x = clamp(parent.x + offset.x, 0, KNOWN_MAP_WIDTH);
  const y = clamp(parent.y + offset.y, 0, KNOWN_MAP_HEIGHT);
  return {
    x,
    y,
    xRatio: Number((x / KNOWN_MAP_WIDTH).toFixed(6)),
    yRatio: Number((y / KNOWN_MAP_HEIGHT).toFixed(6)),
    source: 'gsi-estimated'
  };
}

function buildStaticMapFromLegacy(entry, legacyByAddressLookup) {
  const matched = legacyByAddressLookup.get(normalizeAddressForLookup(entry.fullAddress));
  if (matched?.map) return matched.map;
  if (entry.level === 'lot' || entry.level === 'town') {
    const townMatch = legacyByAddressLookup.get(normalizeAddressForLookup(`${PREFECTURE}${CITY}${entry.baseTown}`));
    if (townMatch?.map) return townMatch.map;
  } else {
    const townMatch = legacyByAddressLookup.get(normalizeAddressForLookup(entry.fullAddress));
    if (townMatch?.map) return townMatch.map;
  }
  return null;
}

async function buildMaster() {
  const [legacyRaw, geolonia] = await Promise.all([
    fs.promises.readFile(DATA_JSON_PATH, 'utf8').then(JSON.parse).catch(() => ({ entries: [], map: { width: KNOWN_MAP_WIDTH, height: KNOWN_MAP_HEIGHT } })),
    fetchJson(GEOLONIA_API)
  ]);

  const legacyEntries = legacyRaw.entries || [];
  const legacyByAddress = new Map();
  const legacyTownCoordinates = new Map();
  for (const item of legacyEntries) {
    legacyByAddress.set(normalizeAddressForLookup(item.fullAddress), item);
    if (item.level === 'town' && item.name) {
      legacyTownCoordinates.set(item.name, {
        lat: Number(item.lat),
        lng: Number(item.lng)
      });
    }
  }

  const cityCandidates = Array.isArray(geolonia) ? geolonia.filter(item => item && item.koaza === '') : [];
  const townList = [];
  const chomeFromGeolonia = [];
  for (const item of cityCandidates) {
    if (item.town.includes('丁目')) {
      chomeFromGeolonia.push(item);
    } else {
      townList.push(item.town);
    }
  }

  const uniqueTownList = [...new Set(townList)].sort();
  const geoloniaChomeByTown = new Map();
  const chomeFallbackTownCoordinate = new Map();
  for (const item of chomeFromGeolonia) {
    const chomeNumMatch = item.town.match(/(\p{N}+|[一二三四五六七八九十]+)丁目/u);
    const chomeNum = chomeNumMatch
      ? /^\p{N}$/u.test(chomeNumMatch[1]) ? Number(chomeNumMatch[1]) : kanjiToArabic(chomeNumMatch[1])
      : null;
    if (!Number.isFinite(chomeNum)) continue;
    const fullAddress = `${CITY_FULL}${item.town}`;
    const normalizedTown = item.town.replace(/([一二三四五六七八九十]+)丁目$/, '');
    const byTown = geoloniaChomeByTown.get(normalizedTown) || new Map();
    byTown.set(chomeNum, {
      source: 'geolonia-japanese-addresses',
      fullAddress,
      townName: normalizedTown,
      chomeNum,
      lat: Number(Number(item.lat).toFixed(12)),
      lng: Number(Number(item.lng).toFixed(12)),
      townLabel: item.town
    });
    geoloniaChomeByTown.set(normalizedTown, byTown);
    if (!chomeFallbackTownCoordinate.has(normalizedTown)) {
      chomeFallbackTownCoordinate.set(normalizedTown, {
        lat: Number(Number(item.lat).toFixed(12)),
        lng: Number(Number(item.lng).toFixed(12))
      });
    }
  }

  const allTownNames = [...new Set([
    ...uniqueTownList,
    ...chomeFallbackTownCoordinate.keys(),
    ...legacyTownCoordinates.keys()
  ])].sort();

  const geoloniaEntries = [];

  for (const name of allTownNames) {
    const townGeo = cityCandidates.find(item => item.town === name)
      || chomeFallbackTownCoordinate.get(name)
      || legacyTownCoordinates.get(name);
    if (!townGeo) continue;
    geoloniaEntries.push(createEntry({
      source: 'geolonia-japanese-addresses',
      fullAddress: `${CITY_FULL}${name}`,
      townName: name,
      lat: Number(townGeo.lat).toFixed ? Number(Number(townGeo.lat).toFixed(12)) : Number(townGeo.lat),
      lng: Number(townGeo.lng).toFixed ? Number(Number(townGeo.lng).toFixed(12)) : Number(townGeo.lng),
      level: 'town',
      map: buildStaticMapFromLegacy({
        fullAddress: `${CITY_FULL}${name}`,
        baseTown: name,
        level: 'town'
      }, legacyByAddress)
    }));
  }

  for (const item of geoloniaEntries) {
    item.map = item.map || {
      x: null,
      y: null,
      xRatio: null,
      yRatio: null,
      source: 'manual-overview'
    };
    item.note = 'geolonia-japanese-addresses';
  }

  const discoveredLotEntries = [];
  const gsiLotByTown = new Map();
  const existingTownMap = new Map();
  const townCoordinateByName = new Map();
  for (const item of geoloniaEntries) {
    existingTownMap.set(item.name, item.map);
    townCoordinateByName.set(item.name, {
      lat: Number(item.lat),
      lng: Number(item.lng)
    });
  }

  let detectedByApiCount = 0;
  let geoloniaFallbackCount = 0;
  let estimatedCount = 0;
  console.log(`build start: townCount=${allTownNames.length}, maxLot=${MAX_LOT}`);
  for (const town of allTownNames) {
    console.log(`scan town start: ${town}`);
    let missCount = 0;
    const foundByTown = new Map();
    for (let n = 1; n <= MAX_LOT; n++) {
      const useSparseQuery = n > SPARSE_SCAN_START;
      const matched = useSparseQuery ? await findGsiLotMatchSparse(town, n) : await findGsiLotMatch(town, n);

      if (!matched) {
        missCount += 1;
        if (!useSparseQuery && n >= 20 && missCount >= CONSECUTIVE_MISS_LIMIT) break;
        continue;
      }

      missCount = 0;
      const lotNum = extractLotNumberFromTitle(matched.properties.title, town);
      if (!Number.isFinite(lotNum)) continue;
      if (foundByTown.has(lotNum)) continue;
      foundByTown.set(lotNum, {
        source: 'gsi-address-search',
        fullAddress: `${CITY_FULL}${town}${lotNum}番地`,
        lat: Number(Number(matched.geometry.coordinates[1]).toFixed(12)),
        lng: Number(Number(matched.geometry.coordinates[0]).toFixed(12)),
        note: 'gsi-addresssearch'
      });
      detectedByApiCount += 1;
    }
    gsiLotByTown.set(town, foundByTown);
  }

  for (const town of allTownNames) {
    const parentMap = existingTownMap.get(town);
    const parentTownCoordinate = townCoordinateByName.get(town);
    const detectedForTown = gsiLotByTown.get(town) || new Map();
    const geoloniaForTown = geoloniaChomeByTown.get(town) || new Map();

    for (let n = 1; n <= MAX_LOT; n++) {
      const fullAddress = `${CITY_FULL}${town}${n}番地`;

      const legacyMap = legacyByAddress.get(normalizeAddressForLookup(fullAddress));
      const detected = detectedForTown.get(n);
      if (detected) {
        const map = legacyMap?.map || mapFromParentWithOffset(parentMap, fullAddress, n);
        discoveredLotEntries.push(createEntry({
          ...detected,
          townName: town,
          map: {
            ...map,
            source: map?.source || detected.source || 'gsi-addresssearch'
          },
          level: 'lot',
          lotNum: n
        }));
        continue;
      }

      const gsiLot = geoloniaForTown.get(n);
      if (gsiLot) {
        const map = legacyMap?.map || mapFromParentWithOffset(parentMap, fullAddress, n);
        geoloniaFallbackCount += 1;
        discoveredLotEntries.push(createEntry({
          source: 'geolonia-japanese-addresses',
          fullAddress,
          townName: town,
          lat: gsiLot.lat,
          lng: gsiLot.lng,
          map,
          level: 'lot',
          lotNum: n,
          note: 'fallback-from-geolonia'
        }));
        continue;
      }

      estimatedCount += 1;
      discoveredLotEntries.push(createEntry({
        source: 'gsi-estimated',
        fullAddress,
        townName: town,
        lat: parentTownCoordinate?.lat ?? 0,
        lng: parentTownCoordinate?.lng ?? 0,
        map: mapFromParentWithOffset(parentMap, fullAddress, n),
        level: 'lot',
        lotNum: n,
        note: 'estimated-by-gsi-scan'
      }));
    }
  }

  discoveredLotEntries.sort((a, b) => {
    if (a.name === b.name) return 0;
    return a.name < b.name ? -1 : 1;
  });

  const townEntries = geoloniaEntries.map(item => {
    const merged = {
      ...item,
      note: item.note || 'geolonia-japanese-addresses'
    };
    merged.map = merged.map || legacyByAddress.get(normalizeAddressForLookup(merged.fullAddress))?.map || {
      x: null,
      y: null,
      xRatio: null,
      yRatio: null,
      source: 'manual-overview'
    };
    return merged;
  });

  const allEntries = [...townEntries, ...discoveredLotEntries];

  for (const entry of allEntries) {
    if (entry.map) {
      entry.map.x = Number(entry.map.x);
      entry.map.y = Number(entry.map.y);
      entry.map.xRatio = Number(entry.map.xRatio);
      entry.map.yRatio = Number(entry.map.yRatio);
    } else {
      entry.map = {
        x: null,
        y: null,
        xRatio: null,
        yRatio: null,
        source: 'unknown'
      };
    }
  }

  const db = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString().slice(0, 10),
    area: {
      prefecture: PREFECTURE,
      city: CITY
    },
    map: {
      id: 'isesaki-kuwamap-overview',
      src: 'assets/isesaki-kuwamap-overview.png',
      width: KNOWN_MAP_WIDTH,
      height: KNOWN_MAP_HEIGHT
    },
    sources: [
      {
        id: 'geolonia-japanese-addresses',
        name: 'Geolonia 住所データ',
        url: 'https://geolonia.github.io/japanese-addresses/',
        license: 'MIT License',
        note: '町丁目・大字・小字レベルの住所データ（参考用）'
      },
      {
        id: 'gsi-address-search',
        name: '国土地理院 アドレスサーチAPI',
        url: 'https://msearch.gsi.go.jp/address-search/',
        license: 'CC BY 4.0',
        note: '番地候補抽出（検出時）'
      },
      {
        id: 'isesaki-kuwamap-overview',
        name: 'いせさきくわまっぷ由来の概略地図',
        url: 'https://www2.wagmap.jp/isesaki-sp/',
        license: '要確認',
        note: 'MVP表示用の概略背景。座標はこの画像上の推定値'
      }
    ],
    precisionPolicy: {
      primary: '番地までの代表点（可能な限り取得）',
      fallback: '番地が取得できない場合は町域代表点へ相対オフセット',
      lotNumber: '番地ごとの近似オフセット'
    },
    entries: allEntries
  };

  await fs.promises.writeFile(DATA_JSON_PATH, `${JSON.stringify(db, null, 2)}\n`);
  const jsContent = `window.ISESAKI_ADDRESS_DB = ${JSON.stringify(db, null, 2)};`;
  await fs.promises.writeFile(DATA_JS_PATH, `${jsContent}\n`);

  const detectedLotCount = discoveredLotEntries.length;
  const townCount = geoloniaEntries.length;
  const townMapMissing = geoloniaEntries.filter(item => !item.map?.x || !item.map?.y).length;
  console.log(`生成: 町域=${townCount}, 番地=${detectedLotCount}, townMap未設定=${townMapMissing}`);
  console.log(`api検出=${detectedByApiCount} / geoloniaFallback=${geoloniaFallbackCount} / 推定=${estimatedCount}`);
  console.log(`output: ${DATA_JSON_PATH}, ${DATA_JS_PATH}`);
}

buildMaster().catch(error => {
  console.error(error);
  process.exit(1);
});
