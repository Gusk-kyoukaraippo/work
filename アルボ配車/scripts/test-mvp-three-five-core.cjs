const assert = require('node:assert/strict');
const fs = require('node:fs');
const Core = require('../src/mvp-three-five-core.js');

function makeUser(index, overrides = {}) {
  const angle = (index / 32) * Math.PI * 2;
  return {
    id: `U${String(index + 1).padStart(3, '0')}`,
    name: `利用者${index + 1}`,
    address: `伊勢崎市テスト町${index + 1}`,
    mobility: 'walking',
    wheelchairOk: false,
    mirrorRequired: false,
    lat: 36.32 + Math.sin(angle) * 0.04,
    lon: 139.18 + Math.cos(angle) * 0.04,
    ...overrides
  };
}

function makeDistanceMatrix(users) {
  const points = [{ lat: 36.327358, lon: 139.181168 }, ...users];
  return points.map((pointA, indexA) => points.map((pointB, indexB) => {
    if (indexA === indexB) return 0;
    const meanLat = (pointA.lat + pointB.lat) * Math.PI / 360;
    const dx = (pointA.lon - pointB.lon) * 111_320 * Math.cos(meanLat);
    const dy = (pointA.lat - pointB.lat) * 110_540;
    return Math.hypot(dx, dy) * 1.2;
  }));
}

function generate(users, historyRows = []) {
  return Core.generatePlans({
    users,
    distanceMatrix: makeDistanceMatrix(users),
    historyRows,
    restartsPerProfile: 10
  });
}

function assertAllValid(result, users) {
  assert.deepEqual(result.errors, []);
  assert.ok(result.plans.length >= 1 && result.plans.length <= 5);
  for (const plan of result.plans) {
    assert.deepEqual(Core.validatePlan(plan, users), []);
    const assigned = plan.vehicles.reduce((sum, vehicle) => sum + vehicle.stops.length, 0);
    assert.equal(assigned, users.length);
    assert.ok(plan.vehicles.length <= 6);
  }
}

{
  const csv = '\uFEFF利用者ID,利用者名,住所,車いす利用,車いす代替乗車可,ミラー折り畳み必須,緯度,経度,座標情報元\n'
    + 'A01,"山田, 太郎",伊勢崎市太田町1,はい,いいえ,○,36.3,139.1,GSI番地代表点\n'
    + 'A02,佐藤花子,伊勢崎市曲輪町2,いいえ,可,いいえ,,,\n';
  const users = Core.parseDailyCsv(csv);
  assert.equal(users.length, 2);
  assert.equal(users[0].name, '山田, 太郎');
  assert.equal(users[0].mobility, 'wheelchair');
  assert.equal(users[0].mirrorRequired, true);
  assert.equal(users[0].coordinateSource, 'GSI番地代表点');
  assert.equal(users[1].wheelchairOk, true);
  assert.equal(users[1].lat, null);
  assert.equal(users[1].coordinateSource, '');
}

{
  const baseHeader = '利用者ID,利用者名,住所,車いす利用,車いす代替乗車可,ミラー折り畳み必須';
  const baseRow = 'A01,座標確認,伊勢崎市太田町,いいえ,いいえ,いいえ';

  const legacyCoordinates = Core.parseDailyCsv(`${baseHeader},X座標,Y座標\n${baseRow},236,247`);
  assert.equal(legacyCoordinates[0].lat, null, '画像用X/Y座標を緯度経度として扱わない');
  assert.equal(legacyCoordinates[0].lon, null, '画像用X/Y座標を緯度経度として扱わない');

  assert.throws(
    () => Core.parseDailyCsv(`${baseHeader},緯度,経度\n${baseRow},36.3,`),
    /緯度と経度は両方入力/
  );
  assert.throws(
    () => Core.parseDailyCsv(`${baseHeader},緯度,経度\n${baseRow},緯度不明,139.1`),
    /緯度・経度には数値/
  );

  for (const sourceHeader of ['座標情報元', '位置情報元', 'coordinate_source']) {
    const users = Core.parseDailyCsv(`${baseHeader},緯度,経度,${sourceHeader}\n${baseRow},,,手動確認`);
    assert.equal(users[0].lat, null);
    assert.equal(users[0].lon, null);
    assert.equal(users[0].coordinateSource, '手動確認');
  }
}

