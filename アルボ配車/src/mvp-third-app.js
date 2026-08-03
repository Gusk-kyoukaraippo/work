(function startMvpThird() {
  'use strict';

  const Core = globalThis.ArboCore;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
  const VEHICLE_COLORS = {
    '10': '#087f73', '11': '#2f69a1', '12': '#8b5ba6',
    '13': '#d17b18', '14': '#bb4f66', '15': '#59733d'
  };
  const state = {
    users: [],
    historyRows: [],
    plans: [],
    selectedPlanIndex: 0,
    selectedUserIndex: -1,
    locationEditMode: false,
    inputRevision: 0,
    dailyLoadToken: 0,
    historyLoadToken: 0,
    road: null,
    map: null,
    roadReady: false,
    busy: false,
    currentRoutes: [],
    routeRequestToken: 0,
    dailyFileName: '',
    historyFileName: ''
  };

  const roadScript = $('#roadData');
  const addressScript = $('#addressData');
  const mockData2Script = $('#mockData2');
  const ROAD_DATA = JSON.parse(roadScript.textContent);
  const ADDRESS_DATA = JSON.parse(addressScript.textContent);
  const MOCK_DATA_2_CSV = mockData2Script.textContent;
  roadScript.remove();
  addressScript.remove();
  mockData2Script.remove();

  const addressResolver = new Core.AddressResolver(ADDRESS_DATA);

  function roadWorkerMain() {
    'use strict';
    let offsets;
    let to;
    let costs;
    let meters;
    let xs;
    let ys;

    class Heap {
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
        if (items.length) {
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

    function straightDistance(a, b) {
      return Math.hypot(xs[a] - xs[b], ys[a] - ys[b]);
    }

    function distanceRow(source, targets) {
      const count = offsets.length - 1;
      const distance = new Float64Array(count);
      const actual = new Float64Array(count);
      distance.fill(Infinity);
      actual.fill(Infinity);
      distance[source] = 0;
      actual[source] = 0;
      const heap = new Heap();
      heap.push([0, source]);
      const needed = new Set(targets);
      const result = new Float64Array(targets.length);
      result.fill(NaN);

      while (heap.size && needed.size) {
        const item = heap.pop();
        const currentCost = item[0];
        const node = item[1];
        if (currentCost !== distance[node]) continue;
        if (needed.has(node)) needed.delete(node);
        for (let edge = offsets[node]; edge < offsets[node + 1]; edge++) {
          const next = to[edge];
          const candidate = currentCost + costs[edge];
          if (candidate < distance[next]) {
            distance[next] = candidate;
            actual[next] = actual[node] + meters[edge];
            heap.push([candidate, next]);
          }
        }
      }
      let fallbackCount = 0;
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index];
        if (Number.isFinite(actual[target])) result[index] = actual[target];
        else { result[index] = straightDistance(source, target) * 1.35; fallbackCount++; }
      }
      return { values: result, fallbackCount };
    }

    function shortestPath(source, target) {
      if (source === target) return { path: [source], distance: 0, fallback: false };
      const count = offsets.length - 1;
      const distance = new Float64Array(count);
      const actual = new Float64Array(count);
      const previous = new Int32Array(count);
      distance.fill(Infinity);
      actual.fill(Infinity);
      previous.fill(-1);
      distance[source] = 0;
      actual[source] = 0;
      const heap = new Heap();
      heap.push([straightDistance(source, target), source, 0]);

      while (heap.size) {
        const item = heap.pop();
        const node = item[1];
        const knownCost = item[2];
        if (knownCost !== distance[node]) continue;
        if (node === target) break;
        for (let edge = offsets[node]; edge < offsets[node + 1]; edge++) {
          const next = to[edge];
          const candidate = knownCost + costs[edge];
          if (candidate < distance[next]) {
            distance[next] = candidate;
            actual[next] = actual[node] + meters[edge];
            previous[next] = node;
            heap.push([candidate + straightDistance(next, target), next, candidate]);
          }
        }
      }
      if (!Number.isFinite(distance[target])) {
        return { path: [source, target], distance: straightDistance(source, target) * 1.35, fallback: true };
      }
      const path = [];
      let cursor = target;
      while (cursor >= 0) {
        path.push(cursor);
        if (cursor === source) break;
        cursor = previous[cursor];
      }
      path.reverse();
      return { path, distance: actual[target], fallback: false };
    }

    self.onmessage = event => {
      const message = event.data;
      try {
        if (message.type === 'init') {
          offsets = message.offsets;
          to = message.to;
          costs = message.costs;
          meters = message.meters;
          xs = message.xs;
          ys = message.ys;
          self.postMessage({ type: 'ready' });
          return;
        }
        if (message.type === 'matrix') {
          const sources = message.sourceNodes;
          const matrix = new Float64Array(sources.length * sources.length);
          let fallbackCount = 0;
          for (let row = 0; row < sources.length; row++) {
            const result = distanceRow(sources[row], sources);
            matrix.set(result.values, row * sources.length);
            fallbackCount += result.fallbackCount;
            matrix[row * sources.length + row] = 0;
            self.postMessage({ type: 'progress', requestId: message.requestId, phase: 'matrix', current: row + 1, total: sources.length });
          }
          self.postMessage({ type: 'matrix-result', requestId: message.requestId, matrix, fallbackCount }, [matrix.buffer]);
          return;
        }
        if (message.type === 'routes') {
          const results = [];
          for (let index = 0; index < message.legs.length; index++) {
            const leg = message.legs[index];
            const route = shortestPath(leg.from, leg.to);
            results.push({ key: leg.key, ...route });
            self.postMessage({ type: 'progress', requestId: message.requestId, phase: 'routes', current: index + 1, total: message.legs.length });
          }
          self.postMessage({ type: 'routes-result', requestId: message.requestId, routes: results });
        }
      } catch (error) {
        self.postMessage({ type: 'worker-error', requestId: message.requestId, message: error.message || String(error) });
      }
    };
  }

  class WorkerRouter {
    constructor(onProgress) {
      this.worker = null;
      this.sequence = 0;
      this.pending = new Map();
      this.onProgress = onProgress;
      this.available = false;
      this.fatalError = null;
    }
    async init(graph) {
      const source = `(${roadWorkerMain.toString()})()`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      try {
        this.worker = new Worker(url);
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      this.worker.onmessage = event => this.handleMessage(event.data);
      this.worker.onerror = error => {
        this.available = false;
        this.fatalError = new Error(error.message || '道路計算ワーカーでエラーが発生しました。HTMLを再読み込みしてください。');
        for (const pending of this.pending.values()) pending.reject(this.fatalError);
        this.pending.clear();
      };
      await new Promise((resolve, reject) => {
        this.pending.set('ready', { resolve, reject });
        try {
          this.worker.postMessage({
            type: 'init', offsets: graph.offsets, to: graph.to, costs: graph.costs, meters: graph.meters,
            xs: graph.xs, ys: graph.ys
          }, [graph.offsets.buffer, graph.to.buffer, graph.costs.buffer, graph.meters.buffer]);
        } catch (error) {
          this.pending.delete('ready');
          reject(error);
        }
      });
      this.available = true;
    }
    handleMessage(message) {
      if (message.type === 'ready') {
        const pending = this.pending.get('ready');
        this.pending.delete('ready');
        pending?.resolve();
        return;
      }
      if (message.type === 'progress') {
        this.onProgress?.(message);
        return;
      }
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      if (message.type === 'worker-error') {
        this.pending.delete(message.requestId);
        pending.reject(new Error(message.message));
      } else if (message.type === 'matrix-result') {
        this.pending.delete(message.requestId);
        pending.resolve({ matrix: message.matrix, fallbackCount: message.fallbackCount || 0 });
      } else if (message.type === 'routes-result') {
        this.pending.delete(message.requestId);
        pending.resolve(message.routes);
      }
    }
    request(type, payload) {
      if (this.fatalError) return Promise.reject(this.fatalError);
      if (!this.available) return Promise.reject(new Error('道路計算の準備ができていません。'));
      const requestId = `${type}-${++this.sequence}`;
      return new Promise((resolve, reject) => {
        this.pending.set(requestId, { resolve, reject });
        try {
          this.worker.postMessage({ type, requestId, ...payload });
        } catch (error) {
          this.pending.delete(requestId);
          reject(error);
        }
      });
    }
    matrix(sourceNodes) { return this.request('matrix', { sourceNodes }); }
    routes(legs) { return this.request('routes', { legs }); }
  }

  class RoadEngine {
    constructor(data) {
      this.data = data;
      this.scale = data.encoding.coordinateScale || 1_000_000;
      this.originLat = data.facility.lat;
      this.originLon = data.facility.lon;
      this.cosLat = Math.cos(this.originLat * Math.PI / 180);
      this.xs = null;
      this.ys = null;
      this.reachable = null;
      this.pickupNodes = null;
      this.paths = null;
      this.bounds = null;
      this.facilityNode = -1;
      this.router = new WorkerRouter(message => this.onWorkerProgress?.(message));
      this.onWorkerProgress = null;
    }
    project(lat, lon) {
      return {
        x: (lon - this.originLon) * 111_320 * this.cosLat,
        y: (lat - this.originLat) * 110_540
      };
    }
    unproject(x, y) {
      return {
        lat: this.originLat + y / 110_540,
        lon: this.originLon + x / (111_320 * this.cosLat)
      };
    }
    edgeFactor(typeIndex, flags) {
      let factor = typeIndex <= 7 ? 1 : typeIndex <= 9 ? 1.04 : typeIndex <= 12 ? 1.10 : typeIndex === 13 ? 1.42 : typeIndex === 14 ? 2.35 : 1.35;
      if (flags & 1) factor *= 3.2;
      if (flags & 8) factor *= 1.65;
      return factor;
    }
    async prepare(onProgress) {
      const nodes = this.data.nodes;
      const ways = this.data.ways;
      const nodeCount = nodes.length;
      const xs = new Float32Array(nodeCount);
      const ys = new Float32Array(nodeCount);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let index = 0; index < nodeCount; index++) {
        const lat = nodes[index][0] / this.scale;
        const lon = nodes[index][1] / this.scale;
        const point = this.project(lat, lon);
        xs[index] = point.x;
        ys[index] = point.y;
        minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
      }
      this.xs = xs;
      this.ys = ys;
      this.bounds = { minX, minY, maxX, maxY };
      onProgress?.(12, '道路座標を展開しました');
      await nextFrame();

      const degree = new Uint32Array(nodeCount);
      const pickupCandidate = new Uint8Array(nodeCount);

      for (const way of ways) {
        const typeIndex = way[0];
        const oneway = way[1];
        const flags = way[2];
        const pickupAllowed = typeIndex > 1 && typeIndex !== 14 && !(flags & 1);
        if (pickupAllowed) for (let index = 4; index < way.length; index++) pickupCandidate[way[index]] = 1;
        for (let index = 4; index < way.length - 1; index++) {
          const left = way[index];
          const right = way[index + 1];
          if (oneway >= 0) degree[left]++;
          if (oneway <= 0) degree[right]++;
        }
      }
      onProgress?.(27, '道路の接続関係を確認しました');
      await nextFrame();

      this.facilityNode = this.nearestNodeRaw(this.data.facility.lat, this.data.facility.lon, null);
      const offsets = new Uint32Array(nodeCount + 1);
      for (let index = 0; index < nodeCount; index++) offsets[index + 1] = offsets[index] + degree[index];
      const edgeCount = offsets[nodeCount];
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
        const factor = this.edgeFactor(typeIndex, flags);
        for (let index = 4; index < way.length - 1; index++) {
          const left = way[index];
          const right = way[index + 1];
          const distance = Math.hypot(xs[left] - xs[right], ys[left] - ys[right]);
          if (oneway >= 0) addEdge(left, right, distance, distance * factor);
          if (oneway <= 0) addEdge(right, left, distance, distance * factor);
        }
      }

      const forward = new Uint8Array(nodeCount);
      const reverseDegree = new Uint32Array(nodeCount);
      for (let edge = 0; edge < to.length; edge++) reverseDegree[to[edge]]++;
      const reverseOffsets = new Uint32Array(nodeCount + 1);
      for (let index = 0; index < nodeCount; index++) reverseOffsets[index + 1] = reverseOffsets[index] + reverseDegree[index];
      const reverseTo = new Uint32Array(to.length);
      const reverseCursor = new Uint32Array(reverseOffsets.subarray(0, nodeCount));
      for (let from = 0; from < nodeCount; from++) {
        for (let edge = offsets[from]; edge < offsets[from + 1]; edge++) reverseTo[reverseCursor[to[edge]]++] = from;
      }
      const walkGraph = (adjacentOffsets, adjacentTo, visited) => {
        const queue = new Uint32Array(nodeCount);
        let head = 0, tail = 0;
        visited[this.facilityNode] = 1;
        queue[tail++] = this.facilityNode;
        while (head < tail) {
          const node = queue[head++];
          for (let edge = adjacentOffsets[node]; edge < adjacentOffsets[node + 1]; edge++) {
            const next = adjacentTo[edge];
            if (!visited[next]) { visited[next] = 1; queue[tail++] = next; }
          }
        }
      };
      walkGraph(offsets, to, forward);
      const backward = new Uint8Array(nodeCount);
      walkGraph(reverseOffsets, reverseTo, backward);
      const reachable = new Uint8Array(nodeCount);
      const pickupNodes = new Uint8Array(nodeCount);
      let reachableCount = 0;
      let pickupCount = 0;
      for (let index = 0; index < nodeCount; index++) {
        if (forward[index] && backward[index]) {
          reachable[index] = 1;
          reachableCount++;
          if (pickupCandidate[index]) { pickupNodes[index] = 1; pickupCount++; }
        }
      }
      this.reachable = reachable;
      this.pickupNodes = pickupCount ? pickupNodes : reachable;
      onProgress?.(52, `経路グラフを作成しました（${reachableCount.toLocaleString()}地点）`);
      await nextFrame();

      const paths = {
        major: new Path2D(), collector: new Path2D(), local: new Path2D(), detail: new Path2D()
      };
      for (const way of ways) {
        const typeIndex = way[0];
        const path = typeIndex <= 7 ? paths.major : typeIndex <= 9 ? paths.collector : typeIndex <= 12 ? paths.local : paths.detail;
        if (way.length <= 4) continue;
        path.moveTo(xs[way[4]], ys[way[4]]);
        for (let index = 5; index < way.length; index++) path.lineTo(xs[way[index]], ys[way[index]]);
      }
      this.paths = paths;
      onProgress?.(73, '地図表示を準備しました');
      await nextFrame();

      this.data.nodes = null;
      this.data.ways = null;
      this.data.names = null;
      await this.router.init({ offsets, to, costs, meters, xs, ys });
      onProgress?.(100, '道路データの準備が完了しました');
    }
    nearestNodeRaw(lat, lon, mask) {
      const point = this.project(lat, lon);
      let bestNode = -1;
      let bestSquared = Infinity;
      for (let index = 0; index < this.xs.length; index++) {
        if (mask && !mask[index]) continue;
        const squared = (this.xs[index] - point.x) ** 2 + (this.ys[index] - point.y) ** 2;
        if (squared < bestSquared) { bestSquared = squared; bestNode = index; }
      }
      return bestNode;
    }
    snap(lat, lon) {
      const node = this.nearestNodeRaw(lat, lon, this.pickupNodes || this.reachable);
      const point = this.project(lat, lon);
      const distance = node >= 0 ? Math.hypot(this.xs[node] - point.x, this.ys[node] - point.y) : Infinity;
      return { node, distance };
    }
    async distanceMatrix(sourceNodes, onProgress) {
      this.onWorkerProgress = message => {
        if (message.phase === 'matrix') onProgress?.(message.current, message.total);
      };
      const result = await this.router.matrix(sourceNodes);
      this.onWorkerProgress = null;
      if (result.fallbackCount) throw new Error(`道路上で往復できない組み合わせが${result.fallbackCount}件あります。位置を補正してください。`);
      const flat = result.matrix;
      const size = sourceNodes.length;
      return Array.from({ length: size }, (_, row) => Array.from(flat.subarray(row * size, (row + 1) * size)));
    }
    async routeLegs(legs, onProgress) {
      this.onWorkerProgress = message => {
        if (message.phase === 'routes') onProgress?.(message.current, message.total);
      };
      const routes = await this.router.routes(legs);
      this.onWorkerProgress = null;
      return routes;
    }
  }

  class CanvasMap {
    constructor(stage, roadCanvas, routeCanvas, engine) {
      this.stage = stage;
      this.roadCanvas = roadCanvas;
      this.routeCanvas = routeCanvas;
      this.engine = engine;
      this.view = { ...engine.bounds };
      this.cityView = { ...engine.bounds };
      this.routes = [];
      this.users = [];
      this.previewUsers = [];
      this.selectedPreviewIndex = -1;
      this.onWorldClick = null;
      this.drag = null;
      this.renderQueued = false;
      this.resizeObserver = new ResizeObserver(() => this.render());
      this.resizeObserver.observe(stage);
      stage.addEventListener('wheel', event => this.onWheel(event), { passive: false });
      stage.addEventListener('pointerdown', event => this.onPointerDown(event));
      stage.addEventListener('pointermove', event => this.onPointerMove(event));
      stage.addEventListener('pointerup', event => this.onPointerUp(event));
      stage.addEventListener('pointercancel', event => this.onPointerUp(event));
      this.fitBounds(this.cityView);
    }
    canvasSize(canvas) {
      const width = Math.max(1, this.stage.clientWidth);
      const height = Math.max(1, this.stage.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      return { width, height, dpr };
    }
    transform(canvas) {
      const size = this.canvasSize(canvas);
      const padding = 18;
      const rangeX = Math.max(10, this.view.maxX - this.view.minX);
      const rangeY = Math.max(10, this.view.maxY - this.view.minY);
      const scale = Math.min((size.width - padding * 2) / rangeX, (size.height - padding * 2) / rangeY);
      const offsetX = (size.width - rangeX * scale) / 2;
      const offsetY = (size.height - rangeY * scale) / 2;
      return { ...size, padding, rangeX, rangeY, scale, offsetX, offsetY };
    }
    worldToScreen(x, y, transform = this.transform(this.routeCanvas)) {
      return {
        x: transform.offsetX + (x - this.view.minX) * transform.scale,
        y: transform.height - transform.offsetY - (y - this.view.minY) * transform.scale
      };
    }
    screenToWorld(x, y, transform = this.transform(this.routeCanvas)) {
      return {
        x: this.view.minX + (x - transform.offsetX) / transform.scale,
        y: this.view.minY + (transform.height - transform.offsetY - y) / transform.scale
      };
    }
    applyWorldTransform(context, transform) {
      context.setTransform(
        transform.scale * transform.dpr, 0, 0, -transform.scale * transform.dpr,
        (transform.offsetX - this.view.minX * transform.scale) * transform.dpr,
        (transform.height - transform.offsetY + this.view.minY * transform.scale) * transform.dpr
      );
    }
    scheduleRender() {
      if (this.renderQueued) return;
      this.renderQueued = true;
      requestAnimationFrame(() => { this.renderQueued = false; this.render(); });
    }
    render() {
      this.renderRoads();
      this.renderRoutes();
    }
    renderRoads() {
      const transform = this.transform(this.roadCanvas);
      const context = this.roadCanvas.getContext('2d');
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, this.roadCanvas.width, this.roadCanvas.height);
      context.fillStyle = '#e7efeb';
      context.fillRect(0, 0, this.roadCanvas.width, this.roadCanvas.height);
      this.applyWorldTransform(context, transform);
      const metersPerPixel = 1 / transform.scale;
      const draw = (path, color, width) => {
        context.strokeStyle = color;
        context.lineWidth = width / transform.scale;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.stroke(path);
      };
      if (metersPerPixel < 5.2) draw(this.engine.paths.detail, '#d4ded9', .65);
      if (metersPerPixel < 18) draw(this.engine.paths.local, '#c3d2cc', .85);
      draw(this.engine.paths.collector, '#aebfba', 1.05);
      draw(this.engine.paths.major, '#f7f1df', 3.1);
      draw(this.engine.paths.major, '#9eafa9', 1.05);
    }
    renderRoutes() {
      const transform = this.transform(this.routeCanvas);
      const context = this.routeCanvas.getContext('2d');
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, this.routeCanvas.width, this.routeCanvas.height);
      this.applyWorldTransform(context, transform);
      for (const route of this.routes) {
        if (!route.visible) continue;
        context.strokeStyle = 'rgba(255,255,255,.92)';
        context.lineWidth = 6.2 / transform.scale;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.beginPath();
        this.traceRoute(context, route);
        context.stroke();
        context.strokeStyle = route.color;
        context.lineWidth = 3.2 / transform.scale;
        context.beginPath();
        this.traceRoute(context, route);
        context.stroke();
      }
      for (const user of this.previewUsers) {
        if (!Number.isFinite(user.lat) || !Number.isFinite(user.lon) || !Number.isInteger(user.roadNode) || user.roadNode < 0) continue;
        const addressPoint = this.engine.project(user.lat, user.lon);
        const node = user.roadNode;
        context.strokeStyle = user.locationPrecision === 'town' ? 'rgba(199,122,18,.55)' : 'rgba(8,127,115,.42)';
        context.lineWidth = 1.2 / transform.scale;
        context.setLineDash([5 / transform.scale, 4 / transform.scale]);
        context.beginPath();
        context.moveTo(addressPoint.x, addressPoint.y);
        context.lineTo(this.engine.xs[node], this.engine.ys[node]);
        context.stroke();
        context.setLineDash([]);
      }
      context.setTransform(transform.dpr, 0, 0, transform.dpr, 0, 0);
      for (const route of this.routes) {
        if (!route.visible) continue;
        for (let index = 0; index < route.stops.length; index++) {
          const stop = route.stops[index];
          const point = this.engine.project(stop.user.lat, stop.user.lon);
          const screen = this.worldToScreen(point.x, point.y, transform);
          context.beginPath();
          context.fillStyle = '#fff';
          context.arc(screen.x, screen.y, 8.2, 0, Math.PI * 2);
          context.fill();
          context.beginPath();
          context.fillStyle = route.color;
          context.arc(screen.x, screen.y, 6.1, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = '#fff';
          context.font = '700 8px sans-serif';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText(String(index + 1), screen.x, screen.y + .3);
        }
      }
      const markerIndexes = this.previewUsers.map((_, index) => index)
        .sort((left, right) => Number(left === this.selectedPreviewIndex) - Number(right === this.selectedPreviewIndex));
      for (const index of markerIndexes) {
        const user = this.previewUsers[index];
        if (!Number.isFinite(user.lat) || !Number.isFinite(user.lon)) continue;
        const point = this.engine.project(user.lat, user.lon);
        const screen = this.worldToScreen(point.x, point.y, transform);
        const selected = index === this.selectedPreviewIndex;
        const color = user.locationPrecision === 'town' ? '#c77a12' : user.locationPrecision === 'missing' ? '#b3483f' : '#087f73';
        if (selected) {
          context.beginPath();
          context.fillStyle = 'rgba(255,208,116,.95)';
          context.arc(screen.x, screen.y, 13, 0, Math.PI * 2);
          context.fill();
        }
        context.beginPath();
        context.fillStyle = '#fff';
        context.arc(screen.x, screen.y, 9.4, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.fillStyle = color;
        context.arc(screen.x, screen.y, 7.3, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#fff';
        context.font = '700 8px sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(String(index + 1), screen.x, screen.y + .2);
      }
      const facility = this.engine.project(this.engine.data.facility.lat, this.engine.data.facility.lon);
      const facilityScreen = this.worldToScreen(facility.x, facility.y, transform);
      context.fillStyle = '#b3483f';
      context.strokeStyle = '#fff';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(facilityScreen.x, facilityScreen.y, 7, 0, Math.PI * 2);
      context.fill(); context.stroke();
      context.fillStyle = '#17323b';
      context.font = '700 10px sans-serif';
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.fillText('発着地点', facilityScreen.x + 10, facilityScreen.y);
    }
    traceRoute(context, route) {
      let started = false;
      for (const leg of route.legs) {
        for (const node of leg.path) {
          const x = this.engine.xs[node];
          const y = this.engine.ys[node];
          if (!started) { context.moveTo(x, y); started = true; }
          else context.lineTo(x, y);
        }
      }
    }
    setRoutes(routes, users) {
      this.routes = routes;
      this.users = users;
      this.renderRoutes();
    }
    setPreviewUsers(users, selectedIndex = -1) {
      this.previewUsers = users || [];
      this.selectedPreviewIndex = selectedIndex;
      this.renderRoutes();
    }
    fitBounds(bounds) {
      const width = Math.max(200, bounds.maxX - bounds.minX);
      const height = Math.max(200, bounds.maxY - bounds.minY);
      const padding = .09;
      this.view = {
        minX: bounds.minX - width * padding, maxX: bounds.maxX + width * padding,
        minY: bounds.minY - height * padding, maxY: bounds.maxY + height * padding
      };
      this.scheduleRender();
    }
    fitCity() { this.fitBounds(this.cityView); }
    fitRoutes() {
      const points = [{ lat: this.engine.data.facility.lat, lon: this.engine.data.facility.lon }];
      for (const route of this.routes) if (route.visible) for (const stop of route.stops) points.push(stop.user);
      if (points.length === 1) return this.fitCity();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const point of points) {
        const projected = this.engine.project(point.lat, point.lon);
        minX = Math.min(minX, projected.x); minY = Math.min(minY, projected.y);
        maxX = Math.max(maxX, projected.x); maxY = Math.max(maxY, projected.y);
      }
      this.fitBounds({ minX, minY, maxX, maxY });
    }
    fitUsers() {
      const points = [{ lat: this.engine.data.facility.lat, lon: this.engine.data.facility.lon },
        ...this.previewUsers.filter(user => Number.isFinite(user.lat) && Number.isFinite(user.lon))];
      if (points.length === 1) return this.fitCity();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const point of points) {
        const projected = this.engine.project(point.lat, point.lon);
        minX = Math.min(minX, projected.x); minY = Math.min(minY, projected.y);
        maxX = Math.max(maxX, projected.x); maxY = Math.max(maxY, projected.y);
      }
      this.fitBounds({ minX, minY, maxX, maxY });
    }
    focusUser(index) {
      const user = this.previewUsers[index];
      if (!user || !Number.isFinite(user.lat) || !Number.isFinite(user.lon)) return;
      const point = this.engine.project(user.lat, user.lon);
      this.fitBounds({ minX: point.x - 450, maxX: point.x + 450, minY: point.y - 450, maxY: point.y + 450 });
    }
    zoomBy(factor) {
      const centerX = (this.view.minX + this.view.maxX) / 2;
      const centerY = (this.view.minY + this.view.maxY) / 2;
      const halfWidth = Math.min((this.cityView.maxX - this.cityView.minX) * 1.1, Math.max(125, (this.view.maxX - this.view.minX) * factor / 2));
      const halfHeight = Math.min((this.cityView.maxY - this.cityView.minY) * 1.1, Math.max(125, (this.view.maxY - this.view.minY) * factor / 2));
      this.view = { minX: centerX - halfWidth, maxX: centerX + halfWidth, minY: centerY - halfHeight, maxY: centerY + halfHeight };
      this.scheduleRender();
    }
    onWheel(event) {
      event.preventDefault();
      const rect = this.stage.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const transform = this.transform(this.routeCanvas);
      const anchor = this.screenToWorld(x, y, transform);
      const factor = Math.exp(Math.sign(event.deltaY) * .18);
      const width = Math.min((this.cityView.maxX - this.cityView.minX) * 2.2, Math.max(250, (this.view.maxX - this.view.minX) * factor));
      const height = Math.min((this.cityView.maxY - this.cityView.minY) * 2.2, Math.max(250, (this.view.maxY - this.view.minY) * factor));
      const ratioX = (anchor.x - this.view.minX) / (this.view.maxX - this.view.minX);
      const ratioY = (anchor.y - this.view.minY) / (this.view.maxY - this.view.minY);
      this.view = {
        minX: anchor.x - width * ratioX, maxX: anchor.x + width * (1 - ratioX),
        minY: anchor.y - height * ratioY, maxY: anchor.y + height * (1 - ratioY)
      };
      this.scheduleRender();
    }
    onPointerDown(event) {
      if (event.target.closest?.('a, button')) return;
      this.stage.setPointerCapture(event.pointerId);
      this.drag = {
        id: event.pointerId, x: event.clientX, y: event.clientY,
        startX: event.clientX, startY: event.clientY, moved: false
      };
    }
    onPointerMove(event) {
      if (!this.drag || this.drag.id !== event.pointerId) return;
      const transform = this.transform(this.routeCanvas);
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY) <= 5) return;
      this.drag.moved = true;
      this.drag.x = event.clientX; this.drag.y = event.clientY;
      const shiftX = dx / transform.scale;
      const shiftY = dy / transform.scale;
      this.view.minX -= shiftX; this.view.maxX -= shiftX;
      this.view.minY += shiftY; this.view.maxY += shiftY;
      this.scheduleRender();
    }
    onPointerUp(event) {
      if (this.drag?.id !== event.pointerId) return;
      const drag = this.drag;
      this.drag = null;
      if (event.type === 'pointerup' && !drag.moved && this.onWorldClick) {
        const rect = this.stage.getBoundingClientRect();
        this.onWorldClick(this.screenToWorld(event.clientX - rect.left, event.clientY - rect.top));
      }
    }
  }

  function setProgress(visible, percent, text) {
    $('#progressWrap').classList.toggle('visible', visible);
    $('#progressBar').style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
    $('#progressText').textContent = text || '';
  }

  function setMessages(messages) {
    const container = $('#messages');
    container.replaceChildren();
    for (const message of messages) {
      const item = document.createElement('div');
      item.className = `message ${message.type || 'info'}`;
      item.textContent = message.text;
      container.append(item);
    }
  }

  function updateWorkflow(step) {
    $$('.workflow > div').forEach(item => item.classList.toggle('active', Number(item.dataset.step) <= step));
  }

  function coordinateIssue(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '緯度・経度は両方を数値で入力してください。';
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return '緯度・経度の範囲が正しくありません。';
    const [south, west, north, east] = ROAD_DATA.coverage.bbox;
    if (lat < south || lat > north || lon < west || lon > east) {
      return `座標が内蔵道路データの範囲（緯度${south}〜${north}、経度${west}〜${east}）外です。`;
    }
    return '';
  }

  function validateInputCoordinates(users) {
    for (const user of users) {
      const hasEither = Number.isFinite(user.lat) || Number.isFinite(user.lon);
      if (!hasEither) continue;
      const issue = coordinateIssue(user.lat, user.lon);
      if (issue) throw new Error(`${user.sourceRow || '?'}行目「${user.name}」: ${issue}`);
    }
  }

  function invalidateGeneratedPlans() {
    state.plans = [];
    state.distanceMatrix = null;
    state.sourceNodes = null;
    state.generationStats = null;
    state.currentRoutes = [];
    state.selectedPlanIndex = 0;
    state.routeRequestToken++;
    state.map?.setRoutes([], state.users);
  }

  function setBusyInputs(disabled) {
    for (const id of ['dailyButton', 'historyButton', 'demoButton', 'demo2Button', 'templateButton']) {
      const element = $(`#${id}`);
      if (element) element.disabled = disabled;
    }
    $('#applyCoordinateButton') && ($('#applyCoordinateButton').disabled = disabled);
    $('#mapCorrectionButton') && ($('#mapCorrectionButton').disabled = disabled);
  }

  function updateInputSummary() {
    const users = state.users;
    const counts = {
      wheelchair: users.filter(user => user.mobility === 'wheelchair').length,
      consent: users.filter(user => user.mobility === 'walking' && user.wheelchairOk).length,
      mirror: users.filter(user => user.mirrorRequired).length,
      exact: users.filter(user => ['parcel_branch', 'parcel'].includes(user.addressMatchLevel)).length,
      town: users.filter(user => ['parent_lot', 'residential_block', 'chome', 'town'].includes(user.addressMatchLevel)).length,
      missing: users.filter(user => user.addressMatchLevel === 'unresolved').length,
      coordinateMissing: users.filter(user => user.locationPrecision === 'missing').length,
      coordinateMismatch: users.filter(user => user.coordinateAddressMismatch).length
    };
    $('#countAll').textContent = users.length;
    $('#countWheelchair').textContent = counts.wheelchair;
    $('#countConsent').textContent = counts.consent;
    $('#countMirror').textContent = counts.mirror;
    $('#legendExact').textContent = counts.exact;
    $('#legendTown').textContent = counts.town;
    $('#legendMissing').textContent = counts.missing;
    const divisor = Math.max(1, users.length);
    $('#barExact').style.width = `${counts.exact / divisor * 100}%`;
    $('#barTown').style.width = `${counts.town / divisor * 100}%`;
    $('#barMissing').style.width = `${counts.missing / divisor * 100}%`;
    $('#addressSummary').textContent = users.length ? `${users.length - counts.missing}/${users.length}件を照合` : 'CSVを読み込んでください';

    const messages = [];
    if (!users.length) messages.push({ type: 'info', text: '当日利用者CSV、29人架空デモ、または模擬データ2を読み込んでください。' });
    if (users.length > 32) messages.push({ type: 'error', text: `利用者が${users.length}人です。想定上限32人を超えています。` });
    if (counts.missing) messages.push({ type: 'warn', text: `${counts.missing}人は内蔵する公的住所データと照合できていません。座標があっても入力住所を確認してください。` });
    if (counts.coordinateMissing) messages.push({ type: 'error', text: `${counts.coordinateMissing}人の地図座標を解決できません。緯度・経度を入力するか地図で補正してください。` });
    if (counts.coordinateMismatch) messages.push({ type: 'error', text: `${counts.coordinateMismatch}人は座標を取得した住所と現在の住所が異なります。座標を再確認してください。` });
    const broadCoordinates = users.filter(user => user.locationPrecision === 'town').length;
    if (broadCoordinates) messages.push({ type: 'warn', text: `${broadCoordinates}人は地番座標がなく、丁目または町域代表点で計算します。` });
    const ambiguousCoordinates = users.filter(user => user.coordinateAmbiguous).length;
    if (ambiguousCoordinates) messages.push({ type: 'warn', text: `${ambiguousCoordinates}人は同じ地番の候補点が複数あります。地図で位置を確認してください。` });
    const farSnaps = users.filter(user => Number.isFinite(user.snapDistance) && user.snapDistance > 100);
    if (farSnaps.length) messages.push({ type: 'warn', text: `${farSnaps.length}人の地点が経路計算用の道路から100m以上離れています。地図で送迎位置を確認してください。` });
    const nodeCounts = new Map();
    for (const user of users) if (Number.isInteger(user.roadNode) && user.roadNode >= 0) nodeCounts.set(user.roadNode, (nodeCounts.get(user.roadNode) || 0) + 1);
    const duplicateGroups = [...nodeCounts.values()].filter(count => count > 1).length;
    if (duplicateGroups) messages.push({ type: 'warn', text: `${duplicateGroups}組の利用者が同じ道路地点に接続されています。住所確認地図で重なりを確認できます。` });
    if (state.road?.router?.fatalError) messages.push({ type: 'error', text: '道路計算を続行できません。HTMLを再読み込みしてください。' });
    if (state.historyRows.length) messages.push({ type: 'info', text: `過去配車 ${state.historyRows.length.toLocaleString()}行を同乗・車両実績の評価に使います。` });
    else if (users.length) messages.push({ type: 'info', text: '履歴CSVなしのため、今回は道路距離と車両条件を中心に計算します。' });
    if (messages.length) setMessages(messages);
    const ready = state.roadReady && !state.road?.router?.fatalError && users.length > 0 && users.length <= 32 && counts.coordinateMissing === 0 && counts.coordinateMismatch === 0 && !state.busy;
    $('#generateButton').disabled = !ready;
    const reviewing = $('#results').classList.contains('reviewing');
    updateWorkflow(state.plans.length && !reviewing ? 4 : state.busy ? 3 : users.length ? 2 : 1);
  }

  async function readTextFile(file) {
    const buffer = await file.arrayBuffer();
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'UTF-8' };
    } catch (_) {
      return { text: new TextDecoder('shift_jis').decode(buffer), encoding: 'Shift_JIS' };
    }
  }

  function resolveUsers(users) {
    return users.map(user => {
      const resolved = addressResolver.resolve(user);
      if (state.roadReady && Number.isFinite(resolved.lat) && Number.isFinite(resolved.lon)) {
        const issue = coordinateIssue(resolved.lat, resolved.lon);
        if (issue) return { ...resolved, lat: null, lon: null, roadNode: -1, snapDistance: Infinity, locationPrecision: 'missing', locationLabel: '範囲外' };
        const snap = state.road.snap(resolved.lat, resolved.lon);
        resolved.roadNode = snap.node;
        resolved.snapDistance = snap.distance;
      }
      return resolved;
    });
  }

  function replaceDailyUsers(users) {
    if (state.busy) throw new Error('候補生成中は別のデータを読み込めません。完了後にお試しください。');
    validateInputCoordinates(users);
    state.inputRevision++;
    state.users = resolveUsers(users);
    state.selectedUserIndex = state.users.length ? Math.max(0, state.users.findIndex(user => ['town', 'missing'].includes(user.locationPrecision))) : -1;
    if (state.selectedUserIndex < 0 && state.users.length) state.selectedUserIndex = 0;
    state.locationEditMode = false;
    invalidateGeneratedPlans();
    hideResults();
    updateInputSummary();
  }

  async function loadDailyFile(file) {
    const loadToken = ++state.dailyLoadToken;
    try {
      const decoded = await readTextFile(file);
      if (loadToken !== state.dailyLoadToken) return;
      if (state.busy) throw new Error('候補生成中は別のデータを読み込めません。完了後にお試しください。');
      const users = Core.parseDailyCsv(decoded.text);
      replaceDailyUsers(users);
      state.dailyFileName = file.name;
      $('#dailyFileName').textContent = `${file.name} / ${decoded.encoding}`;
    } catch (error) {
      setMessages([{ type: 'error', text: error.message }]);
    }
  }

  async function loadHistoryFile(file) {
    const loadToken = ++state.historyLoadToken;
    try {
      if (state.busy) throw new Error('候補生成中は履歴を変更できません。');
      const decoded = await readTextFile(file);
      if (loadToken !== state.historyLoadToken) return;
      if (state.busy) throw new Error('候補生成中は履歴を変更できません。完了後にお試しください。');
      state.historyRows = Core.parseHistoryCsv(decoded.text);
      state.inputRevision++;
      invalidateGeneratedPlans();
      state.historyFileName = file.name;
      $('#historyFileName').textContent = `${file.name} / ${state.historyRows.length.toLocaleString()}行`;
      hideResults();
      updateInputSummary();
    } catch (error) {
      setMessages([{ type: 'error', text: error.message }]);
    }
  }

  function loadDemo() {
    state.dailyLoadToken++;
    state.historyLoadToken++;
    const towns = ADDRESS_DATA.towns || [];
    const selected = [];
    const stride = Math.max(1, Math.floor(towns.length / 29));
    for (let index = 0; index < 29; index++) selected.push(towns[(index * stride + 3) % towns.length]);
    const users = selected.map((town, index) => ({
      id: `D${String(index + 1).padStart(3, '0')}`,
      name: `デモ利用者${String(index + 1).padStart(2, '0')}`,
      address: `群馬県伊勢崎市${town[0]}`,
      mobility: index < 9 ? 'wheelchair' : 'walking',
      wheelchairOk: index >= 9 && index < 17,
      mirrorRequired: index === 20,
      lat: null,
      lon: null
    }));
    const historyRows = [];
    for (let day = 1; day <= 14; day++) {
      for (let index = 0; index < users.length; index++) {
        historyRows.push({
          date: `2026-06-${String(day).padStart(2, '0')}`, trip: '迎え', id: users[index].id,
          vehicle: String(10 + ((index + Math.floor(index / 5)) % 6)), seat: '', order: (index % 6) + 1
        });
      }
    }
    replaceDailyUsers(users);
    state.historyRows = historyRows;
    state.dailyFileName = '29人架空デモ';
    state.historyFileName = '14日分デモ履歴';
    $('#dailyFileName').textContent = state.dailyFileName;
    $('#historyFileName').textContent = `${state.historyFileName} / ${historyRows.length}行`;
    updateInputSummary();
  }

  function loadDemo2() {
    try {
      state.dailyLoadToken++;
      state.historyLoadToken++;
      replaceDailyUsers(Core.parseDailyCsv(MOCK_DATA_2_CSV));
      state.historyRows = [];
      state.dailyFileName = '模擬データ2（既存27住所・匿名名）';
      state.historyFileName = '';
      $('#dailyFileName').textContent = `${state.dailyFileName} / 車いす10人`;
      $('#historyFileName').textContent = '未選択・履歴なしで生成';
      updateInputSummary();
    } catch (error) {
      setMessages([{ type: 'error', text: `模擬データ2を読み込めませんでした: ${error.message}` }]);
    }
  }

  function coordinateDescription(user) {
    if (!user) return '';
    const snap = Number.isFinite(user.snapDistance) ? `・経路計算の道路まで約${Math.round(user.snapDistance)}m` : '';
    if (user.coordinateAddressMismatch) return `座標の対象住所が現在の入力住所と異なります。再入力してください。${snap}`;
    const caution = String(user.locationLabel || '').includes('代表点')
      ? '。住所・地番の代表点です。安全な駐車位置は今回の対象外です。' : '';
    const ambiguity = user.coordinateAmbiguous ? '。同一地番に複数の位置候補があります。' : '';
    return `座標: ${user.locationLabel || '未解決'}${snap}${caution}${ambiguity}`;
  }

  function setLocationEditMode(enabled) {
    state.locationEditMode = Boolean(enabled && state.selectedUserIndex >= 0 && !state.busy);
    $('#mapCorrectionButton').classList.toggle('active', state.locationEditMode);
    $('#mapCorrectionButton').setAttribute('aria-pressed', state.locationEditMode ? 'true' : 'false');
    $('#mapStage').classList.toggle('correction-mode', state.locationEditMode);
    if (state.locationEditMode) $('#coordinateNote').textContent = '地図上で住所座標として採用する位置をクリックしてください。安全な駐車位置の記録ではありません。';
    else $('#coordinateNote').textContent = coordinateDescription(state.users[state.selectedUserIndex]);
  }

  function renderAddressReview() {
    const container = $('#addressList');
    container.replaceChildren();
    state.users.forEach((user, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-current', index === state.selectedUserIndex ? 'true' : 'false');
      const number = document.createElement('span');
      const partialMatch = ['parent_lot', 'residential_block', 'chome', 'town'].includes(user.addressMatchLevel);
      const noMatch = user.addressMatchLevel === 'unresolved';
      number.className = `address-index ${partialMatch ? 'town' : noMatch ? 'missing' : ''}`.trim();
      number.textContent = String(index + 1);
      const copy = document.createElement('span'); copy.className = 'address-copy';
      const strong = document.createElement('strong'); strong.textContent = `${user.name} / ${user.id}`;
      const small = document.createElement('small'); small.textContent = user.address;
      copy.append(strong, small);
      const tag = document.createElement('span');
      tag.className = `precision-tag ${partialMatch ? 'town' : noMatch ? 'missing' : ''}`.trim();
      tag.textContent = user.addressMatchLabel || '未照合';
      button.append(number, copy, tag);
      button.addEventListener('click', () => selectReviewUser(index, true));
      container.append(button);
    });

    const user = state.users[state.selectedUserIndex];
    const latInput = $('#selectedLatitude');
    const lonInput = $('#selectedLongitude');
    if (!user) {
      $('#selectedAddressName').textContent = '利用者を選択';
      $('#selectedAddressText').textContent = '一覧から確認する利用者を選んでください。';
      $('#matchedAddressText').textContent = '—';
      $('#addressMatchText').textContent = '—';
      $('#unmatchedAddressText').textContent = '—';
      $('#unmatchedAddressText').classList.remove('attention');
      $('#addressSourceText').textContent = '—';
      $('#coordinateMatchedAddressText').textContent = '—';
      latInput.value = ''; lonInput.value = '';
      $('#coordinateNote').textContent = '';
      $('#applyCoordinateButton').disabled = true;
      $('#mapCorrectionButton').disabled = true;
      return;
    }
    $('#selectedAddressName').textContent = `${state.selectedUserIndex + 1}. ${user.name}（${user.id}）`;
    $('#selectedAddressText').textContent = user.address;
    $('#matchedAddressText').textContent = user.matchedAddress || '照合できません';
    $('#addressMatchText').textContent = user.addressMatchLabel || '未照合';
    $('#unmatchedAddressText').textContent = user.unmatchedAddress || 'なし';
    $('#unmatchedAddressText').classList.toggle('attention', Boolean(user.unmatchedAddress));
    $('#addressSourceText').textContent = user.addressSource || '—';
    $('#coordinateMatchedAddressText').textContent = user.coordinateMatchedAddress || '未記録';
    latInput.value = Number.isFinite(user.lat) ? user.lat.toFixed(6) : '';
    lonInput.value = Number.isFinite(user.lon) ? user.lon.toFixed(6) : '';
    $('#applyCoordinateButton').disabled = state.busy;
    $('#mapCorrectionButton').disabled = state.busy;
    $('#backToResultsButton').disabled = !state.plans.length;
    $('#coordinateNote').textContent = coordinateDescription(user);
  }

  function selectReviewUser(index, focus) {
    if (!state.users[index]) return;
    state.selectedUserIndex = index;
    setLocationEditMode(false);
    state.map?.setPreviewUsers(state.users, index);
    renderAddressReview();
    if (focus) state.map?.focusUser(index);
  }

  function applySelectedCoordinate(lat, lon, source) {
    const user = state.users[state.selectedUserIndex];
    if (!user || state.busy) return;
    const issue = coordinateIssue(lat, lon);
    if (issue) {
      $('#coordinateNote').textContent = issue;
      return;
    }
    const snap = state.road.snap(lat, lon);
    if (!Number.isInteger(snap.node) || snap.node < 0) {
      $('#coordinateNote').textContent = 'この位置を往復可能な道路へ接続できません。別の位置を選んでください。';
      return;
    }
    state.users[state.selectedUserIndex] = {
      ...user, lat, lon, roadNode: snap.node, snapDistance: snap.distance,
      locationPrecision: 'manual', locationLabel: source, coordinateSource: source,
      coordinateMethod: 'manual', coordinateTargetAddress: user.address, coordinateMatchedAddress: user.address,
      coordinateAddressMismatch: false
    };
    state.inputRevision++;
    invalidateGeneratedPlans();
    setLocationEditMode(false);
    state.map.setPreviewUsers(state.users, state.selectedUserIndex);
    renderAddressReview();
    updateInputSummary();
    $('#coordinateNote').textContent = `${source}を反映しました。経路計算の道路まで約${Math.round(snap.distance)}mです。`;
  }

  function handleMapClick(world) {
    if (!$('#results').classList.contains('reviewing')) return;
    if (state.locationEditMode) {
      const coordinate = state.road.unproject(world.x, world.y);
      applySelectedCoordinate(coordinate.lat, coordinate.lon, '地図補正');
      return;
    }
    let bestIndex = -1;
    let bestDistance = Infinity;
    state.users.forEach((user, index) => {
      if (!Number.isFinite(user.lat) || !Number.isFinite(user.lon)) return;
      const point = state.road.project(user.lat, user.lon);
      const distance = Math.hypot(point.x - world.x, point.y - world.y);
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
    });
    const clickTolerance = Math.max(60, (state.map.view.maxX - state.map.view.minX) / Math.max(1, $('#mapStage').clientWidth) * 22);
    if (bestIndex >= 0 && bestDistance <= clickTolerance) selectReviewUser(bestIndex, false);
  }

  function showAddressReview(fit = true) {
    if (!state.roadReady || !state.map || !state.users.length) return;
    if (!$('#results').classList.contains('reviewing')) state.routeRequestToken++;
    state.currentRoutes = [];
    $('#emptyState').style.display = 'none';
    $('#results').classList.add('visible', 'reviewing');
    $('#mapTitle').textContent = '利用者住所と詳細道路';
    $('#fitRouteButton').textContent = '全住所';
    $('#mapStatus').textContent = 'ピンを選択・地図をドラッグ・ホイールで拡大';
    const precise = state.users.filter(user => ['parcel_branch', 'parcel'].includes(user.addressMatchLevel)).length;
    const block = state.users.filter(user => user.addressMatchLevel === 'residential_block').length;
    const broader = state.users.filter(user => ['parent_lot', 'chome', 'town'].includes(user.addressMatchLevel)).length;
    $('#addressReviewSubtitle').textContent = `${state.users.length}人中、地番・枝番 ${precise}件、街区 ${block}件、親地番・町域 ${broader}件。住所照合と座標取得方法を分けて表示します。`;
    $('#backToResultsButton').disabled = !state.plans.length;
    if (!state.users[state.selectedUserIndex]) state.selectedUserIndex = 0;
    state.map.setRoutes([], state.users);
    state.map.setPreviewUsers(state.users, state.selectedUserIndex);
    renderAddressReview();
    updateWorkflow(2);
    if (fit) nextFrame().then(() => state.map?.fitUsers());
  }

  function hideResults() {
    state.currentRoutes = [];
    state.map?.setRoutes([], state.users);
    if (state.roadReady && state.users.length) {
      showAddressReview(true);
    } else {
      $('#results').classList.remove('visible', 'reviewing');
      $('#emptyState').style.display = '';
    }
  }

  async function generatePlans() {
    if (state.busy || !state.roadReady || !state.users.length) return;
    state.busy = true;
    setBusyInputs(true);
    $('#generateButton').disabled = true;
    updateWorkflow(3);
    setProgress(true, 2, '利用者地点を道路へ接続しています');
    const revision = state.inputRevision;
    let failureMessage = '';
    let completionWarning = '';
    try {
      state.users = resolveUsers(state.users);
      const missing = state.users.filter(user => !Number.isInteger(user.roadNode) || user.roadNode < 0);
      if (missing.length) throw new Error(`${missing.length}人を道路へ接続できません。住所または緯度・経度を確認してください。`);
      const usersSnapshot = state.users.map(user => ({ ...user }));
      const historySnapshot = state.historyRows.map(row => ({ ...row }));
      const sourceNodes = [state.road.facilityNode, ...usersSnapshot.map(user => user.roadNode)];
      const distanceMatrix = await state.road.distanceMatrix(sourceNodes, (current, total) => {
        const percent = 5 + current / total * 63;
        setProgress(true, percent, `道路距離を計算中 ${current}/${total}地点`);
      });
      if (revision !== state.inputRevision) throw new Error('入力が変更されたため、古い計算結果を破棄しました。');
      setProgress(true, 73, '車両条件を満たす組み合わせを探索しています');
      await nextFrame();
      const result = Core.generatePlans({
        users: usersSnapshot,
        distanceMatrix,
        historyRows: historySnapshot,
        restartsPerProfile: 56
      });
      if (revision !== state.inputRevision) throw new Error('入力が変更されたため、古い計算結果を破棄しました。');
      if (result.errors.length) throw new Error(result.errors.join(' / '));
      state.plans = result.plans;
      state.generationStats = result.stats;
      state.distanceMatrix = distanceMatrix;
      state.sourceNodes = sourceNodes;
      state.selectedPlanIndex = 0;
      setProgress(true, 90, `${state.plans.length}案を整えています`);
      showResults();
      completionWarning = await selectPlan(0) || '';
      updateWorkflow($('#results').classList.contains('reviewing') ? 2 : 4);
      setProgress(false, 100, '完了');
    } catch (error) {
      failureMessage = error.message || String(error);
      setProgress(false, 0, '');
      updateWorkflow(2);
    } finally {
      state.busy = false;
      setBusyInputs(false);
      updateInputSummary();
      if (failureMessage) setMessages([{ type: 'error', text: failureMessage }]);
      else if (completionWarning) setMessages([{ type: 'warn', text: completionWarning }]);
    }
  }

  function showResults() {
    $('#emptyState').style.display = 'none';
    $('#results').classList.add('visible');
    $('#results').classList.remove('reviewing');
    setLocationEditMode(false);
    state.map?.setPreviewUsers([], -1);
    $('#mapTitle').textContent = '道路経路プレビュー';
    $('#fitRouteButton').textContent = '経路全体';
    if (state.plans.length) updateWorkflow(4);
    const stats = state.generationStats;
    $('#resultSubtitle').textContent = `${stats.generatedCandidateCount.toLocaleString()}通りを検証し、違いのある${state.plans.length}案に整理しました。履歴 ${stats.historyTripCount}便。`;
    renderPlanTabs();
  }

  function renderPlanTabs() {
    const container = $('#planTabs');
    container.replaceChildren();
    state.plans.forEach((plan, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `plan-tab${index === state.selectedPlanIndex ? ' active' : ''}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', index === state.selectedPlanIndex ? 'true' : 'false');
      const strong = document.createElement('strong');
      strong.textContent = `${index + 1}. ${plan.profile.label}`;
      const small = document.createElement('span');
      small.textContent = `${plan.metrics.usedVehicleCount}台・約${plan.metrics.totalDistanceKm.toFixed(1)}km`;
      button.append(strong, small);
      button.addEventListener('click', () => selectPlan(index));
      container.append(button);
    });
  }

  function metric(label, value) {
    const item = document.createElement('div');
    item.className = 'metric';
    const labelNode = document.createElement('span');
    labelNode.textContent = label;
    const valueNode = document.createElement('b');
    valueNode.textContent = value;
    item.append(labelNode, valueNode);
    return item;
  }

  function renderPlanDetails(plan) {
    const modeLabel = plan.mode === 'wheelchair-priority' ? '車いす4＋通常1' : '車いす2＋通常4';
    $('#metrics').replaceChildren(
      metric('概算道路距離・全車合計', `${plan.metrics.totalDistanceKm.toFixed(1)} km`),
      metric('使用車両', `${plan.metrics.usedVehicleCount} / 6 台`),
      metric('代替車いす乗車', `${plan.metrics.substituteCount} 人`),
      metric('15号車の構成', modeLabel),
      metric('車両間の距離ばらつき', `${plan.metrics.routeImbalanceKm.toFixed(1)} km`)
    );
    renderVehicleGrid(plan);
  }

  function renderVehicleGrid(plan) {
    const grid = $('#vehicleGrid');
    grid.replaceChildren();
    for (const vehiclePlan of plan.vehicles) {
      const color = VEHICLE_COLORS[vehiclePlan.vehicle.id];
      const card = document.createElement('article');
      card.className = 'vehicle-card';
      const head = document.createElement('div');
      head.className = 'vehicle-head';
      const dot = document.createElement('i'); dot.style.background = color;
      const title = document.createElement('strong'); title.textContent = `${vehiclePlan.vehicle.name}・${vehiclePlan.vehicle.configuration}`;
      const distance = document.createElement('small'); distance.textContent = `約 ${(vehiclePlan.distance / 1000).toFixed(1)} km`;
      head.append(dot, title, distance);
      const capacity = document.createElement('div');
      capacity.className = 'vehicle-capacity';
      const normal = document.createElement('span'); normal.className = 'capacity-pill'; normal.textContent = `通常 ${vehiclePlan.normalUsed}/${vehiclePlan.vehicle.normalCapacity}`;
      const wheelchair = document.createElement('span'); wheelchair.className = 'capacity-pill'; wheelchair.textContent = `車いす ${vehiclePlan.wheelchairUsed}/${vehiclePlan.vehicle.wheelchairCapacity}`;
      capacity.append(normal, wheelchair);
      if (vehiclePlan.vehicle.mirrorFoldable) {
        const mirror = document.createElement('span'); mirror.className = 'capacity-pill'; mirror.textContent = 'ミラー対応'; capacity.append(mirror);
      }
      const list = document.createElement('ol');
      list.className = 'stop-list';
      vehiclePlan.stops.forEach((stop, index) => {
        const user = state.users[stop.userIndex];
        const row = document.createElement('li');
        const number = document.createElement('span'); number.className = 'stop-number'; number.textContent = String(index + 1);
        const name = document.createElement('div'); name.className = 'stop-name';
        const strong = document.createElement('strong'); strong.textContent = user.name;
        const small = document.createElement('small'); small.textContent = `${user.address}・${user.locationLabel}`;
        name.append(strong, small);
        const seat = document.createElement('span');
        const substitute = stop.seat === 'wheelchair' && user.mobility !== 'wheelchair';
        seat.className = `seat-tag${substitute ? ' sub' : ''}`;
        seat.textContent = stop.seat === 'wheelchair' ? (substitute ? '代替車いす' : '車いす') : '通常席';
        row.append(number, name, seat);
        list.append(row);
      });
      card.append(head, capacity, list);
      grid.append(card);
    }
  }

  async function selectPlan(index) {
    if (!state.plans[index]) return;
    state.selectedPlanIndex = index;
    renderPlanTabs();
    const plan = state.plans[index];
    renderPlanDetails(plan);
    const token = ++state.routeRequestToken;
    $('#mapStatus').textContent = '道路経路を作成中…';
    const legs = [];
    const routeDefinitions = [];
    for (const vehiclePlan of plan.vehicles) {
      const nodes = [state.road.facilityNode, ...vehiclePlan.stops.map(stop => state.users[stop.userIndex].roadNode), state.road.facilityNode];
      const routeLegs = [];
      for (let legIndex = 0; legIndex < nodes.length - 1; legIndex++) {
        const key = `${vehiclePlan.vehicle.id}-${legIndex}`;
        legs.push({ from: nodes[legIndex], to: nodes[legIndex + 1], key });
        routeLegs.push(key);
      }
      routeDefinitions.push({
        vehicleId: vehiclePlan.vehicle.id,
        color: VEHICLE_COLORS[vehiclePlan.vehicle.id],
        visible: true,
        legKeys: routeLegs,
        stops: vehiclePlan.stops.map(stop => ({ ...stop, user: state.users[stop.userIndex] }))
      });
    }
    try {
      const routes = await state.road.routeLegs(legs, (current, total) => {
        if (token === state.routeRequestToken) $('#mapStatus').textContent = `道路経路を作成中 ${current}/${total}`;
      });
      if (token !== state.routeRequestToken || $('#results').classList.contains('reviewing')) return;
      const fallbackCount = routes.filter(route => route.fallback).length;
      if (fallbackCount) throw new Error(`${fallbackCount}区間を道路上で往復できません。住所位置を補正して再生成してください。`);
      const byKey = new Map(routes.map(route => [route.key, route]));
      state.currentRoutes = routeDefinitions.map(definition => ({
        ...definition,
        legs: definition.legKeys.map(key => byKey.get(key)).filter(Boolean)
      }));
      state.map.setRoutes(state.currentRoutes, state.users);
      state.map.fitRoutes();
      renderVehicleFilter();
      $('#mapStatus').textContent = '道路経路を表示中';
    } catch (error) {
      if (token !== state.routeRequestToken || $('#results').classList.contains('reviewing')) return;
      $('#mapStatus').textContent = '経路表示エラー';
      const warning = `配車案は生成済みですが、地図経路を表示できませんでした: ${error.message}`;
      setMessages([{ type: 'warn', text: warning }]);
      return warning;
    }
  }

  function renderVehicleFilter() {
    const container = $('#vehicleFilter');
    container.replaceChildren();
    for (const route of state.currentRoutes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'vehicle-chip';
      const dot = document.createElement('i'); dot.style.background = route.color;
      const label = document.createElement('span'); label.textContent = `${route.vehicleId}号車`;
      button.append(dot, label);
      button.addEventListener('click', () => {
        route.visible = !route.visible;
        button.classList.toggle('off', !route.visible);
        state.map.renderRoutes();
      });
      container.append(button);
    }
  }

  function csvSafe(value) {
    const text = String(value ?? '');
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
  }

  function downloadBlob(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportSelectedCsv() {
    const plan = state.plans[state.selectedPlanIndex];
    if (!plan) return;
    const rows = [[
      '候補名', '15号車構成', '車両番号', '訪問順', '利用者ID', '利用者名', '住所',
      '緯度', '経度', '座標情報元', '座標取得時住所', '座標代表住所', '照合住所', '住所一致レベル', '未一致部分', '住所情報元',
      '座席区分', '車いす利用', '代替乗車', 'ミラー折り畳み必須', '位置精度', '車両概算距離km'
    ]];
    for (const vehiclePlan of plan.vehicles) {
      vehiclePlan.stops.forEach((stop, index) => {
        const user = state.users[stop.userIndex];
        const substitute = stop.seat === 'wheelchair' && user.mobility !== 'wheelchair';
        rows.push([
          plan.profile.label,
          plan.mode === 'wheelchair-priority' ? '車いす4＋通常1' : '車いす2＋通常4',
          vehiclePlan.vehicle.id,
          index + 1,
          user.id,
          user.name,
          user.address,
          Number.isFinite(user.lat) ? user.lat.toFixed(6) : '',
          Number.isFinite(user.lon) ? user.lon.toFixed(6) : '',
          user.coordinateSource || user.locationLabel,
          user.coordinateTargetAddress || user.address,
          user.coordinateMatchedAddress || '',
          user.matchedAddress || '',
          user.addressMatchLabel || '未照合',
          user.unmatchedAddress || '',
          user.addressSource || '',
          stop.seat === 'wheelchair' ? '車いす枠' : '通常席',
          user.mobility === 'wheelchair' ? 'はい' : 'いいえ',
          substitute ? 'はい' : 'いいえ',
          user.mirrorRequired ? 'はい' : 'いいえ',
          user.locationLabel,
          (vehiclePlan.distance / 1000).toFixed(2)
        ]);
      });
    }
    const csv = '\uFEFF' + Core.toCsv(rows.map(row => row.map(csvSafe))).replace(/\n/g, '\r\n');
    downloadBlob(`配車案_${new Date().toISOString().slice(0, 10)}_${state.selectedPlanIndex + 1}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function exportCoordinateCsv() {
    if (!state.users.length) return;
    const rows = [[
      '利用者ID', '利用者名', '住所', '車いす利用', '車いす代替乗車可', 'ミラー折り畳み必須', '緯度', '経度', '座標情報元',
      '座標取得時住所', '座標代表住所', '照合住所', '住所一致レベル', '未一致部分', '住所情報元'
    ]];
    for (const user of state.users) {
      rows.push([
        user.id, user.name, user.address,
        user.mobility === 'wheelchair' ? 'はい' : 'いいえ',
        user.wheelchairOk ? 'はい' : 'いいえ',
        user.mirrorRequired ? 'はい' : 'いいえ',
        Number.isFinite(user.lat) ? user.lat.toFixed(6) : '',
        Number.isFinite(user.lon) ? user.lon.toFixed(6) : '',
        user.coordinateSource || user.locationLabel || '',
        user.coordinateTargetAddress || user.address,
        user.coordinateMatchedAddress || '',
        user.matchedAddress || '',
        user.addressMatchLabel || '未照合',
        user.unmatchedAddress || '',
        user.addressSource || ''
      ]);
    }
    const csv = '\uFEFF' + Core.toCsv(rows.map(row => row.map(csvSafe))).replace(/\n/g, '\r\n');
    downloadBlob(`当日利用者_座標付き_${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function exportSelectedJson() {
    const plan = state.plans[state.selectedPlanIndex];
    if (!plan) return;
    const serializablePlan = {
      candidate: state.selectedPlanIndex + 1,
      profile: plan.profile,
      mode: plan.mode,
      metrics: plan.metrics,
      vehicles: plan.vehicles.map(vehiclePlan => ({
        vehicle: vehiclePlan.vehicle,
        normalUsed: vehiclePlan.normalUsed,
        wheelchairUsed: vehiclePlan.wheelchairUsed,
        distanceMeters: vehiclePlan.distance,
        stops: vehiclePlan.stops.map((stop, index) => ({ order: index + 1, seat: stop.seat, user: state.users[stop.userIndex] }))
      }))
    };
    const output = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      facility: state.road.data.facility,
      roadData: {
        source: state.road.data.source,
        generatedAt: state.road.data.generatedAt,
        coverage: state.road.data.coverage
      },
      input: { dailyFile: state.dailyFileName, historyFile: state.historyFileName, userCount: state.users.length },
      plan: serializablePlan,
      warnings: [
        '60分目標は評価対象外です。',
        '道路経路は検討用の概算であり、通行可否・車幅・時間帯規制を完全には保証しません。'
      ]
    };
    downloadBlob(`配車案_${new Date().toISOString().slice(0, 10)}_${state.selectedPlanIndex + 1}.json`, JSON.stringify(output, null, 2), 'application/json;charset=utf-8');
  }

  function downloadTemplate() {
    const rows = [
      ['利用者ID', '利用者名', '住所', '車いす利用', '車いす代替乗車可', 'ミラー折り畳み必須', '緯度', '経度', '座標情報元', '座標取得時住所', '座標代表住所', '照合住所', '住所一致レベル', '未一致部分', '住所情報元'],
      ['U001', '例：利用者A', '群馬県伊勢崎市太田町366', 'いいえ', 'はい', 'いいえ', '', '', '', '', '', '', '', '', ''],
      ['U002', '例：利用者B', '群馬県伊勢崎市曲輪町', 'はい', 'いいえ', 'はい', '36.324218', '139.190602', 'CSV座標', '群馬県伊勢崎市曲輪町', '', '', '', '', '']
    ];
    const csv = '\uFEFF' + Core.toCsv(rows).replace(/\n/g, '\r\n');
    downloadBlob('当日利用者CSV_ひな形.csv', csv, 'text/csv;charset=utf-8');
  }

  function bindEvents() {
    $('#dailyButton').addEventListener('click', () => { $('#dailyInput').value = ''; $('#dailyInput').click(); });
    $('#historyButton').addEventListener('click', () => { $('#historyInput').value = ''; $('#historyInput').click(); });
    $('#dailyInput').addEventListener('change', event => event.target.files[0] && loadDailyFile(event.target.files[0]));
    $('#historyInput').addEventListener('change', event => event.target.files[0] && loadHistoryFile(event.target.files[0]));
    $('#demoButton').addEventListener('click', loadDemo);
    $('#demo2Button').addEventListener('click', loadDemo2);
    $('#templateButton').addEventListener('click', downloadTemplate);
    $('#generateButton').addEventListener('click', generatePlans);
    $('#fitRouteButton').addEventListener('click', () => $('#results').classList.contains('reviewing') ? state.map?.fitUsers() : state.map?.fitRoutes());
    $('#fitCityButton').addEventListener('click', () => state.map?.fitCity());
    $('#zoomInButton').addEventListener('click', () => state.map?.zoomBy(.72));
    $('#zoomOutButton').addEventListener('click', () => state.map?.zoomBy(1.38));
    $('#reviewAddressesButton').addEventListener('click', () => showAddressReview(false));
    $('#backToResultsButton').addEventListener('click', () => {
      if (!state.plans.length) return;
      showResults();
      selectPlan(state.selectedPlanIndex);
    });
    $('#exportCoordinatesButton').addEventListener('click', exportCoordinateCsv);
    $('#applyCoordinateButton').addEventListener('click', () => applySelectedCoordinate(Number($('#selectedLatitude').value), Number($('#selectedLongitude').value), '手動入力'));
    $('#mapCorrectionButton').addEventListener('click', () => setLocationEditMode(!state.locationEditMode));
    $('#exportCsvButton').addEventListener('click', exportSelectedCsv);
    $('#exportJsonButton').addEventListener('click', exportSelectedJson);
  }

  async function initializeRoads() {
    setProgress(true, 2, '内蔵道路データを展開しています');
    try {
      state.road = new RoadEngine(ROAD_DATA);
      await state.road.prepare((percent, message) => setProgress(true, percent, message));
      state.roadReady = true;
      state.map = new CanvasMap($('#mapStage'), $('#roadCanvas'), $('#routeCanvas'), state.road);
      state.map.onWorldClick = handleMapClick;
      $('#roadBadge').textContent = `${state.road.data.stats.nodeCount.toLocaleString()}地点・生活道路まで収録`;
      setProgress(false, 100, '準備完了');
      if (state.users.length) {
        state.users = resolveUsers(state.users);
        showAddressReview(true);
      }
      updateInputSummary();
    } catch (error) {
      $('#roadBadge').textContent = '道路データの準備に失敗';
      setProgress(false, 0, '');
      setMessages([{ type: 'error', text: `道路データを準備できませんでした: ${error.message}` }]);
    }
  }

  bindEvents();
  updateInputSummary();
  initializeRoads();
})();
