/* Diagnostic UI. No business payload, IDs, paths or browser storage are recorded. */
(function (win) {
  'use strict';
  let called = false, hidden = win.document.hidden;
  win.document.addEventListener('visibilitychange', () => { if (win.document.hidden) hidden = true; });
  const labels = { settingsAndPanel: '設定・管理情報・開始時パネル', payloadReadValidate: '保存データ読込・検証', contextBuild: '起動情報作成', runtimeCopyAndVerify: 'コピー・照合・起動ファイル作成', sessionRecord: '編集セッション記録', workbookSave: 'ブック保存', finalPanel: 'パネル更新', directLaunchPreparation: '直開き準備' };
  async function ready() {
    const timing = win.__EXCEL_GATE_TIMING__;
    if (called || !timing) return;
    called = true;
    if (win.document.readyState === 'loading') await new Promise(resolve => win.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)));
    const control = win.document.querySelector('input[name="staffId"]');
    const gateDialog = win.document.querySelector('excel-gate-panel')?.shadowRoot?.querySelector('dialog');
    // Fail closed: rendering a shell or an error page is not a successful startup.
    const usable = !!control && !control.disabled && control.getClientRects().length > 0 && !gateDialog?.open && !control.closest('[inert]');
    const localNow = Date.now() - new Date().getTimezoneOffset() * 60000;
    const totalMs = localNow - timing.startedLocalMs;
    const handoffMs = localNow - timing.handoffLocalMs;
    const phaseValues = Object.values(timing.phasesMs);
    const fresh = performance.getEntriesByType('navigation')[0]?.type !== 'reload' && totalMs < 300000;
    const valid = usable && fresh && !hidden && Number.isFinite(totalMs) && totalMs >= 0 && handoffMs >= 0 && phaseValues.every(v => Number.isFinite(v) && v >= 0);
    const report = { ...timing, study: 'excel-gate-startup-study-1', recordedAt: new Date().toISOString(), totalMs, handoffMs,
      browserNavigationToReadyMs: performance.now(), valid, invalidReason: !fresh ? '再読込または古い起動情報です。ブックから測り直してください' : !usable ? '操作可能な入力欄を確認できません' : hidden ? '計測中にタブが背景になりました' : !valid ? '時計が変化した可能性があります' : '',
      readyDefinition: 'adapter loaded; login input enabled and visible; gate dialog closed; two animation frames',
      browser: navigator.userAgent, browserState: 'unknown', host: 'unknown', dataSet: '初期データ', userInputObserved: false };
    win.__EXCEL_GATE_BENCHMARK_RESULT__ = report;
    const observe = event => { if (event.isTrusted && event.target === control) { report.userInputObserved = true; win.document.removeEventListener('input', observe, true); } };
    win.document.addEventListener('input', observe, true);
    const host = win.document.createElement('aside'); host.id = 'excel-gate-benchmark';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>:host{display:block;color:#142d41;background:#fff7df;border:2px solid #ae7b08;padding:12px 20px;font:14px/1.6 sans-serif}summary{cursor:pointer;font-weight:bold}button,select,input{font:inherit;margin:4px;padding:4px}td{padding:2px 12px 2px 0}p{margin:4px 0}</style><details><summary></summary><p>検証用です。正式版の速度判定はWindows実測後です。</p><table></table><p class="details"></p><label>Edgeの状態 <select id="browser"><option value="unknown">未記録</option><option value="warm">起動済み</option><option value="cold">未起動（プロセスなし）</option></select></label><label>ブック <select id="host"><option value="unknown">未記録</option><option>JUST Calc</option><option>Excel</option></select></label><label>データ条件 <input id="data" value="初期データ" maxlength="80"></label><button>計測結果を保存</button><p>結果に業務データは含めません。保存前に操作できることを確認してください。</p></details>';
    const title = { baseline: 'A 旧方式・診断', minimal: 'B 最小改修・比較', direct: 'C HTML直開き' }[report.profile] || report.profile;
    shadow.querySelector('summary').textContent = title + '：' + (valid ? (totalMs / 1000).toFixed(3) + ' 秒（操作可能まで）' : '計測無効：' + report.invalidReason);
    const table = shadow.querySelector('table');
    for (const [key, value] of [...Object.entries(report.phasesMs), ['handoff', handoffMs]]) {
      const tr = table.insertRow(); tr.insertCell().textContent = labels[key] || '計測出力・ブラウザ起動〜操作可能'; tr.insertCell().textContent = (value / 1000).toFixed(3) + ' 秒';
    }
    shadow.querySelector('.details').textContent = '内訳（上記と重複）：コピー ' + (report.detailMs.fileCopy / 1000).toFixed(3) + ' 秒、CRC＋ファイル読込 ' + (report.detailMs.crcWithFileRead / 1000).toFixed(3) + ' 秒。';
    shadow.querySelector('button').onclick = () => {
      report.browserState = shadow.querySelector('#browser').value; report.host = shadow.querySelector('#host').value;
      report.dataSet = shadow.querySelector('#data').value.trim() || '未記録';
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
      const a = win.document.createElement('a'); a.href = url; a.download = 'startup-' + report.profile + '-' + Date.now() + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    win.document.body.prepend(host);
  }
  win.ExcelGateBenchmark = { ready };
})(window);
