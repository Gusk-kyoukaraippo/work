(function attachArboCore(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ArboCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createArboCore() {
  'use strict';

  const DAILY_COLUMNS = {
    id: ['利用者ID', 'ID', 'No', 'no', 'id'],
    name: ['利用者名', '利用者氏名', '氏名', '名前', 'name'],
    address: ['住所', '利用者住所', '送迎先住所', 'address'],
    wheelchair: ['車いす利用', '車椅子利用', '車いす', '車椅子', 'wheelchair'],
    wheelchairOk: ['車いす代替乗車可', '車椅子代替乗車可', '代替乗車可', 'wheelchair_ok'],
    mirror: ['ミラー折り畳み必須', 'ミラー折畳必須', 'ミラー必須', 'mirror_required'],
    lat: ['緯度', 'lat', 'latitude'],
    lon: ['経度', 'lng', 'lon', 'longitude'],
    coordinateSource: ['座標情報元', '位置情報元', '座標取得方法', 'coordinate_source', 'coordinate_method'],
    coordinateTargetAddress: ['座標取得時住所', '座標対象住所', 'coordinate_target_address'],
    coordinateMatchedAddress: ['座標代表住所', 'coordinate_matched_address'],
    matchedAddress: ['照合住所', 'matched_address'],
    addressMatchLevel: ['住所一致レベル', '一致レベル', 'address_match_level'],
    unmatchedAddress: ['未一致部分', 'unmatched_address'],
    addressSource: ['住所情報元', 'address_source']
  };

  const HISTORY_COLUMNS = {
    date: ['日付', 'date'],
    trip: ['便', '便区分', 'trip'],
    id: ['利用者ID', 'ID', 'id'],
    vehicle: ['車両番号', '車両', 'vehicle'],
    seat: ['座席区分', '座席', 'seat'],
    order: ['訪問順', '順番', 'order']
  };

  const PLAN_PROFILES = [
    {
      id: 'balanced', label: 'バランス案', description: '距離・履歴・使用台数をバランスよく評価',
      distance: 1, vehicles: 0.9, substitute: 3.4, imbalance: 0.25, pair: 1.0, affinity: 0.6, noise: 2.2
    },
    {
      id: 'history', label: '過去実績重視案', description: '以前に同乗した人と慣れた車両を優先',
      distance: 0.65, vehicles: 0.5, substitute: 3.2, imbalance: 0.15, pair: 2.8, affinity: 1.7, noise: 1.8
    },
    {
      id: 'compact', label: '経路まとまり案', description: '住所の近さと道路距離を強く優先',
      distance: 1.65, vehicles: 0.45, substitute: 3.0, imbalance: 0.18, pair: 0.35, affinity: 0.2, noise: 1.5
    },
    {
      id: 'few-vehicles', label: '使用台数抑制案', description: '不要な車両をなるべく使わない',
      distance: 0.7, vehicles: 80, substitute: 3.4, imbalance: 0.1, pair: 0.55, affinity: 0.35, noise: 1.2
    },
    {
      id: 'alternative', label: '別パターン案', description: '上位案とは異なる組み合わせを提示',
      distance: 0.95, vehicles: 1.0, substitute: 3.1, imbalance: 0.35, pair: 0.9, affinity: 0.5, noise: 5.5
    }
  ];

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const source = String(text || '');
    for (let index = 0; index < source.length; index++) {
      const char = source[index];
      const next = source[index + 1];
      if (quoted) {
        if (char === '"' && next === '"') {
          field += '"';
          index++;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (char !== '\r') {
        field += char;
      }
    }
    row.push(field);
    rows.push(row);
    return rows.filter(columns => columns.some(value => String(value).trim() !== ''));
  }

  function toCsv(rows) {
    return rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  }

  function normalizedHeader(value) {
    return String(value || '').replace(/^\uFEFF/, '').trim();
  }

  function findHeader(headers, candidates) {
    const normalized = headers.map(normalizedHeader);
    for (const candidate of candidates) {
      const index = normalized.indexOf(candidate);
      if (index >= 0) return index;
    }
    return -1;
  }

  function locateHeaderRow(rows, requiredCandidates) {
    return rows.findIndex(row => requiredCandidates.some(candidates => findHeader(row, candidates) >= 0));
  }

  const KANJI_DIGITS = new Map([
    ['〇', 0], ['零', 0], ['一', 1], ['二', 2], ['三', 3], ['四', 4], ['五', 5],
    ['六', 6], ['七', 7], ['八', 8], ['九', 9]
  ]);

  function japaneseNumber(value) {
    const source = String(value || '');
    if (!source) return null;
    if (/^\d+$/.test(source)) return Number(source);
    let total = 0;
    let current = 0;
    for (const character of source) {
      if (KANJI_DIGITS.has(character)) {
        current = KANJI_DIGITS.get(character);
      } else if (character === '十') {
        total += (current || 1) * 10;
        current = 0;
      } else if (character === '百') {
        total += (current || 1) * 100;
        current = 0;
      } else {
        return null;
      }
    }
    return total + current;
  }

  function normalizeAddress(value) {
    let normalized = String(value || '').normalize('NFKC').trim();
    normalized = normalized
      .replace(/^[\s　]*〒?\s*\d{3}\s*[-‐‑‒–—―−﹘﹣－]?\s*\d{4}\s*/, '')
      .replace(/^[\s　]*日本(?:国)?/, '')
      .replace(/^[\s　]*群馬県/, '')
      .replace(/^[\s　]*伊勢崎市/, '')
      .replace(/^大字/, '')
      .replace(/([\u3007零一二三四五六七八九十百]+)丁目/g, (match, number) => {
        const parsed = japaneseNumber(number);
        return parsed == null ? match : `${parsed}丁目`;
      })
      .replace(/[‐‑‒–—―−﹘﹣－]/g, '-')
      .replace(/丁目-/g, '丁目')
      .replace(/(\d)\s*の\s*(?=\d)/g, '$1-')
      .replace(/([\d甲乙丙丁戊己庚辛壬癸])番地?\s*(?:の)?\s*(?=[\d甲乙丙丁戊己庚辛壬癸])/g, '$1-')
      .replace(/([\d甲乙丙丁戊己庚辛壬癸])番地?(?=$|[^\d])/g, '$1')
      .replace(/[\s　]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    return normalized;
  }

  function addressAliases(value) {
    const canonical = normalizeAddress(value);
    if (!canonical) return [];
    const aliases = new Set([canonical]);
    aliases.add(canonical.replace(/(\d+)丁目(?=\d)/g, '$1-'));
    aliases.add(canonical.replace(/(\d+)丁目$/g, '$1-'));
    return [...aliases].filter(Boolean);
  }

  function formatArea(area) {
    return `${area?.[0] || ''}${area?.[1] || ''}${area?.[2] || ''}`;
  }

  function formatParcel(area, row) {
    const numbers = [row?.[1], row?.[2], row?.[3]].filter(value => value !== 0 && value !== '' && value != null);
    if (!numbers.length) return formatArea(area);
    return `${formatArea(area)}${numbers[0]}番地${numbers.slice(1).join('-')}`;
  }

  function matchLevelLabel(level) {
    return ({
      parcel_branch: '地番・枝番まで一致',
      parcel: '地番まで一致',
      parent_lot: '親地番まで一致',
      residential_block: '住居表示の街区まで一致',
      chome: '丁目まで一致',
      town: '町域まで一致',
      unresolved: '未照合'
    })[level] || '未照合';
  }

  function numericParts(row) {
    return [row?.[1], row?.[2], row?.[3]]
      .filter(value => value !== 0 && value !== '' && value != null)
      .map(String);
  }

  function addressIdentity(match) {
    if (!match) return '';
    const matched = normalizeAddress(match.matchedAddress || '');
    if (!matched) return normalizeAddress(match.normalizedAddress || match.unmatchedAddress || '');
    let suffix = normalizeAddress(match.unmatchedAddress || '');
    if (match.addressMatchLevel === 'residential_block') suffix = suffix.replace(/^(\d+)号$/, '$1');
    return `${matched}\u0001${suffix}`;
  }

  function prefixMatch(map, key, minimumLength = 1) {
    for (let length = key.length; length >= minimumLength; length--) {
      let candidate = key.slice(0, length);
      if (candidate.endsWith('-')) candidate = candidate.slice(0, -1);
      const entry = map.get(candidate);
      const next = key[candidate.length] || '';
      if (entry && !(/\d$/.test(candidate) && /^\d/.test(next))) return { entry, consumed: candidate.length };
    }
    return null;
  }

  class AddressResolver {
    constructor(data = {}) {
      this.data = data;
      this.scale = data.coordinateScale || data.abr?.coordinateScale || 1_000_000;
      this.exact = new Map((data.exact || []).map(entry => [normalizeAddress(entry[0]), entry]));
      this.legacyTowns = [...(data.towns || [])]
        .map(entry => ({ entry, key: normalizeAddress(entry[0]) }))
        .filter(item => item.key)
        .sort((left, right) => right.key.length - left.key.length);

      const abr = data.abr || {};
      this.abr = abr;
      this.areas = (abr.areas || []).map((area, index) => ({
        index,
        data: area,
        display: formatArea(area),
        aliases: addressAliases(formatArea(area)),
        residential: Boolean(area?.[3]),
        townPosition: null,
        parcels: [],
        blocks: []
      }));
      for (const row of abr.parcels || []) this.areas[row[0]]?.parcels.push(row);
      for (const row of abr.blocks || []) this.areas[row[0]]?.blocks.push(row);
      for (const row of abr.towns || []) {
        const area = this.areas[row[0]];
        if (area) area.townPosition = { lat: row[1] / this.scale, lon: row[2] / this.scale };
      }
      this.areaAliases = this.areas
        .flatMap(area => area.aliases.map(alias => ({ area, alias })))
        .sort((left, right) => right.alias.length - left.alias.length);
    }

    findAreaMatches(key) {
      let longest = 0;
      const matches = [];
      for (const candidate of this.areaAliases) {
        if (candidate.alias.length < longest) break;
        if (!key.startsWith(candidate.alias)) continue;
        if (!longest) longest = candidate.alias.length;
        if (candidate.alias.length === longest) matches.push(candidate);
      }
      return matches;
    }

    matchParcel(candidate, key) {
      const tail = key.slice(candidate.alias.length);
      const numeric = tail.match(/^([甲乙丙丁戊己庚辛壬癸]?\d+|[甲乙丙丁戊己庚辛壬癸])(?:-([甲乙丙丁戊己庚辛壬癸]?\d+|[甲乙丙丁戊己庚辛壬癸]))?(?:-([甲乙丙丁戊己庚辛壬癸]?\d+|[甲乙丙丁戊己庚辛壬癸]))?/);
      if (!numeric) return null;
      const supplied = numeric.slice(1).filter(Boolean);
      const parentRows = candidate.area.parcels.filter(row => numericParts(row)[0] === supplied[0]);
      if (!parentRows.length) return null;
      const exactRows = parentRows.filter(row => {
        const parts = numericParts(row);
        return parts.length === supplied.length && supplied.every((part, index) => parts[index] === part);
      });
      const chosenRows = exactRows.length ? exactRows : parentRows;
      const chosen = chosenRows.find(row => row[4] && row[5]) || chosenRows[0];
      const chosenParts = numericParts(chosen);
      const exact = exactRows.length > 0;
      const consumedTail = exact ? numeric[0].length : supplied[0].length;
      const remaining = tail.slice(consumedTail).replace(/^-/, '');
      const level = exact
        ? chosenParts.length > 1 ? 'parcel_branch' : 'parcel'
        : 'parent_lot';
      const matchedRow = exact ? chosen : [chosen[0], supplied[0], 0, 0, 0, 0];
      const hasCoordinate = exact && chosen[4] && chosen[5];
      const matchedAddress = `群馬県伊勢崎市${formatParcel(candidate.area.data, matchedRow)}`;
      return {
        matchedAddress,
        unmatchedAddress: remaining,
        addressMatchLevel: level,
        addressMatchLabel: matchLevelLabel(level),
        addressSource: 'デジタル庁ABR・地番マスタ',
        coordinate: hasCoordinate ? { lat: chosen[4] / this.scale, lon: chosen[5] / this.scale } : null,
        coordinateLabel: hasCoordinate ? 'ABR地番代表点' : '',
        coordinateMatchedAddress: hasCoordinate ? matchedAddress : '',
        coordinateAmbiguous: Boolean(exact && (chosen[6] || chosenRows.filter(row => row[4] && row[5]).length > 1)),
        fallbackCoordinate: candidate.area.townPosition,
        fallbackCoordinateLabel: candidate.area.townPosition ? (candidate.area.data?.[1] ? 'ABR丁目代表点' : 'ABR町域代表点') : '',
        fallbackCoordinateMatchedAddress: candidate.area.townPosition ? `群馬県伊勢崎市${candidate.area.display}` : '',
        areaHasChome: Boolean(candidate.area.data?.[1])
      };
    }

    matchBlock(candidate, key) {
      const tail = key.slice(candidate.alias.length);
      const numeric = tail.match(/^(\d+)/);
      if (!numeric) return null;
      const rows = candidate.area.blocks.filter(row => String(row[1]) === numeric[1]);
      if (!rows.length) return null;
      const chosen = rows[0];
      const remaining = tail.slice(numeric[0].length).replace(/^-/, '');
      const matchedAddress = `群馬県伊勢崎市${candidate.area.display}${chosen[1]}番`;
      return {
        matchedAddress,
        unmatchedAddress: remaining,
        addressMatchLevel: 'residential_block',
        addressMatchLabel: matchLevelLabel('residential_block'),
        addressSource: 'デジタル庁ABR・住居表示街区マスタ',
        coordinate: { lat: chosen[2] / this.scale, lon: chosen[3] / this.scale },
        coordinateLabel: 'ABR街区代表点',
        coordinateMatchedAddress: matchedAddress,
        coordinateAmbiguous: Boolean(chosen[4] || rows.length > 1),
        fallbackCoordinate: candidate.area.townPosition,
        fallbackCoordinateLabel: candidate.area.townPosition ? (candidate.area.data?.[1] ? 'ABR丁目代表点' : 'ABR町域代表点') : '',
        fallbackCoordinateMatchedAddress: candidate.area.townPosition ? `群馬県伊勢崎市${candidate.area.display}` : '',
        areaHasChome: Boolean(candidate.area.data?.[1])
      };
    }

    matchAddress(address) {
      const key = normalizeAddress(address);
      if (!key) return {
        normalizedAddress: '', matchedAddress: '', unmatchedAddress: '',
        addressMatchLevel: 'unresolved', addressMatchLabel: matchLevelLabel('unresolved'), addressSource: '', coordinate: null
      };
      const areaMatches = this.findAreaMatches(key);
      const parcelIntent = /番地|地番/.test(String(address || ''));
      const residentialDisplayIntent = !parcelIntent
        && areaMatches.some(candidate => candidate.area.residential);
      for (const candidate of areaMatches) {
        if (candidate.area.residential) {
          if (parcelIntent) {
            const parcel = this.matchParcel(candidate, key);
            if (parcel) return { normalizedAddress: key, ...parcel };
          } else {
            const block = this.matchBlock(candidate, key);
            if (block) return { normalizedAddress: key, ...block };
          }
          continue;
        }
        const parcel = this.matchParcel(candidate, key);
        if (parcel) return { normalizedAddress: key, ...parcel };
        const block = this.matchBlock(candidate, key);
        if (block) return { normalizedAddress: key, ...block };
      }

      const legacyExact = prefixMatch(this.exact, key);
      if (legacyExact
        && !residentialDisplayIntent
        && !areaMatches.some(candidate => candidate.area.data?.[1])) {
        const entry = legacyExact.entry;
        const remaining = key.slice(legacyExact.consumed).replace(/^-/, '');
        return {
          normalizedAddress: key,
          matchedAddress: entry[3] || `群馬県伊勢崎市${entry[0]}`,
          unmatchedAddress: remaining,
          addressMatchLevel: remaining && /^\d/.test(remaining) ? 'parent_lot' : 'parcel',
          addressMatchLabel: matchLevelLabel(remaining && /^\d/.test(remaining) ? 'parent_lot' : 'parcel'),
          addressSource: '国土地理院住所検索',
          coordinate: { lat: entry[1] / this.scale, lon: entry[2] / this.scale },
          coordinateLabel: 'GSI番地代表点',
          coordinateMatchedAddress: entry[3] || `群馬県伊勢崎市${entry[0]}`,
          coordinateAmbiguous: false,
          fallbackCoordinate: null,
          fallbackCoordinateLabel: '',
          fallbackCoordinateMatchedAddress: '',
          areaHasChome: false
        };
      }

      if (areaMatches.length) {
        const candidate = areaMatches[0];
        const level = candidate.area.data?.[1] ? 'chome' : 'town';
        return {
          normalizedAddress: key,
          matchedAddress: `群馬県伊勢崎市${candidate.area.display}`,
          unmatchedAddress: key.slice(candidate.alias.length).replace(/^-/, ''),
          addressMatchLevel: level,
          addressMatchLabel: matchLevelLabel(level),
          addressSource: 'デジタル庁ABR・町字マスタ',
          coordinate: candidate.area.townPosition,
          coordinateLabel: candidate.area.townPosition ? (level === 'chome' ? 'ABR丁目代表点' : 'ABR町域代表点') : '',
          coordinateMatchedAddress: candidate.area.townPosition ? `群馬県伊勢崎市${candidate.area.display}` : '',
          coordinateAmbiguous: false,
          fallbackCoordinate: null,
          fallbackCoordinateLabel: '',
          fallbackCoordinateMatchedAddress: '',
          areaHasChome: Boolean(candidate.area.data?.[1])
        };
      }

      const town = this.legacyTowns.find(candidate => key.startsWith(candidate.key));
      if (town) {
        return {
          normalizedAddress: key,
          matchedAddress: `群馬県伊勢崎市${town.entry[0]}`,
          unmatchedAddress: key.slice(town.key.length).replace(/^-/, ''),
          addressMatchLevel: 'town',
          addressMatchLabel: matchLevelLabel('town'),
          addressSource: '町域代表点データ',
          coordinate: { lat: town.entry[1] / this.scale, lon: town.entry[2] / this.scale },
          coordinateLabel: '町域代表点',
          coordinateMatchedAddress: `群馬県伊勢崎市${town.entry[0]}`,
          coordinateAmbiguous: false,
          fallbackCoordinate: null,
          fallbackCoordinateLabel: '',
          fallbackCoordinateMatchedAddress: '',
          areaHasChome: false
        };
      }
      return {
        normalizedAddress: key, matchedAddress: '', unmatchedAddress: key,
        addressMatchLevel: 'unresolved', addressMatchLabel: matchLevelLabel('unresolved'), addressSource: '', coordinate: null,
        coordinateLabel: '', coordinateMatchedAddress: '', coordinateAmbiguous: false,
        fallbackCoordinate: null, fallbackCoordinateLabel: '', fallbackCoordinateMatchedAddress: '', areaHasChome: false
      };
    }

    resolve(user) {
      const match = this.matchAddress(user.address);
      const {
        coordinate: matchedCoordinate,
        coordinateLabel: matchedCoordinateLabel,
        coordinateMatchedAddress: matchedCoordinateAddress,
        fallbackCoordinate,
        fallbackCoordinateLabel,
        fallbackCoordinateMatchedAddress,
        areaHasChome,
        ...addressMatch
      } = match;
      const explicitCoordinates = Number.isFinite(user.lat) && Number.isFinite(user.lon);
      const targetAddress = user.coordinateTargetAddress || (explicitCoordinates ? user.address : '');
      const targetMatch = targetAddress ? this.matchAddress(targetAddress) : null;
      const coordinateAddressMismatch = Boolean(
        explicitCoordinates && targetAddress && addressIdentity(targetMatch) !== addressIdentity(match)
      );
      if (explicitCoordinates) {
        const source = user.coordinateSource || user.coordinateMethod || 'CSV座標';
        const manual = ['地図補正', '手動入力', '現地確認'].some(label => source.includes(label));
        const town = source.includes('町域代表点') || source.includes('丁目代表点');
        const precise = source.includes('番地代表点') || source.includes('地番代表点') || source.includes('街区代表点');
        const representativeAddress = user.coordinateMatchedAddress
          || (manual ? user.address : source.startsWith('ABR') && matchedCoordinate ? matchedCoordinateAddress : '');
        return {
          ...user,
          ...addressMatch,
          locationPrecision: manual ? 'manual' : town ? 'town' : precise ? 'exact' : 'coordinate',
          locationLabel: source,
          coordinateSource: source,
          coordinateMethod: manual ? 'manual' : source.startsWith('ABR') ? 'abr' : source.startsWith('GSI') ? 'gsi' : 'csv',
          coordinateTargetAddress: targetAddress || user.address,
          coordinateMatchedAddress: representativeAddress,
          coordinateAddressMismatch,
          resolvedAddress: match.matchedAddress
        };
      }
      let automaticCoordinate = matchedCoordinate;
      let automaticLabel = matchedCoordinateLabel;
      let automaticMatchedAddress = matchedCoordinateAddress;
      if (!automaticCoordinate && !areaHasChome) {
        const legacy = prefixMatch(this.exact, match.normalizedAddress || '');
        if (legacy) {
          automaticCoordinate = { lat: legacy.entry[1] / this.scale, lon: legacy.entry[2] / this.scale };
          automaticLabel = 'GSI番地代表点';
          automaticMatchedAddress = legacy.entry[3] || `群馬県伊勢崎市${legacy.entry[0]}`;
        }
      }
      if (!automaticCoordinate && fallbackCoordinate) {
        automaticCoordinate = fallbackCoordinate;
        automaticLabel = fallbackCoordinateLabel;
        automaticMatchedAddress = fallbackCoordinateMatchedAddress;
      }
      if (automaticCoordinate) {
        const town = ['town', 'chome'].includes(match.addressMatchLevel) || automaticLabel.includes('町域代表点') || automaticLabel.includes('丁目代表点');
        return {
          ...user,
          ...addressMatch,
          lat: automaticCoordinate.lat,
          lon: automaticCoordinate.lon,
          locationPrecision: town ? 'town' : 'exact',
          locationLabel: automaticLabel,
          coordinateSource: automaticLabel,
          coordinateMethod: automaticLabel.startsWith('ABR') ? 'abr' : automaticLabel.startsWith('GSI') ? 'gsi' : 'address-db',
          coordinateTargetAddress: user.address,
          coordinateMatchedAddress: automaticMatchedAddress,
          coordinateAddressMismatch: false,
          resolvedAddress: match.matchedAddress
        };
      }
      return {
        ...user,
        ...addressMatch,
        lat: null,
        lon: null,
        locationPrecision: 'missing',
        locationLabel: '座標未解決',
        coordinateSource: '',
        coordinateMethod: '',
        coordinateTargetAddress: '',
        coordinateMatchedAddress: '',
        coordinateAddressMismatch: false,
        resolvedAddress: match.matchedAddress
      };
    }
  }

  const BOOLEAN_TRUE = ['1', 'true', 'yes', 'y', 'はい', '可', '可能', '○', '〇', '有', 'あり', '車いす', '車椅子'];
  const BOOLEAN_FALSE = ['0', 'false', 'no', 'n', 'いいえ', '不可', '不可能', '×', '✕', '無', 'なし', '歩行', '通常'];

  function parseBooleanValue(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return null;
    if (BOOLEAN_TRUE.includes(normalized)) return true;
    if (BOOLEAN_FALSE.includes(normalized)) return false;
    return null;
  }

  function parseBoolean(value) {
    return parseBooleanValue(value) === true;
  }

  function parseDailyCsv(text) {
    const rows = parseCsv(text);
    const headerIndex = locateHeaderRow(rows, [DAILY_COLUMNS.name, DAILY_COLUMNS.address]);
    if (headerIndex < 0) throw new Error('利用者名または住所の列が見つかりません。');
    const headers = rows[headerIndex].map(normalizedHeader);
    const column = Object.fromEntries(Object.entries(DAILY_COLUMNS).map(([key, names]) => [key, findHeader(headers, names)]));
    if (column.name < 0 || column.address < 0) throw new Error('「利用者名」と「住所」の列が必要です。');
    const requiredFlags = [
      ['車いす利用', column.wheelchair],
      ['車いす代替乗車可', column.wheelchairOk],
      ['ミラー折り畳み必須', column.mirror]
    ];
    const missingFlags = requiredFlags.filter(([, index]) => index < 0).map(([label]) => label);
    if (missingFlags.length) throw new Error(`安全な配車のため「${missingFlags.join('」「')}」列が必要です。CSVひな形を確認してください。`);

    const parsedRows = rows.slice(headerIndex + 1)
      .filter(row => row.some(value => String(value || '').trim()))
      .map((row, index) => {
        const name = String(row[column.name] || '').trim() || `利用者${index + 1}`;
        const address = String(row[column.address] || '').trim();
        const idValue = column.id >= 0 ? String(row[column.id] || '').trim() : '';
        const rawLat = column.lat >= 0 ? String(row[column.lat] ?? '').trim() : '';
        const rawLon = column.lon >= 0 ? String(row[column.lon] ?? '').trim() : '';
        const hasLat = rawLat !== '';
        const hasLon = rawLon !== '';
        const lat = hasLat ? Number(rawLat) : null;
        const lon = hasLon ? Number(rawLon) : null;
        const coordinateErrors = [];
        if (hasLat !== hasLon) {
          coordinateErrors.push('緯度と経度は両方入力してください');
        } else if (hasLat && (!Number.isFinite(lat) || !Number.isFinite(lon))) {
          coordinateErrors.push('緯度・経度には数値を入力してください');
        }
        const wheelchair = parseBooleanValue(row[column.wheelchair]);
        const wheelchairOk = parseBooleanValue(row[column.wheelchairOk]);
        const mirrorRequired = parseBooleanValue(row[column.mirror]);
        return {
          id: idValue || `U${String(index + 1).padStart(3, '0')}`,
          name,
          address,
          mobility: wheelchair === true ? 'wheelchair' : wheelchair === false ? 'walking' : 'unknown',
          wheelchairOk,
          mirrorRequired,
          lat: Number.isFinite(lat) ? lat : null,
          lon: Number.isFinite(lon) ? lon : null,
          coordinateSource: column.coordinateSource >= 0 ? String(row[column.coordinateSource] ?? '').trim() : '',
          coordinateTargetAddress: column.coordinateTargetAddress >= 0 ? String(row[column.coordinateTargetAddress] ?? '').trim() : '',
          coordinateMatchedAddress: column.coordinateMatchedAddress >= 0 ? String(row[column.coordinateMatchedAddress] ?? '').trim() : '',
          matchedAddress: column.matchedAddress >= 0 ? String(row[column.matchedAddress] ?? '').trim() : '',
          addressMatchLevel: column.addressMatchLevel >= 0 ? String(row[column.addressMatchLevel] ?? '').trim() : '',
          unmatchedAddress: column.unmatchedAddress >= 0 ? String(row[column.unmatchedAddress] ?? '').trim() : '',
          addressSource: column.addressSource >= 0 ? String(row[column.addressSource] ?? '').trim() : '',
          sourceRow: index + headerIndex + 2,
          coordinateErrors,
          flagErrors: [
            wheelchair === null ? '車いす利用' : '',
            wheelchairOk === null ? '車いす代替乗車可' : '',
            mirrorRequired === null ? 'ミラー折り畳み必須' : ''
          ].filter(Boolean)
        };
      });
    const invalidCoordinates = parsedRows.filter(row => row.coordinateErrors.length);
    if (invalidCoordinates.length) {
      const details = invalidCoordinates.slice(0, 5)
        .map(row => `${row.sourceRow}行目: ${row.coordinateErrors.join('・')}`)
        .join('、');
      const rest = invalidCoordinates.length > 5 ? `ほか${invalidCoordinates.length - 5}行` : '';
      throw new Error(`座標に誤りがあります（${details}${rest}）。`);
    }
    const invalid = parsedRows.filter(row => row.flagErrors.length);
    if (invalid.length) {
      const details = invalid.slice(0, 5).map(row => `${row.sourceRow}行目: ${row.flagErrors.join('・')}`).join('、');
      const rest = invalid.length > 5 ? `ほか${invalid.length - 5}行` : '';
      throw new Error(`「はい／いいえ」を判定できない項目があります（${details}${rest}）。`);
    }
    return parsedRows.map(({ coordinateErrors, flagErrors, ...row }) => row);
  }

  function parseHistoryCsv(text) {
    const rows = parseCsv(text);
    const headerIndex = locateHeaderRow(rows, [HISTORY_COLUMNS.date, HISTORY_COLUMNS.id]);
    if (headerIndex < 0) throw new Error('履歴CSVの「日付」または「利用者ID」の列が見つかりません。');
    const headers = rows[headerIndex].map(normalizedHeader);
    const column = Object.fromEntries(Object.entries(HISTORY_COLUMNS).map(([key, names]) => [key, findHeader(headers, names)]));
    if (column.date < 0 || column.id < 0 || column.vehicle < 0) {
      throw new Error('履歴CSVには「日付」「利用者ID」「車両番号」が必要です。');
    }
    return rows.slice(headerIndex + 1)
      .filter(row => row.some(value => String(value || '').trim()))
      .map(row => ({
        date: String(row[column.date] || '').trim(),
        trip: column.trip >= 0 ? String(row[column.trip] || '').trim() : '',
        id: String(row[column.id] || '').trim(),
        vehicle: String(row[column.vehicle] || '').trim().replace(/号車$/, ''),
        seat: column.seat >= 0 ? String(row[column.seat] || '').trim() : '',
        order: column.order >= 0 ? Number(row[column.order]) || null : null
      }))
      .filter(row => row.date && row.id && row.vehicle);
  }

  function pairKey(a, b) {
    return a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`;
  }

  function buildHistoryModel(rows) {
    const trips = new Map();
    const appearances = new Map();
    const vehicleCounts = new Map();
    const latestVehicle = new Map();
    const sorted = [...(rows || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const row of sorted) {
      const tripKey = `${row.date}\u0001${row.trip || ''}`;
      if (!trips.has(tripKey)) trips.set(tripKey, []);
      trips.get(tripKey).push(row);
      appearances.set(row.id, (appearances.get(row.id) || 0) + 1);
      const affinityKey = `${row.id}\u0001${row.vehicle}`;
      vehicleCounts.set(affinityKey, (vehicleCounts.get(affinityKey) || 0) + 1);
      latestVehicle.set(row.id, row.vehicle);
    }

    const pairObservations = new Map();
    for (const tripRows of trips.values()) {
      const uniqueById = new Map(tripRows.map(row => [row.id, row]));
      const attendees = [...uniqueById.values()];
      for (let left = 0; left < attendees.length; left++) {
        for (let right = left + 1; right < attendees.length; right++) {
          const a = attendees[left];
          const b = attendees[right];
          const key = pairKey(a.id, b.id);
          const value = pairObservations.get(key) || { co: 0, same: 0 };
          value.co++;
          if (a.vehicle === b.vehicle) value.same++;
          pairObservations.set(key, value);
        }
      }
    }

    const pairScores = new Map();
    for (const [key, value] of pairObservations) {
      if (value.same === 0) {
        pairScores.set(key, 0);
      } else {
        const rate = (value.same + 0.5) / (value.co + 1.5);
        pairScores.set(key, rate * Math.log2(value.co + 1));
      }
    }

    const affinityScores = new Map();
    for (const [key, count] of vehicleCounts) {
      const userId = key.split('\u0001')[0];
      const total = appearances.get(userId) || 1;
      affinityScores.set(key, (count / total) * Math.log2(total + 1));
    }

    return {
      rowCount: sorted.length,
      tripCount: trips.size,
      pairScores,
      pairObservations,
      affinityScores,
      latestVehicle,
      appearances,
      pairScore(a, b) { return pairScores.get(pairKey(a, b)) || 0; },
      affinityScore(userId, vehicleId) {
        let score = affinityScores.get(`${userId}\u0001${vehicleId}`) || 0;
        if (latestVehicle.get(userId) === String(vehicleId)) score += 0.5;
        return score;
      }
    };
  }

  function createVehicles(mode) {
    const common = [10, 11, 12, 13, 14].map(number => ({
      id: String(number), name: `${number}号車`, normalCapacity: 4, wheelchairCapacity: 2,
      mirrorFoldable: number === 13 || number === 14, configuration: '通常構成'
    }));
    const vehicle15 = mode === 'wheelchair-priority'
      ? { id: '15', name: '15号車', normalCapacity: 1, wheelchairCapacity: 4, mirrorFoldable: false, configuration: '車いす優先構成' }
      : { id: '15', name: '15号車', normalCapacity: 4, wheelchairCapacity: 2, mirrorFoldable: false, configuration: '通常構成' };
    return [...common, vehicle15];
  }

  function validateInput(users) {
    const errors = [];
    const warnings = [];
    if (!Array.isArray(users) || users.length === 0) errors.push('当日送迎対象者がありません。');
    if (users.length > 32) errors.push(`当日送迎対象者が${users.length}人です。想定上限32人を超えています。`);
    const ids = new Set();
    for (const user of users || []) {
      if (!user.id) errors.push('利用者IDが空欄の行があります。');
      else if (ids.has(user.id)) errors.push(`利用者ID「${user.id}」が重複しています。`);
      ids.add(user.id);
      if (!user.address) errors.push(`${user.name || user.id}: 住所が空欄です。`);
      if (!['walking', 'wheelchair'].includes(user.mobility)) errors.push(`${user.name || user.id}: 車いす利用の値を確認してください。`);
      if (typeof user.wheelchairOk !== 'boolean') errors.push(`${user.name || user.id}: 車いす代替乗車可の値を確認してください。`);
      if (typeof user.mirrorRequired !== 'boolean') errors.push(`${user.name || user.id}: ミラー折り畳み必須の値を確認してください。`);
      if (!Number.isFinite(user.lat) || !Number.isFinite(user.lon)) warnings.push(`${user.name || user.id}: 地図座標を解決できていません。`);
    }
    return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  }

  function mulberry32(seed) {
    return function random() {
      let value = seed += 0x6D2B79F5;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function hashString(value) {
    let hash = 2166136261;
    for (const character of String(value)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  class MinHeap {
    constructor() { this.items = []; }
    push(item) {
      const items = this.items;
      items.push(item);
      let index = items.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (items[parent][0] <= item[0]) break;
        items[index] = items[parent];
        index = parent;
      }
      items[index] = item;
    }
    pop() {
      const items = this.items;
      if (!items.length) return null;
      const first = items[0];
      const last = items.pop();
      if (items.length && last) {
        let index = 0;
        while (true) {
          let child = index * 2 + 1;
          if (child >= items.length) break;
          if (child + 1 < items.length && items[child + 1][0] < items[child][0]) child++;
          if (items[child][0] >= last[0]) break;
          items[index] = items[child];
          index = child;
        }
        items[index] = last;
      }
      return first;
    }
    get size() { return this.items.length; }
  }

  function exactRoundTrip(memberIndices, distanceMatrix) {
    const count = memberIndices.length;
    if (!count) return { distance: 0, order: [] };
    if (count === 1) {
      const point = memberIndices[0] + 1;
      return { distance: distanceMatrix[0][point] + distanceMatrix[point][0], order: [memberIndices[0]] };
    }

    const stateCount = 1 << count;
    const costs = Array.from({ length: stateCount }, () => new Float64Array(count).fill(Infinity));
    const parents = Array.from({ length: stateCount }, () => new Int16Array(count).fill(-1));
    for (let index = 0; index < count; index++) costs[1 << index][index] = distanceMatrix[0][memberIndices[index] + 1];

    for (let mask = 1; mask < stateCount; mask++) {
      for (let last = 0; last < count; last++) {
        const current = costs[mask][last];
        if (!Number.isFinite(current) || !(mask & (1 << last))) continue;
        for (let next = 0; next < count; next++) {
          if (mask & (1 << next)) continue;
          const nextMask = mask | (1 << next);
          const candidate = current + distanceMatrix[memberIndices[last] + 1][memberIndices[next] + 1];
          if (candidate < costs[nextMask][next]) {
            costs[nextMask][next] = candidate;
            parents[nextMask][next] = last;
          }
        }
      }
    }

    const fullMask = stateCount - 1;
    let bestDistance = Infinity;
    let bestLast = -1;
    for (let last = 0; last < count; last++) {
      const candidate = costs[fullMask][last] + distanceMatrix[memberIndices[last] + 1][0];
      if (candidate < bestDistance) {
        bestDistance = candidate;
        bestLast = last;
      }
    }

    const reversed = [];
    let mask = fullMask;
    let last = bestLast;
    while (last >= 0) {
      reversed.push(memberIndices[last]);
      const previous = parents[mask][last];
      mask ^= 1 << last;
      last = previous;
    }
    return { distance: bestDistance, order: reversed.reverse() };
  }

  function modeCapacityFeasible(users, mode) {
    const vehicles = createVehicles(mode);
    const normal = vehicles.reduce((sum, vehicle) => sum + vehicle.normalCapacity, 0);
    const wheelchair = vehicles.reduce((sum, vehicle) => sum + vehicle.wheelchairCapacity, 0);
    const requiredWheelchair = users.filter(user => user.mobility === 'wheelchair').length;
    const requiredNormal = users.filter(user => user.mobility !== 'wheelchair' && !user.wheelchairOk).length;
    const mirrorUsers = users.filter(user => user.mirrorRequired);
    const mirrorVehicles = vehicles.filter(vehicle => vehicle.mirrorFoldable);
    const mirrorNormal = mirrorVehicles.reduce((sum, vehicle) => sum + vehicle.normalCapacity, 0);
    const mirrorWheelchair = mirrorVehicles.reduce((sum, vehicle) => sum + vehicle.wheelchairCapacity, 0);
    const mirrorRequiredWheelchair = mirrorUsers.filter(user => user.mobility === 'wheelchair').length;
    const mirrorRequiredNormal = mirrorUsers.filter(user => user.mobility !== 'wheelchair' && !user.wheelchairOk).length;
    return requiredWheelchair <= wheelchair
      && requiredNormal <= normal
      && users.length <= normal + wheelchair
      && mirrorRequiredWheelchair <= mirrorWheelchair
      && mirrorRequiredNormal <= mirrorNormal
      && mirrorUsers.length <= mirrorNormal + mirrorWheelchair;
  }

  function minimumSubstitutions(users, mode) {
    const vehicles = createVehicles(mode);
    const totalNormal = vehicles.reduce((sum, vehicle) => sum + vehicle.normalCapacity, 0);
    const totalWheelchair = vehicles.reduce((sum, vehicle) => sum + vehicle.wheelchairCapacity, 0);
    const mirrorVehicles = vehicles.filter(vehicle => vehicle.mirrorFoldable);
    const mirrorNormal = mirrorVehicles.reduce((sum, vehicle) => sum + vehicle.normalCapacity, 0);
    const mirrorWheelchair = mirrorVehicles.reduce((sum, vehicle) => sum + vehicle.wheelchairCapacity, 0);
    const fixedWheelchair = users.filter(user => user.mobility === 'wheelchair').length;
    const fixedNormal = users.filter(user => user.mobility === 'walking' && !user.wheelchairOk).length;
    const flexible = users.filter(user => user.mobility === 'walking' && user.wheelchairOk);
    const mirrorFixedWheelchair = users.filter(user => user.mirrorRequired && user.mobility === 'wheelchair').length;
    const mirrorFixedNormal = users.filter(user => user.mirrorRequired && user.mobility === 'walking' && !user.wheelchairOk).length;
    const mirrorFlexible = flexible.filter(user => user.mirrorRequired).length;
    const nonMirrorFlexible = flexible.length - mirrorFlexible;

    let best = Infinity;
    for (let mirrorSubstitutes = 0; mirrorSubstitutes <= mirrorFlexible; mirrorSubstitutes++) {
      if (mirrorFixedNormal + mirrorFlexible - mirrorSubstitutes > mirrorNormal) continue;
      if (mirrorFixedWheelchair + mirrorSubstitutes > mirrorWheelchair) continue;
      for (let otherSubstitutes = 0; otherSubstitutes <= nonMirrorFlexible; otherSubstitutes++) {
        const substitutes = mirrorSubstitutes + otherSubstitutes;
        if (fixedNormal + flexible.length - substitutes > totalNormal) continue;
        if (fixedWheelchair + substitutes > totalWheelchair) continue;
        best = Math.min(best, substitutes);
      }
    }
    return best;
  }

  function remainingCapacityFeasible(states, users, remainingIndices) {
    let normal = 0;
    let wheelchair = 0;
    let mirrorNormal = 0;
    let mirrorWheelchair = 0;
    for (const state of states) {
      const openNormal = state.vehicle.normalCapacity - state.normalUsed;
      const openWheelchair = state.vehicle.wheelchairCapacity - state.wheelchairUsed;
      normal += openNormal;
      wheelchair += openWheelchair;
      if (state.vehicle.mirrorFoldable) {
        mirrorNormal += openNormal;
        mirrorWheelchair += openWheelchair;
      }
    }

    let requiredNormal = 0;
    let requiredWheelchair = 0;
    let mirrorRequiredNormal = 0;
    let mirrorRequiredWheelchair = 0;
    let mirrorFlexible = 0;
    for (const index of remainingIndices) {
      const user = users[index];
      if (user.mobility === 'wheelchair') {
        requiredWheelchair++;
        if (user.mirrorRequired) mirrorRequiredWheelchair++;
      } else if (!user.wheelchairOk) {
        requiredNormal++;
        if (user.mirrorRequired) mirrorRequiredNormal++;
      } else if (user.mirrorRequired) {
        mirrorFlexible++;
      }
    }
    return requiredNormal <= normal
      && requiredWheelchair <= wheelchair
      && remainingIndices.length <= normal + wheelchair
      && mirrorRequiredNormal <= mirrorNormal
      && mirrorRequiredWheelchair <= mirrorWheelchair
      && mirrorRequiredNormal + mirrorRequiredWheelchair + mirrorFlexible <= mirrorNormal + mirrorWheelchair;
  }

  function assignmentSignature(states, users, mode) {
    const parts = [];
    let usesVehicle15 = false;
    for (const state of states) {
      const members = state.members.map(member => `${users[member.userIndex].id}:${member.seat}`).sort();
      if (state.vehicle.id === '15' && members.length) usesVehicle15 = true;
      parts.push(`${state.vehicle.id}=${members.join(',')}`);
    }
    return `${usesVehicle15 ? mode : '15-unused'}|${parts.join('|')}`;
  }

  function buildAssignmentMap(states, users) {
    const map = new Map();
    for (const state of states) {
      for (const member of state.members) map.set(users[member.userIndex].id, `${state.vehicle.id}:${member.seat}`);
    }
    return map;
  }

  function constructAssignment(users, distanceMatrix, history, profile, mode, random, minimumSubstituteCount) {
    const vehicles = createVehicles(mode);
    const states = vehicles.map(vehicle => ({ vehicle, normalUsed: 0, wheelchairUsed: 0, members: [] }));
    const order = users.map((_, index) => index).sort((left, right) => {
      const a = users[left];
      const b = users[right];
      const constraintA = (a.mirrorRequired ? 100 : 0) + (a.mobility === 'wheelchair' ? 30 : a.wheelchairOk ? 0 : 20) + random();
      const constraintB = (b.mirrorRequired ? 100 : 0) + (b.mobility === 'wheelchair' ? 30 : b.wheelchairOk ? 0 : 20) + random();
      return constraintB - constraintA;
    });
    let explored = 0;

    function assign(position, substituteUsed) {
      if (position >= order.length) return substituteUsed === minimumSubstituteCount;
      if (++explored > 60_000) return false;
      const userIndex = order[position];
      const user = users[userIndex];
      const seatOptions = user.mobility === 'wheelchair' ? ['wheelchair'] : user.wheelchairOk ? ['normal', 'wheelchair'] : ['normal'];
      const choices = [];

      for (let stateIndex = 0; stateIndex < states.length; stateIndex++) {
        const state = states[stateIndex];
        if (user.mirrorRequired && !state.vehicle.mirrorFoldable) continue;
        for (const seat of seatOptions) {
          if (seat === 'normal' && state.normalUsed >= state.vehicle.normalCapacity) continue;
          if (seat === 'wheelchair' && state.wheelchairUsed >= state.vehicle.wheelchairCapacity) continue;
          const existing = state.members;
          let geographical = distanceMatrix[0][userIndex + 1] / 1000;
          let pairReward = 0;
          if (existing.length) {
            geographical = Math.min(...existing.map(member => distanceMatrix[member.userIndex + 1][userIndex + 1])) / 1000;
            for (const member of existing) pairReward += history.pairScore(user.id, users[member.userIndex].id);
          }
          const opensVehicle = existing.length === 0 ? 1 : 0;
          const substitute = seat === 'wheelchair' && user.mobility !== 'wheelchair' ? 1 : 0;
          if (substituteUsed + substitute > minimumSubstituteCount) continue;
          const affinity = history.affinityScore(user.id, state.vehicle.id);
          const score = geographical * profile.distance
            + opensVehicle * profile.vehicles
            + substitute * profile.substitute
            - pairReward * profile.pair
            - affinity * profile.affinity
            + (random() - 0.5) * profile.noise;
          choices.push({ stateIndex, seat, score });
        }
      }
      choices.sort((a, b) => a.score - b.score);

      for (const choice of choices) {
        const state = states[choice.stateIndex];
        state.members.push({ userIndex, seat: choice.seat });
        if (choice.seat === 'normal') state.normalUsed++;
        else state.wheelchairUsed++;
        const remaining = order.slice(position + 1);
        const nextSubstituteUsed = substituteUsed + (choice.seat === 'wheelchair' && user.mobility !== 'wheelchair' ? 1 : 0);
        if (remainingCapacityFeasible(states, users, remaining) && assign(position + 1, nextSubstituteUsed)) return true;
        state.members.pop();
        if (choice.seat === 'normal') state.normalUsed--;
        else state.wheelchairUsed--;
      }
      return false;
    }

    return assign(0, 0) ? states : null;
  }

  function evaluateStates(states, users, distanceMatrix, history, mode) {
    const vehiclePlans = [];
    let totalDistance = 0;
    let pairHistoryScore = 0;
    let vehicleAffinityScore = 0;
    let substituteCount = 0;
    const routeDistances = [];

    for (const state of states) {
      if (!state.members.length) continue;
      const memberIndices = state.members.map(member => member.userIndex);
      const route = exactRoundTrip(memberIndices, distanceMatrix);
      totalDistance += route.distance;
      routeDistances.push(route.distance);
      const memberByIndex = new Map(state.members.map(member => [member.userIndex, member]));
      for (let left = 0; left < state.members.length; left++) {
        const leftUser = users[state.members[left].userIndex];
        vehicleAffinityScore += history.affinityScore(leftUser.id, state.vehicle.id);
        if (state.members[left].seat === 'wheelchair' && leftUser.mobility !== 'wheelchair') substituteCount++;
        for (let right = left + 1; right < state.members.length; right++) {
          pairHistoryScore += history.pairScore(leftUser.id, users[state.members[right].userIndex].id);
        }
      }
      vehiclePlans.push({
        vehicle: { ...state.vehicle },
        normalUsed: state.normalUsed,
        wheelchairUsed: state.wheelchairUsed,
        distance: route.distance,
        stops: route.order.map(userIndex => ({ userIndex, seat: memberByIndex.get(userIndex).seat }))
      });
    }

    const average = routeDistances.length ? totalDistance / routeDistances.length : 0;
    const imbalance = routeDistances.length
      ? Math.sqrt(routeDistances.reduce((sum, value) => sum + (value - average) ** 2, 0) / routeDistances.length)
      : 0;
    return {
      mode,
      vehicles: vehiclePlans,
      metrics: {
        totalDistance,
        totalDistanceKm: totalDistance / 1000,
        usedVehicleCount: vehiclePlans.length,
        substituteCount,
        pairHistoryScore,
        vehicleAffinityScore,
        routeImbalanceKm: imbalance / 1000
      },
      assignmentMap: buildAssignmentMap(states, users),
      signature: assignmentSignature(states, users, mode)
    };
  }

  function objective(candidate, profile) {
    const metrics = candidate.metrics;
    return metrics.totalDistanceKm * profile.distance
      + metrics.usedVehicleCount * profile.vehicles
      + metrics.substituteCount * profile.substitute
      + metrics.routeImbalanceKm * profile.imbalance
      - metrics.pairHistoryScore * profile.pair
      - metrics.vehicleAffinityScore * profile.affinity;
  }

  function validatePlan(plan, users) {
    const errors = [];
    const seen = new Set();
    for (const vehiclePlan of plan.vehicles) {
      let normal = 0;
      let wheelchair = 0;
      for (const stop of vehiclePlan.stops) {
        const user = users[stop.userIndex];
        if (!user) { errors.push('存在しない利用者が含まれています。'); continue; }
        if (seen.has(user.id)) errors.push(`${user.name}: 重複割り当て`);
        seen.add(user.id);
        if (stop.seat === 'normal') normal++;
        else wheelchair++;
        if (user.mobility === 'wheelchair' && stop.seat !== 'wheelchair') errors.push(`${user.name}: 車いす利用者が通常席`);
        if (user.mobility !== 'wheelchair' && !user.wheelchairOk && stop.seat === 'wheelchair') errors.push(`${user.name}: 代替乗車不可`);
        if (user.mirrorRequired && !vehiclePlan.vehicle.mirrorFoldable) errors.push(`${user.name}: ミラー対応車ではない`);
      }
      if (normal > vehiclePlan.vehicle.normalCapacity) errors.push(`${vehiclePlan.vehicle.name}: 通常席超過`);
      if (wheelchair > vehiclePlan.vehicle.wheelchairCapacity) errors.push(`${vehiclePlan.vehicle.name}: 車いす枠超過`);
    }
    for (const user of users) if (!seen.has(user.id)) errors.push(`${user.name}: 未配車`);
    return [...new Set(errors)];
  }

  function planDifference(a, b, users) {
    let changes = 0;
    for (const user of users) {
      const left = String(a.assignmentMap.get(user.id) || '').split(':');
      const right = String(b.assignmentMap.get(user.id) || '').split(':');
      if (left[0] !== right[0]) changes += 1;
      else if (left[1] !== right[1]) changes += 0.5;
    }
    return changes;
  }

  function validateDistanceMatrix(distanceMatrix, size) {
    if (!Array.isArray(distanceMatrix) || distanceMatrix.length !== size) return false;
    return distanceMatrix.every((row, rowIndex) => Array.isArray(row)
      && row.length === size
      && row.every((value, columnIndex) => Number.isFinite(value) && value >= 0
        && (rowIndex !== columnIndex || Math.abs(value) < 1e-9)));
  }

  function generatePlans({ users, distanceMatrix, historyRows = [], restartsPerProfile = 48 }) {
    const validation = validateInput(users);
    if (validation.errors.length) return { plans: [], errors: validation.errors, warnings: validation.warnings };
    if (!validateDistanceMatrix(distanceMatrix, users.length + 1)) {
      return { plans: [], errors: ['距離行列が不正です。サイズ、未計算値、負の値を確認してください。'], warnings: validation.warnings };
    }

    const history = buildHistoryModel(historyRows);
    const modes = ['wheelchair-priority', 'standard'].filter(mode => modeCapacityFeasible(users, mode));
    if (!modes.length) {
      return {
        plans: [],
        errors: ['通常席と車いす枠の内訳上、15号車のどちらの構成でも全員を割り当てられません。'],
        warnings: validation.warnings
      };
    }

    const seedBase = hashString(users.map(user => user.id).sort().join('|'));
    const candidates = new Map();
    for (let profileIndex = 0; profileIndex < PLAN_PROFILES.length; profileIndex++) {
      const profile = PLAN_PROFILES[profileIndex];
      for (let modeIndex = 0; modeIndex < modes.length; modeIndex++) {
        const mode = modes[modeIndex];
        const minimumSubstituteCount = minimumSubstitutions(users, mode);
        if (!Number.isFinite(minimumSubstituteCount)) continue;
        for (let restart = 0; restart < restartsPerProfile; restart++) {
          const random = mulberry32(seedBase + profileIndex * 100_003 + modeIndex * 10_007 + restart * 97);
          const states = constructAssignment(users, distanceMatrix, history, profile, mode, random, minimumSubstituteCount);
          if (!states) continue;
          const candidate = evaluateStates(states, users, distanceMatrix, history, mode);
          candidate.validationErrors = validatePlan(candidate, users);
          if (candidate.validationErrors.length) continue;
          const existing = candidates.get(candidate.signature);
          if (!existing || objective(candidate, PLAN_PROFILES[0]) < objective(existing, PLAN_PROFILES[0])) {
            candidates.set(candidate.signature, candidate);
          }
        }
      }
    }

    const pool = [...candidates.values()];
    if (!pool.length) {
      return { plans: [], errors: ['条件を満たす配車候補を生成できませんでした。'], warnings: validation.warnings };
    }

    const selected = [];
    const minimumDifference = Math.max(1, Math.ceil(users.length * 0.1));
    for (const profile of PLAN_PROFILES) {
      const ranked = pool
        .filter(candidate => !selected.includes(candidate))
        .sort((a, b) => objective(a, profile) - objective(b, profile));
      const chosen = ranked.find(candidate => selected.every(current => planDifference(candidate, current, users) >= minimumDifference));
      if (!chosen) continue;
      chosen.profile = { id: profile.id, label: profile.label, description: profile.description };
      chosen.objective = objective(chosen, profile);
      selected.push(chosen);
      if (selected.length >= 5) break;
    }

    for (const candidate of pool.sort((a, b) => objective(a, PLAN_PROFILES[0]) - objective(b, PLAN_PROFILES[0]))) {
      if (selected.length >= 5) break;
      if (selected.includes(candidate)) continue;
      if (!selected.every(current => planDifference(candidate, current, users) >= minimumDifference)) continue;
      candidate.profile = { id: 'additional', label: '追加候補', description: '条件を満たす別の組み合わせ' };
      candidate.objective = objective(candidate, PLAN_PROFILES[0]);
      selected.push(candidate);
    }

    return {
      plans: selected,
      errors: [],
      warnings: validation.warnings,
      stats: {
        generatedCandidateCount: pool.length,
        historyRowCount: history.rowCount,
        historyTripCount: history.tripCount,
        availableModes: modes
      }
    };
  }

  return {
    DAILY_COLUMNS,
    HISTORY_COLUMNS,
    PLAN_PROFILES,
    MinHeap,
    parseCsv,
    toCsv,
    parseBoolean,
    parseDailyCsv,
    parseHistoryCsv,
    normalizeAddress,
    addressAliases,
    matchLevelLabel,
    AddressResolver,
    buildHistoryModel,
    createVehicles,
    minimumSubstitutions,
    validateInput,
    exactRoundTrip,
    validatePlan,
    generatePlans
  };
});
