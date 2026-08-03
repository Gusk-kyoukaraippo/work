const STALE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN_PASSWORD = 'mmh';
const ADMIN_SESSION_KEY = 'goods_admin_authed';

let state = null;
let scanStream = null;
let scanning = false;
let scanningFrame = null;
let editDeviceId = null;

const $ = (id) => document.getElementById(id);

function nowTs() {
  return new Date().toISOString();
}

function uid(prefix) {
  if (window.crypto && window.crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

function empty(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

function defaultState() {
  const types = ['ノートPC'];
  const devices = Array.from({ length: 10 }, (_, i) => ({
    id: `EQ-${String(i + 1).padStart(2, '0')}`,
    type: 'ノートPC',
    name: `PC-${String(i + 1).padStart(2, '0')}`,
    note: '',
    createdAt: nowTs(),
  }));
  return { types, devices, scans: [] };
}

function normalizeState(input) {
  const base = defaultState();
  const parsed = input && typeof input === 'object' ? input : {};
  const types = Array.isArray(parsed.types) && parsed.types.length ? parsed.types.filter(Boolean) : base.types;
  const devices = Array.isArray(parsed.devices) ? parsed.devices.filter((d) => d && d.id) : base.devices;
  const scans = Array.isArray(parsed.scans) ? parsed.scans.filter((s) => s && s.deviceId && s.ts) : [];
  return {
    types: types.length ? types : base.types,
    devices,
    scans,
  };
}

async function initState() {
  showLoading(true);
  try {
    const res = await fetch('/api/goods/data');
    const data = await res.json();
    if (data && (data.types || data.devices)) {
      state = normalizeState(data);
    } else {
      state = defaultState();
      await persist();
    }
  } catch (e) {
    state = defaultState();
    toast('データ読み込みに失敗しました（オフライン動作中）');
  }
  showLoading(false);
}

async function persist() {
  try {
    await fetch('/api/goods/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
  } catch (e) {
    toast('クラウド保存に失敗しました');
  }
}

function showLoading(on) {
  const overlay = $('loading-overlay');
  const mainContent = $('main-content');
  if (overlay) overlay.style.display = on ? 'flex' : 'none';
  if (mainContent) mainContent.style.display = on ? 'none' : '';
}

function isAdminAuthed() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
}

function showAdminContent(on) {
  const gate = $('admin-gate');
  const content = $('admin-content');
  if (gate) gate.style.display = on ? 'none' : '';
  if (content) content.style.display = on ? '' : 'none';
}

function adminLogin() {
  const pw = $('admin-password');
  const err = $('admin-error');
  if (pw.value === ADMIN_PASSWORD) {
    sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
    pw.value = '';
    err.style.display = 'none';
    showAdminContent(true);
    renderAll();
  } else {
    err.style.display = '';
    pw.value = '';
    pw.focus();
  }
}

function adminLogout() {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  showAdminContent(false);
}

function escapeHtml(v) {
  return String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatJa(ts) {
  if (empty(ts)) return '未確認';
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ts));
}

function isStale(ts) {
  if (empty(ts)) return true;
  return Date.now() - new Date(ts).getTime() >= STALE_DAYS * DAY_MS;
}

function latestScan(deviceId) {
  for (let i = 0; i < state.scans.length; i++) {
    const s = state.scans[i];
    if (s.deviceId === deviceId) return s;
  }
  return null;
}

function renderTypes() {
  const opts = state.types.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  $('filter-type').innerHTML = `<option value="all">全種別</option>${opts}`;
  $('device-type').innerHTML = opts;

  const historyOpts = state.devices
    .map((d) => `<option value="${d.id}">${escapeHtml(d.name)} (${escapeHtml(d.type)})</option>`)
    .join('');
  $('history-filter').innerHTML = `<option value="all">全機器</option>${historyOpts}`;
}

function renderTypeList() {
  if (state.types.length === 0) {
    $('type-list').innerHTML = '<div class="muted">種別なし</div>';
    return;
  }
  const rows = state.types
    .map(
      (t) => `<div class="list-item">${escapeHtml(t)}<span class="device-actions"><button class="ghost" data-act="rename-type" data-type="${encode(t)}">編集</button> <button class="ghost" data-act="delete-type" data-type="${encode(t)}">削除</button></span></div>`,
    )
    .join('');
  $('type-list').innerHTML = rows;
}

function encode(v) {
  return encodeURIComponent(String(v));
}

function decode(v) {
  return decodeURIComponent(String(v));
}

function renderDeviceCards() {
  const target = $('filter-type').value;
  const grouped = $('btn-group-view').classList.contains('active');
  const list = state.devices.filter((d) => target === 'all' || d.type === target);

  if (list.length === 0) {
    $('device-list').innerHTML = '<div class="muted">該当機器なし</div>';
    return;
  }

  function badgeHtml(last) {
    if (!last)            return `<span class="badge na">❓ 未確認</span>`;
    if (isStale(last.ts)) return `<span class="badge warn">⚠️ 要確認</span>`;
    return                        `<span class="badge ok">✅ OK</span>`;
  }

  if (!grouped) {
    const rows = list
      .map((d) => {
        const last = latestScan(d.id);
        return `<tr>
          <td><strong>${escapeHtml(d.name || '-')}</strong><div class="muted">${escapeHtml(d.id)}</div></td>
          <td>${escapeHtml(d.type)}</td>
          <td>${formatJa(last?.ts)}</td>
          <td>${escapeHtml(last?.location || '-')}</td>
          <td>${escapeHtml(last?.checker || '-')}</td>
          <td>${badgeHtml(last)}</td>
        </tr>`;
      })
      .join('');

    $('device-list').className = 'table-wrap';
    $('device-list').innerHTML = `<table>
      <thead><tr><th>表示名</th><th>種別</th><th>最終確認</th><th>場所</th><th>確認者</th><th>状態</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
    return;
  }

  const groups = list.reduce((acc, d) => {
    acc[d.type] = acc[d.type] || [];
    acc[d.type].push(d);
    return acc;
  }, {});

  const html = Object.keys(groups)
    .sort()
    .map((type) => {
      const cards = groups[type]
        .map((d) => {
          const last = latestScan(d.id);
          const warnClass = last && isStale(last.ts) ? 'warning' : '';
          return `<div class="device-card ${warnClass}">
            <div class="device-card-body">
              <div><strong>${escapeHtml(d.name || '-')}</strong> <span class="muted" style="font-size:11px;">${escapeHtml(d.id)}</span></div>
              <div class="device-meta">最終確認: ${formatJa(last?.ts)}</div>
              <div class="device-meta">場所: ${escapeHtml(last?.location || '-')} ／ 確認者: ${escapeHtml(last?.checker || '-')}</div>
            </div>
            ${badgeHtml(last)}
          </div>`;
        })
        .join('');
      return `<div><h3>${escapeHtml(type)}</h3>${cards}</div>`;
    })
    .join('');

  $('device-list').className = '';
  $('device-list').innerHTML = html;
}

function renderDeviceTable() {
  const sorted = state.devices.slice().sort((a, b) => {
    const typeOrder = a.type.localeCompare(b.type, 'ja');
    if (typeOrder !== 0) return typeOrder;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
  });

  const rows = sorted
    .map(
      (d) => `<tr>
        <td>${escapeHtml(d.name || '-')}</td>
        <td>${escapeHtml(d.type)}</td>
        <td>${escapeHtml(d.id)}</td>
        <td>${escapeHtml(d.note || '-')}</td>
        <td>
          <button class="ghost" data-act="edit-device" data-id="${d.id}">編集</button>
          <button class="ghost" data-act="delete-device" data-id="${d.id}">削除</button>
        </td>
      </tr>`,
    )
    .join('');

  $('device-table-wrap').innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>表示名</th><th>種別</th><th>機器ID</th><th>備考</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function renderHistory() {
  const target = $('history-filter').value;
  const list = (target === 'all' ? state.scans : state.scans.filter((s) => s.deviceId === target)).slice().sort(
    (a, b) => new Date(b.ts) - new Date(a.ts),
  );

  if (list.length === 0) {
    $('history-list').innerHTML = '<div class="muted">履歴なし</div>';
    return;
  }

  const body = list
    .map((s) => {
      const d = state.devices.find((x) => x.id === s.deviceId);
      return `<div class="device-card">
        <div><strong>${escapeHtml(d ? d.name : '不明な機器')}</strong> <span class="muted">${escapeHtml(s.deviceId)}</span></div>
        <div class="device-meta">${formatJa(s.ts)}</div>
        <div class="device-meta">場所: ${escapeHtml(s.location || '-')}</div>
        <div class="device-meta">確認者: ${escapeHtml(s.checker || '-')}</div>
      </div>`;
    })
    .join('');

  $('history-list').innerHTML = body;
}

function buildQrArea() {
  const area = $('qr-area');
  area.innerHTML = '';

  state.devices.forEach((d) => {
    const card = document.createElement('div');
    card.className = 'qr-card';

    const codeWrap = document.createElement('div');
    codeWrap.className = 'qr-code';
    new QRCode(codeWrap, {
      text: `${location.origin}/scan?id=${encodeURIComponent(d.id)}`,
      width: 140,
      height: 140,
      colorDark: '#111827',
      colorLight: '#fff',
      correctLevel: QRCode.CorrectLevel.M,
    });

    const name = document.createElement('div');
    name.textContent = d.name || '-';
    const type = document.createElement('div');
    type.className = 'muted';
    type.textContent = d.type;
    const id = document.createElement('div');
    id.className = 'muted';
    id.textContent = d.id;

    card.appendChild(codeWrap);
    card.appendChild(name);
    card.appendChild(type);
    card.appendChild(id);
    area.appendChild(card);
  });
}

function findDeviceId(text) {
  if (empty(text)) return null;
  const raw = String(text).trim();
  if (/^EQ-/.test(raw) && state.devices.some((d) => d.id === raw)) return raw;

  if (raw.startsWith('EQ:')) {
    const candidate = raw.slice(3);
    if (state.devices.some((d) => d.id === candidate)) return candidate;
  }

  try {
    if (raw.includes('?')) {
      const q = new URL(raw).searchParams;
      const viaId = q.get('deviceId') || q.get('id');
      if (viaId && state.devices.some((d) => d.id === viaId)) return viaId;
    }
  } catch (_e) {
    const u = raw.split('?')[1];
    if (u) {
      try {
        const q = new URLSearchParams(u);
        const viaId = q.get('deviceId') || q.get('id');
        if (viaId && state.devices.some((d) => d.id === viaId)) return viaId;
      } catch (_x) {}
    }
  }

  const m = raw.match(/(EQ-[A-Za-z0-9-]+)/);
  if (m && state.devices.some((d) => d.id === m[1])) return m[1];
  if (state.devices.some((d) => d.id === raw)) return raw;
  return null;
}

function saveCheck() {
  const deviceRaw = $('scan-device-id').value.trim() || $('manual-device-id').value.trim();
  const id = findDeviceId(deviceRaw);
  if (!id) {
    toast('機器IDが未登録です');
    return;
  }

  const record = {
    id: uid('CHK'),
    deviceId: id,
    location: $('scan-location').value.trim(),
    checker: $('scan-checker').value.trim(),
    ts: nowTs(),
  };
  state.scans.unshift(record);
  if (state.scans.length > 3000) state.scans = state.scans.slice(0, 3000);
  persist();

  $('scan-device-id').value = '';
  $('manual-device-id').value = '';
  $('scan-location').value = '';
  $('scan-checker').value = '';
  renderAll();
  toast('チェックを保存しました');
}

async function startScan() {
  if (scanning) return;

  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    const video = $('camera');
    video.srcObject = scanStream;
    await video.play();

    scanning = true;
    $('scan-status').textContent = 'スキャン中';
    $('btn-start').disabled = true;
    $('btn-stop').disabled = false;

    const canvas = $('qr-canvas');
    const ctx = canvas.getContext('2d');

    const detectLoop = () => {
      if (!scanning) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });
        if (code) {
          const raw = code.data || '';
          const id = findDeviceId(raw);
          if (id) {
            $('scan-device-id').value = id;
            $('scan-status').textContent = `読取成功: ${id}`;
          } else {
            $('scan-status').textContent = '未登録コード';
          }
        }
      }
      if (scanning) scanningFrame = requestAnimationFrame(detectLoop);
    };

    scanningFrame = requestAnimationFrame(detectLoop);
  } catch (_e) {
    toast('カメラへのアクセスに失敗しました');
    $('scan-status').textContent = '起動失敗';
  }
}

function stopScan() {
  if (!scanStream) return;
  scanStream.getTracks().forEach((t) => t.stop());
  scanStream = null;
  const v = $('camera');
  v.srcObject = null;
  scanning = false;
  if (scanningFrame) {
    cancelAnimationFrame(scanningFrame);
    scanningFrame = null;
  }
  $('btn-start').disabled = false;
  $('btn-stop').disabled = true;
  $('scan-status').textContent = '停止';
}

function addOrUpdateDevice() {
  const name = $('device-name').value.trim();
  const type = $('device-type').value;
  const note = $('device-note').value.trim();

  if (!name || !type) {
    toast('表示名と種別は必須です');
    return;
  }

  if (editDeviceId) {
    const d = state.devices.find((x) => x.id === editDeviceId);
    if (!d) return;
    d.name = name;
    d.type = type;
    d.note = note;
    toast('更新しました');
  } else {
    state.devices.push({
      id: uid('EQ'),
      type,
      name,
      note,
      createdAt: nowTs(),
    });
    toast('機器を追加しました');
  }

  editDeviceId = null;
  $('device-name').value = '';
  $('device-note').value = '';
  $('editing-info').textContent = '新規登録モード';
  $('btn-save-device').textContent = '機器を保存';
  persist();
  renderAll();
}

function startDeviceEdit(id) {
  const d = state.devices.find((x) => x.id === id);
  if (!d) return;
  editDeviceId = d.id;
  $('device-name').value = d.name;
  $('device-type').value = d.type;
  $('device-note').value = d.note || '';
  $('editing-info').textContent = `編集中: ${d.name}`;
  $('btn-save-device').textContent = '更新する';
}

function deleteDevice(id) {
  if (!confirm('この機器を削除しますか？')) return;
  state.devices = state.devices.filter((x) => x.id !== id);
  state.scans = state.scans.filter((s) => s.deviceId !== id);
  persist();
  renderAll();
  toast('削除しました');
}

function addType() {
  const v = $('new-type').value.trim();
  if (!v) return;
  if (state.types.includes(v)) {
    toast('既に同じ種別があります');
    return;
  }
  state.types.push(v);
  $('new-type').value = '';
  persist();
  renderAll();
}

function renameType(encodedType) {
  const name = decode(encodedType);
  const next = prompt('新しい種別名を入力してください', name);
  if (next === null) return;
  const n = next.trim();
  if (!n || n === name) return;
  if (state.types.includes(n)) {
    toast('既存の種別名です');
    return;
  }
  state.types = state.types.map((t) => (t === name ? n : t));
  state.devices.forEach((d) => {
    if (d.type === name) d.type = n;
  });
  persist();
  renderAll();
}

function deleteType(encodedType) {
  const name = decode(encodedType);
  const inUse = state.devices.some((d) => d.type === name);
  if (inUse) {
    if (!confirm('この種別は使用中です。使用中データを"未分類"に移してから削除します。よろしいですか？')) return;
    if (!state.types.includes('未分類')) state.types.push('未分類');
    state.devices.forEach((d) => {
      if (d.type === name) d.type = '未分類';
    });
  }
  state.types = state.types.filter((t) => t !== name);
  persist();
  renderAll();
}

function clearHistory() {
  if (state.scans.length === 0) {
    toast('履歴は空です');
    return;
  }
  if (!confirm('履歴をすべて削除しますか？')) return;
  state.scans = [];
  persist();
  renderHistory();
  toast('履歴を削除しました');
}

function printQrs() {
  buildQrArea();
  setTimeout(() => window.print(), 100);
}

function renderAll() {
  renderTypes();
  renderTypeList();
  renderDeviceCards();
  renderDeviceTable();
  renderHistory();
  buildQrArea();
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1500);
}

function bind() {
  $('btn-start').addEventListener('click', startScan);
  $('btn-stop').addEventListener('click', stopScan);
  $('btn-save-check').addEventListener('click', saveCheck);
  $('btn-manual-check').addEventListener('click', saveCheck);

  $('filter-type').addEventListener('change', renderDeviceCards);
  $('btn-group-view').addEventListener('click', () => {
    $('btn-group-view').classList.add('active');
    $('btn-list-view').classList.remove('active');
    renderDeviceCards();
  });
  $('btn-list-view').addEventListener('click', () => {
    $('btn-list-view').classList.add('active');
    $('btn-group-view').classList.remove('active');
    renderDeviceCards();
  });

  $('btn-add-type').addEventListener('click', addType);
  $('btn-save-device').addEventListener('click', addOrUpdateDevice);
  $('btn-reset-device').addEventListener('click', () => {
    editDeviceId = null;
    $('device-name').value = '';
    $('device-note').value = '';
    $('btn-save-device').textContent = '機器を保存';
    $('editing-info').textContent = '新規登録モード';
  });

  $('btn-build-qr').addEventListener('click', buildQrArea);
  $('btn-print-qr').addEventListener('click', printQrs);

  $('history-filter').addEventListener('change', renderHistory);
  $('btn-clear-history').addEventListener('click', clearHistory);

  $('type-list').addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    const type = e.target.dataset.type;
    if (!act || !type) return;
    if (act === 'rename-type') renameType(type);
    if (act === 'delete-type') deleteType(type);
  });

  $('device-table-wrap').addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    const id = e.target.dataset.id;
    if (!act || !id) return;
    if (act === 'edit-device') startDeviceEdit(id);
    if (act === 'delete-device') deleteDevice(id);
  });

  window.addEventListener('beforeunload', stopScan);

  // Admin auth
  $('btn-admin-login').addEventListener('click', adminLogin);
  $('admin-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') adminLogin(); });
  $('btn-admin-logout').addEventListener('click', adminLogout);
}

// Initialize: load from cloud, then render
initState().then(() => {
  showAdminContent(isAdminAuthed());
  renderAll();
  bind();
});
