import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const require = createRequire(import.meta.url);
const Core = require('../src/mvp-third-core.js');

const roadData = JSON.parse(fs.readFileSync(path.join(projectDir, 'data/isesaki-road-network.json'), 'utf8'));
const abrAddressData = JSON.parse(fs.readFileSync(path.join(projectDir, 'data/isesaki-abr-address-points.json'), 'utf8'));
const mockCsv = fs.readFileSync(path.join(projectDir, 'MVP3rd/mock-data-2.csv'), 'utf8');

function resolveMissingCoordinates(users) {
  const missingBeforeResolution = users.filter(user => !Number.isFinite(user.lat) || !Number.isFinite(user.lon));
  assert.deepEqual(missingBeforeResolution, [], '模擬データ2は27人全員の座標を持つこと');

  const resolver = new Core.AddressResolver({ abr: abrAddressData });
  const resolved = users.map(user => resolver.resolve(user));
  const upgraded = resolved.find(user => user.id === 'M2-025');
  assert.equal(upgraded.addressMatchLevel, 'parcel_branch', 'M2-025は地番・枝番まで照合できること');
  assert.equal(upgraded.coordinateSource, 'ABR地番代表点', 'M2-025はABR地番座標を使うこと');
  assert.ok(Math.abs(upgraded.lat - 36.317518) < 0.000002);
  assert.ok(Math.abs(upgraded.lon - 139.165096) < 0.000002);
  assert.equal(resolved.filter(user => user.addressMatchLevel === 'parcel_branch').length, 20);
  assert.equal(resolved.filter(user => user.addressMatchLevel === 'parcel').length, 4);
  assert.equal(resolved.filter(user => user.addressMatchLevel === 'residential_block').length, 1);
  assert.equal(resolved.filter(user => user.addressMatchLevel === 'parent_lot').length, 2);
  return resolved;
}

function project(lat, lon) {
  const originLat = roadData.facility.lat;
  const originLon = roadData.facility.lon;
  const cosLat = Math.cos(originLat * Math.PI / 180);
  return {
    x: (lon - originLon) * 111_320 * cosLat,
    y: (lat - originLat) * 110_540
  };
}

function edgeFactor(typeIndex, flags) {
  let factor = typeIndex <= 7 ? 1
    : typeIndex <= 9 ? 1.04
      : typeIndex <= 12 ? 1.10
        : typeIndex === 13 ? 1.42
          : typeIndex === 14 ? 2.35
            : 1.35;
  if (flags & 1) factor *= 3.2;
  if (flags & 8) factor *= 1.65;
  return factor;
}

function nearestNode(lat, lon, xs, ys, mask = null) {
  const point = project(lat, lon);
  let bestNode = -1;
  let bestSquared = Infinity;
  for (let index = 0; index < xs.length; index++) {
    if (mask && !mask[index]) continue;
    const squared = (xs[index] - point.x) ** 2 + (ys[index] - point.y) ** 2;
    if (squared < bestSquared) {
      bestNode = index;
      bestSquared = squared;
    }
  }
  return { node: bestNode, distance: Math.sqrt(bestSquared) };
}

