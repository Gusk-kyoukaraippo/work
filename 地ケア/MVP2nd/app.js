const state = {
  months: [],
  dataByMonth: new Map(),
  selectedMonth: null,
  alert: null
};

const DB_NAME = "tiiki-care-dashboard";
const DB_STORE = "settings";
const DIR_HANDLE_KEY = "dataDirHandle";

const THRESHOLDS = {
  nursing: { danger: 11, caution: 12 },
  homeReturn: { danger: 72.5, caution: 75 },
  homeAdmission: 20,
  emergencyHome: 9
};

const NON_HOME_ROUTE_KEYWORDS = ["特養", "老健", "介護療養"];
const HOME_ROUTE_KEYWORDS = ["自宅", "在宅系施設", "居宅", "有料老人ホーム", "サ高住", "GH", "在宅強化型老健", "介護医療院"];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const months = buildCandidateMonths(36);
  let loaded = await loadMonthData(months);
  applyLoadedMonths(loaded, "自動読み込み");

  if (loaded.length === 0) {
    loaded = await tryLoadFromSavedDirectory();
    applyLoadedMonths(loaded, "保存フォルダ自動読み込み");
  }

  bindEvents();
  if (!state.selectedMonth) {
    showDataSourcePanel(true);
    showManualLoader(true);
    setText("source-status", "自動読み込みに失敗しました。フォルダ接続またはフォルダ選択で読み込みできます。");
    setText("alert-detail", "データ未読込です。上の「データソース」からCSVフォルダを選択してください。");
    if (!supportsDirectoryPicker()) {
      setText("manual-help", "このブラウザはフォルダ自動接続に未対応です。下の「CSVフォルダを選択（代替）」を使ってください。");
    }
  }
}

function bindEvents() {
  const monthSelect = document.getElementById("month-select");
  monthSelect.addEventListener("change", (e) => {
    state.selectedMonth = e.target.value;
    renderDashboard();
  });
  const folderInput = document.getElementById("csv-folder");
  folderInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    const loaded = await loadMonthDataFromFileList(files);
    applyLoadedMonths(loaded, "フォルダ選択");
    if (!state.selectedMonth) {
      showDataSourcePanel(true);
      setText("source-status", "フォルダ内に対象CSVが見つかりませんでした。対象のCSV3種が同じフォルダにあることを確認してください。");
    }
  });
  const connectBtn = document.getElementById("connect-folder");
  connectBtn.addEventListener("click", async () => {
    await connectDirectoryAndLoad();
  });
  document.getElementById("er-form").addEventListener("submit", (e) => {
    e.preventDefault();
    runErJudge();
  });
}

function buildCandidateMonths(count) {
  const now = new Date();
  const list = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    list.push(key);
  }
  return list;
}

async function loadMonthData(candidates) {
  state.dataByMonth.clear();
  const loaded = [];
  const tasks = candidates.map(async (key) => {
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(4, 6));
    const lastDay = new Date(year, month, 0).getDate();
    const files = {
      nursing: `./data/病棟別人数分布表(条件指定)_${key}.csv`,
      bed: `./data/病床稼働報告_${key}${String(lastDay).padStart(2, "0")}.csv`,
      master: `./data/地ケアマスタデータ_${key}.csv`
    };
    try {
      const [nursingCsv, bedCsv, masterCsv] = await Promise.all([
        fetchCsvText(files.nursing),
        fetchCsvText(files.bed),
        fetchCsvText(files.master)
      ]);
      const monthData = aggregateMonthData(key, nursingCsv, bedCsv, masterCsv);
      state.dataByMonth.set(key, monthData);
      loaded.push(key);
    } catch (_e) {
    }
  });
  await Promise.all(tasks);
  return loaded;
}

async function fetchCsvText(path) {
  const response = await fetch(encodeURI(path));
  if (!response.ok) {
    throw new Error(`Failed: ${path}`);
  }
  const buffer = await response.arrayBuffer();
  return decodeArrayBuffer(buffer);
}

