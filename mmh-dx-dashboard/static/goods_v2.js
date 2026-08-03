const API_GET = '/api/goods-v2/data';
const API_SAVE = '/api/goods-v2/data';
const API_LOGS_GET = '/api/goods-v2/logs';
const API_LOGS_SAVE = '/api/goods-v2/logs';
const ADMIN_PASSWORD = 'mmh';
const QR_PREFIX_ITEM = 'ITEM:';
const QR_PREFIX_LOC = 'LOC:';

let state = {
  items: [],
  logs: [],
}; // getItemDefaults()で上書きされる

let currentTab = 'record';
let currentManageType = 'bed';
let currentView = 'room'; // 'room' or 'list'
let activeItem = null;
let activeLocation = null;
let countdownTimer = null;
let countdownRemaining = 30;
let reservationMode = false;
let activeItemMeta = null;
let cameraStream = null;
let isScanning = false;
let scannerBusyUntil = 0;
let lastScannedValue = '';
let lastScannedAt = 0;
let barcodeDetector = null;
let saveLogsInFlight = false;
let saveLogsQueued = false;
let qrCodesRendered = false;
let scanPopupTimer = null;

const roomDefinitions = [
  { room: '401', beds: 4 },
  { room: '402', beds: 4 },
  { room: '403', beds: 4 },
  { room: '405', beds: 4 },
  { room: '406', beds: 4 },
  { room: '407', beds: 2 },
  { room: '408', beds: 2 },
  { room: '410', beds: 2 },
  { room: '411', beds: 2 },
  { room: '412', beds: 2 },
  { room: '413', beds: 2 },
  { room: '415', beds: 2 },
  { room: '416', beds: 2 },
  { room: '417', beds: 1 },
  { room: '418', beds: 1 },
  { room: '420', beds: 1 },
  { room: '421', beds: 1 },
  { room: '422', beds: 1 },
  { room: '423', beds: 1 },
  { room: '425', beds: 1 },
  { room: '426', beds: 1 },
  { room: '427', beds: 1 },
];

const ITEM_TYPES = [
  {
    type: 'bed',
    prefix: 'BED',
    count: 45,
    label: 'ベッド',
    defaultLocation: null,
    defaultStatus: 'unknown',
  },
  {
    type: 'sensor',
    prefix: 'SNS',
    count: 6,
    label: 'センサー',
    defaultLocation: 'SS',
    defaultStatus: 'スタッフステーション',
  },
];

const ui = {
  reserveModeBtn: null,
  manualItemInput: null,
  manualLocationInput: null,
  scanItemManualBtn: null,
  scanLocationManualBtn: null,
  selectedItemText: null,
  selectedLocationText: null,
  clearItemBtn: null,
  clearLocationBtn: null,
  confirmMoveBtn: null,
  clearAllBtn: null,
  itemSearch: null,
  itemList: null,
  roomView: null,
  viewRoomBtn: null,
  viewListBtn: null,
  manageTypeToggle: null,
  manageTypeButtons: {},
  showBedsBtn: null,
  showSensorsBtn: null,
  editModal: null,
  editItemTitle: null,
  editLocation: null,
  editStatus: null,
  editCancel: null,
  editSave: null,
  adminPassword: null,
  adminUnlockBtn: null,
  adminLock: null,
  adminMain: null,
  qrItems: null,
  qrLocations: null,
  refreshQrBtn: null,
  printQrBtn: null,
  logList: null,
  operatorName: null,
  scannerVideo: null,
  scannerActions: null,
  scannerNote: null,
  startScanBtn: null,
  stopScanBtn: null,
  toast: null,
  scanOverlay: null,
  scanPopup: null,
};

