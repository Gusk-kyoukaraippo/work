// ============================================================
// 地ケア病棟 搬入判断アラートシステム - app.js
// ============================================================

// --- グローバル状態 ---
const state = {
  // 看護必要度データ（CSV1から）
  nursing: {
    // 当月データ: { eligible: [日別該当人数], total: [日別対象人数] }
    currentMonth: null,
    // 対象期間テキスト
    periodText: '',
    // 集計値
    monthlyEligible: 0, // 当月の該当延べ日数
    monthlyTotal: 0,     // 当月の対象延べ日数
    monthlyRate: null,    // 当月の看護必要度(%)
    // 3ヶ月累計は手入力 or 過去CSVから（MVP1では当月のみ）
    threeMonthRate: null,
    // 3ヶ月内訳（当月+ダミー）
    threeMonthSeries: [],
  },
  // 病床稼働データ（CSV2から）
  beds: null,
  // 在宅復帰率（手入力）
  homeReturn: {
    sixMonthRate: null,
    monthlyRate: null,
    // 6ヶ月内訳（当月+ダミー）
    sixMonthSeries: [],
  },
  // アラートレベル
  alertLevel: null, // 'safe' | 'caution' | 'danger'
};

// --- 定数 ---
const THRESHOLDS = {
  nursing: { danger: 11, caution: 12 },       // 11%未満=危険, 11-12%=注意, 12%以上=安全
  homeReturn: { danger: 72.5, caution: 75 },  // 72.5%未満=危険, 72.5-75%=注意, 75%以上=安全
};

const SEASON_MODES = {
  1:  { mode: 'damage-control', label: '冬季：ダメージ最小化', targets: { home: 70, nursing: 10 } },
  2:  { mode: 'damage-control', label: '冬季：ダメージ最小化', targets: { home: 70, nursing: 10 } },
  3:  { mode: 'recovery', label: '春季：立て直し期', targets: { home: 75, nursing: 12 } },
  4:  { mode: 'recovery', label: '春季：立て直し期', targets: { home: 75, nursing: 12 } },
  5:  { mode: 'recovery', label: '春季：立て直し期', targets: { home: 75, nursing: 12 } },
  6:  { mode: 'adjustment', label: '調整月：次の準備', targets: { home: 75, nursing: 12 } },
  7:  { mode: 'normal', label: '夏季：平時運用', targets: { home: 75, nursing: 12 } },
  8:  { mode: 'normal', label: '夏季：平時運用', targets: { home: 75, nursing: 12 } },
  9:  { mode: 'normal', label: '夏季：平時運用', targets: { home: 75, nursing: 12 } },
  10: { mode: 'critical-prep', label: '🔥 冬前準備期（最重要）', targets: { home: 80, nursing: 15 } },
  11: { mode: 'critical-prep', label: '🔥 冬前準備期（最重要）', targets: { home: 80, nursing: 15 } },
  12: { mode: 'damage-control', label: '冬季：ダメージ最小化', targets: { home: 70, nursing: 10 } },
};

// 在宅復帰にカウントされない施設
const NON_HOME_RETURN_RESIDENCES = ['tokuyou', 'roken', 'care-therapy'];

// 在宅復帰にカウントされる施設
const HOME_RETURN_RESIDENCES = ['home', 'residential-care', 'enhanced-roken', 'care-medical'];

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  updateSeasonMode();
  setupEventListeners();
});

function setupEventListeners() {
  document.getElementById('csv-nursing').addEventListener('change', handleNursingCSV);
  document.getElementById('csv-bed').addEventListener('change', handleBedCSV);
  document.getElementById('btn-apply-manual').addEventListener('click', applyManualHomeReturn);
  document.getElementById('btn-judge').addEventListener('click', runTriage);
  document.getElementById('btn-reset').addEventListener('click', resetTriage);
  document.getElementById('residence').addEventListener('change', onResidenceChange);
}

