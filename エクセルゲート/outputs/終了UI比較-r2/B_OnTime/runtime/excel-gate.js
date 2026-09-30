(function (root, factory) {
  'use strict';
  var core = typeof module === 'object' && module.exports ? require('./excel-gate-core.js') : root.ExcelGateCore;
  var library = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = library;
  if (root.document) {
    if (root.__EXCEL_GATE_DIRECT_PENDING__) {
      root.__EXCEL_GATE_BOOT_READY__ = root.__EXCEL_GATE_DIRECT_PENDING__.then(function () {
        root.ExcelGate = library.mount(root);
      }, function () {
        root.__EXCEL_GATE_CONTEXT__ = { invalid: true };
        root.ExcelGate = library.mount(root);
      });
    } else root.ExcelGate = library.mount(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';
  var VERSION = '0.9.0';
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
    if (c.displayName !== undefined && (typeof c.displayName !== 'string' || !c.displayName.trim() || [...c.displayName].length > 256 || /[\x00-\x1f\x7f]/.test(c.displayName))) throw new Error('アプリ名を確認できません。');
    if (c.accentColor !== undefined && !/^#[0-9a-f]{6}$/i.test(c.accentColor)) throw new Error('アプリの表示色を確認できません。');
    c.dataSource = c.dataSource === undefined ? 'workbook' : c.dataSource;
    c.exitMode = c.exitMode === undefined ? 'manual' : c.exitMode;
    if (!['manual','onTime','waitLoop'].includes(c.exitMode)) throw new Error('終了方式を確認できません。ブックから開き直してください。');
    if (!['workbook', 'csvFolder'].includes(c.dataSource) ||
        (c.dataSource === 'csvFolder' && (c.mode !== 'view' || !c.readOnly || c.hasPayload || Object.prototype.hasOwnProperty.call(c, 'payload')))) {
      throw new Error('CSVフォルダの起動情報を確認できません。ブックから開き直してください。');
    }
    return c;
  }
  function validateSource(input, FileType) {
    function fail(detail) { throw new Error('CSVの受け渡しデータを確認できません。' + detail + ' ブックから開き直してください。'); }
    function timestamp(value) {
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value) && Number.isFinite(Date.parse(value));
    }
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        typeof input.sourcePath !== 'string' || !input.sourcePath.trim() || input.sourcePath.length > 32767 || /[\x00-\x1f]/.test(input.sourcePath) ||
        !timestamp(input.readAt) || !Array.isArray(input.files) || input.files.length > 1000) fail('読込元またはファイル一覧が不正です。');
    var names = new Set(), total = 0;
    // Validate the whole manifest before decoding any bytes or calling an app.
    var manifest = input.files.map(function (file) {
      if (!file || typeof file !== 'object' || typeof file.name !== 'string' || !file.name || file.name.length > 255 ||
          /[\\/:*?"<>|\x00-\x1f]/.test(file.name) || !/\.csv$/i.test(file.name) || names.has(file.name.toLowerCase()) ||
          !Number.isSafeInteger(file.size) || file.size < 0 || !timestamp(file.lastModified) || typeof file.base64 !== 'string') fail('ファイル名・サイズ・更新日時が不正です。');
      total += file.size;
      if (total > 50 * 1024 * 1024) fail('CSVは合計50MiB以下にしてください。');
      if (file.base64.length !== 4 * Math.ceil(file.size / 3)) fail('CSVのバイト数が一致しません。');
      names.add(file.name.toLowerCase());
      return { name: file.name, size: file.size, lastModified: file.lastModified, base64: file.base64 };
    });
    var files = manifest.map(function (file) {
      // A canonical alphabet/padding check also rejects whitespace and truncated input.
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) fail(file.name + ' の内容が不正です。');
      var binary;
      try { binary = atob(file.base64); } catch (_) { fail(file.name + ' の内容が不正です。'); }
      if (binary.length !== file.size || btoa(binary) !== file.base64) fail(file.name + ' のバイト数または内容が不正です。');
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new FileType([bytes], file.name, { type: 'text/csv', lastModified: Date.parse(file.lastModified) });
    });
    return {
      files: Object.freeze(files),
      info: Object.freeze({ sourcePath: input.sourcePath, readAt: input.readAt, readOnly: true,
        files: Object.freeze(manifest.map(function (file) { return Object.freeze({ name: file.name, size: file.size, lastModified: file.lastModified }); })) })
    };
  }
  function createController(input, options) {
    var context = validateContext(input), opts = options || {};
    var csvFolder = context.dataSource === 'csvFolder';
    var source = csvFolder ? validateSource(opts.source, opts.File || globalThis.File) : null;
    var phase = 'loading', adapter, lastOutput = null, inFlight = false;
    var sequence = { exportSequence: 0, lastSaveDataId: null };
    function emit(message) { if (opts.onChange) opts.onChange({ phase: phase, message: message, lastOutput: lastOutput }); }
    function initialData(factory) { return context.hasPayload ? snapshot(context.payload) : factory(); }
    function assertEditable() {
      if (phase === 'editing') return true;
      var messages = {
        loading: '読み込み中は変更できません。準備が終わるまでお待ちください。',
        view: '閲覧専用では変更できません。',
        exporting: '保存用ファイルの出力中は変更できません。',
        exported: '入力を終えたため変更できません。画面の案内に沿って保存して閉じてください。',
        error: '起動に失敗したため変更できません。ブックから開き直してください。'
      };
      var error = new Error(messages[phase] || '現在は変更できません。');
      error.code = 'EXCEL_GATE_NOT_EDITABLE';
      throw error;
    }
    async function connect(value) {
      if (adapter) throw new Error('ExcelGate.connectは一度だけ呼んでください。');
      adapter = value;
      try {
        if (!adapter || (csvFolder ? typeof adapter.loadSourceFiles !== 'function' : typeof adapter.load !== 'function' || typeof adapter.exportData !== 'function')) throw new Error('アプリのデータ接続がありません。');
        if (context.readOnly) {
          if (typeof adapter.setReadOnly !== 'function') throw new Error('このアプリは閲覧専用に対応していません。');
          if (await adapter.setReadOnly(true) === false) throw new Error('閲覧専用に切り替えられませんでした。');
        }
        // ready must include ALL asynchronous restoration performed by the app.
        if (adapter.ready) await adapter.ready;
        var loaded = csvFolder
          ? await adapter.loadSourceFiles(source.files, source.info)
          : await adapter.load(context.hasPayload ? snapshot(context.payload) : undefined, { hasPayload: context.hasPayload, readOnly: context.readOnly });
        if (loaded === CANCEL || loaded === false) throw new Error('データの読み込みが中止されました。');
        phase = context.readOnly ? 'view' : 'editing';
        emit(csvFolder
          ? (source.files.length ? '読込時点のCSV（' + source.files.length + '件）を閲覧しています。最新を見るにはブックの「最新CSVで開く」を押してください。' : 'データなし：登録フォルダにCSVがありません。')
          : context.readOnly ? 'ブックに保存された内容を閲覧しています。' : '作業が終わったら「アプリを終了して保存作業に移る」を押してください。次の操作をこの画面に表示します。');
      } catch (error) { phase = 'error'; emit(error.message); throw error; }
    }
    async function exportFile(authorName, kind) {
      if (csvFolder) throw new Error('CSVフォルダ閲覧型では保存用ファイルを出力できません。');
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
        // exportData may commit a draft. Freeze mutation only after its snapshot exists.
        phase = 'exporting';
        emit('保存用ファイルを出力しています。');
        await opts.download(output);
        // Do not advance on adapter failure, cancellation, serialization or download failure.
        sequence = { exportSequence: envelope.exportSequence, lastSaveDataId: envelope.saveDataId };
        lastOutput = output;
        phase = kind === 'complete' ? 'exported' : 'editing';
        emit(kind === 'complete'
          ? '編集を終了しました。画面の案内に沿って、ブックへの保存を続けてください。'
          : '途中保存の準備をしました。「' + (context.displayName || 'このアプリ') + '」のブックへ戻り「保存して続ける」を押してください。まだブックへの保存は完了していません。');
        return output;
      } catch (error) { if (phase === 'exporting') phase = 'editing'; emit(error.message); throw error; }
      finally { inFlight = false; }
    }
    async function redownload() {
      if (!lastOutput) throw new Error('再出力できるファイルはありません。');
      await opts.download(lastOutput);
      return lastOutput;
    }
    return { connect: connect, exportFile: exportFile, redownload: redownload, initialData: initialData, assertEditable: assertEditable,
      sourceInfo: function () { return source ? source.info : null; },
      state: function () { return { phase: phase, exportSequence: sequence.exportSequence, hasOutput: !!lastOutput, inFlight: inFlight }; } };
  }
  function mount(win) {
    var linked = win.__EXCEL_GATE_REQUIRED__ === true || Object.prototype.hasOwnProperty.call(win, '__EXCEL_GATE_CONTEXT__');
    var controller, startupError, ui, latestMessage = 'アプリの準備を待っています。';
    var connected = false, authorName = '', lastFocus, showingExit = false;
    var pendingKind, dialogMode, preparingExport = false;
    var handoff = 'none', handoffOutput, handoffTimer;
    var automatic = win.__EXCEL_GATE_CONTEXT__ && ['onTime','waitLoop'].includes(win.__EXCEL_GATE_CONTEXT__.exitMode);
    function waitForHandoff(output) {
      handoffOutput = output; handoff = 'waiting';
      win.clearTimeout(handoffTimer);
      handoffTimer = win.setTimeout(function () { if (handoff === 'waiting') { handoff = 'slow'; render(); } }, 30000);
      win.ExcelGateDirect.handoff(output, function (receipt) {
        var env = handoffOutput.envelope;
        if (receipt.state !== 'ready' || ['databaseId','sessionId','dataType','schemaVersion','baseRevision','saveDataId','exportSequence'].some(function (key) { return receipt[key] !== env[key]; })) return;
        handoff = 'ready'; win.clearTimeout(handoffTimer); render();
      });
    }
    var csvFolder = !!(win.__EXCEL_GATE_CONTEXT__ && win.__EXCEL_GATE_CONTEXT__.dataSource === 'csvFolder');
    var api = { version: VERSION, isLinked: linked, CANCEL: CANCEL, cancel: function () { return CANCEL; }, snapshot: snapshot };
    if (!linked) {
      api.assertEditable = function () { return true; };
      api.initialData = function (factory) { return factory(); };
      api.connect = function () { return Promise.resolve(); };
      api.exportFile = function () { return Promise.reject(new Error('Excelから起動してください。')); };
      return api;
    }
    var appName = 'このアプリ';
    function download(output) {
      var blob = new win.Blob([output.text], { type: 'application/json;charset=utf-8' });
      var url = win.URL.createObjectURL(blob), a = win.document.createElement('a');
      try {
        a.href = url; a.download = output.fileName; a.hidden = true;
        win.document.body.appendChild(a); a.click();
      } finally { a.remove(); win.setTimeout(function () { win.URL.revokeObjectURL(url); }, 10000); }
    }
    try {
      if (automatic && !win.ExcelGateDirect) throw new Error('終了の準備に必要な起動情報がありません。ブックから開き直してください。');
      controller = createController(win.__EXCEL_GATE_CONTEXT__, { source: win.__EXCEL_GATE_SOURCE__, File: win.File, download: download, onChange: function (state) {
        if (automatic && state.phase === 'exported' && state.lastOutput && handoff === 'none') waitForHandoff(state.lastOutput);
        latestMessage = state.message; render();
        if (win.ExcelGateDirect) { win.ExcelGateDirect.state(state.phase); if (state.phase === "error") win.ExcelGateDirect.error(state.message); }
      } });
    } catch (e) { startupError = e; latestMessage = e.message; }
    if (!startupError && typeof win.__EXCEL_GATE_CONTEXT__.displayName === 'string') appName = win.__EXCEL_GATE_CONTEXT__.displayName;
    api.assertEditable = function () { if (startupError) throw startupError; return controller.assertEditable(); };
    api.initialData = function (factory) { if (startupError) throw startupError; return controller.initialData(factory); };
    api.connect = function (adapter) {
      connected = true;
      if (startupError) return Promise.reject(startupError);
      return controller.connect(adapter).then(async function () {
        if (win.ExcelGateDirect) await win.ExcelGateDirect.ready();
      });
    };
    api.exportFile = async function (kind) {
      if (startupError || !ui || !controller) throw startupError || new Error('準備中です。');
      if (csvFolder) return controller.exportFile('', kind);
      if (controller.state().phase !== 'editing' || controller.state().inFlight) throw new Error('現在は出力できません。');
      if (win.__EXCEL_GATE_CONTEXT__.authorRequired !== false && !authorName) {
        pendingKind = kind || 'workCopy'; dialogMode = 'name';
        latestMessage = '保存者名を入力してください。この編集作業では一度入力すれば使い続けられます。';
        render(); ui.name.focus(); return null;
      }
      var output;
      preparingExport = true; dialogMode = 'state'; render();
      try {
        output = await controller.exportFile(authorName, kind || 'workCopy');
        if (output && kind !== 'complete') dialogMode = 'workCopy';
        return output;
      } finally {
        preparingExport = false;
        if (!output && controller.state().phase === 'editing') dialogMode = 'exportError';
        render();
      }
    };
    function showModal() {
      if (!ui.dialog.open) { lastFocus = win.document.activeElement; ui.dialog.showModal(); }
    }
    function render() {
      if (!ui) return;
      var state = controller ? controller.state() : { phase: 'error' };
      ui.status.textContent = state.phase === 'editing' && !state.hasOutput && !dialogMode
        ? '入力した内容は、このあと開いているブックで保存します。' : latestMessage;
      ui.work.disabled = ui.finish.disabled = state.phase !== 'editing' || state.inFlight;
      ui.again.hidden = !state.hasOutput;
      ui.work.hidden = ui.finish.hidden = csvFolder || state.phase === 'view';
      ui.more.hidden = csvFolder || state.phase === 'view' || !state.hasOutput;
      ui.editTitle.textContent = state.phase === 'view' ? '閲覧専用です' : '作業が終わったら、ここから保存作業へ';
      var isState = preparingExport || state.phase === 'loading' || state.phase === 'exporting' || state.phase === 'error' || state.phase === 'exported';
      var isName = !isState && dialogMode === 'name';
      var isWorkCopy = !isState && dialogMode === 'workCopy';
      var isExportError = !isState && dialogMode === 'exportError';
      if (isExportError) ui.editTitle.textContent = '保存の準備を完了できませんでした';
      ui.nameLabel.hidden = !isName;
      ui.next.hidden = !isName; ui.back.hidden = !(isName || isWorkCopy);
      ui.nameError.hidden = true;
      ui.retry.hidden = true; ui.close.hidden = true;
      ui.back.textContent = isName || isExportError ? '入力画面に戻る' : '保存後、入力画面に戻る';
      if (isName) {
        ui.modalTitle.textContent = 'まず、お名前を入力してください';
        ui.modalText.textContent = 'この編集作業では、一度入力すれば使い続けられます。';
      } else if (isWorkCopy) {
        ui.modalTitle.textContent = 'ブックで途中保存する';
        ui.modalText.textContent = '開いている「' + appName + '」のブックで「保存して続ける」を押してください。保存が終わったら、この画面で作業を続けられます。';
      } else if (isExportError) {
        ui.modalTitle.textContent = '保存の準備を完了できませんでした';
        ui.modalText.textContent = latestMessage;
      } else if (isState) {
        ui.modalText.textContent = state.phase === 'exported'
          ? (automatic
            ? handoff === 'ready'
              ? 'この作業タブを閉じてから、開いている「' + appName + '」のブックで「保存して閉じる」を押してください。ブックへの保存は、そこで完了します。'
              : handoff === 'slow'
                ? '準備に時間がかかっています。Edgeとブックは開いたまま「もう一度準備する」を押してください。進まない場合は管理担当に連絡してください。入力内容はこの画面に残っています。'
                : '終了の準備をしています。そのままお待ちください。'
            : '開いている「' + appName + '」のブックで「保存して閉じる」を押してください。保存後に、Edgeの作業タブを閉じる案内が出ます。この画面は開いたままにしてください。')
          : preparingExport ? '保存の準備をしています。そのままお待ちください。' : latestMessage;
        ui.retry.hidden = state.phase !== 'exported' || (automatic && handoff !== 'slow');
        ui.retry.textContent = automatic ? 'もう一度準備する' : '保存の準備をやり直す';
        ui.close.hidden = state.phase !== 'error' && !(state.phase === 'exported' && handoff === 'ready');
        ui.close.textContent = handoff === 'ready' ? 'この作業タブを閉じる' : '画面を閉じる';
        ui.modalTitle.textContent = state.phase === 'exported' ? (automatic ? handoff === 'ready' ? '保存の準備ができました' : handoff === 'slow' ? '準備を続けています' : '終了の準備中' : 'ブックで保存して閉じる') : state.phase === 'error' ? '起動を停止しました' : preparingExport || state.phase === 'exporting' ? '終了の準備中' : '読み込み中';
      }
      showingExit = state.phase === 'exported';
      if (isState || isName || isWorkCopy) showModal();
      else if (ui.dialog.open) { ui.dialog.close(); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
      ui.reserveSpace();
    }
    function createUI() {
      var host = win.document.createElement('excel-gate-panel'); host.id = 'excel-gate-panel';
      // Gate-owned viewport reserves space for the dock, including fixed app navigation.
      // Business selectors, source HTML and data remain unchanged.
      host.style.cssText = 'display:block;position:fixed;inset:auto 0 0;z-index:1000;';
      win.document.body.appendChild(host);
      if (!host.attachShadow || typeof win.HTMLDialogElement === 'undefined' || !win.HTMLDialogElement.prototype.showModal) {
        startupError = new Error('このEdgeではExcelゲートを利用できません。');
        host.textContent = 'このEdgeではExcelゲートを利用できません。対応バージョンを確認してください。';
        host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:block;background:#edf4fa;padding:48px;font:18px sans-serif;';
        return;
      }
      var shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<style>:host{font:15px/1.6 "Yu Gothic UI",Meiryo,sans-serif;color:#17324d}*{box-sizing:border-box}[hidden]{display:none!important}.dock{background:#edf4fa;border:0;border-top:1px solid #b9cad8;padding:20px 24px;min-height:160px;max-height:calc(100dvh - 100px);overflow:auto}h2{font-size:19px;font-weight:600;margin:0 0 4px;overflow-wrap:anywhere}p{margin:4px 0;overflow-wrap:anywhere}.status,#modal-text{font-size:14px;color:#405e77}.actions{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-top:16px;min-height:52px}.secondary-actions,.next-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.next-actions{margin-left:auto;justify-content:flex-end}label{display:flex;flex-direction:column;gap:4px;font-size:14px}input,button{font:inherit;border:1px solid #9baebb;border-radius:6px;padding:10px 14px;max-width:100%;min-height:44px}input{width:250px;min-width:0;font-size:16px;background:white;color:#17324d}button{cursor:pointer;background:transparent;color:#405e77;white-space:normal;overflow-wrap:anywhere}button.primary{background:#1769aa;color:white;border-color:#1769aa;min-height:52px;min-width:360px;padding:13px 18px;font-weight:600}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #e3a52c;outline-offset:2px}summary{cursor:pointer;font-size:13px}#name-error{color:#a12c28;font-size:14px}dialog.dock{position:fixed;inset:auto 0 0;margin:0;width:100%;max-width:none;font:inherit;color:#17324d;border-radius:0;box-shadow:none}dialog::backdrop{background:#17324d30}#app-title{display:none}#more{position:relative}#more[open]{padding:6px 10px;background:#edf4fa}#more button{margin-left:10px}#source-info{font-size:13px;margin-top:12px}@media(max-width:700px){.dock{padding:16px}.actions{flex-wrap:wrap;gap:12px}button.primary{min-width:0;flex:1}.next-actions{width:100%}#name-label{width:100%}input{width:100%}.next-actions #back{font-size:13px}h2{font-size:17px}}@media(max-width:430px){.next-actions{flex-direction:column-reverse;align-items:stretch}.next-actions #back{align-self:flex-start}button.primary{width:100%}}@media print{:host,dialog{display:none!important}}</style>' +
        '<footer class="dock" aria-label="保存と終了"><span id="app-title"></span><h2 id="edit-title">作業が終わったら、ここから保存作業へ</h2><p class="status" id="status" role="status"></p><div class="actions"><div class="secondary-actions"><button id="work" disabled>途中保存</button><details id="more" hidden><summary>前回の準備をやり直す</summary><button id="again" hidden>前回と同じ内容で準備する</button></details></div><div class="next-actions"><button id="finish" class="primary" disabled>アプリを終了して保存作業に移る</button></div></div></footer>' +
        '<dialog class="dock" aria-labelledby="modal-title" aria-describedby="modal-text"><h2 id="modal-title" aria-live="polite"></h2><p id="modal-text" aria-live="polite"></p><div class="actions"><label id="name-label" hidden>保存する人のお名前<input id="name" maxlength="50" autocomplete="off" aria-describedby="name-error"></label><div class="next-actions"><button id="back" hidden>入力画面に戻る</button><button id="next" class="primary" hidden>この名前で保存作業に進む</button><button id="retry" class="primary" hidden>保存の準備をやり直す</button><button id="close" class="primary" hidden>画面を閉じる</button></div></div><p id="name-error" role="alert" hidden></p></dialog>';
      shadow.getElementById('app-title').textContent = appName;
      if (!startupError && win.__EXCEL_GATE_CONTEXT__.accentColor) host.style.setProperty('--app-accent',win.__EXCEL_GATE_CONTEXT__.accentColor);
      function get(id) { return shadow.getElementById(id); }
      ui = { dialog: shadow.querySelector('dialog'), name: get('name'), nameLabel: get('name-label'), more: get('more'), work: get('work'), finish: get('finish'), again: get('again'), status: get('status'), modalText: get('modal-text'), modalTitle: get('modal-title'), retry: get('retry'), close: get('close'), editTitle: get('edit-title'), next: get('next'), back: get('back'), nameError: get('name-error') };
      var workspace = win.document.createElement('excel-gate-workspace'); workspace.id = 'excel-gate-workspace';
      workspace.style.cssText = 'display:block;position:fixed;inset:0 0 160px;overflow:auto;contain:layout;';
      Array.from(win.document.body.childNodes).forEach(function (node) { if (node !== host) workspace.appendChild(node); });
      win.document.body.insertBefore(workspace, host);
      var printStyle = win.document.createElement('style');
      printStyle.textContent = '@media print{#excel-gate-workspace{position:static!important;overflow:visible!important;contain:none!important}}';
      win.document.head.appendChild(printStyle);
      var observer = new win.MutationObserver(function (records) {
        records.forEach(function (record) { Array.from(record.addedNodes).forEach(function (node) {
          if (node.parentNode === win.document.body && node !== host && node !== workspace && !(node.nodeType === 1 && node.matches('a[download]'))) workspace.appendChild(node);
        }); });
      });
      observer.observe(win.document.body, { childList: true });
      ui.reserveSpace = function () {
        var dock = ui.dialog.open ? ui.dialog : shadow.querySelector('footer');
        var height = Math.ceil(dock.getBoundingClientRect().height);
        workspace.style.bottom = height + 'px';
      };
      if (win.ResizeObserver) { var resize = new win.ResizeObserver(ui.reserveSpace); resize.observe(shadow.querySelector('footer')); resize.observe(ui.dialog); }
      win.addEventListener('resize',ui.reserveSpace);
      if (csvFolder && controller) {
        var info = controller.sourceInfo(), details = win.document.createElement('details');
        details.id = 'source-info'; details.style.flexBasis = '100%';
        var summary = win.document.createElement('summary');
        summary.textContent = 'CSV読込日時：' + info.readAt + ' ／ 対象 ' + info.files.length + '件';
        details.appendChild(summary);
        var location = win.document.createElement('p'); location.textContent = '読込元：' + info.sourcePath; details.appendChild(location);
        var list = win.document.createElement('ul');
        info.files.forEach(function (file) { var item = win.document.createElement('li'); item.textContent = file.name + '（更新日時：' + file.lastModified + '）'; list.appendChild(item); });
        details.appendChild(list); shadow.querySelector('footer').appendChild(details);
      }
      ui.name.addEventListener('input', function () { authorName = ui.name.value.trim(); ui.nameError.hidden = true; ui.name.removeAttribute('aria-invalid'); });
      function run(kind) { api.exportFile(kind).catch(function () {}); }
      ui.work.onclick = function () { run('workCopy'); }; ui.finish.onclick = function () { run('complete'); };
      ui.next.onclick = function () {
        try { core.normalizeAuthorName(authorName); }
        catch (error) { ui.nameError.textContent = error.message; ui.nameError.hidden = false; ui.name.setAttribute('aria-invalid','true'); ui.name.focus(); ui.reserveSpace(); return; }
        run(pendingKind);
      };
      ui.name.addEventListener('keydown',function (event) { if (event.key === 'Enter') { event.preventDefault(); ui.next.click(); } });
      ui.back.onclick = function () { dialogMode = null; pendingKind = null; render(); };
      ui.again.onclick = ui.retry.onclick = function () {
        controller.redownload().then(function (output) { if (automatic && handoff !== 'none' && handoff !== 'ready') waitForHandoff(output); render(); })
          .catch(function (error) { latestMessage = error.message; render(); });
      };
      ui.dialog.addEventListener('cancel', function (event) { event.preventDefault(); if (dialogMode === 'name' || dialogMode === 'workCopy' || dialogMode === 'exportError') ui.back.click(); });
      ui.close.onclick = function () {
        if (win.ExcelGateDirect) win.ExcelGateDirect.close(); else win.close();
        ui.modalText.textContent = handoff === 'ready'
          ? 'この作業タブの×で閉じてください。閉じた後は、開いている「' + appName + '」のブックで「保存して閉じる」を押してください。'
          : 'この作業タブの×で閉じてから、ブックから開き直してください。';
      };
      render();
      if (startupError && win.ExcelGateDirect) win.ExcelGateDirect.error(startupError.message);
      win.setTimeout(function () { if (!connected) { startupError = new Error('アプリの接続が完了しませんでした。Excelから開き直してください。'); latestMessage = startupError.message; render(); ui.modalTitle.textContent = '起動を停止しました'; ui.close.hidden = false; } }, 15000);
    }
    if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', createUI); else createUI();
    win.addEventListener('beforeunload', function (event) {
      if (controller && ((controller.state().phase === 'editing' && !showingExit) || (automatic && handoff !== 'none' && handoff !== 'ready'))) { event.preventDefault(); event.returnValue = ''; }
    });
    win.addEventListener('pagehide', function () { win.clearTimeout(handoffTimer); });
    return api;
  }
  return { VERSION: VERSION, CANCEL: CANCEL, snapshot: snapshot, validateContext: validateContext, validateSource: validateSource, createController: createController, mount: mount };
});