function nowIso() {
  return new Date().toISOString();
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

function getLocationCodes() {
  return roomDefinitions.flatMap(({ room, beds }) => {
    if (beds === 1) return [room];
    return Array.from({ length: beds }, (_, i) => `${room}-${i + 1}`);
  });
}

function getItemTypeConfig(type) {
  return ITEM_TYPES.find(itemType => itemType.type === type) || null;
}

function inferItemType(item) {
  if (getItemTypeConfig(item?.type)) return item.type;

  const id = String(item?.id || '').toUpperCase();
  if (id === 'TEST-000') return 'bed';

  const matched = ITEM_TYPES.find(itemType => id.startsWith(`${itemType.prefix}-`));
  return matched?.type || ITEM_TYPES[0]?.type || 'bed';
}

const STATUS_OPTIONS_BY_TYPE = {
  bed: ['unknown', 'スタッフステーション', '配置済み', '使用中', '使用予約中(廊下)'],
  sensor: ['スタッフステーション', '使用中', '配置済み', '修理中', '使用予約中(廊下)', 'unknown'],
};

function getItemDefaults() {
  const items = [
    { id: 'TEST-000', type: 'bed', location: null, status: 'unknown', reservedAt: null, updatedAt: null, updatedBy: null },
  ];

  for (const t of ITEM_TYPES) {
    for (let i = 1; i <= t.count; i++) {
      items.push({
        id: `${t.prefix}-${pad3(i)}`,
        type: t.type,
        location: t.defaultLocation ?? null,
        status: t.defaultStatus ?? 'unknown',
        reservedAt: null,
        updatedAt: null,
        updatedBy: null,
      });
    }
  }

  return { items, logs: [] };
}

function normalizeState(raw) {
  let rawItems = Array.isArray(raw?.items) ? raw.items : [];
  if (rawItems.length === 0) {
    rawItems = [
      ...(Array.isArray(raw?.beds) ? raw.beds : []),
      ...(Array.isArray(raw?.sensors) ? raw.sensors : []),
    ];
  }
  if (rawItems.length === 0) return getItemDefaults();

  const items = rawItems.map(item => ({
    ...item,
    type: inferItemType(item),
    id: String(item.id || ''),
    location: item.location ?? null,
    status: item.status || 'unknown',
    reservedAt: item.reservedAt ?? null,
    updatedAt: item.updatedAt ?? null,
    updatedBy: item.updatedBy ?? null,
  })).filter(item => !!item.id);

  if (items.length === 0) return getItemDefaults();

  if (!items.find(item => item.id === 'TEST-000')) {
    items.unshift({ id: 'TEST-000', type: 'bed', location: null, status: 'unknown', reservedAt: null, updatedAt: null, updatedBy: null });
  }

  return { items, logs: [] };
}

function getAllItems() {
  return state.items;
}

function findItem(id) {
  return state.items.find(item => item.id === id);
}

function addLog(itemId, action, detail) {
  const by = ui.operatorName?.value?.trim() || sessionStorage.getItem('goodsV2Operator') || '';
  state.logs.unshift({
    ts: nowIso(),
    itemId,
    action,
    detail,
    by,
  });
  state.logs = state.logs.slice(0, 200);
  saveLogs();
}

async function saveLogs() {
  if (saveLogsInFlight) {
    saveLogsQueued = true;
    return;
  }
  saveLogsInFlight = true;
  try {
    do {
      saveLogsQueued = false;
      try {
        await fetch(API_LOGS_SAVE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.logs),
        });
      } catch (_) {
        // ログ保存失敗は無視（メイン操作に影響させない）
      }
    } while (saveLogsQueued);
  } finally {
    saveLogsInFlight = false;
  }
}

function saveOperator() {
  const value = ui.operatorName.value.trim();
  sessionStorage.setItem('goodsV2Operator', value);
}