// ============================================================
// 季節モード表示
// ============================================================
function updateSeasonMode() {
  const month = new Date().getMonth() + 1;
  const season = SEASON_MODES[month];
  const el = document.getElementById('season-mode');
  el.textContent = season.label;
  if (season.mode === 'critical-prep') {
    el.style.background = 'rgba(255, 80, 80, 0.4)';
  } else if (season.mode === 'damage-control') {
    el.style.background = 'rgba(255, 193, 7, 0.3)';
  }
}

// ============================================================
// CSV解析: Shift-JIS 対応
// ============================================================
function readFileAsShiftJIS(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    // Shift-JIS / CP932 で読む
    reader.readAsText(file, 'Shift_JIS');
  });
}

function parseCSVLine(line) {
  // カンマ区切り（ダブルクォート内の改行・カンマ対応の簡易版）
  const result = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

function clampRate(v) {
  return Math.max(0, Math.min(100, v));
}

function average(values) {
  if (!values || values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function getRecentMonthLabels(count) {
  const labels = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(`${d.getFullYear()}年${d.getMonth() + 1}月`);
  }
  return labels;
}

function buildNursingThreeMonthSeries(currentRate) {
  if (currentRate === null || currentRate === undefined) return [];
  const labels = getRecentMonthLabels(3);
  const offsets = [-0.8, 0.5, 0];
  return labels.map((label, idx) => ({
    label,
    rate: clampRate(currentRate + offsets[idx]),
    source: idx === 2 ? 'actual' : 'dummy',
  }));
}

function buildHomeSixMonthSeries(monthlyInput, sixMonthTarget) {
  const base = !isNaN(monthlyInput)
    ? monthlyInput
    : (!isNaN(sixMonthTarget) ? sixMonthTarget : null);
  if (base === null) return [];

  const labels = getRecentMonthLabels(6);
  const offsets = [-1.8, -1.1, -0.6, 0.3, 0.9, 0];
  let rates = offsets.map(o => clampRate(base + o));

  if (!isNaN(monthlyInput)) {
    rates[5] = clampRate(monthlyInput);
  }

  if (!isNaN(sixMonthTarget)) {
    if (!isNaN(monthlyInput)) {
      const currentFirstFive = rates.slice(0, 5);
      const neededFirstFiveSum = sixMonthTarget * 6 - rates[5];
      const currentFirstFiveSum = currentFirstFive.reduce((a, b) => a + b, 0);
      const delta = (neededFirstFiveSum - currentFirstFiveSum) / 5;
      rates = rates.map((r, idx) => idx < 5 ? clampRate(r + delta) : r);
    } else {
      const currentAvg = average(rates);
      const delta = sixMonthTarget - currentAvg;
      rates = rates.map(r => clampRate(r + delta));
    }
  }

  return labels.map((label, idx) => ({
    label,
    rate: rates[idx],
    source: (!isNaN(monthlyInput) && idx === 5) ? 'actual' : 'dummy',
  }));
}

// ============================================================
// CSV1: 病棟別人数分布表（看護必要度）
// ============================================================
async function handleNursingCSV(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await readFileAsShiftJIS(file);
    const lines = text.split('\n').map(l => l.replace(/\r/g, '')).filter(l => l.trim());

    // 対象期間を取得（2行目）
    const periodLine = parseCSVLine(lines[1]);
    state.nursing.periodText = periodLine[1] || '';

    // ６階病棟,Ⅱ,該当人数 の行を探す（9行目付近）
    let eligibleRow = null;
    let totalRow = null;

    for (let i = 0; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const ward = cols[0] || '';
      const level = cols[1] || '';
      const metric = cols[2] || '';

      // 6階病棟 Ⅱ の該当人数 & 対象人数を探す
      if (ward.includes('６階') || ward.includes('6階') || ward.includes('ｹ') || ward.includes('地ケア')) {
        if (level === 'Ⅱ' || level === 'II' || level === '2' || level === 'Ⅱ') {
          if (metric.includes('該当')) {
            eligibleRow = cols;
          } else if (metric.includes('対象')) {
            totalRow = cols;
          }
        }
      }
    }

    if (!eligibleRow || !totalRow) {
      alert('CSVから６階病棟Ⅱのデータを読み取れませんでした。\n行構成を確認してください。');
      return;
    }

    // 日別データを抽出（4列目以降が日別データ）
    const eligible = [];
    const total = [];
    // 列3以降にデータがある（0: 病棟名, 1: Ⅱ, 2: 該当人数, 3～: 日別）
    for (let i = 3; i < eligibleRow.length; i++) {
      const ev = parseFloat(eligibleRow[i]);
      const tv = parseFloat(totalRow[i]);
      if (!isNaN(ev) && !isNaN(tv) && tv > 0) {
        eligible.push(ev);
        total.push(tv);
      }
    }

    state.nursing.currentMonth = { eligible, total };
    state.nursing.monthlyEligible = eligible.reduce((a, b) => a + b, 0);
    state.nursing.monthlyTotal = total.reduce((a, b) => a + b, 0);
    state.nursing.monthlyRate = state.nursing.monthlyTotal > 0
      ? (state.nursing.monthlyEligible / state.nursing.monthlyTotal * 100)
      : null;

    // MVP1: 当月 + 過去2ヶ月ダミーで3ヶ月累計を作る
    state.nursing.threeMonthSeries = buildNursingThreeMonthSeries(state.nursing.monthlyRate);
    state.nursing.threeMonthRate = average(state.nursing.threeMonthSeries.map(m => m.rate));

    document.getElementById('status-nursing').textContent =
      `読込完了 (${eligible.length}日分)`;
    document.getElementById('status-nursing').classList.add('loaded');
    document.getElementById('last-updated').textContent =
      `最終更新: ${new Date().toLocaleString('ja-JP')}`;

    updateDashboard();
  } catch (err) {
    alert('CSV読み込みエラー: ' + err.message);
  }
}

// ============================================================
// CSV2: 病床稼働報告
// ============================================================
async function handleBedCSV(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await readFileAsShiftJIS(file);
    // ダブルクォート内の改行に対応するため全文を結合して処理
    const rawLines = text.split('\n').map(l => l.replace(/\r/g, ''));

    // ヘッダー行を飛ばして、病棟データ行を探す
    const wards = [];
    const wardNames = ['SCU', '３階', '３階', '3階', '４階', '4階', '５階', '5階',
                        '６階', '6階', 'ｱﾙﾎﾞｰｽ', 'アルボース', '合計'];

    // 行を結合して正しくパース（ダブルクォート内改行対応）
    const mergedLines = mergeQuotedLines(rawLines);

    for (const line of mergedLines) {
      const cols = parseCSVLine(line);
      if (cols.length < 7) continue;

      const name = cols[0] || '';
      if (wardNames.some(w => name.includes(w))) {
        wards.push({
          name: name,
          fixedBeds: parseInt(cols[1]) || 0,
          occupancyRate: parseFloat((cols[3] || '0').replace('%', '')) || 0,
          avgStay: parseFloat(cols[4]) || 0,
          currentPatients: parseInt(cols[6]) || 0,
          emptyBeds: parseInt(cols[11]) || 0,
        });
      }
    }

    state.beds = wards;

    document.getElementById('status-bed').textContent =
      `読込完了 (${wards.length}病棟)`;
    document.getElementById('status-bed').classList.add('loaded');

    updateDashboard();
  } catch (err) {
    alert('CSV読み込みエラー: ' + err.message);
  }
}