function decodeArrayBuffer(buffer) {
  try {
    const decoder = new TextDecoder("shift_jis");
    return decoder.decode(buffer);
  } catch (_e) {
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(buffer);
  }
}

async function loadMonthDataFromFileList(files) {
  state.dataByMonth.clear();
  const monthMap = new Map();

  for (const file of files) {
    const matched = detectCsvFile(file.name || "");
    const monthKey = matched?.monthKey || null;
    const type = matched?.type || null;
    if (!monthKey || !type) continue;

    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, {});
    }
    monthMap.get(monthKey)[type] = { file, matched };
  }

  const loaded = [];
  const entries = Array.from(monthMap.entries());
  await Promise.all(entries.map(async ([monthKey, item]) => {
    if (!item.nursing || !item.bed || !item.master) return;
    const [nursingBuf, bedBuf, masterBuf] = await Promise.all([
      item.nursing.file.arrayBuffer(),
      item.bed.file.arrayBuffer(),
      item.master.file.arrayBuffer()
    ]);
    const nursingCsv = decodeArrayBuffer(nursingBuf);
    const bedCsv = decodeArrayBuffer(bedBuf);
    const masterCsv = decodeArrayBuffer(masterBuf);
    const monthData = aggregateMonthData(monthKey, nursingCsv, bedCsv, masterCsv, {
      asOf: item.master.matched?.asOf || null
    });
    state.dataByMonth.set(monthKey, monthData);
    loaded.push(monthKey);
  }));
  return loaded;
}

function applyLoadedMonths(loaded, sourceLabel) {
  state.months = loaded.sort();
  state.selectedMonth = state.months[state.months.length - 1] || null;
  renderMonthSelector();
  if (state.selectedMonth) {
    renderDashboard();
    setText("source-status", `${sourceLabel}で ${state.months.length}ヶ月分を読み込みました。`);
    showDataSourcePanel(false);
    showManualLoader(false);
  }
}

function showManualLoader(show) {
  const el = document.getElementById("manual-loader");
  if (!el) return;
  el.classList.toggle("hidden", !show);
}

function showDataSourcePanel(show) {
  const el = document.getElementById("data-source-panel");
  if (!el) return;
  el.classList.toggle("hidden", !show);
}

function supportsDirectoryPicker() {
  return typeof window.showDirectoryPicker === "function";
}

async function connectDirectoryAndLoad() {
  if (!supportsDirectoryPicker()) {
    document.getElementById("csv-folder").click();
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: "read" });
    await saveDirectoryHandle(handle);
    const loaded = await loadMonthDataFromDirectoryHandle(handle);
    applyLoadedMonths(loaded, "接続フォルダ読み込み");
    if (loaded.length === 0) {
      showDataSourcePanel(true);
      setText("source-status", "接続フォルダ内に対象CSVが見つかりませんでした。対象のCSV3種が同じフォルダにあることを確認してください。");
      showManualLoader(true);
    }
  } catch (_e) {
    showDataSourcePanel(true);
    setText("source-status", "フォルダ接続はキャンセルされました。");
  }
}

async function tryLoadFromSavedDirectory() {
  try {
    if (!supportsDirectoryPicker()) return [];
    const handle = await getDirectoryHandle();
    if (!handle) return [];
    let perm = await handle.queryPermission({ mode: "read" });
    if (perm !== "granted") {
      perm = await handle.requestPermission({ mode: "read" });
    }
    if (perm !== "granted") return [];
    return loadMonthDataFromDirectoryHandle(handle);
  } catch (_e) {
    return [];
  }
}