function setupElements() {
  ui.reserveModeBtn = document.getElementById('reserveModeBtn');
  ui.selectedItemText = document.getElementById('selectedItemText');
  ui.selectedLocationText = document.getElementById('selectedLocationText');
  ui.clearItemBtn = document.getElementById('clearItemBtn');
  ui.clearLocationBtn = document.getElementById('clearLocationBtn');
  ui.clearAllBtn = document.getElementById('clearAllBtn');
  ui.itemSearch = document.getElementById('itemSearch');
  ui.itemList = document.getElementById('itemList');
  ui.viewRoomBtn = document.getElementById('viewRoomBtn');
  ui.viewListBtn = document.getElementById('viewListBtn');
  ui.roomView = document.getElementById('roomView');
  ui.showBedsBtn = document.getElementById('showBedsBtn');
  ui.showSensorsBtn = document.getElementById('showSensorsBtn');
  ui.manageTypeToggle = ui.showBedsBtn?.parentElement || ui.showSensorsBtn?.parentElement || null;
  ui.editModal = document.getElementById('editModal');
  ui.editItemTitle = document.getElementById('editItemTitle');
  ui.editLocation = document.getElementById('editLocation');
  ui.editStatus = document.getElementById('editStatus');
  ui.editCancel = document.getElementById('editCancel');
  ui.editSave = document.getElementById('editSave');
  ui.adminPassword = document.getElementById('adminPassword');
  ui.adminUnlockBtn = document.getElementById('adminUnlockBtn');
  ui.adminLock = document.getElementById('adminLock');
  ui.adminMain = document.getElementById('adminMain');
  ui.qrItems = document.getElementById('qrItems');
  ui.qrLocations = document.getElementById('qrLocations');
  ui.refreshQrBtn = document.getElementById('refreshQrBtn');
  ui.printQrBtn = document.getElementById('printQrBtn');
  ui.logList = document.getElementById('logList');
  ui.operatorName = document.getElementById('operatorName');
  ui.scannerVideo = document.getElementById('scannerVideo');
  ui.scannerActions = document.getElementById('scannerActions');
  ui.scannerNote = document.getElementById('scannerNote');
  ui.startScanBtn = document.getElementById('startScanBtn');
  ui.stopScanBtn = document.getElementById('stopScanBtn');
  ui.toast = document.getElementById('toastMsg');
  ui.scanOverlay = document.getElementById('scanOverlay');
  ui.scanPopup = document.getElementById('scanPopup');
}

function setupManageTypeButtons() {
  if (!ui.manageTypeToggle) return;

  const existingButtons = {
    bed: ui.showBedsBtn,
    sensor: ui.showSensorsBtn,
  };

  ui.manageTypeToggle.innerHTML = '';
  ui.manageTypeButtons = {};

  ITEM_TYPES.forEach((itemType, index) => {
    const button = existingButtons[itemType.type] || document.createElement('button');
    if (itemType.type === 'bed') button.id = 'showBedsBtn';
    if (itemType.type === 'sensor') button.id = 'showSensorsBtn';
    button.type = 'button';
    button.className = 'chip-btn';
    button.dataset.type = itemType.type;
    button.textContent = itemType.label;
    button.addEventListener('click', () => switchManageType(itemType.type));
    ui.manageTypeToggle.appendChild(button);
    ui.manageTypeButtons[itemType.type] = button;

    if (index === 0) {
      currentManageType = itemType.type;
    }
  });

  ui.showBedsBtn = ui.manageTypeButtons.bed || null;
  ui.showSensorsBtn = ui.manageTypeButtons.sensor || null;
}

function bindUi() {
  ui.reserveModeBtn.addEventListener('click', toggleReservationMode);
  ui.clearItemBtn.addEventListener('click', () => {
    setActiveItem(null);
    updateRecordSaveState();
  });
  ui.clearLocationBtn.addEventListener('click', () => {
    setActiveLocation(null);
    updateRecordSaveState();
  });
  ui.clearAllBtn.addEventListener('click', clearScanned);
  setupManageTypeButtons();
  ui.itemSearch.addEventListener('input', renderItemList);
  ui.editCancel.addEventListener('click', closeEditModal);
  ui.editSave.addEventListener('click', saveEditedItem);
  ui.adminUnlockBtn.addEventListener('click', unlockAdmin);

  ui.refreshQrBtn.addEventListener('click', () => {
    qrCodesRendered = false;
    renderQrCodes();
  });
  ui.printQrBtn.addEventListener('click', () => window.print());
  ui.operatorName.addEventListener('input', saveOperator);

  document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => {
      switchTab(button.dataset.tab);
    });
  });

  ui.startScanBtn.addEventListener('click', startScanner);
  ui.stopScanBtn.addEventListener('click', stopScanner);
  ui.viewRoomBtn.addEventListener('click', () => switchView('room'));
  ui.viewListBtn.addEventListener('click', () => switchView('list'));

  const storedName = sessionStorage.getItem('goodsV2Operator');
  if (storedName) ui.operatorName.value = storedName;

  if ('BarcodeDetector' in window) {
    barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
  }
  // jsQRはscript読み込み後に使えるのでここではチェックしない
  ui.scannerNote.style.display = 'none';
}