// ダブルクォート内の改行を結合
function mergeQuotedLines(lines) {
  const result = [];
  let current = '';
  let inQuote = false;

  for (const line of lines) {
    if (inQuote) {
      current += ' ' + line;
    } else {
      if (current) result.push(current);
      current = line;
    }
    // クォートの数を数える（偶数なら閉じている）
    const quoteCount = (current.match(/"/g) || []).length;
    inQuote = quoteCount % 2 !== 0;
  }
  if (current) result.push(current);
  return result;
}

// ============================================================
// 在宅復帰率の手入力
// ============================================================
function applyManualHomeReturn() {
  const sixMonth = parseFloat(document.getElementById('home-return-6m').value);
  const monthly = parseFloat(document.getElementById('home-return-month').value);

  state.homeReturn.sixMonthSeries = buildHomeSixMonthSeries(monthly, sixMonth);
  if (state.homeReturn.sixMonthSeries.length > 0) {
    state.homeReturn.monthlyRate = state.homeReturn.sixMonthSeries[5].rate;
    state.homeReturn.sixMonthRate = average(state.homeReturn.sixMonthSeries.map(m => m.rate));
  }

  updateDashboard();
}

// ============================================================
// ダッシュボード更新
// ============================================================
function updateDashboard() {
  updateNursingMetrics();
  updateHomeReturnMetrics();
  updateBedMetrics();
  updateAlertLevel();
  updateDailyChart();
}

function getStatusLevel(value, thresholds) {
  if (value === null || value === undefined) return null;
  if (value < thresholds.danger) return 'danger';
  if (value < thresholds.caution) return 'caution';
  return 'safe';
}

function setBadge(elementId, level) {
  const el = document.getElementById(elementId);
  el.className = 'metric-badge';
  if (!level) { el.textContent = ''; return; }
  const labels = { safe: '安全圏', caution: '要注意', danger: '危険' };
  el.textContent = labels[level];
  el.classList.add(`badge-${level}`);
}

function updateNursingMetrics() {
  const rate3m = state.nursing.threeMonthRate;
  const rateMonth = state.nursing.monthlyRate;

  document.getElementById('nursing-3m').textContent =
    rate3m !== null ? rate3m.toFixed(1) + '%' : '--%';
  document.getElementById('nursing-month').textContent =
    rateMonth !== null ? rateMonth.toFixed(1) + '%' : '--%';

  setBadge('nursing-3m-badge', getStatusLevel(rate3m, THRESHOLDS.nursing));
  setBadge('nursing-month-badge', getStatusLevel(rateMonth, THRESHOLDS.nursing));

  // 詳細
  const detail = document.getElementById('nursing-detail');
  detail.textContent = '';
  if (!state.nursing.currentMonth) return;

  const seriesText = state.nursing.threeMonthSeries
    .map(m => `${m.label} ${m.rate.toFixed(1)}%${m.source === 'dummy' ? '(ダミー)' : '(当月)'}`)
    .join(' / ');

  const lines = [
    `該当延べ日数: ${state.nursing.monthlyEligible} / 対象延べ日数: ${state.nursing.monthlyTotal}`,
    `期間: ${state.nursing.periodText || '-'}`,
    `3ヶ月内訳: ${seriesText}`,
  ];
  lines.forEach(line => {
    const row = document.createElement('div');
    row.textContent = line;
    detail.appendChild(row);
  });
}

function updateHomeReturnMetrics() {
  const rate6m = state.homeReturn.sixMonthRate;
  const rateMonth = state.homeReturn.monthlyRate;

  document.getElementById('home-6m').textContent =
    rate6m !== null ? rate6m.toFixed(1) + '%' : '--%';
  document.getElementById('home-month').textContent =
    rateMonth !== null ? rateMonth.toFixed(1) + '%' : '--%';

  setBadge('home-6m-badge', getStatusLevel(rate6m, THRESHOLDS.homeReturn));
  setBadge('home-month-badge', getStatusLevel(rateMonth, THRESHOLDS.homeReturn));

  const detail = document.getElementById('home-detail');
  detail.textContent = '';
  if (!state.homeReturn.sixMonthSeries || state.homeReturn.sixMonthSeries.length === 0) {
    const row = document.createElement('div');
    row.textContent = '6ヶ月内訳: 未設定';
    detail.appendChild(row);
    return;
  }

  const seriesText = state.homeReturn.sixMonthSeries
    .map(m => `${m.label} ${m.rate.toFixed(1)}%${m.source === 'dummy' ? '(ダミー)' : '(当月)'}`)
    .join(' / ');
  const row = document.createElement('div');
  row.textContent = `6ヶ月内訳: ${seriesText}`;
  detail.appendChild(row);
}

function updateBedMetrics() {
  const grid = document.getElementById('bed-grid');
  if (!state.beds || state.beds.length === 0) {
    grid.innerHTML = '<div class="bed-item"><span class="bed-ward">データ未読込</span></div>';
    return;
  }

  // 病棟名の表示用マッピング
  const displayNames = {
    'SCU病棟': 'SCU（急性期）',
    '３階病棟': '3階（DPC急性期）',
    '４階病棟': '4階（回復期）',
    '５階病棟': '5階（難病）',
    '６階病棟': '6階（地ケア）',
  };

  grid.innerHTML = state.beds
    .filter(w => !w.name.includes('合計'))
    .map(w => {
      const display = displayNames[w.name] || w.name;
      const rate = w.occupancyRate;
      const barColor = rate >= 95 ? '#dc3545' : rate >= 90 ? '#ffc107' : '#28a745';
      const emptyWarn = w.emptyBeds <= 2 ? 'warn' : '';
      return `
        <div class="bed-item">
          <span class="bed-ward">${display}</span>
          <span>稼働${rate}%</span>
          <div class="bed-bar">
            <div class="bed-bar-fill" style="width:${Math.min(rate, 100)}%;background:${barColor}"></div>
          </div>
          <span class="bed-empty ${emptyWarn}">空${w.emptyBeds}床</span>
        </div>`;
    }).join('');
}

function updateAlertLevel() {
  // 看護必要度と在宅復帰率の両方から総合アラートレベルを決定
  const nursingLevel = getStatusLevel(state.nursing.threeMonthRate, THRESHOLDS.nursing);
  const homeLevel = getStatusLevel(state.homeReturn.sixMonthRate, THRESHOLDS.homeReturn);

  // 両方データがない場合
  if (!nursingLevel && !homeLevel) {
    state.alertLevel = null;
    setAlertBanner(null);
    return;
  }

  // どちらか一方でも危険なら危険
  const levels = [nursingLevel, homeLevel].filter(Boolean);
  if (levels.includes('danger')) {
    state.alertLevel = 'danger';
  } else if (levels.includes('caution')) {
    state.alertLevel = 'caution';
  } else {
    state.alertLevel = 'safe';
  }

  setAlertBanner(state.alertLevel);
}

function setAlertBanner(level) {
  const banner = document.getElementById('alert-banner');
  const icon = document.getElementById('alert-icon');
  const text = document.getElementById('alert-text');

  banner.className = 'alert-banner';

  if (!level) {
    icon.textContent = '⚪';
    text.textContent = 'データを読み込んでください';
    return;
  }

  const config = {
    safe: {
      icon: '🟢',
      text: 'レベル1: 安全圏 — 通常運用（急性期入院を優先）',
      class: 'level-safe',
    },
    caution: {
      icon: '🟡',
      text: 'レベル2: 要注意 — 地ケア直入を慎重に検討',
      class: 'level-caution',
    },
    danger: {
      icon: '🔴',
      text: 'レベル3: 危険 — 基準達成に貢献する患者のみ地ケアへ',
      class: 'level-danger',
    },
  };

  const c = config[level];
  banner.classList.add(c.class);
  icon.textContent = c.icon;
  text.textContent = c.text;
}

// ============================================================
// 日別チャート
// ============================================================
function updateDailyChart() {
  const container = document.getElementById('monthly-breakdown');
  const chartEl = document.getElementById('daily-chart');

  if (!state.nursing.currentMonth) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  const { eligible, total } = state.nursing.currentMonth;
  const dailyRates = eligible.map((e, i) => total[i] > 0 ? (e / total[i] * 100) : 0);
  const maxRate = Math.max(...dailyRates, 20); // 最低20%スケール

  const thresholdY = (11 / maxRate * 100);

  let barsHtml = dailyRates.map((rate, i) => {
    const h = (rate / maxRate * 100);
    const color = rate >= 12 ? '#28a745' : rate >= 11 ? '#ffc107' : '#dc3545';
    return `
      <div class="daily-bar">
        <span class="daily-bar-value">${rate.toFixed(1)}%</span>
        <div class="daily-bar-fill" style="height:${h}%;background:${color}"></div>
        <span class="daily-bar-label">${i + 1}</span>
      </div>`;
  }).join('');

  chartEl.innerHTML = `
    <div style="position:relative;">
      <div class="threshold-line" style="bottom:${thresholdY}%;position:absolute;width:100%;border-top:2px dashed #dc3545;z-index:2;">
        <span class="threshold-label" style="position:absolute;right:0;top:-14px;font-size:9px;color:#dc3545;">基準11%</span>
      </div>
      <div class="daily-bar-chart">${barsHtml}</div>
    </div>
    <div class="chart-legend">
      <span>🟢 12%以上（安全圏）</span>
      <span>🟡 11-12%（要注意）</span>
      <span>🔴 11%未満（危険）</span>
      <span>平均: ${state.nursing.monthlyRate.toFixed(1)}%</span>
    </div>`;
}

// ============================================================
// 居住場所変更時の警告表示
// ============================================================
function onResidenceChange() {
  const val = document.getElementById('residence').value;
  const warning = document.getElementById('residence-warning');
  warning.style.display = NON_HOME_RETURN_RESIDENCES.includes(val) ? 'block' : 'none';
}

// ============================================================
// ER 搬入判定
// ============================================================
function runTriage() {
  const residence = document.getElementById('residence').value;
  if (!residence) {
    alert('入院前の居住場所を選択してください');
    return;
  }

  const adlRadio = document.querySelector('input[name="adl"]:checked');
  if (!adlRadio) {
    alert('ADLを選択してください');
    return;
  }

  // --- A項目スコア計算 ---
  const procedures = ['proc-o2', 'proc-cv', 'proc-injection', 'proc-wound', 'proc-other'];
  let aScore = 0;
  const checkedProcs = [];
  procedures.forEach(id => {
    if (document.getElementById(id).checked) {
      aScore++;
      checkedProcs.push(document.getElementById(id).parentElement.textContent.trim());
    }
  });

  // --- B項目簡易判定 ---
  const adl = adlRadio.value;
  const bScore = adl === 'total' ? 3 : 0; // 全介助 = B3点以上

  // --- 看護必要度該当判定 ---
  const nursingEligible = (aScore >= 2 && bScore >= 3) || (aScore >= 3);

  // --- 在宅復帰見込み判定 ---
  let homeReturnProspect;
  if (NON_HOME_RETURN_RESIDENCES.includes(residence)) {
    homeReturnProspect = false; // 同じ施設に戻っても在宅復帰にならない
  } else if (HOME_RETURN_RESIDENCES.includes(residence)) {
    homeReturnProspect = true;
  } else {
    homeReturnProspect = false; // 不明
  }

  // --- 患者タイプ分類 ---
  let patientType;
  if (nursingEligible && homeReturnProspect) {
    patientType = 'A';
  } else if (nursingEligible && !homeReturnProspect) {
    patientType = 'B';
  } else if (!nursingEligible && homeReturnProspect) {
    patientType = 'C';
  } else {
    patientType = 'D';
  }

  // --- 推奨判定 ---
  const recommendation = getRecommendation(patientType);

  // --- 影響予測 ---
  const expectedStay = parseInt(document.getElementById('expected-stay').value) || 30;
  const simulation = simulateImpact(nursingEligible, expectedStay);

  // --- 表示 ---
  displayTriageResult({
    patientType,
    nursingEligible,
    homeReturnProspect,
    aScore,
    bScore,
    checkedProcs,
    adl,
    residence,
    recommendation,
    simulation,
  });
}

function getRecommendation(type) {
  const nursingLevel = getStatusLevel(state.nursing.threeMonthRate, THRESHOLDS.nursing);
  const homeLevel = getStatusLevel(state.homeReturn.sixMonthRate, THRESHOLDS.homeReturn);

  // データがない場合は安全圏扱い
  const nL = nursingLevel || 'safe';
  const hL = homeLevel || 'safe';

  const result = { action: '', detail: '', level: 'acute' };

  if (type === 'D') {
    result.action = '急性期 or 難病病棟へ入院';
    result.detail = '地ケアに入れるメリットなし（看護必要度・在宅復帰率ともに貢献しない）';
    result.level = 'acute';
    return result;
  }

  if (type === 'A') {
    if (nL === 'danger' || hL === 'danger') {
      result.action = '地ケア直入を強く推奨';
      result.detail = '看護必要度・在宅復帰率の両方に貢献。基準が危険水域のため優先的に地ケアへ。';
      result.level = 'strong';
    } else if (nL === 'caution' || hL === 'caution') {
      result.action = '地ケア直入を検討';
      result.detail = '両指標に貢献する患者。基準が要注意のため地ケア直入が望ましい。';
      result.level = 'consider';
    } else {
      result.action = '急性期へ入院（通常運用）';
      result.detail = '基準は安全圏。通常は急性期入院を優先（単価: 急性期 > 地ケア）。';
      result.level = 'acute';
    }
  } else if (type === 'B') {
    if (nL === 'danger') {
      result.action = '地ケア直入を推奨（看護必要度改善のため）';
      result.detail = '看護必要度が危険水域。在宅復帰率には貢献しないが、看護必要度の改善を優先。';
      result.level = 'recommend';
    } else if (nL === 'caution') {
      result.action = '地ケア直入を検討（看護必要度が要注意）';
      result.detail = '看護必要度の改善に貢献。在宅復帰率が安全圏であれば検討可。';
      result.level = 'consider';
    } else {
      result.action = '急性期へ入院';
      result.detail = '看護必要度は安全圏。在宅復帰にカウントされないため、急性期優先。';
      result.level = 'acute';
    }
  } else if (type === 'C') {
    if (hL === 'danger') {
      result.action = '地ケア直入を推奨（在宅復帰率改善のため）';
      result.detail = '在宅復帰率が危険水域。看護必要度には貢献しないが、在宅復帰率の改善を優先。';
      result.level = 'recommend';
    } else if (hL === 'caution') {
      result.action = '地ケア直入を検討（在宅復帰率が要注意）';
      result.detail = '在宅復帰率の改善に貢献。看護必要度が安全圏であれば検討可。';
      result.level = 'consider';
    } else {
      result.action = '急性期へ入院';
      result.detail = '在宅復帰率は安全圏。看護必要度に貢献しないため、急性期優先。';
      result.level = 'acute';
    }
  }

  return result;
}

// ============================================================
// 影響予測シミュレーション
// ============================================================
function simulateImpact(nursingEligible, expectedStay) {
  if (!state.nursing.currentMonth) {
    return { available: false };
  }

  const currentEligible = state.nursing.monthlyEligible;
  const currentTotal = state.nursing.monthlyTotal;
  const currentRate = state.nursing.monthlyRate;

  let newEligible, newTotal, newRate;

  if (nursingEligible) {
    // 該当患者の場合: 該当日数と対象日数の両方が増える
    newEligible = currentEligible + expectedStay;
    newTotal = currentTotal + expectedStay;
  } else {
    // 非該当患者の場合: 対象日数だけ増える（分母のみ増加）
    newEligible = currentEligible;
    newTotal = currentTotal + expectedStay;
  }

  newRate = newTotal > 0 ? (newEligible / newTotal * 100) : 0;

  return {
    available: true,
    currentRate,
    newRate,
    change: newRate - currentRate,
    nursingEligible,
    expectedStay,
    currentEligible,
    currentTotal,
    newEligible,
    newTotal,
  };
}

// ============================================================
// 判定結果の表示
// ============================================================
function displayTriageResult(data) {
  document.getElementById('triage-result').style.display = 'block';

  // 患者タイプ
  const typeLabels = {
    A: { label: 'タイプA 🟦 両貢献', desc: '看護必要度○ + 在宅復帰○' },
    B: { label: 'タイプB 🟨 看護のみ', desc: '看護必要度○ + 在宅復帰×' },
    C: { label: 'タイプC 🟧 在宅のみ', desc: '看護必要度× + 在宅復帰○' },
    D: { label: 'タイプD ⬜ 貢献なし', desc: '看護必要度× + 在宅復帰×' },
  };

  const typeInfo = typeLabels[data.patientType];
  const badge = document.getElementById('patient-type-badge');
  badge.textContent = typeInfo.label;
  badge.className = `type-badge type-${data.patientType.toLowerCase()}`;
  document.getElementById('patient-type-detail').textContent = typeInfo.desc;

  // 2軸判定
  const axisNursing = document.getElementById('axis-nursing');
  axisNursing.textContent = data.nursingEligible ? '○ 該当' : '× 非該当';
  axisNursing.className = data.nursingEligible ? 'axis-yes' : 'axis-no';
  document.getElementById('axis-nursing-detail').textContent =
    `A項目: ${data.aScore}点 / B項目(簡易): ${data.bScore >= 3 ? '3点以上（全介助）' : '3点未満'}`;

  const axisHome = document.getElementById('axis-home');
  axisHome.textContent = data.homeReturnProspect ? '○ 見込みあり' : '× 見込みなし/不明';
  axisHome.className = data.homeReturnProspect ? 'axis-yes' : 'axis-no';

  const residenceLabels = {
    'home': '自宅',
    'residential-care': '居宅系介護施設',
    'enhanced-roken': '在宅強化型老健',
    'care-medical': '介護医療院',
    'tokuyou': '特養 → 在宅復帰にカウントされない',
    'roken': '老健 → 在宅復帰にカウントされない',
    'care-therapy': '介護療養型 → 在宅復帰にカウントされない',
    'acute-hospital': '他の急性期病院',
    'other': 'その他',
  };
  document.getElementById('axis-home-detail').textContent =
    `入院前居住: ${residenceLabels[data.residence] || data.residence}`;

  // 推奨
  const recBox = document.getElementById('recommendation-box');
  recBox.className = `result-box recommendation-box rec-${data.recommendation.level}`;
  document.getElementById('recommendation-text').innerHTML =
    `${data.recommendation.action}<br><span style="font-size:13px;font-weight:400;color:#495057;">${data.recommendation.detail}</span>`;

  // 影響予測
  const simBox = document.getElementById('simulation-box');
  const simResult = document.getElementById('simulation-result');

  if (!data.simulation.available) {
    simResult.textContent = '看護必要度CSVを読み込むとシミュレーションが表示されます';
    return;
  }

  const s = data.simulation;
  const changeClass = s.change > 0 ? 'sim-improve' : s.change < 0 ? 'sim-worsen' : 'sim-neutral';
  const changeSign = s.change > 0 ? '+' : '';
  const arrow = s.change > 0 ? '↑' : s.change < 0 ? '↓' : '→';

  simResult.innerHTML = `
    <div>この患者を地ケアに入れた場合（予測入院${s.expectedStay}日）:</div>
    <div style="margin:8px 0;font-size:16px;">
      看護必要度: ${s.currentRate.toFixed(1)}%
      → <span class="sim-change ${changeClass}">${s.newRate.toFixed(1)}% (${changeSign}${s.change.toFixed(2)}% ${arrow})</span>
    </div>
    <div style="font-size:11px;color:#868e96;">
      該当延べ日数: ${s.currentEligible} → ${s.newEligible} /
      対象延べ日数: ${s.currentTotal} → ${s.newTotal}
    </div>`;
}

// ============================================================
// リセット
// ============================================================
function resetTriage() {
  document.getElementById('residence').value = '';
  document.getElementById('residence-warning').style.display = 'none';
  document.querySelectorAll('.checkbox-group input').forEach(cb => cb.checked = false);
  document.querySelectorAll('input[name="adl"]').forEach(r => r.checked = false);
  document.getElementById('expected-stay').value = '30';
  document.getElementById('triage-result').style.display = 'none';
}