{
  assert.equal(Core.normalizeAddress('群馬県伊勢崎市今泉町二丁目940番地17'), '今泉町2丁目940-17');
  assert.equal(Core.normalizeAddress('群馬県伊勢崎市日乃出町430の7'), '日乃出町430-7');
  assert.equal(Core.normalizeAddress('グリーンハイツ'), 'グリーンハイツ', '建物名の長音をハイフン化しない');
  assert.equal(Core.normalizeAddress('羽黒町32県営住宅202号'), '羽黒町32県営住宅202号', '建物・部屋番号の号を保持する');

  const resolver = new Core.AddressResolver({
    coordinateScale: 1_000_000,
    abr: {
      coordinateScale: 1_000_000,
      areas: [
        ['今泉町', '二丁目', '', 0],
        ['赤堀今井町', '一丁目', '', 0],
        ['羽黒町', '', '', 0],
        ['緑町', '', '', 1],
        ['田中島町', '', '', 0],
        ['境', '', '', 0],
        ['境保泉', '', '', 0],
        ['大手町', '', '', 1],
        ['間野谷町', '', '', 0]
      ],
      parcels: [
        [0, 938, 13, 0, 0, 0],
        [0, 940, 17, 0, 0, 0],
        [1, 253, 19, 0, 36376406, 139214499],
        [2, 32, 0, 0, 36288235, 139211868],
        [4, 493, 1, 0, 0, 0],
        [4, 493, 2, 0, 0, 0],
        [6, 1219, 2, 0, 36297974, 139221298],
        [7, 25, 1, 0, 36320000, 139190000],
        [8, '甲149', 2, 0, 0, 0]
      ],
      blocks: [[3, 13, 36317485, 139195423]],
      towns: [
        [0, 36311881, 139197780], [1, 36375959, 139210273], [2, 36289000, 139212000],
        [3, 36317000, 139195000], [4, 36322000, 139168000], [5, 36290000, 139220000], [6, 36298000, 139221000],
        [7, 36323000, 139194000], [8, 36380000, 139260000]
      ]
    }
  });

  const shorthand = resolver.matchAddress('群馬県伊勢崎市今泉町2-938-13');
  assert.equal(shorthand.addressMatchLevel, 'parcel_branch');
  assert.equal(shorthand.matchedAddress, '群馬県伊勢崎市今泉町二丁目938番地13');
  assert.equal(shorthand.unmatchedAddress, '');

  const kanjiChome = resolver.matchAddress('群馬県伊勢崎市今泉町二丁目940番地17');
  assert.equal(kanjiChome.addressMatchLevel, 'parcel_branch');
  assert.equal(kanjiChome.matchedAddress, '群馬県伊勢崎市今泉町二丁目940番地17');

  const chomeWithSeparator = resolver.matchAddress('群馬県伊勢崎市今泉町2丁目-938-13');
  assert.equal(chomeWithSeparator.addressMatchLevel, 'parcel_branch');
  assert.equal(chomeWithSeparator.matchedAddress, '群馬県伊勢崎市今泉町二丁目938番地13');

  const building = resolver.matchAddress('群馬県伊勢崎市羽黒町32県営住宅202号');
  assert.equal(building.addressMatchLevel, 'parcel');
  assert.equal(building.unmatchedAddress, '県営住宅202号');

  const residential = resolver.matchAddress('群馬県伊勢崎市緑町13-7');
  assert.equal(residential.addressMatchLevel, 'residential_block');
  assert.equal(residential.unmatchedAddress, '7');

  const parent = resolver.matchAddress('群馬県伊勢崎市田中島町493');
  assert.equal(parent.addressMatchLevel, 'parent_lot');
  assert.equal(parent.matchedAddress, '群馬県伊勢崎市田中島町493番地');
  assert.equal(parent.unmatchedAddress, '');

  const longestTown = resolver.matchAddress('群馬県伊勢崎市境保泉1219-2');
  assert.equal(longestTown.addressMatchLevel, 'parcel_branch');
  assert.match(longestTown.matchedAddress, /境保泉/);

  const unknownResidentialBlock = resolver.matchAddress('群馬県伊勢崎市大手町25-1');
  assert.equal(unknownResidentialBlock.addressMatchLevel, 'town', '住居表示地区のハイフン表記を地番へ誤昇格しない');
  assert.equal(unknownResidentialBlock.unmatchedAddress, '25-1');

  const explicitParcelIntent = resolver.matchAddress('群馬県伊勢崎市大手町25番地1');
  assert.equal(explicitParcelIntent.addressMatchLevel, 'parcel_branch', '番地明記時は住居表示地区でも地番照合できる');

  const irohaParcel = resolver.matchAddress('群馬県伊勢崎市間野谷町甲149-2');
  assert.equal(irohaParcel.addressMatchLevel, 'parcel_branch');
  assert.match(irohaParcel.matchedAddress, /甲149番地2/);

  const explicit = resolver.resolve({
    id: 'A01', name: '座標保持', address: '群馬県伊勢崎市赤堀今井町1丁目253番地19',
    lat: 36.37727, lon: 139.214142, coordinateSource: 'GSI番地代表点'
  });
  assert.equal(explicit.addressMatchLevel, 'parcel_branch');
  assert.equal(explicit.lat, 36.37727, 'CSV座標はABR座標で上書きしない');
  assert.equal(explicit.coordinateAddressMismatch, false);

  const equivalentChome = resolver.resolve({
    id: 'A01b', name: '表記ゆれ', address: '群馬県伊勢崎市今泉町2丁目938番地13',
    lat: 36.31, lon: 139.2, coordinateSource: 'CSV座標', coordinateTargetAddress: '群馬県伊勢崎市今泉町2-938-13'
  });
  assert.equal(equivalentChome.coordinateAddressMismatch, false, '丁目省略表記は同一住所とみなす');

  const equivalentResidential = resolver.resolve({
    id: 'A01c', name: '住居表示ゆれ', address: '群馬県伊勢崎市緑町13番7号',
    lat: 36.31, lon: 139.2, coordinateSource: 'CSV座標', coordinateTargetAddress: '群馬県伊勢崎市緑町13-7'
  });
  assert.equal(equivalentResidential.coordinateAddressMismatch, false, '住居番号の号有無は同一住所とみなす');

  const mismatch = resolver.resolve({
    id: 'A02', name: '住所変更', address: '群馬県伊勢崎市羽黒町32', lat: 36.2, lon: 139.2,
    coordinateSource: 'CSV座標', coordinateTargetAddress: '群馬県伊勢崎市田中島町493'
  });
  assert.equal(mismatch.coordinateAddressMismatch, true);
}

