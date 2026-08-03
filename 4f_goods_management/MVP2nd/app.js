(() => {
  'use strict';

  const STATE_KEY = 'goods_qr_mvp2_state_v1';
  const SESSION_KEY = 'goods_qr_mvp2_session_v1';
  const SESSION_ACTOR_KEY = 'goods_qr_mvp2_actor_v1';
  const ADMIN_SESSION_KEY = 'goods_qr_mvp2_admin_session_v1';
  const ADMIN_PASSWORD = 'mmh';
  const TTL_MS = 30000;
  const MAX_LOGS = 50;

  const ROOM_FOUR = [401, 402, 403, 405, 406];
  const ROOM_TWO = [407, 408, 410, 411, 412, 413, 415, 416];
  const ROOM_ONE = [417, 418, 420, 421, 422, 423, 425, 426, 427];

  const STATUS_OPTIONS = {
    bed: ['病床にある', '使用予約中(廊下)', '不明'],
    sensor: ['病床にある', '使用予約中(廊下)', 'スタッフステーション', '修理中', '不明']
  };

  const $ = (id) => document.getElementById(id);
  const locations = [];
  for (const r of ROOM_FOUR) for (let i = 1; i <= 4; i++) locations.push(`${r}-${i}`);
  for (const r of ROOM_TWO) for (let i = 1; i <= 2; i++) locations.push(`${r}-${i}`);
  for (const r of ROOM_ONE) locations.push(`${r}-1`);
  locations.push('SS');

  const state = {
    items: {},
    logs: []
  };

  const scanSession = {
    itemId: null,
    locId: null,
    reserveMode: false,
    expiresAt: 0,
    updatedAt: 0
  };

  const els = {
    tabs: {
      record: $('tab-record'),
      list: $('tab-list'),
      admin: $('tab-admin')
    },
    tabButtons: document.querySelectorAll('.tab-btn'),

    scanVideo: $('scanVideo'),
    startScanBtn: $('startScanBtn'),
    scanSupportState: $('scanSupportState'),
    scanFallback: $('scanFallback'),
    fallbackToggle: $('fallbackToggleBtn'),
    scanManualInput: $('scanManualInput'),
    scanManualApplyBtn: $('scanManualApplyBtn'),

    scanItemDisplay: $('scanItemDisplay'),
    scanLocDisplay: $('scanLocDisplay'),
    clearScannedItemBtn: $('clearScannedItemBtn'),
    clearScannedLocBtn: $('clearScannedLocBtn'),
    timerText: $('scanTimerText'),
    scanTip: $('scanTip'),
    reserveModeBtn: $('reserveModeBtn'),
    manualCommitBtn: $('manualCommitBtn'),

    itemSearchInput: $('itemSearchInput'),
    itemList: $('itemList'),
    typeButtons: document.querySelectorAll('[data-type]'),

    adminPassInput: $('adminPassInput'),
    adminLoginBtn: $('adminLoginBtn'),
    adminLogoutBtn: $('adminLogoutBtn'),
    adminLock: $('adminLock'),
    adminPanel: $('adminPanel'),
    printAllQrBtn: $('printAllQrBtn'),
    refreshQrBtn: $('refreshQrBtn'),
    itemQrGrid: $('itemQrGrid'),
    locQrGrid: $('locQrGrid'),
    logList: $('logList'),

    editor: $('itemEditor'),
    editTitle: $('editTitle'),
    editLocation: $('editLocation'),
    editStatus: $('editStatus'),
    editActor: $('editActor'),
    editCancelBtn: $('editCancelBtn'),
    editSaveBtn: $('editSaveBtn'),

    globalActorInput: $('globalActorInput')
  };

  let activeType = 'bed';
  let currentEditingItemId = null;
  let scanTimer = null;
  let cameraPoller = null;
  let cameraStream = null;
  let detector = null;
  let lastScanValue = '';
  let lastScanAt = 0;

  function nowText(ts, withSec = false) {
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: withSec ? '2-digit' : undefined
    }).format(new Date(ts));
  }

  function locationLabel(locId) {
    if (!locId) return '未設定';
    if (locId === 'SS') return 'スタッフステーション';
    return locId;
  }

  function itemLabel(itemId) {
    if (itemId.startsWith('BED-')) return `ベッド-${itemId.slice(4)}`;
    if (itemId.startsWith('SNS-')) return `センサー-${itemId.slice(4)}`;
    return itemId;
  }

  function isBedLocation(locId) {
    return locId !== 'SS' && /^\d{3}-\d+$/.test(locId);
  }

  function deriveStatus(type, locId, forcedReserved = false) {
    if (forcedReserved) return '使用予約中(廊下)';
    if (type === 'bed') {
      if (isBedLocation(locId)) return '病床にある';
      return '不明';
    }
    if (type === 'sensor') {
      if (locId === 'SS') return 'スタッフステーション';
      if (isBedLocation(locId)) return '病床にある';
      return '不明';
    }
    return '不明';
  }

  function getActor() {
    const a = els.globalActorInput.value.trim() || localStorage.getItem(SESSION_ACTOR_KEY) || '';
    if (a) localStorage.setItem(SESSION_ACTOR_KEY, a);
    return a;
  }

  function addLog(entry) {
    state.logs.unshift(entry);
    if (state.logs.length > MAX_LOGS) state.logs.length = MAX_LOGS;
    saveState();
    renderLogList();
  }

  function saveState() {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function loadState() {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) {
      initItems();
      return;
    }

    try {
      const parsed = JSON.parse(raw) || {};
      state.logs = Array.isArray(parsed.logs) ? parsed.logs.slice(0, MAX_LOGS) : [];
      const src = parsed.items || {};
      state.items = {};
      for (const id of Object.keys(src)) {
        const x = src[id] || {};
        const type = x.type || (id.startsWith('BED-') ? 'bed' : 'sensor');
        state.items[id] = {
          id,
          type,
          locationId: x.locationId || null,
          status: x.status || (type === 'bed' ? '不明' : 'スタッフステーション'),
          reservationAt: x.reservationAt || null,
          updatedAt: x.updatedAt || null
        };
      }
      if (Object.keys(state.items).length === 0) initItems();
    } catch {
      initItems();
    }
  }

  function initItems() {
    state.items = {};
    for (let i = 1; i <= 45; i++) {
      const id = `BED-${String(i).padStart(3, '0')}`;
      state.items[id] = { id, type: 'bed', locationId: null, status: '不明', reservationAt: null, updatedAt: null };
    }
    for (let i = 1; i <= 6; i++) {
      const id = `SNS-${String(i).padStart(3, '0')}`;
      state.items[id] = { id, type: 'sensor', locationId: 'SS', status: 'スタッフステーション', reservationAt: null, updatedAt: Date.now() };
    }
    state.logs = [];
    saveState();
  }

  function loadSession() {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) || {};
      scanSession.itemId = parsed.itemId || null;
      scanSession.locId = parsed.locId || null;
      scanSession.reserveMode = !!parsed.reserveMode;
      scanSession.expiresAt = parsed.expiresAt || 0;
      scanSession.updatedAt = parsed.updatedAt || 0;
      if (!scanSessionActive()) clearSession();
    } catch {
      clearSession();
    }
  }

  function saveSession() {
    localStorage.setItem(SESSION_KEY, JSON.stringify(scanSession));
  }

  function clearSession() {
    scanSession.itemId = null;
    scanSession.locId = null;
    scanSession.reserveMode = false;
    scanSession.expiresAt = 0;
    scanSession.updatedAt = 0;
    saveSession();
    renderScanPanel();
  }

  function scanSessionActive() {
    return Date.now() < scanSession.expiresAt;
  }

  function keepSession(kind, id) {
    const now = Date.now();
    scanSession.updatedAt = now;
    scanSession.expiresAt = now + TTL_MS;
    if (kind === 'item') {
      scanSession.itemId = id;
      scanSession.reserveMode = scanSession.reserveMode;
    }
    if (kind === 'location') {
      scanSession.locId = id;
    }
    if (scanSession.reserveMode) {
      // 予約モードは次の物品スキャンで即時確定のため維持
    }
    saveSession();
    renderScanPanel();
  }

  function startCountdown() {
    if (scanTimer) clearInterval(scanTimer);
    scanTimer = setInterval(() => {
      if (!scanSessionActive()) {
        if (scanSession.itemId || scanSession.locId) clearSession();
        return;
      }
      const remain = Math.max(0, Math.ceil((scanSession.expiresAt - Date.now()) / 1000));
      els.timerText.textContent = String(remain).padStart(2, '0');
    }, 500);
  }

  function setReserveMode(force) {
    scanSession.reserveMode = force;
    els.reserveModeBtn.classList.toggle('active', force);
    if (force) {
      els.reserveModeBtn.textContent = '予約モード: ON';
      els.scanTip.textContent = '次に読み込む物品を「使用予約中(廊下)」登録します';
    } else {
      els.reserveModeBtn.textContent = '使用予約中にする';
      els.scanTip.textContent = '物品または場所を先に読み込むと30秒以内に一致させて保存';
    }
    saveSession();
  }

  function parseScanValue(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const v = raw.trim();
    if (!v) return null;
    if (v.startsWith('ITEM:')) {
      const code = v.slice(5).trim().toUpperCase();
      if (/^(BED|SNS)-\d{3}$/.test(code)) return { kind: 'item', id: code };
    }
    if (v.startsWith('LOC:')) {
      const code = v.slice(4).trim().toUpperCase();
      if (locations.includes(code)) return { kind: 'location', id: code };
    }
    return null;
  }

  function renderScanPanel() {
    els.scanItemDisplay.textContent = scanSession.itemId ? itemLabel(scanSession.itemId) : '未スキャン';
    els.scanLocDisplay.textContent = scanSession.locId ? locationLabel(scanSession.locId) : '未スキャン';
    els.clearScannedItemBtn.disabled = !scanSession.itemId;
    els.clearScannedLocBtn.disabled = !scanSession.locId;
    els.manualCommitBtn.disabled = !(scanSession.itemId && scanSession.locId && scanSessionActive());

    if (!scanSessionActive()) {
      els.timerText.textContent = '00';
    } else {
      const remain = Math.max(0, Math.ceil((scanSession.expiresAt - Date.now()) / 1000));
      els.timerText.textContent = String(remain).padStart(2, '0');
    }
  }

  function commitScan() {
    if (!(scanSession.itemId && scanSession.locId && scanSessionActive())) return;
    const item = state.items[scanSession.itemId];
    if (!item) return;
    const nextStatus = deriveStatus(item.type, scanSession.locId);
    if (!window.confirm(`物品: ${itemLabel(item.id)}\n場所: ${locationLabel(scanSession.locId)}\n状態: ${nextStatus}\nこの内容で保存しますか？`)) return;

    const before = { ...item };
    const actor = getActor() || '未入力';
    const now = Date.now();
    item.locationId = scanSession.locId;
    item.status = nextStatus;
    item.reservationAt = null;
    item.updatedAt = now;

    addLog({
      time: now,
      actor,
      itemId: item.id,
      itemName: itemLabel(item.id),
      action: 'スキャン保存',
      from: `${locationLabel(before.locationId)} / ${before.status}`,
      to: `${locationLabel(item.locationId)} / ${item.status}`,
      note: 'QRスキャン保存'
    });

    clearSession();
    renderAll();
  }

  function reserveWithItem(itemId) {
    const item = state.items[itemId];
    if (!item) return;
    const now = Date.now();
    const actor = getActor() || '未入力';
    if (!window.confirm(`物品: ${itemLabel(item.id)} を「使用予約中(廊下)」で更新しますか？`)) return;
    const before = { ...item };
    item.status = '使用予約中(廊下)';
    item.reservationAt = now;
    item.updatedAt = now;
    addLog({
      time: now,
      actor,
      itemId: item.id,
      itemName: itemLabel(item.id),
      action: '予約登録',
      from: `${locationLabel(before.locationId)} / ${before.status}`,
      to: `${locationLabel(item.locationId)} / 使用予約中(廊下)`,
      note: '使用予約中(廊下)'
    });
    setReserveMode(false);
    clearSession();
    renderAll();
  }

  function handleScan(raw) {
    if (scanSession.expiresAt && !scanSessionActive()) clearSession();
    const parsed = parseScanValue(raw);
    if (!parsed) {
      window.alert('QR形式が正しくありません');
      return;
    }

    if (parsed.kind === 'item') {
      if (!state.items[parsed.id]) {
        window.alert('未登録の物品です');
        return;
      }
      if (scanSession.reserveMode) {
        reserveWithItem(parsed.id);
        return;
      }
      keepSession('item', parsed.id);
    }

    if (parsed.kind === 'location') {
      keepSession('location', parsed.id);
    }

    if (scanSession.itemId && scanSession.locId && scanSessionActive()) commitScan();
  }

  function toggleFallback() {
    els.scanFallback.classList.toggle('open');
    els.fallbackToggle.textContent = els.scanFallback.classList.contains('open') ? '手動入力を隠す' : '手動入力を開く';
    if (els.scanFallback.classList.contains('open')) els.scanManualInput.focus();
  }

  async function startCamera() {
    if (!('BarcodeDetector' in window)) {
      els.scanSupportState.classList.add('show');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      els.scanSupportState.classList.add('show');
      return;
    }
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      els.scanVideo.srcObject = cameraStream;
      await els.scanVideo.play();
      detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      els.scanSupportState.classList.remove('show');
      if (cameraPoller) clearInterval(cameraPoller);
      cameraPoller = setInterval(async () => {
        try {
          const codes = await detector.detect(els.scanVideo);
          const text = codes?.[0]?.rawValue?.trim();
          if (!text) return;
          if (text !== lastScanValue || Date.now() - lastScanAt > 1400) {
            lastScanValue = text;
            lastScanAt = Date.now();
            handleScan(text);
          }
        } catch {
          // ignore decode errors
        }
      }, 500);
      els.startScanBtn.textContent = 'カメラ停止';
    } catch {
      els.scanSupportState.classList.add('show');
    }
  }

  function stopCamera() {
    if (cameraPoller) {
      clearInterval(cameraPoller);
      cameraPoller = null;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
    }
    els.scanVideo.srcObject = null;
    els.startScanBtn.textContent = 'カメラ起動';
  }

  function switchTab(name) {
    Object.entries(els.tabs).forEach(([key, node]) => node.classList.toggle('active', key === name));
    els.tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === name));
    if (name !== 'record') stopCamera();
    if (name === 'admin') renderAdminPanel();
  }

  function renderItemList() {
    els.itemList.innerHTML = '';
    const q = els.itemSearchInput.value.trim().toLowerCase();
    const rows = Object.values(state.items)
      .filter((item) => item.type === activeType)
      .filter((item) => {
        if (!q) return true;
        const target = [item.id, item.status, locationLabel(item.locationId), itemLabel(item.id), item.type].join(' ').toLowerCase();
        return target.includes(q);
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    if (!rows.length) {
      els.itemList.innerHTML = '<p class="empty">該当する物品がありません</p>';
      return;
    }

    for (const item of rows) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'item-row';
      row.innerHTML = `\n        <div class="row-head">${itemLabel(item.id)} <span>${item.id}</span></div>\n        <div class="row-meta">状態: ${item.status}</div>\n        <div class="row-meta">場所: ${locationLabel(item.locationId)}</div>\n        <div class="row-meta">最終更新: ${item.updatedAt ? nowText(item.updatedAt) : '未更新'}</div>\n      `;
      row.addEventListener('click', () => openEditor(item.id));
      els.itemList.appendChild(row);
    }
  }

  function openEditor(itemId) {
    const item = state.items[itemId];
    if (!item) return;
    currentEditingItemId = itemId;

    els.editTitle.textContent = `${itemLabel(item.id)} (${item.id})`;
    els.editActor.value = getActor();

    els.editLocation.innerHTML = '<option value="">未設定</option>';
    for (const loc of locations) {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = locationLabel(loc);
      els.editLocation.appendChild(opt);
    }
    els.editLocation.value = item.locationId || '';

    els.editStatus.innerHTML = '';
    for (const s of STATUS_OPTIONS[item.type]) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      els.editStatus.appendChild(opt);
    }
    els.editStatus.value = item.status;

    els.editor.classList.remove('hidden');
  }

  function closeEditor() {
    currentEditingItemId = null;
    els.editor.classList.add('hidden');
  }

  function renderQrSection() {
    if (typeof QRCode === 'undefined') {
      window.alert('QRライブラリ未読み込み');
      return;
    }
    els.itemQrGrid.innerHTML = '';
    els.locQrGrid.innerHTML = '';

    for (const id of Object.keys(state.items).sort()) {
      const item = state.items[id];
      const row = document.createElement('div');
      row.className = 'qr-card';
      const name = item.type === 'bed' ? 'ベッド' : 'センサー';
      row.innerHTML = `<h5>${name} ${itemLabel(item.id)}</h5><p>ITEM:${item.id}</p><div class="qr-slot" id="qr-item-${item.id}"></div>`;
      els.itemQrGrid.appendChild(row);
      new QRCode(`qr-item-${item.id}`, { text: `ITEM:${item.id}`, width: 148, height: 148 });
    }

    for (const loc of locations) {
      const row = document.createElement('div');
      row.className = 'qr-card';
      row.innerHTML = `<h5>場所 ${locationLabel(loc)}</h5><p>LOC:${loc}</p><div class="qr-slot" id="qr-loc-${loc}"></div>`;
      els.locQrGrid.appendChild(row);
      new QRCode(`qr-loc-${loc}`, { text: `LOC:${loc}`, width: 148, height: 148 });
    }
  }

  function renderLogList() {
    els.logList.innerHTML = '';
    if (!state.logs.length) {
      els.logList.innerHTML = '<p class="empty">更新ログなし</p>';
      return;
    }
    for (const item of state.logs.slice(0, MAX_LOGS)) {
      const row = document.createElement('div');
      row.className = 'log-row';
      row.innerHTML = `\n        <div class="log-head">${nowText(item.time, true)} | ${item.actor || '未入力'} | ${item.itemName}</div>\n        <div class="log-body">${item.action} / ${item.from} → ${item.to}</div>\n        <div class="log-note">${item.note || ''}</div>\n      `;
      els.logList.appendChild(row);
    }
  }

  function renderAdminPanel() {
    const unlocked = !!sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!unlocked) {
      els.adminLock.classList.remove('hidden');
      els.adminPanel.classList.add('hidden');
      els.adminLogoutBtn.classList.add('hidden');
      return;
    }
    els.adminLock.classList.add('hidden');
    els.adminPanel.classList.remove('hidden');
    els.adminLogoutBtn.classList.remove('hidden');
    renderQrSection();
    renderLogList();
  }

  function renderAll() {
    renderScanPanel();
    renderItemList();
    renderAdminPanel();
    saveState();
  }

  function bindEvents() {
    els.tabButtons.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

    els.startScanBtn.addEventListener('click', () => {
      if (cameraPoller) {
        stopCamera();
        return;
      }
      startCamera();
    });

    els.fallbackToggle.addEventListener('click', toggleFallback);

    els.scanManualApplyBtn.addEventListener('click', () => {
      const v = els.scanManualInput.value.trim();
      if (!v) return;
      handleScan(v);
      els.scanManualInput.value = '';
      toggleFallback();
    });

    els.scanManualInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        els.scanManualApplyBtn.click();
      }
    });

    els.clearScannedItemBtn.addEventListener('click', () => {
      scanSession.itemId = null;
      scanSession.expiresAt = 0;
      saveSession();
      renderScanPanel();
    });
    els.clearScannedLocBtn.addEventListener('click', () => {
      scanSession.locId = null;
      scanSession.expiresAt = 0;
      saveSession();
      renderScanPanel();
    });

    els.reserveModeBtn.addEventListener('click', () => {
      if (scanSession.itemId) {
        reserveWithItem(scanSession.itemId);
        return;
      }
      setReserveMode(!scanSession.reserveMode);
    });

    els.manualCommitBtn.addEventListener('click', commitScan);

    els.scanSupportState.addEventListener('click', () => {
      els.scanSupportState.classList.remove('show');
      toggleFallback();
    });

    els.itemSearchInput.addEventListener('input', renderItemList);
    els.typeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        els.typeButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeType = btn.dataset.type;
        renderItemList();
      });
    });

    els.adminLoginBtn.addEventListener('click', () => {
      if (els.adminPassInput.value !== ADMIN_PASSWORD) {
        window.alert('パスワードが違います');
        return;
      }
      sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
      els.adminPassInput.value = '';
      renderAdminPanel();
    });

    els.adminLogoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      renderAdminPanel();
    });

    els.printAllQrBtn.addEventListener('click', () => {
      renderQrSection();
      setTimeout(() => window.print(), 80);
    });

    els.refreshQrBtn.addEventListener('click', renderQrSection);

    els.editCancelBtn.addEventListener('click', closeEditor);
    els.editSaveBtn.addEventListener('click', () => {
      const actor = (els.editActor.value.trim() || getActor() || '未入力');
      if (!actor) return;
      const item = state.items[currentEditingItemId];
      if (!item) return;
      const before = { ...item };
      const next = {
        locationId: els.editLocation.value || null,
        status: els.editStatus.value,
        updatedAt: Date.now(),
        reservationAt: els.editStatus.value === '使用予約中(廊下)' ? Date.now() : null
      };

      item.locationId = next.locationId;
      item.status = next.status;
      item.updatedAt = next.updatedAt;
      item.reservationAt = next.reservationAt;

      addLog({
        time: next.updatedAt,
        actor,
        itemId: item.id,
        itemName: itemLabel(item.id),
        action: '手動更新',
        from: `${locationLabel(before.locationId)} / ${before.status}`,
        to: `${locationLabel(item.locationId)} / ${item.status}`,
        note: `${item.type} 手動更新`
      });

      saveState();
      closeEditor();
      renderAll();
    });

    els.globalActorInput.addEventListener('change', () => {
      const a = els.globalActorInput.value.trim();
      if (a) localStorage.setItem(SESSION_ACTOR_KEY, a);
    });

    els.globalActorInput.value = localStorage.getItem(SESSION_ACTOR_KEY) || '';

    window.addEventListener('beforeunload', stopCamera);
  }

  function init() {
    loadState();
    loadSession();
    bindEvents();
    startCountdown();
    renderAll();
    if (scanSession.itemId || scanSession.locId) {
      if (!scanSessionActive()) clearSession();
      setReserveMode(scanSession.reserveMode);
    }
  }

  init();
})();