async function loadMonthDataFromDirectoryHandle(handle) {
  const files = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== "file") continue;
    if (!/\.csv$/i.test(entry.name)) continue;
    files.push(await entry.getFile());
  }
  return loadMonthDataFromFileList(files);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDirectoryHandle(handle) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(handle, DIR_HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getDirectoryHandle() {
  const db = await openDb();
  const result = await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(DIR_HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuote = false;
  const src = text.replace(/\r/g, "");

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuote) {
      if (ch === "\"" && src[i + 1] === "\"") {
        cell += "\"";
        i += 1;
      } else if (ch === "\"") {
        inQuote = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === "\"") {
      inQuote = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

function aggregateMonthData(monthKey, nursingText, _bedText, masterText, meta = {}) {
  const nursingRows = parseCsv(nursingText);
  const masterRows = parseCsv(masterText);

  const nursing = aggregateNursing(nursingRows);
  const master = aggregateMaster(masterRows, monthKey);

  return {
    monthKey,
    asOf: meta.asOf || null,
    nursing,
    homeReturn: {
      num: master.homeReturnNum,
      den: master.homeReturnDen,
      rate: ratio(master.homeReturnNum, master.homeReturnDen)
    },
    homeAdmission: {
      num: master.homeAdmissionNum,
      den: master.homeAdmissionDen,
      rate: ratio(master.homeAdmissionNum, master.homeAdmissionDen)
    },
    emergencyHome: {
      count: master.emergencyHomeCount,
      den: master.homeAdmissionDen
    }
  };
}

function aggregateNursing(rows) {
  let eligibleRow = null;
  let totalRow = null;
  let ratioRow = null;
  let periodText = "";

  for (const cols of rows) {
    const c0 = cols[0] || "";
    const c1 = cols[1] || "";
    const c2 = cols[2] || "";
    if (c0 === "対象日") periodText = cols[1] || "";
    if ((c0.includes("６階") || c0.includes("6階")) && (c1 === "Ⅱ" || c1 === "II" || c1 === "2")) {
      if (c2.includes("該当")) eligibleRow = cols;
      if (c2.includes("対象")) totalRow = cols;
      if (c2.includes("割合")) ratioRow = cols;
    }
  }

  if (!eligibleRow || !totalRow) {
    return { num: 0, den: 0, rate: null, periodText };
  }

  let num = 0;
  let den = 0;
  for (let i = 3; i < Math.min(eligibleRow.length, totalRow.length); i += 1) {
    const e = Number(eligibleRow[i]);
    const t = Number(totalRow[i]);
    if (Number.isFinite(e) && Number.isFinite(t) && t > 0) {
      num += e;
      den += t;
    }
  }
  const averageRate = ratioRow ? findTrailingNumber(ratioRow) : null;
  const fallbackRate = ratio(num, den);
  return { num, den, rate: averageRate ?? fallbackRate, periodText };
}

function aggregateMaster(rows, monthKey) {
  const targetYear = Number(monthKey.slice(0, 4));
  const targetMonth = Number(monthKey.slice(4, 6));
  const header = rows[1] || [];
  const col = {
    admissionDate: findCol(header, "今回入院日"),
    dischargeDate: findCol(header, "今回退院日"),
    route: findCol(header, "入院経路"),
    destination: findCol(header, "転出先"),
    notes: findCol(header, "備考とSCU日数"),
    readmission: findCol(header, "再入院"),
    id: 1
  };

  let homeReturnNum = 0;
  let homeReturnDen = 0;
  let homeAdmissionNum = 0;
  let homeAdmissionDen = 0;
  let emergencyHomeCount = 0;

  for (let i = 2; i < rows.length; i += 1) {
    const r = rows[i];
    if (!r || !(r[col.id] || "").trim()) continue;

    const ad = parseYmd(r[col.admissionDate]);
    const dd = parseYmd(r[col.dischargeDate]);
    const route = (r[col.route] || "").trim();
    const destination = (r[col.destination] || "").trim();
    const notes = (r[col.notes] || "").trim();
    const readmission = (r[col.readmission] || "").trim();

    if (ad && ad.year === targetYear && ad.month === targetMonth) {
      homeAdmissionDen += 1;
      if (isHomeEquivalentRoute(route)) {
        homeAdmissionNum += 1;
      }
      if (isHomeEquivalentRoute(route) && isEmergency(notes)) {
        emergencyHomeCount += 1;
      }
    }

    if (dd && dd.year === targetYear && dd.month === targetMonth) {
      const excluded = destination === "" || destination.includes("死亡") || readmission.includes("○");
      if (!excluded) {
        homeReturnDen += 1;
        if (isHomeEquivalentDestination(destination)) {
          homeReturnNum += 1;
        }
      }
    }
  }

  return { homeReturnNum, homeReturnDen, homeAdmissionNum, homeAdmissionDen, emergencyHomeCount };
}

function findCol(header, name) {
  return header.findIndex((h) => (h || "").includes(name));
}

function detectCsvFile(fileName) {
  const specs = [
    { type: "nursing", pattern: /^病棟別人数分布表\(条件指定\)_([0-9-]+)\.csv$/i },
    { type: "bed", pattern: /^病床稼働報告_([0-9-]+)(最終結果)?\.csv$/i },
    { type: "master", pattern: /^地ケアマスタ(?:データ)?_([0-9-]+)(入院者)?\.csv$/i }
  ];

  for (const spec of specs) {
    const match = fileName.match(spec.pattern);
    if (!match) continue;
    const monthKey = normalizeMonthKey(match[1]);
    if (!monthKey) return null;
    return {
      type: spec.type,
      monthKey,
      asOf: spec.type === "master" ? parseAsOfFromFileName(match[1]) : null
    };
  }
  return null;
}

function normalizeMonthKey(raw) {
  if (!raw) return null;
  const compact = String(raw).replace(/[^0-9]/g, "");
  if (compact.length === 6) return compact;
  if (compact.length >= 8) return compact.slice(0, 6);
  return null;
}

function parseYmd(value) {
  if (!value) return null;
  const text = String(value).trim();

  const western = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (western) {
    return { year: Number(western[1]), month: Number(western[2]), day: Number(western[3]) };
  }

  const reiwa = text.match(/^R(\d{1,2})[./-](\d{1,2})[./-](\d{1,2})$/i);
  if (reiwa) {
    return { year: 2018 + Number(reiwa[1]), month: Number(reiwa[2]), day: Number(reiwa[3]) };
  }

  return null;
}

function parseAsOfFromFileName(raw) {
  if (!raw) return null;
  const text = String(raw);
  const dated = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dated) {
    return { year: Number(dated[1]), month: Number(dated[2]), day: Number(dated[3]) };
  }
  return null;
}

function formatAsOf(asOf) {
  if (!asOf) return "";
  return `${asOf.month}月${asOf.day}日時点`;
}

function isHomeEquivalentRoute(route) {
  if (!route) return false;
  if (route.includes("一般病棟")) return false;
  if (route.includes("急性期病院")) return false;
  if (NON_HOME_ROUTE_KEYWORDS.some((k) => route.includes(k))) {
    if (route.includes("在宅強化型老健")) return true;
    return false;
  }
  return HOME_ROUTE_KEYWORDS.some((k) => route.includes(k));
}

function isHomeEquivalentDestination(dest) {
  if (!dest) return false;
  if (dest.includes("死亡")) return false;
  if (NON_HOME_ROUTE_KEYWORDS.some((k) => dest.includes(k))) {
    if (dest.includes("在宅強化型老健")) return true;
    return false;
  }
  return HOME_ROUTE_KEYWORDS.some((k) => dest.includes(k));
}

function isEmergency(notes) {
  return notes.includes("予定外");
}

function ratio(num, den) {
  if (!den) return null;
  return (num / den) * 100;
}

function findTrailingNumber(row, reverseIndex = 0) {
  let found = -1;
  for (let i = row.length - 1; i >= 0; i -= 1) {
    const raw = row[i];
    if (raw === null || raw === undefined || String(raw).trim() === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    found += 1;
    if (found === reverseIndex) {
      return value;
    }
  }
  return null;
}

function rollingWindow(keys, endKey, monthsBack) {
  const idx = keys.indexOf(endKey);
  if (idx < 0) return [];
  const start = Math.max(0, idx - monthsBack + 1);
  return keys.slice(start, idx + 1);
}

function weightedRate(keys, pick) {
  let num = 0;
  let den = 0;
  for (const key of keys) {
    const v = pick(state.dataByMonth.get(key));
    num += v.num;
    den += v.den;
  }
  return ratio(num, den);
}

function sumBy(keys, pick) {
  return keys.reduce((acc, key) => acc + pick(state.dataByMonth.get(key)), 0);
}

function formatPercent(value) {
  return value === null ? "--" : `${value.toFixed(1)}%`;
}

function renderMonthSelector() {
  const select = document.getElementById("month-select");
  select.innerHTML = "";
  for (const key of state.months) {
    const year = key.slice(0, 4);
    const month = Number(key.slice(4, 6));
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${year}年${month}月`;
    if (key === state.selectedMonth) opt.selected = true;
    select.appendChild(opt);
  }
}

function renderDashboard() {
  const keys = state.months;
  const current = state.dataByMonth.get(state.selectedMonth);
  if (!current) return;
  const selectedMonthLabel = `${state.selectedMonth.slice(0, 4)}年${Number(state.selectedMonth.slice(4, 6))}月`;
  const asOfLabel = formatAsOf(current.asOf);

  const k3 = rollingWindow(keys, state.selectedMonth, 3);
  const k6 = rollingWindow(keys, state.selectedMonth, 6);

  const nursingRolling = weightedRate(k3, (m) => m.nursing);
  const homeRolling = weightedRate(k6, (m) => m.homeReturn);
  const homeAdmRolling = weightedRate(k3, (m) => m.homeAdmission);
  const emergencyRolling = sumBy(k3, (m) => m.emergencyHome.count);

  setText("nursing-rolling", formatPercent(nursingRolling));
  setText("nursing-month", formatPercent(current.nursing.rate));
  setText("home-rolling", formatPercent(homeRolling));
  setText("home-month", formatPercent(current.homeReturn.rate));
  setText("home-adm-rolling", formatPercent(homeAdmRolling));
  setText("home-adm-month", formatPercent(current.homeAdmission.rate));
  setText("emer-rolling", `${emergencyRolling}人`);
  setText("emer-month", `${current.emergencyHome.count}人`);
  setAchievement("home-status", homeRolling !== null && homeRolling >= THRESHOLDS.homeReturn.caution);
  setAchievement("nursing-status", nursingRolling !== null && nursingRolling >= THRESHOLDS.nursing.caution);
  setAchievement("home-adm-status", homeAdmRolling !== null && homeAdmRolling >= THRESHOLDS.homeAdmission);
  setAchievement("emer-status", emergencyRolling >= THRESHOLDS.emergencyHome);

  renderAlert(homeRolling, nursingRolling);
  renderBreakdown(k6);
  setText("current-month-label", asOfLabel ? `(${selectedMonthLabel} / ${asOfLabel})` : `(${selectedMonthLabel})`);
  setText("judge-alert", document.getElementById("overall-alert").textContent);
}

function renderBreakdown(keys) {
  const body = document.getElementById("breakdown-body");
  body.innerHTML = "";
  for (const key of keys) {
    const m = state.dataByMonth.get(key);
    const tr = document.createElement("tr");
    tr.innerHTML = [
      `<td>${key.slice(0, 4)}-${key.slice(4, 6)}</td>`,
      `<td>${formatPercent(m.homeReturn.rate)}</td>`,
      `<td>${formatPercent(m.nursing.rate)}</td>`,
      `<td>${formatPercent(m.homeAdmission.rate)}</td>`,
      `<td>${m.emergencyHome.count}人</td>`
    ].join("");
    body.appendChild(tr);
  }
}

function getLevel(value, threshold) {
  if (value === null) return "caution";
  if (value < threshold.danger) return "danger";
  if (value < threshold.caution) return "caution";
  return "safe";
}

function renderAlert(homeRolling, nursingRolling) {
  const homeLevel = getLevel(homeRolling, THRESHOLDS.homeReturn);
  const nursingLevel = getLevel(nursingRolling, THRESHOLDS.nursing);
  let overall = "safe";
  if (homeLevel === "danger" || nursingLevel === "danger") overall = "danger";
  else if (homeLevel === "caution" || nursingLevel === "caution") overall = "caution";
  state.alert = overall;

  const labels = {
    safe: "🟢 安全",
    caution: "🟡 注意",
    danger: "🔴 危険"
  };
  const detail = `在宅復帰率: ${labels[homeLevel]} / 看護必要度: ${labels[nursingLevel]}`;
  const el = document.getElementById("overall-alert");
  el.textContent = labels[overall];
  el.className = `alert badge-${overall}`;
  const wrap = document.querySelector(".alert-wrap");
  if (wrap) wrap.className = `alert-wrap level-${overall}`;
  setText("alert-detail", detail);
}

function runErJudge() {
  const procCount = document.querySelectorAll("input[name='proc']:checked").length;
  const adl = document.querySelector("input[name='adl']:checked").value;
  const prospect = document.querySelector("input[name='prospect']:checked").value;
  const residence = document.getElementById("residence").value;
  const isTransfer = document.getElementById("is-transfer").checked;
  const isEmergency = document.getElementById("is-emergency").checked;

  const nursingPositive = (procCount >= 2 && adl === "full") || procCount >= 3;
  const homePositive = prospect === "yes" && isResidenceCountable(residence) && !isTransfer;
  const type = classifyType(nursingPositive, homePositive);
  const recommendation = recommendDestination({ nursingPositive, homePositive, adl, procCount, isEmergency });

  setText("judge-nursing", nursingPositive ? "○" : "×");
  setText("judge-home", homePositive ? "○" : "×");
  setText("judge-type", type);
  setText("judge-destination", recommendation.destination);
  setText("judge-reason", recommendation.reason);
}

function isResidenceCountable(code) {
  return ["home", "residential-care", "enhanced-roken", "care-medical"].includes(code);
}

function classifyType(nursingPositive, homePositive) {
  if (nursingPositive && homePositive) return "A";
  if (nursingPositive && !homePositive) return "B";
  if (!nursingPositive && homePositive) return "C";
  return "D";
}

function recommendDestination({ nursingPositive, homePositive, adl, procCount, isEmergency }) {
  if (nursingPositive && homePositive) {
    return {
      destination: "地ケア",
      reason: "看護必要度と在宅復帰の双方に寄与見込み。地ケア直入の候補。"
    };
  }
  if (nursingPositive && !homePositive) {
    if (adl === "full" && procCount >= 3) {
      return {
        destination: "難病",
        reason: "医療処置負荷が高く、在宅復帰寄与は弱い。高負荷病床の検討を優先。"
      };
    }
    return {
      destination: "急性期",
      reason: "看護必要度は満たすが、在宅復帰寄与が弱いため急性期が妥当。"
    };
  }
  if (!nursingPositive && homePositive) {
    return {
      destination: isEmergency ? "急性期" : "地ケア",
      reason: isEmergency
        ? "在宅復帰寄与はあるが緊急入院で急性期優先。"
        : "在宅復帰寄与が見込めるため地ケア候補。"
    };
  }
  return {
    destination: "急性期",
    reason: "看護必要度・在宅復帰寄与ともに乏しいため急性期で再評価。"
  };
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setAchievement(id, achieved) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = achieved ? "達成" : "未達";
  el.className = `status-chip ${achieved ? "status-achieved" : "status-missed"}`;
}