{
  const abr = JSON.parse(fs.readFileSync('data/isesaki-abr-address-points.json', 'utf8'));
  const database = JSON.parse(fs.readFileSync('data/isesaki-address-db.json', 'utf8'));
  const scale = 1_000_000;
  const exact = database.entries
    .filter(entry => entry.source === 'gsi-address-search')
    .map(entry => [
      Core.normalizeAddress(entry.fullAddress || entry.name),
      Math.round(entry.lat * scale),
      Math.round(entry.lng * scale),
      entry.fullAddress || entry.name
    ]);
  const resolver = new Core.AddressResolver({ coordinateScale: scale, abr, exact });

  const residentialNotation = resolver.matchAddress('群馬県伊勢崎市本町19-1');
  assert.equal(residentialNotation.addressMatchLevel, 'town', '住居表示のハイフン表記を旧GSI地番へ誤照合しない');
  assert.equal(residentialNotation.unmatchedAddress, '19-1');

  const explicitParcelNotation = resolver.matchAddress('群馬県伊勢崎市本町19番地1');
  assert.equal(explicitParcelNotation.addressMatchLevel, 'parcel_branch', '番地の明記時はABR地番・枝番まで照合する');
}

{
  const header = '利用者ID,利用者名,住所,車いす利用,車いす代替乗車可,ミラー折り畳み必須,緯度,経度,座標情報元,座標取得時住所,座標代表住所,照合住所,住所一致レベル,未一致部分,住所情報元';
  const row = 'A01,監査情報,群馬県伊勢崎市緑町13-7,いいえ,いいえ,いいえ,36.3,139.2,GSI番地代表点,群馬県伊勢崎市緑町13-7,群馬県伊勢崎市緑町13番,群馬県伊勢崎市緑町13番,住居表示の街区まで一致,7,デジタル庁ABR';
  const parsed = Core.parseDailyCsv(`${header}\n${row}`)[0];
  assert.equal(parsed.coordinateTargetAddress, '群馬県伊勢崎市緑町13-7');
  assert.equal(parsed.coordinateMatchedAddress, '群馬県伊勢崎市緑町13番');
  assert.equal(parsed.matchedAddress, '群馬県伊勢崎市緑町13番');
  assert.equal(parsed.addressMatchLevel, '住居表示の街区まで一致');
  assert.equal(parsed.unmatchedAddress, '7');
  assert.equal(parsed.addressSource, 'デジタル庁ABR');
}

{
  assert.throws(
    () => Core.parseDailyCsv('利用者ID,利用者名,住所\nA01,安全確認前,伊勢崎市太田町'),
    /安全な配車/
  );
  assert.throws(
    () => Core.parseDailyCsv('利用者ID,利用者名,住所,車いす利用,車いす代替乗車可,ミラー折り畳み必須\nA01,安全確認前,伊勢崎市太田町,,いいえ,いいえ'),
    /判定できない/
  );
}

