(function (root, factory) {
  'use strict';
  var core = typeof module === 'object' && module.exports ? require('./excel-gate-core.js') : root.ExcelGateCore;
  var library = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = library;
  if (root.document) root.ExcelGate = library.mount(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';
  var VERSION = '0.4.0';
  var CANCEL = Object.freeze({ cancelled: true });
  function snapshot(value) {
    var ancestors = [];
    function check(v, depth) {
      if (depth > 62) throw new Error('データの入れ子が深すぎます。');
      if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
      if (typeof v === 'number' && Number.isFinite(v)) return;
      if (typeof v !== 'object') throw new Error('JSONに保存できない値があります。');
      if (ancestors.indexOf(v) !== -1) throw new Error('循環参照は保存できません。');
      if (!Array.isArray(v) && Object.prototype.toString.call(v) !== '[object Object]') throw new Error('JSONのオブジェクトか配列を返してください。');
      if (typeof v.toJSON === 'function' || Object.getOwnPropertySymbols(v).length) throw new Error('JSON変換で内容が変わる値は保存できません。');
      ancestors.push(v);
      if (Array.isArray(v)) {
        for (var i = 0; i < v.length; i++) check(v[i], depth + 1);
      } else Object.keys(v).forEach(function (key) { check(v[key], depth + 1); });
      ancestors.pop();
    }
    check(value, 0);
    var text = JSON.stringify(value);
    if (text.length > 10485760) throw new Error('データが大きすぎます。');
    return JSON.parse(text);
  }
  function validateContext(input) {
    var c = snapshot(input);
    if (!c || c.runtimeVersion !== VERSION || !['edit', 'view'].includes(c.mode) ||
        typeof c.hasPayload !== 'boolean' || c.readOnly !== (c.mode === 'view') ||
        typeof c.databaseId !== 'string' || !c.databaseId || typeof c.dataType !== 'string' || !c.dataType ||
        !Number.isInteger(c.schemaVersion) || c.schemaVersion < 1 || !Number.isInteger(c.baseRevision) || c.baseRevision < 0 ||
        (c.mode === 'edit' && (typeof c.sessionId !== 'string' || !c.sessionId)) ||
        (c.hasPayload && !Object.prototype.hasOwnProperty.call(c, 'payload'))) {
      throw new Error('Excelの起動情報を確認できません。共有の正本から開き直してください。');
    }
    return c;
  }
  function createController(input, options) {
    var context = validateContext(input), opts = options || {};
    var phase = 'loading', adapter, lastOutput = null, inFlight = false;
    var sequence = { exportSequence: 0, lastSaveDataId: null };
    function emit(message) { if (opts.onChange) opts.onChange({ phase: phase, message: message, lastOutput: lastOutput }); }
    function initialData(factory) { return context.hasPayload ? snapshot(context.payload) : factory(); }
    async function connect(value) {
      if (adapter) throw new Error('ExcelGate.connectは一度だけ呼んでください。');
      adapter = value;
      try {
        if (!adapter || typeof adapter.load !== 'function' || typeof adapter.exportData !== 'function') throw new Error('アプリのデータ接続がありません。');
        if (context.readOnly) {
          if (typeof adapter.setReadOnly !== 'function') throw new Error('このアプリは閲覧専用に対応していません。');
          if (await adapter.setReadOnly(true) === false) throw new Error('閲覧専用に切り替えられませんでした。');
        }
        // ready must include ALL asynchronous restoration performed by the app.
        if (adapter.ready) await adapter.ready;
        var loaded = await adapter.load(context.hasPayload ? snapshot(context.payload) : undefined, { hasPayload: context.hasPayload, readOnly: context.readOnly });
        if (loaded === CANCEL || loaded === false) throw new Error('データの読み込みが中止されました。');
        phase = context.readOnly ? 'view' : 'editing';
        emit(context.readOnly ? '正式保存済みデータの閲覧専用です。' : 'Excelから読み込みました。正式保存はExcelで行います。');
      } catch (error) { phase = 'error'; emit(error.message); throw error; }
    }
    async function exportFile(authorName, kind) {
      if (phase !== 'editing' || inFlight) throw new Error('現在は出力できません。');
      inFlight = true;
      try {
        var author = core.normalizeAuthorName(context.authorRequired === false ? '記名なし' : authorName);
        var payload = await adapter.exportData();
        if (payload === CANCEL) { emit('出力を中止しました。編集を続けられます。'); return null; }
        var envelope = core.createEnvelope(context, sequence, author, kind || 'workCopy', snapshot(payload));
        var text = JSON.stringify(envelope, null, 2);
        if (new TextEncoder().encode(text).length > 10485760) throw new Error('受け渡しファイルは10MiB以下にしてください。');
        var output = Object.freeze({ text: text, fileName: core.makeFileName(envelope), envelope: envelope });
        await opts.download(output);
        // Do not advance on adapter failure, cancellation, serialization or download failure.
        sequence = { exportSequence: envelope.exportSequence, lastSaveDataId: envelope.saveDataId };
        lastOutput = output;
        if (kind === 'complete') phase = 'exported';
        emit('受け渡しファイルのダウンロードを開始しました。Excelで正式保存してください。');
        return output;
      } catch (error) { emit(error.message); throw error; }
      finally { inFlight = false; }
    }
    async function redownload() {
      if (!lastOutput) throw new Error('再出力できるファイルはありません。');
      await opts.download(lastOutput);
      return lastOutput;
    }
    return { connect: connect, exportFile: exportFile, redownload: redownload, initialData: initialData,
      state: function () { return { phase: phase, exportSequence: sequence.exportSequence, hasOutput: !!lastOutput, inFlight: inFlight }; } };
  }
  function mount(win) {
    var linked = win.__EXCEL_GATE_REQUIRED__ === true || Object.prototype.hasOwnProperty.call(win, '__EXCEL_GATE_CONTEXT__');
    var controller, startupError, ui, latestMessage = 'アプリの準備を待っています。';
    var connected = false, authorName = '', lastFocus, showingExit = false;
    var api = { version: VERSION, isLinked: linked, CANCEL: CANCEL, cancel: function () { return CANCEL; }, snapshot: snapshot };
    if (!linked) {
      api.initialData = function (factory) { return factory(); };
      api.connect = function () { return Promise.resolve(); };
      api.exportFile = function () { return Promise.reject(new Error('Excelから起動してください。')); };
      return api;
    }
    function download(output) {
      var blob = new win.Blob([output.text], { type: 'application/json;charset=utf-8' });
      var url = win.URL.createObjectURL(blob), a = win.document.createElement('a');
      try {
        a.href = url; a.download = output.fileName; a.hidden = true;
        win.document.body.appendChild(a); a.click();
      } finally { a.remove(); win.setTimeout(function () { win.URL.revokeObjectURL(url); }, 10000); }
    }
    try {
      controller = createController(win.__EXCEL_GATE_CONTEXT__, { download: download, onChange: function (state) {
        latestMessage = state.message; render();
      } });
    } catch (e) { startupError = e; latestMessage = e.message; }
    api.initialData = function (factory) { if (startupError) throw startupError; return controller.initialData(factory); };
    api.connect = function (adapter) {
      connected = true;
      if (startupError) return Promise.reject(startupError);
      return controller.connect(adapter);
    };
    api.exportFile = async function (kind) {
      if (!ui || !controller) throw startupError || new Error('準備中です。');
      if (win.__EXCEL_GATE_CONTEXT__.authorRequired !== false && !authorName) {
        latestMessage = '上部の保存者名を入力してから出力してください。'; render(); ui.name.focus(); return null;
      }
      ui.work.disabled = ui.finish.disabled = true;
      try { return await controller.exportFile(authorName, kind || 'workCopy'); }
      finally { render(); }
    };
    function showModal() {
      if (!ui.dialog.open) { lastFocus = win.document.activeElement; ui.dialog.showModal(); }
    }
    function render() {
      if (!ui) return;
      var state = controller ? controller.state() : { phase: 'error' };
      ui.status.textContent = latestMessage;
      ui.work.disabled = ui.finish.disabled = state.phase !== 'editing' || state.inFlight;
      ui.again.hidden = !state.hasOutput;
      ui.nameLabel.hidden = state.phase === 'view' || !!(win.__EXCEL_GATE_CONTEXT__ && win.__EXCEL_GATE_CONTEXT__.authorRequired === false);
      ui.work.hidden = ui.finish.hidden = state.phase === 'view';
      if (state.phase === 'loading' || state.phase === 'error' || state.phase === 'exported') {
        ui.modalText.textContent = state.phase === 'exported'
          ? '出力はまだExcelへの正式保存ではありません。Excelへ戻り「受け渡しファイルを正式保存する」を押し、完了表示を確認してExcelを閉じてください。'
          : latestMessage;
        ui.retry.hidden = state.phase !== 'exported';
        ui.close.hidden = state.phase === 'loading';
        ui.modalTitle.textContent = state.phase === 'exported' ? 'Excelで正式保存してください' : state.phase === 'error' ? '起動を停止しました' : '読み込み中';
        showingExit = state.phase === 'exported';
        showModal();
      } else if (ui.dialog.open) { ui.dialog.close(); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
    }
    function createUI() {
      var host = win.document.createElement('excel-gate-panel'); host.id = 'excel-gate-panel';
      // The gate owns only this element. No app selectors or app CSS are modified.
      host.style.cssText = 'display:block;position:relative;z-index:1000;';
      win.document.body.insertBefore(host, win.document.body.firstChild);
      if (!host.attachShadow || typeof win.HTMLDialogElement === 'undefined' || !win.HTMLDialogElement.prototype.showModal) {
        startupError = new Error('このEdgeではExcelゲートを利用できません。');
        host.textContent = 'このEdgeではExcelゲートを利用できません。対応バージョンを確認してください。';
        host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:block;background:#edf4fa;padding:48px;font:18px sans-serif;';
        return;
      }
      var shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<style>:host{font:14px/1.6 "Yu Gothic UI",Meiryo,sans-serif;color:#17324d}*{box-sizing:border-box}header{background:#edf4fa;border-bottom:1px solid #b9cad8;padding:12px 24px;display:flex;flex-wrap:wrap;align-items:center;gap:10px}strong{font-size:16px}p{margin:4px 0}label{display:flex;align-items:center;gap:6px}input,button{font:inherit;border:1px solid #9baebb;border-radius:6px;padding:7px 11px}input{width:155px;background:white;color:#17324d}button{cursor:pointer;background:white;color:#17324d}button.primary{background:#1769aa;color:white;border-color:#1769aa}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible{outline:3px solid #e3a52c;outline-offset:2px}[hidden]{display:none!important}.status{flex-basis:100%;font-size:13px}dialog{color:#17324d;border:1px solid #b9cad8;border-radius:14px;padding:28px;width:min(560px,90vw);font:inherit;box-shadow:0 18px 60px #0003}dialog::backdrop{background:#e8eff8ed}h2{margin-top:0;font-size:22px}.actions{display:flex;gap:10px;margin-top:22px;flex-wrap:wrap}@media print{:host{display:none}}</style>' +
        '<header aria-label="Excelゲート"><strong>Excelゲート</strong><label id="name-label">保存者名 <input id="name" maxlength="50" autocomplete="off"></label><button id="work" class="primary" disabled>受け渡し用に出力</button><button id="finish" disabled>出力してExcelへ戻る</button><button id="again" hidden>同じファイルを再出力</button><p class="status" id="status" role="status"></p></header>' +
        '<dialog aria-labelledby="modal-title"><h2 id="modal-title"></h2><p id="modal-text"></p><div class="actions"><button id="retry" hidden>同じファイルを再出力</button><button id="close" hidden>画面を閉じる</button></div></dialog>';
      function get(id) { return shadow.getElementById(id); }
      ui = { dialog: shadow.querySelector('dialog'), name: get('name'), nameLabel: get('name-label'), work: get('work'), finish: get('finish'), again: get('again'), status: get('status'), modalText: get('modal-text'), modalTitle: get('modal-title'), retry: get('retry'), close: get('close') };
      ui.name.addEventListener('input', function () { authorName = ui.name.value; });
      function run(kind) { api.exportFile(kind).catch(function () {}); }
      ui.work.onclick = function () { run('workCopy'); }; ui.finish.onclick = function () { run('complete'); };
      ui.again.onclick = ui.retry.onclick = function () { controller.redownload().catch(function (error) { latestMessage = error.message; render(); }); };
      ui.dialog.addEventListener('cancel', function (event) { event.preventDefault(); });
      ui.close.onclick = function () { win.close(); ui.modalText.textContent += ' 自動で閉じない場合は、このタブを閉じてください。'; };
      render();
      win.setTimeout(function () { if (!connected) { startupError = new Error('アプリの接続が完了しませんでした。Excelから開き直してください。'); latestMessage = startupError.message; render(); ui.modalTitle.textContent = '起動を停止しました'; ui.close.hidden = false; } }, 15000);
    }
    if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', createUI); else createUI();
    win.addEventListener('beforeunload', function (event) {
      if (controller && controller.state().phase === 'editing' && !showingExit) { event.preventDefault(); event.returnValue = ''; }
    });
    return api;
  }
  return { VERSION: VERSION, CANCEL: CANCEL, snapshot: snapshot, validateContext: validateContext, createController: createController, mount: mount };
});