async function fetchState() {
  const res = await fetch(API_GET);
  if (!res.ok) {
    throw new Error('GET API failed');
  }
  const data = await res.json();

  const hasServerData = data && (
    (Array.isArray(data.items) && data.items.length > 0) ||
    (Array.isArray(data.beds) && data.beds.length > 0) ||
    (Array.isArray(data.sensors) && data.sensors.length > 0)
  );

  if (hasServerData) {
    state = normalizeState(data);
  } else {
    state = getItemDefaults();
    await saveState(state);
  }

  // ログは別ドキュメントから取得
  try {
    const logRes = await fetch(API_LOGS_GET);
    if (logRes.ok) {
      const logs = await logRes.json();
      state.logs = Array.isArray(logs) ? logs : [];
    }
  } catch (_) {
    state.logs = [];
  }
}

async function saveState(nextState = state) {
  state = nextState;
  // ログは別ドキュメントで管理するため除外して保存
  const { logs: _logs, ...dataWithoutLogs } = state;
  const res = await fetch(API_SAVE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dataWithoutLogs),
  });
  if (!res.ok) throw new Error('Save failed');
}

function updateRecordSaveState() {
  const hasItem = !!activeItem;
  const hasLoc = !!activeLocation;

  if (hasItem) {
    ui.selectedItemText.textContent = activeItem.id;
  } else {
    ui.selectedItemText.textContent = '-';
  }

  if (hasLoc) {
    ui.selectedLocationText.textContent = activeLocation;
  } else {
    ui.selectedLocationText.textContent = '-';
  }

  if (ui.scanOverlay) {
    let overlayText = '';
    if (hasItem && hasLoc) {
      overlayText = `${activeItem.id} → ${activeLocation}`;
    } else if (hasItem) {
      overlayText = activeItem.id;
    } else if (hasLoc) {
      overlayText = `→ ${activeLocation}`;
    }
    ui.scanOverlay.textContent = overlayText;
    ui.scanOverlay.classList.toggle('visible', !!overlayText);
  }

  if (hasItem && hasLoc && !reservationMode) {
    confirmMove();
    return;
  }

  if (hasItem || hasLoc) {
    startCountdown();
  } else {
    stopCountdown();
  }
}

function setActiveItem(itemId) {
  activeItem = itemId ? findItem(itemId) : null;
  activeItemMeta = activeItem;

  if (activeItem && reservationMode) {
    applyReservation(activeItem);
  }
  updateRecordSaveState();
}

function setActiveLocation(location) {
  activeLocation = location;
  updateRecordSaveState();
}

function clearScanned() {
  setActiveItem(null);
  setActiveLocation(null);
  stopCountdown();
}