{
  const standard = Core.createVehicles('standard');
  assert.deepEqual(standard.map(vehicle => [vehicle.id, vehicle.normalCapacity, vehicle.wheelchairCapacity]), [
    ['10', 4, 2], ['11', 4, 2], ['12', 4, 2], ['13', 4, 2], ['14', 4, 2], ['15', 4, 2]
  ]);
  const priority = Core.createVehicles('wheelchair-priority');
  assert.deepEqual(priority.at(-1), {
    id: '15', name: '15号車', normalCapacity: 1, wheelchairCapacity: 4,
    mirrorFoldable: false, configuration: '車いす優先構成'
  });
}

{
  const users = Array.from({ length: 29 }, (_, index) => makeUser(index, {
    mobility: index < 8 ? 'wheelchair' : 'walking',
    wheelchairOk: index >= 8 && index < 13,
    mirrorRequired: index === 0
  }));
  const result = generate(users);
  assertAllValid(result, users);
  for (const plan of result.plans) {
    const mirrorVehicle = plan.vehicles.find(vehicle => vehicle.stops.some(stop => stop.userIndex === 0));
    assert.ok(['13', '14'].includes(mirrorVehicle.vehicle.id));
  }
}

{
  const users = Array.from({ length: 18 }, (_, index) => makeUser(index, {
    mobility: index < 6 ? 'wheelchair' : 'walking'
  }));
  const result = generate(users);
  assertAllValid(result, users);
  assert.ok(result.plans.some(plan => plan.vehicles.length <= 3), '定員内なら未使用車を残せる候補が必要');
}

{
  const users = Array.from({ length: 32 }, (_, index) => makeUser(index, {
    mobility: index < 13 ? 'wheelchair' : 'walking'
  }));
  const result = generate(users);
  assertAllValid(result, users);
  assert.ok(result.plans.every(plan => plan.mode === 'wheelchair-priority'));
}

{
  const users = Array.from({ length: 32 }, (_, index) => makeUser(index, {
    mobility: index < 7 ? 'wheelchair' : 'walking',
    wheelchairOk: index >= 7
  }));
  const result = generate(users);
  assertAllValid(result, users);
  assert.ok(result.plans.some(plan => plan.metrics.substituteCount >= 1));
  for (const plan of result.plans) {
    for (const vehicle of plan.vehicles) {
      for (const stop of vehicle.stops) {
        if (users[stop.userIndex].mobility === 'wheelchair') assert.equal(stop.seat, 'wheelchair');
      }
    }
  }
}

{
  const users = Array.from({ length: 15 }, (_, index) => makeUser(index, { mobility: 'wheelchair' }));
  const result = generate(users);
  assert.equal(result.plans.length, 0);
  assert.ok(result.errors.some(message => message.includes('割り当てられません')));
}

{
  const users = [makeUser(0, { wheelchairOk: true })];
  const result = generate(users);
  assertAllValid(result, users);
  assert.ok(result.plans.every(plan => plan.metrics.substituteCount === 0));
}

{
  const users = [makeUser(0)];
  const result = Core.generatePlans({ users, distanceMatrix: [[0], [100, 0]], restartsPerProfile: 2 });
  assert.equal(result.plans.length, 0);
  assert.ok(result.errors.some(message => message.includes('距離行列')));
}

{
  const history = Core.buildHistoryModel([
    { date: '2026-01-01', trip: '迎え', id: 'A', vehicle: '10' },
    { date: '2026-01-01', trip: '迎え', id: 'B', vehicle: '11' }
  ]);
  assert.equal(history.pairScore('A', 'B'), 0);
}

{
  const users = Array.from({ length: 33 }, (_, index) => makeUser(index));
  const result = generate(users);
  assert.equal(result.plans.length, 0);
  assert.ok(result.errors.some(message => message.includes('上限32人')));
}

{
  const matrix = [
    [0, 5, 2, 9],
    [5, 0, 4, 2],
    [2, 4, 0, 3],
    [9, 2, 3, 0]
  ];
  const route = Core.exactRoundTrip([0, 1, 2], matrix);
  assert.equal(route.distance, 12);
  assert.deepEqual([...route.order].sort(), [0, 1, 2]);
}