function walkGraph(startNode, offsets, to) {
  const visited = new Uint8Array(offsets.length - 1);
  const queue = new Uint32Array(visited.length);
  let head = 0;
  let tail = 0;
  visited[startNode] = 1;
  queue[tail++] = startNode;
  while (head < tail) {
    const node = queue[head++];
    for (let edge = offsets[node]; edge < offsets[node + 1]; edge++) {
      const next = to[edge];
      if (!visited[next]) {
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
  }
  return visited;
}

function buildRoadGraph() {
  assert.deepEqual(
    roadData.highwayTypes.slice(0, 2),
    ['motorway', 'motorway_link'],
    '送迎候補除外の道路種別インデックがアプリの前提と合うこと'
  );
  assert.equal(roadData.highwayTypes[14], 'track');

  const nodes = roadData.nodes;
  const ways = roadData.ways;
  const nodeCount = nodes.length;
  const scale = roadData.encoding.coordinateScale || 1_000_000;
  const xs = new Float32Array(nodeCount);
  const ys = new Float32Array(nodeCount);
  for (let index = 0; index < nodeCount; index++) {
    const point = project(nodes[index][0] / scale, nodes[index][1] / scale);
    xs[index] = point.x;
    ys[index] = point.y;
  }

  const degree = new Uint32Array(nodeCount);
  const pickupCandidate = new Uint8Array(nodeCount);
  for (const way of ways) {
    const typeIndex = way[0];
    const oneway = way[1];
    const flags = way[2];
    const pickupAllowed = typeIndex > 1 && typeIndex !== 14 && !(flags & 1);
    if (pickupAllowed) {
      for (let index = 4; index < way.length; index++) pickupCandidate[way[index]] = 1;
    }
    for (let index = 4; index < way.length - 1; index++) {
      const left = way[index];
      const right = way[index + 1];
      if (oneway >= 0) degree[left]++;
      if (oneway <= 0) degree[right]++;
    }
  }

  const offsets = new Uint32Array(nodeCount + 1);
  for (let index = 0; index < nodeCount; index++) offsets[index + 1] = offsets[index] + degree[index];
  const edgeCount = offsets[nodeCount];
  assert.equal(edgeCount, roadData.stats.directedEdgeCount, '有向辺数が道路データの統計と合うこと');

  const to = new Uint32Array(edgeCount);
  const costs = new Float32Array(edgeCount);
  const meters = new Float32Array(edgeCount);
  const cursor = new Uint32Array(offsets.subarray(0, nodeCount));
  const addEdge = (from, destination, distance, cost) => {
    const edge = cursor[from]++;
    to[edge] = destination;
    meters[edge] = distance;
    costs[edge] = cost;
  };

  for (const way of ways) {
    const typeIndex = way[0];
    const oneway = way[1];
    const flags = way[2];
    const factor = edgeFactor(typeIndex, flags);
    for (let index = 4; index < way.length - 1; index++) {
      const left = way[index];
      const right = way[index + 1];
      const distance = Math.hypot(xs[left] - xs[right], ys[left] - ys[right]);
      if (oneway >= 0) addEdge(left, right, distance, distance * factor);
      if (oneway <= 0) addEdge(right, left, distance, distance * factor);
    }
  }

  const facilitySnap = nearestNode(roadData.facility.lat, roadData.facility.lon, xs, ys);
  assert.ok(facilitySnap.node >= 0, '発着地を道路ノードにスナップできること');

  const reverseDegree = new Uint32Array(nodeCount);
  for (let edge = 0; edge < to.length; edge++) reverseDegree[to[edge]]++;
  const reverseOffsets = new Uint32Array(nodeCount + 1);
  for (let index = 0; index < nodeCount; index++) reverseOffsets[index + 1] = reverseOffsets[index] + reverseDegree[index];
  const reverseTo = new Uint32Array(edgeCount);
  const reverseCursor = new Uint32Array(reverseOffsets.subarray(0, nodeCount));
  for (let from = 0; from < nodeCount; from++) {
    for (let edge = offsets[from]; edge < offsets[from + 1]; edge++) reverseTo[reverseCursor[to[edge]]++] = from;
  }

  const forward = walkGraph(facilitySnap.node, offsets, to);
  const backward = walkGraph(facilitySnap.node, reverseOffsets, reverseTo);
  const reachable = new Uint8Array(nodeCount);
  const pickupNodes = new Uint8Array(nodeCount);
  let reachableCount = 0;
  let pickupCount = 0;
  for (let index = 0; index < nodeCount; index++) {
    if (forward[index] && backward[index]) {
      reachable[index] = 1;
      reachableCount++;
      if (pickupCandidate[index]) {
        pickupNodes[index] = 1;
        pickupCount++;
      }
    }
  }
  assert.ok(reachable[facilitySnap.node], '発着地ノードが往復到達可能集合に含まれること');
  assert.ok(pickupCount > 0, '往復可能な送迎候補ノードがあること');

  return {
    xs,
    ys,
    offsets,
    to,
    costs,
    meters,
    reachable,
    pickupCandidate,
    pickupNodes,
    facilityNode: facilitySnap.node,
    facilitySnapDistance: facilitySnap.distance,
    reachableCount,
    pickupCount
  };
}

function distanceRow(source, targets, graph) {
  const count = graph.offsets.length - 1;
  const distance = new Float64Array(count);
  const actual = new Float64Array(count);
  distance.fill(Infinity);
  actual.fill(Infinity);
  distance[source] = 0;
  actual[source] = 0;
  const heap = new Core.MinHeap();
  heap.push([0, source]);
  const needed = new Set(targets);

  while (heap.size && needed.size) {
    const [currentCost, node] = heap.pop();
    if (currentCost !== distance[node]) continue;
    needed.delete(node);
    for (let edge = graph.offsets[node]; edge < graph.offsets[node + 1]; edge++) {
      const next = graph.to[edge];
      const candidate = currentCost + graph.costs[edge];
      if (candidate < distance[next]) {
        distance[next] = candidate;
        actual[next] = actual[node] + graph.meters[edge];
        heap.push([candidate, next]);
      }
    }
  }

  return targets.map(target => actual[target]);
}

function buildDistanceMatrix(sourceNodes, graph) {
  return sourceNodes.map((source, index) => {
    const row = distanceRow(source, sourceNodes, graph);
    for (let targetIndex = 0; targetIndex < row.length; targetIndex++) {
      assert.ok(
        Number.isFinite(row[targetIndex]),
        `道路上で到達不可: ${index} -> ${targetIndex}`
      );
      assert.ok(row[targetIndex] >= 0, `負の道路距離: ${index} -> ${targetIndex}`);
    }
    assert.equal(row[index], 0, '同一送迎ノードへの距離は0であること');
    return row;
  });
}

const parsedUsers = Core.parseDailyCsv(mockCsv);
assert.equal(parsedUsers.length, 27, '模擬データ2は27人分であること');
const users = resolveMissingCoordinates(parsedUsers);
const [south, west, north, east] = roadData.coverage.bbox;
for (const user of users) {
  assert.ok(Number.isFinite(user.lat) && Number.isFinite(user.lon), `${user.id}: 有効な緯度経度が必要です`);
  assert.ok(
    user.lat >= south && user.lat <= north && user.lon >= west && user.lon <= east,
    `${user.id}: 座標が道路データ範囲外です`
  );
}

console.log('道路グラフを構築しています…');
const graph = buildRoadGraph();
const snappedUsers = users.map(user => {
  const snap = nearestNode(user.lat, user.lon, graph.xs, graph.ys, graph.pickupNodes);
  assert.ok(snap.node >= 0, `${user.id}: 送迎候補ノードにスナップできません`);
  assert.ok(graph.reachable[snap.node], `${user.id}: スナップ先が往復到達可能集合の外です`);
  assert.ok(graph.pickupCandidate[snap.node], `${user.id}: スナップ先が送迎候補道路ではありません`);
  assert.ok(snap.distance <= 500, `${user.id}: 送迎候補道路まで${snap.distance.toFixed(1)}mと離れすぎです`);
  return { ...user, roadNode: snap.node, snapDistance: snap.distance };
});

const sourceNodes = [graph.facilityNode, ...snappedUsers.map(user => user.roadNode)];
console.log(`${sourceNodes.length}地点の全相互道路距離を計算しています…`);
const distanceMatrix = buildDistanceMatrix(sourceNodes, graph);

const generation = Core.generatePlans({
  users: snappedUsers,
  distanceMatrix,
  restartsPerProfile: 18
});
assert.deepEqual(generation.errors, [], '配車候補生成でエラーがないこと');
assert.ok(
  generation.plans.length >= 1 && generation.plans.length <= 5,
  `配車候補数は1〜5案の範囲が必要です（実際: ${generation.plans.length}）`
);
for (const plan of generation.plans) {
  assert.deepEqual(Core.validatePlan(plan, snappedUsers), [], `${plan.profile?.label || '候補'}の制約検証`);
  const assigned = plan.vehicles.reduce((sum, vehicle) => sum + vehicle.stops.length, 0);
  assert.equal(assigned, snappedUsers.length, '全27人が一度ずつ配車されること');
}

const maxSnapUser = snappedUsers.reduce((current, user) => user.snapDistance > current.snapDistance ? user : current);
let maximumRoadDistance = 0;
for (const row of distanceMatrix) {
  for (const value of row) maximumRoadDistance = Math.max(maximumRoadDistance, value);
}

console.log(JSON.stringify({
  result: 'ok',
  users: snappedUsers.length,
  coordinateResolution: {
    csvCoordinates: parsedUsers.filter(user => Number.isFinite(user.lat) && Number.isFinite(user.lon)).length,
    abrParcelPoints: users.filter(user => user.coordinateSource === 'ABR地番代表点').length,
    abrBlockPoints: users.filter(user => user.coordinateSource === 'ABR街区代表点').length
  },
  graph: {
    nodes: roadData.nodes.length,
    directedEdges: graph.to.length,
    facilitySccNodes: graph.reachableCount,
    pickupCandidateNodesInScc: graph.pickupCount
  },
  snapping: {
    facilityMeters: Number(graph.facilitySnapDistance.toFixed(1)),
    maximumMeters: Number(maxSnapUser.snapDistance.toFixed(1)),
    maximumUserId: maxSnapUser.id
  },
  routes: {
    orderedPairsChecked: sourceNodes.length * sourceNodes.length,
    unreachablePairs: 0,
    maximumRoadKilometers: Number((maximumRoadDistance / 1000).toFixed(2))
  },
  plans: {
    count: generation.plans.length,
    generatedCandidates: generation.stats?.generatedCandidateCount || 0,
    allConstraintsValid: true
  }
}, null, 2));