function startCountdown() {
  stopCountdown();
  countdownRemaining = 30;
  countdownTimer = setInterval(() => {
    countdownRemaining -= 1;
    if (countdownRemaining <= 0) {
      clearScanned();
    }
  }, 1000);
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function parseScannedCode(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return;

  if (text.startsWith(QR_PREFIX_ITEM)) {
    const itemId = text.slice(QR_PREFIX_ITEM.length).trim();
    const target = findItem(itemId);
    if (!target) {
      showToast('未登録の物品QRです');
      return;
    }
    setActiveItem(target.id);
    showScanPopup(itemId);
  } else if (text.startsWith(QR_PREFIX_LOC)) {
    const loc = text.slice(QR_PREFIX_LOC.length).trim();
    if (!loc) return;
    setActiveLocation(loc);
    showScanPopup(`→ ${loc}`);
  } else {
    // 不正フォーマットは無視（トーストも不要）
    return;
  }
}

function toggleReservationMode() {
  reservationMode = !reservationMode;
  ui.reserveModeBtn.classList.toggle('active', reservationMode);
  ui.reserveModeBtn.textContent = reservationMode ? '予約登録 ON' : '予約登録';
  if (!reservationMode) {
    ui.reserveModeBtn.classList.remove('active');
  }
  document.getElementById('cameraWrap').classList.toggle('reserve-active', reservationMode);
}

function applyReservation(item) {
  if (!item) return;
  const before = item.status;
  item.status = '使用予約中(廊下)';
  item.reservedAt = nowIso();
  item.updatedAt = nowIso();
  item.updatedBy = ui.operatorName.value.trim();
  if (before !== item.status) {
    addLog(item.id, 'status_updated', '使用予約中(廊下)');
  }
  saveAndRefresh('reserved');
  reservationMode = false;
  ui.reserveModeBtn.classList.remove('active');
  ui.reserveModeBtn.textContent = '予約登録';
  document.getElementById('cameraWrap').classList.remove('reserve-active');
}

function confirmMove() {
  if (!activeItem || !activeLocation) return;

  const item = activeItemMeta;
  const beforeLocation = item.location;
  const beforeStatus = item.status;
  item.location = activeLocation;
  item.status = activeLocation === 'SS' ? 'スタッフステーション' : '配置済み';
  item.reservedAt = null;
  item.updatedAt = nowIso();
  item.updatedBy = ui.operatorName.value.trim();

  if (beforeLocation !== activeLocation) {
    addLog(item.id, 'location_updated', activeLocation);
  }
  if (beforeStatus !== item.status) {
    addLog(item.id, 'status_updated', item.status);
  }
  saveAndRefresh('normal');
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  setTimeout(() => ui.toast.classList.remove('show'), 2500);
}

function showScanPopup(message) {
  if (!ui.scanPopup) return;
  ui.scanPopup.textContent = message;
  ui.scanPopup.classList.add('show');
  if (scanPopupTimer) clearTimeout(scanPopupTimer);
  scanPopupTimer = setTimeout(() => ui.scanPopup.classList.remove('show'), 3000);
}

async function saveAndRefresh(mode, itemRef = activeItemMeta) {
  try {
    await saveState(state);

    // クリア前にメッセージ用情報を保存
    const item = itemRef;
    const loc = item ? item.location : null;

    clearScanned();
    renderAll();

    if (mode === 'reserved') {
      showToast(`${item ? item.id : ''} を使用予約中に登録しました`);
    } else if (mode === 'normal' || mode === 'edit') {
      showToast(`${item ? item.id : ''} → ${loc || '-'} に登録しました`);
    }
  } catch (e) {
    alert('保存に失敗しました');
  }
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tab}`);
  });

  const shell = document.querySelector('.app-shell');
  if (shell) {
    shell.style.overflowY = tab === 'record' ? 'hidden' : 'auto';
  }

  if (tab === 'admin') {
    checkAdminState();
  }
}

function checkAdminState() {
  const unlocked = sessionStorage.getItem('goodsV2AdminUnlocked') === '1';
  if (unlocked) {
    ui.adminLock.style.display = 'none';
    ui.adminMain.style.display = 'block';
    renderAdminPanel();
  } else {
    ui.adminLock.style.display = 'block';
    ui.adminMain.style.display = 'none';
  }
}

function unlockAdmin() {
  if (ui.adminPassword.value === ADMIN_PASSWORD) {
    sessionStorage.setItem('goodsV2AdminUnlocked', '1');
    checkAdminState();
    ui.adminPassword.value = '';
  } else {
    alert('パスワードが違います');
  }
}

function switchManageType(type) {
  currentManageType = getItemTypeConfig(type)?.type || ITEM_TYPES[0]?.type || type;
  Object.entries(ui.manageTypeButtons).forEach(([itemType, button]) => {
    button.classList.toggle('active', itemType === currentManageType);
  });
  renderItemList();
}

function renderRoomView() {
  const allItems = getAllItems();

  // location → items のマップを作成
  const locMap = {};
  for (const item of allItems) {
    const loc = item.location;
    if (loc) {
      if (!locMap[loc]) locMap[loc] = [];
      locMap[loc].push(item);
    }
  }

  function slotItemHtml(item) {
    if (!item) return '<span class="slot-empty">-</span>';
    return `<button class="slot-item-btn" data-id="${item.id}">
      <div class="slot-item">
        <span class="slot-item-id">${item.id}</span>
        <span class="slot-item-status">${item.status}</span>
      </div>
    </button>`;
  }

  let html = '';

  for (const { room, beds } of roomDefinitions) {
    html += `<div class="room-card">`;
    html += `<div class="room-card-header">${room}号室</div>`;
    for (let i = 1; i <= beds; i++) {
      const loc = beds === 1 ? room : `${room}-${i}`;
      const items = locMap[loc] || [];
      const bed = items.find(x => x.type === 'bed');
      const sensor = items.find(x => x.type === 'sensor');
      html += `<div class="room-slot">
        <span class="slot-label">${loc}</span>
        ${slotItemHtml(bed)}
        ${slotItemHtml(sensor)}
      </div>`;
    }
    html += `</div>`;
  }

  // SS（スタッフステーション）
  const ssItems = locMap['SS'] || [];
  html += `<div class="room-card room-card-ss">`;
  html += `<div class="room-card-header">スタッフステーション (SS)</div>`;
  if (ssItems.length === 0) {
    html += `<div class="room-slot"><span class="slot-empty">物品なし</span></div>`;
  } else {
    for (const item of ssItems) {
      html += `<div class="room-slot">
        <span class="slot-label">SS</span>
        ${slotItemHtml(item)}
        <span></span>
      </div>`;
    }
  }
  html += `</div>`;

  // location未設定の物品
  const unplaced = allItems.filter(x => !x.location);
  if (unplaced.length > 0) {
    html += `<div class="room-card">`;
    html += `<div class="room-card-header">場所未設定</div>`;
    for (const item of unplaced) {
      html += `<div class="room-slot">
        <span class="slot-label">-</span>
        ${slotItemHtml(item)}
        <span></span>
      </div>`;
    }
    html += `</div>`;
  }

  ui.roomView.innerHTML = html;

  // クリックイベント
  ui.roomView.querySelectorAll('.slot-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = findItem(btn.dataset.id);
      if (item) openEditModal(item);
    });
  });
}

function switchView(view) {
  currentView = view;
  const isRoom = view === 'room';

  ui.viewRoomBtn.classList.toggle('active', isRoom);
  ui.viewListBtn.classList.toggle('active', !isRoom);

  ui.roomView.style.display = isRoom ? 'grid' : 'none';
  document.getElementById('itemList').style.display = isRoom ? 'none' : 'grid';

  document.querySelectorAll('.list-only').forEach(el => {
    el.style.display = isRoom ? 'none' : '';
  });

  if (isRoom) {
    renderRoomView();
  } else {
    renderItemList();
  }
}

function renderItemList() {
  const keyword = (ui.itemSearch.value || '').trim().toLowerCase();
  const rows = state.items.filter(item => item.type === currentManageType).filter(item => {
    const target = `${item.id} ${item.location || ''}`.toLowerCase();
    return !keyword || target.includes(keyword);
  });

  ui.itemList.innerHTML = rows
    .map(item => {
      const t = item.updatedAt ? `更新: ${new Date(item.updatedAt).toLocaleString('ja-JP')}` : '更新: -';
      return `
        <button class="item-row" data-id="${item.id}" data-type="${item.type}">
          <div>
            <div class="item-id">${item.id}</div>
            <div class="item-sub">場所: ${item.location || '-'} ／ 状態: ${item.status}</div>
          </div>
          <div class="item-sub">${t}</div>
        </button>
      `;
    })
    .join('') || '<div class="empty-list">該当なし</div>';

  document.querySelectorAll('.item-row').forEach(button => {
    button.addEventListener('click', event => {
      const row = event.currentTarget;
      const id = row.dataset.id;
      const item = findItem(id);
      if (item) openEditModal(item);
    });
  });
}

function openEditModal(item) {
  activeItemMeta = item;
  const itemTypeConfig = getItemTypeConfig(item.type);
  ui.editItemTitle.textContent = `${itemTypeConfig?.label || item.type} ${item.id}`;
  ui.editLocation.innerHTML = '';

  const locationOptions = ['未設定', ...getLocationCodes(), 'SS'];
  locationOptions.forEach(loc => {
    const option = document.createElement('option');
    option.value = loc === '未設定' ? '' : loc;
    option.textContent = loc;
    if ((item.location || '') === option.value) option.selected = true;
    ui.editLocation.appendChild(option);
  });

  ui.editStatus.innerHTML = '';
  const statusOptions = STATUS_OPTIONS_BY_TYPE[item.type] || STATUS_OPTIONS_BY_TYPE.bed;

  statusOptions.forEach(st => {
    const option = document.createElement('option');
    option.value = st;
    option.textContent = st;
    if (item.status === st) option.selected = true;
    ui.editStatus.appendChild(option);
  });

  ui.editModal.style.display = 'flex';
}

function closeEditModal() {
  ui.editModal.style.display = 'none';
  activeItemMeta = null;
}

function saveEditedItem() {
  const location = ui.editLocation.value || null;
  const status = ui.editStatus.value || 'unknown';
  const item = activeItemMeta;

  if (!item) {
    closeEditModal();
    return;
  }

  if (item.location !== location) {
    addLog(item.id, 'location_updated', location || '');
  }
  if (item.status !== status) {
    addLog(item.id, 'status_updated', status);
  }

  item.location = location;
  item.status = status;
  item.reservedAt = status === '使用予約中(廊下)' ? nowIso() : null;
  item.updatedAt = nowIso();
  item.updatedBy = ui.operatorName.value.trim();

  closeEditModal();
  saveAndRefresh('edit', item);
}

function renderLogs() {
  const latest = state.logs.slice(0, 50);
  ui.logList.innerHTML = latest
    .map(log => {
      const ts = log.ts ? new Date(log.ts).toLocaleString('ja-JP') : '-';
      return `
        <div class="log-item">
          <span>${ts}</span>
          <span>${log.itemId}</span>
          <span>${log.action}</span>
          <span>${log.detail || ''}</span>
          <span>${log.by || ''}</span>
        </div>
      `;
    })
    .join('') || '<div class="empty-list">履歴なし</div>';
}

function renderQrSet(container, items, withPrefix) {
  container.innerHTML = '';
  if (!items || items.length === 0) {
    container.innerHTML = '<p style="color:red;">表示する項目がありません</p>';
    return;
  }
  if (typeof QRCode === 'undefined') {
    container.innerHTML = '<p style="color:red;">QRライブラリが読み込まれていません。ページを再読み込みしてください。</p>';
    return;
  }
  items.forEach(value => {
    const box = document.createElement('div');
    box.className = 'qr-item';
    const qrWrap = document.createElement('div');
    const label = document.createElement('p');
    label.textContent = value;
    box.appendChild(qrWrap);
    box.appendChild(label);
    container.appendChild(box);
    try {
      new QRCode(qrWrap, {
        text: `${withPrefix}${value}`,
        width: 96,
        height: 96,
      });
    } catch (e) {
      qrWrap.innerHTML = '<span style="color:red;font-size:0.7rem;">QR生成エラー</span>';
      console.error('QR生成エラー:', value, e);
    }
  });
}

function renderQrCodes() {
  const itemIds = [];
  for (const t of ITEM_TYPES) {
    for (let i = 1; i <= t.count; i++) {
      itemIds.push(`${t.prefix}-${pad3(i)}`);
    }
  }
  const locIds = ['SS', ...getLocationCodes()];

  renderQrSet(ui.qrItems, itemIds, 'ITEM:');
  renderQrSet(ui.qrLocations, locIds, 'LOC:');

  // テスト用QR
  const testItem = document.getElementById('testQrItem');
  const testLoc = document.getElementById('testQrLoc');
  if (testItem && typeof QRCode !== 'undefined') {
    testItem.innerHTML = '';
    try { new QRCode(testItem, { text: 'ITEM:TEST-000', width: 96, height: 96 }); } catch (_) {}
  }
  if (testLoc && typeof QRCode !== 'undefined') {
    testLoc.innerHTML = '';
    try { new QRCode(testLoc, { text: 'LOC:TEST', width: 96, height: 96 }); } catch (_) {}
  }
  qrCodesRendered = true;
}

function renderAdminPanel() {
  if (!qrCodesRendered) {
    renderQrCodes();
  }
  renderLogs();
}

function renderAll() {
  if (currentView === 'room') {
    renderRoomView();
  } else {
    renderItemList();
  }
  updateRecordSaveState();
  if (currentTab === 'admin') {
    renderAdminPanel();
  }
}

async function startScanner() {
  if (isScanning) return;

  // jsQRの読み込みを最大3秒待つ
  if (!barcodeDetector) {
    const deadline = Date.now() + 3000;
    while (typeof jsQR === 'undefined' && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  const canScan = barcodeDetector || typeof jsQR !== 'undefined';
  if (!canScan) {
    alert('このブラウザはQRスキャンに対応していません。');
    return;
  }

  try {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    } catch (_) {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    ui.scannerVideo.srcObject = cameraStream;
    // loadedmetadata を待ってから play()（Android対策）
    await new Promise(resolve => {
      if (ui.scannerVideo.readyState >= 1) { resolve(); return; }
      ui.scannerVideo.addEventListener('loadedmetadata', resolve, { once: true });
    });
    try { await ui.scannerVideo.play(); } catch (_) { }
    isScanning = true;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const loop = async () => {
      if (!isScanning) return;
      if (!ui.scannerVideo || ui.scannerVideo.readyState < 2) {
        requestAnimationFrame(loop);
        return;
      }

      const now = Date.now();
      if (scannerBusyUntil > now) {
        requestAnimationFrame(loop);
        return;
      }

      canvas.width = ui.scannerVideo.videoWidth;
      canvas.height = ui.scannerVideo.videoHeight;
      ctx.drawImage(ui.scannerVideo, 0, 0, canvas.width, canvas.height);

      try {
        if (barcodeDetector) {
          const codes = await barcodeDetector.detect(canvas);
          if (codes && codes.length > 0) {
            const val = codes[0].rawValue;
            const now2 = Date.now();
            if (val !== lastScannedValue || now2 - lastScannedAt > 5000) {
              lastScannedValue = val;
              lastScannedAt = now2;
              parseScannedCode(val);
            }
            scannerBusyUntil = Date.now() + 1200;
          }
        } else if (typeof jsQR !== 'undefined') {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code) {
            const val = code.data;
            const now2 = Date.now();
            if (val !== lastScannedValue || now2 - lastScannedAt > 5000) {
              lastScannedValue = val;
              lastScannedAt = now2;
              parseScannedCode(val);
            }
            scannerBusyUntil = Date.now() + 1200;
          }
        }
      } catch (_) {
        // ignore
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  } catch (e) {
    showToast('カメラの起動に失敗しました');
    isScanning = false;
  }
}

function stopScanner() {
  isScanning = false;
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
  }
  cameraStream = null;
}

async function init() {
  state = getItemDefaults();
  setupElements();
  bindUi();

  try {
    await fetchState();
    renderAll();
    renderItemList();
    checkAdminState();
    switchTab('record');
  } catch (err) {
    alert('データの読込に失敗しました');
  }
}

function renderTab() {
  if (currentTab === 'manual') renderItemList();
  if (currentTab === 'admin') renderAdminPanel();
}

init();