{
  const csv = fs.readFileSync(require.resolve('../MVP3.5/mock-data-2.csv'), 'utf8');
  const users = Core.parseDailyCsv(csv).map((user, index) => ({
    ...user,
    lat: 36.32 + Math.sin(index) * 0.04,
    lon: 139.18 + Math.cos(index) * 0.04
  }));
  assert.equal(users.length, 27);
  assert.equal(users.filter(user => user.mobility === 'wheelchair').length, 10);
  assert.equal(users.filter(user => user.wheelchairOk).length, 6);
  assert.equal(users.filter(user => user.mirrorRequired).length, 0);
  const result = generate(users);
  assertAllValid(result, users);
}

{
  const visits = Core.parseVisitCsv(
    '\uFEFF訪問先ID,訪問先名,住所,緯度,経度\n'
    + 'A01,"訪問先, 一郎",群馬県伊勢崎市太田町1,,\n'
    + 'A02,,群馬県伊勢崎市曲輪町2,36.32,139.19\n'
  );
  assert.equal(visits.length, 2);
  assert.equal(visits[0].name, '訪問先, 一郎');
  assert.equal(visits[1].name, '訪問先2');
  assert.equal(visits[1].lat, 36.32);
  assert.throws(() => Core.parseVisitCsv('訪問先名,所在地\nテスト,太田町1'), /住所.*列/);
  assert.throws(() => Core.parseVisitCsv('住所,緯度,経度\n太田町1,36.3,'), /両方入力/);
}

{
  const users = Array.from({ length: 8 }, (_, index) => ({
    id: `V${index + 1}`, name: `訪問先${index + 1}`, address: `伊勢崎市テスト町${index + 1}`
  }));
  const points = [
    { lat: 36.327, lon: 139.181 },
    { lat: 36.327, lon: 139.151 }, { lat: 36.330, lon: 139.149 },
    { lat: 36.327, lon: 139.211 }, { lat: 36.330, lon: 139.213 },
    { lat: 36.325, lon: 139.147 }, { lat: 36.326, lon: 139.215 },
    { lat: 36.333, lon: 139.153 }, { lat: 36.333, lon: 139.209 }
  ];
  const matrix = points.map((pointA, indexA) => points.map((pointB, indexB) => {
    if (indexA === indexB) return 0;
    const dx = (pointA.lon - pointB.lon) * 89_000;
    const dy = (pointA.lat - pointB.lat) * 111_000;
    return Math.hypot(dx, dy);
  }));
  const optimized = Core.optimizeVisitRoutes({
    users,
    aIndices: [0, 1],
    bIndices: [2, 3],
    cIndices: [4, 5, 6, 7],
    distanceMatrix: matrix,
    restarts: 12
  });
  assert.deepEqual(optimized.errors, []);
  const result = optimized.result;
  assert.ok(result.routes[0].stops.includes(0) && result.routes[0].stops.includes(1), 'Aの既存先はAに残す');
  assert.ok(result.routes[1].stops.includes(2) && result.routes[1].stops.includes(3), 'Bの既存先はBに残す');
  assert.deepEqual([...result.routes[0].stops, ...result.routes[1].stops].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(result.assignments.length, 4);
  assert.ok(result.assignments.every(assignment => ['A', 'B'].includes(assignment.routeId)));
  assert.equal(result.metrics.evaluatedCandidates, 12);
  assert.equal(
    result.metrics.totalDistance,
    Core.visitRouteDistance(result.routes[0].stops, matrix) + Core.visitRouteDistance(result.routes[1].stops, matrix)
  );
}

{
  const users = Array.from({ length: 4 }, (_, index) => ({
    id: `NC${index + 1}`, name: `Cなし訪問先${index + 1}`, address: `伊勢崎市確認町${index + 1}`
  }));
  const points = [[0, 0], [-3, 0], [-4, 1], [3, 0], [4, 1]];
  const distanceMatrix = points.map((a, row) => points.map((b, column) => (
    row === column ? 0 : Math.hypot(a[0] - b[0], a[1] - b[1]) * 1000
  )));
  const optimized = Core.optimizeVisitRoutes({
    users,
    aIndices: [0, 1],
    bIndices: [2, 3],
    cIndices: [],
    distanceMatrix
  });
  assert.deepEqual(optimized.errors, []);
  assert.equal(optimized.result.assignments.length, 0);
  assert.equal(optimized.result.metrics.cToA, 0);
  assert.equal(optimized.result.metrics.cToB, 0);
  assert.equal(optimized.result.metrics.evaluatedCandidates, 1);
  assert.deepEqual(
    [...optimized.result.routes[0].stops, ...optimized.result.routes[1].stops].sort((a, b) => a - b),
    [0, 1, 2, 3]
  );
}

console.log('mvp-three-five-core: all tests passed');
