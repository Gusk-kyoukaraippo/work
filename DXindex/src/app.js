(function () {
  'use strict';
  var C = window.DXCore;
  /* Capture before rendering, so exported files never contain live forms or unlocked DOM. */
  var pristineTemplate = document.documentElement.outerHTML;
  var activityMode = document.documentElement.getAttribute('data-dashboard-view') === 'activities';
  var state, unlocked = false, managing = false, changed = false, epoch = 0;
  var modalOpen = false, formDirty = false, modalReturnFocus = null, toastTimer;
  function $(id) { return document.getElementById(id); }
  function show(el, visible) { el.classList.toggle('hidden', !visible); }
  function node(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (typeof text !== 'undefined') el.textContent = text;
    return el;
  }
  function icon(name) {
    var paths = {
      browser: 'M3 4h18v16H3z M3 9h18 M7 6.5h.1 M10 6.5h.1 M7 13h4 M7 16h8',
      excel: 'M4 3h16v18H4z M4 8h16 M4 13h16 M4 17h16 M10 8v13',
      discover: 'M10 3a7 7 0 100 14 7 7 0 000-14 M15 15l6 6',
      note: 'M5 3h14v18H5z M9 8h6 M9 12h6 M9 16h3',
      chat: 'M4 4h16v12H10l-5 4v-4H4z M8 9h8 M8 12h5',
      plan: 'M4 5h16 M4 12h16 M4 19h16 M8 3v4 M16 10v4 M10 17v4',
      prototype: 'M12 3l9 5v9l-9 5-9-5V8z M3 8l9 5 9-5 M12 13v9',
      check: 'M9 5H4v16h16V5h-5 M9 3h6v4H9z M8 14l3 3 6-7',
      flag: 'M5 22V3 M5 3h7l2 2h6v10h-6l-2-2H5'
    };
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ui-icon');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    path.setAttribute('d', paths[name] || paths.browser); path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.7');
    path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path); return svg;
  }
  function append(parent, child) { parent.appendChild(child); return child; }
  function button(text, className, handler) {
    var el = node('button', 'button ' + (className || 'secondary'), text);
    el.type = 'button';
    if (handler) el.addEventListener('click', handler);
    return el;
  }
  function toast(message) {
    window.clearTimeout(toastTimer);
    $('toast').textContent = message;
    show($('toast'), true);
    toastTimer = window.setTimeout(function () { show($('toast'), false); }, 5500);
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function dateLabel(iso, time) {
    var d, pad = function (n) { return ('0' + n).slice(-2); };
    if (!iso) return '未出力';
    d = new Date(iso);
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + (time ? ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : '');
  }
  function guard() { if (!unlocked) { toast('内部向けパスワードで解除してください。'); return false; } return true; }
  function findItem(items, id) {
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }
  function setState(next) {
    state = C.normalize(next);
    changed = true;
    render();
  }
  function render() {
    show($('setupBanner'), !state.auth);
    $('internalButton').textContent = unlocked ? '外部向け表示に戻る' : state.auth ? '内部資料・管理画面を開く' : '初期設定';
    $('viewLabel').textContent = unlocked ? '内部向け表示' : '外部向け表示';
    $('viewLabel').classList.toggle('internal', unlocked);
    show($('manageButton'), unlocked);
    $('manageButton').textContent = managing ? '管理画面を閉じる' : activityMode ? '進捗を編集' : 'アプリ・進捗を編集';
    $('manageButton').setAttribute('aria-expanded', String(managing));
    show($('management'), unlocked && managing);
    show($('addApp'), unlocked && managing);
    show($('addProject'), unlocked && managing);
    $('publishedLabel').textContent = state.exportedAt ? '一覧の更新日時：' + dateLabel(state.exportedAt, true) : '登録データはありません';
    show($('changeNotice'), changed && unlocked);
    if (changed) $('changeNotice').textContent = 'この画面に変更があります。共有するには、管理画面から更新したHTMLを出力し、共有先の元ファイルを置き換えてください。';
    renderApps();
    renderProjects();
    renderStageGuide();
  }
  function emptyMessage(target, title, copy) {
    target.querySelector('h3').textContent = title;
    target.querySelector('p').textContent = copy;
  }
  function makeLink(text, path, className) {
    var href = C.toHref(path), el;
    if (!href) return node('span', (className || '') + ' pending', text + '（準備中）');
    el = node('a', className, text);
    el.setAttribute('href', href);
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
    return el;
  }
  function embeddedStageButton(index, text) {
    var el = button(text, 'secondary', function () { openStageDescription(index); });
    el.className = 'stage-detail-link stage-description-button';
    el.setAttribute('aria-label', '第' + (index + 1) + '段階「' + C.STAGES[index] + '」の説明を読む');
    return el;
  }
  function openStageDescription(index) {
    openModal('第' + (index + 1) + '段階：' + C.STAGES[index], function (parent) {
      append(parent, node('div', 'stage-description-body', state.stageDescriptions[index]));
      if (state.stageLinks[index].path) append(parent, stageLink(index, '関連する説明ページを開く ↗'));
      var actions = append(parent, node('div', 'form-actions'));
      if (index > 0) append(actions, button('前の段階', 'secondary', function () { closeModal(true); openStageDescription(index - 1); }));
      if (index < 7) append(actions, button('次の段階', 'secondary', function () { closeModal(true); openStageDescription(index + 1); }));
      append(actions, button('閉じる', 'primary', function () { closeModal(true); }));
    });
  }
  function editStageDescriptions() {
    if (!guard()) return;
    openModal('8段階の説明文を編集', function (parent) {
      append(parent, node('p', '', '説明文は外部向けにも表示されます。仮案を修正し、確定したら先頭の「仮の説明」の行も削除してください。'));
      var texts = state.stageDescriptions.slice(), summaries = state.stageSummaries.slice(), selected = 0, select, input, summary;
      var f = form(parent, function () {
        if (!guard()) return;
        texts[selected] = input.value; summaries[selected] = summary.value;
        var next = clone(state); next.stageDescriptions = texts; next.stageSummaries = summaries;
        setState(next); closeModal(true); toast('説明文を保存しました。共有するには更新したHTMLを出力してください。');
      });
      select = field(f, '編集する段階', 'select', 'descriptionStage', '0', C.STAGES.map(function (stage, index) { return [String(index), '第' + (index + 1) + '段階：' + stage]; }));
      summary = field(f, '一覧に常時表示する短い説明', 'textarea', 'stageSummaryText', summaries[0]); summary.maxLength = 240;
      help(summary, '何をする段階かを1〜2文で書いてください。240文字まで。');
      input = field(f, '詳しい説明文', 'textarea', 'stageDescriptionText', texts[0]); input.maxLength = 10000;
      select.addEventListener('change', function () { texts[selected] = input.value; summaries[selected] = summary.value; selected = Number(select.value); input.value = texts[selected]; summary.value = summaries[selected]; });
      help(input, '改行はそのまま表示されます。各段階10,000文字まで。保存すると、この画面で編集した全段階を反映します。');
      formActions(f, '説明文を保存');
    });
  }
  function stageLink(index, text) {
    var el = node('a', 'stage-detail-link', text);
    el.setAttribute('href', C.stageHref(state.stageLinks[index]));
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
    el.setAttribute('aria-label', '第' + (index + 1) + '段階「' + C.STAGES[index] + '」の詳しい説明を開く');
    return el;
  }
  function renderStageGuide() {
    var row, stageIcons = ['discover', 'note', 'chat', 'plan', 'prototype', 'browser', 'check', 'flag'];
    $('stageGuide').textContent = '';
    C.STAGES.forEach(function (stage, index) {
      if (index % 4 === 0) {
        var phase = append($('stageGuide'), node('div', 'guide-phase ' + (index === 0 ? 'phase-plan' : 'phase-deliver')));
        row = append(phase, node('ol', 'guide-row')); row.setAttribute('start', String(index + 1));
        row.setAttribute('aria-label', index === 0 ? '第1〜4段階' : '第5〜8段階');
      }
      var li = append(row, node('li', 'guide-step-' + (index + 1)));
      var top = append(li, node('div', 'guide-card-top'));
      var number = append(top, node('span', 'guide-stage-number', ('0' + (index + 1)).slice(-2)));
      number.setAttribute('aria-label', '第' + (index + 1) + '段階');
      append(append(top, node('span', 'guide-stage-icon')), icon(stageIcons[index]));
      var body = append(li, node('div', 'guide-step-body'));
      var title = append(body, node('h3', 'guide-stage-title'));
      if (index === 3) { append(title, node('span', 'stage-title-line', 'わけなぜシート修正・')); append(title, node('span', 'stage-title-line', 'アクションシート作成')); }
      else title.textContent = stage;
      append(body, node('p', 'stage-summary', state.stageSummaries[index]));
      var actions = append(body, node('div', 'stage-guide-actions'));
      append(actions, embeddedStageButton(index, '詳しい説明'));
      if (state.stageLinks[index].path) append(actions, stageLink(index, '関連ページを開く ↗'));
    });
  }
  function editStageLinks() {
    if (!guard()) return;
    openModal('8段階の説明リンクを設定', function (parent) {
      append(parent, node('p', '', '各段階の説明ページを指定してください。登録したリンクは外部向けにも表示されます。空欄の場合も、内蔵の説明文は表示されます。'));
      var f = form(parent, function () {
        if (!guard()) return;
        var next = clone(state);
        next.stageLinks = C.STAGES.map(function (stage, index) {
          return { path: $('stagePath' + index).value, anchor: $('stageAnchor' + index).value };
        });
        setState(next); closeModal(true); toast('説明リンクを更新しました。共有するには更新したHTMLを出力してください。');
      });
      C.STAGES.forEach(function (stage, index) {
        var group = append(f, node('fieldset', 'stage-link-fields'));
        append(group, node('legend', '', '第' + (index + 1) + '段階：' + stage));
        var input = field(group, '説明ページの場所', 'text', 'stagePath' + index, state.stageLinks[index].path);
        input.maxLength = 2000;
        help(input, '例：./資料/DXの進め方.html（共有パス・Web URLも使用できます）');
        input = field(group, 'ページ内の見出しID（任意）', 'text', 'stageAnchor' + index, state.stageLinks[index].anchor);
        input.maxLength = 200;
        help(input, 'ページの途中へ開く場合のみ、リンク先の見出しIDを入力します。例：step-' + (index + 1) + '（先頭の # は不要）');
      });
      formActions(f, '説明リンクを保存');
    });
  }
  function appAccent(id) {
    /* Derive the accent from the saved ID, never the name, order or launch type. */
    var hash = 0, i;
    for (i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return 'app-accent-' + (hash % 4);
  }
  function renderApps() {
    var query = C.trim($('appSearch').value).toLowerCase(), count = 0;
    var sorted = state.apps.map(function (item, index) { return { item: item, index: index }; });
    sorted.sort(function (a, b) { return a.item.order - b.item.order || a.index - b.index; });
    $('appList').textContent = '';
    sorted.forEach(function (entry) {
      var app = entry.item, card, top, foot, primary, actions, edit;
      if ((app.name + ' ' + app.description).toLowerCase().indexOf(query) === -1) return;
      count++;
      card = node('article', 'app-card');
      card.setAttribute('data-app-id', app.id);
      card.className += app.kind === 'excel' ? ' excel-app' : ' html-app';
      top = append(card, node('div', 'app-card-top'));
      append(append(top, node('span', 'app-icon ' + appAccent(app.id))), icon(app.kind === 'excel' ? 'excel' : 'browser'));
      append(top, node('h3', '', app.name));
      append(card, node('p', 'app-description', app.description || '説明はまだ登録されていません。'));
      foot = append(card, node('div', 'app-card-foot'));
      if (app.path) {
        if (app.kind === 'excel') {
          primary = workbookLink(app, 'ブックを開く', 'app-open');
          if (!primary) {
            primary = button('ブックを開く', '', function () { openWorkbook(app); });
            primary.className = 'app-open';
            primary.setAttribute('aria-haspopup', 'dialog');
          }
        } else primary = makeLink('アプリを開く', app.path, 'app-open');
        append(primary, node('span', '', '↗')).setAttribute('aria-hidden', 'true');
        primary.setAttribute('aria-label', app.name + '：' + (app.kind === 'excel' ? 'ブックを開く' : 'アプリを開く'));
      } else primary = node('span', 'app-open pending', '準備中');
      append(foot, primary);
      if (app.kind === 'excel' && app.path) {
        var launchHelp = button('開かないとき・初回設定', '', function () { openWorkbook(app); });
        launchHelp.className = 'small-link workbook-help';
        launchHelp.setAttribute('aria-label', app.name + '：開かないとき・初回設定');
        append(foot, launchHelp);
      }
      if (unlocked && managing) {
        actions = append(foot, node('div', 'card-subactions'));
        edit = button('編集', '', function () { editApp(app.id); });
        edit.className = 'edit-button';
        edit.setAttribute('aria-label', app.name + 'を編集');
        append(actions, edit);
      }
      append($('appList'), card);
    });
    $('appCount').textContent = state.apps.length + '件';
    show($('appEmpty'), !count);
    emptyMessage($('appEmpty'), state.apps.length ? '条件に合うアプリがありません' : 'アプリはまだ登録されていません', state.apps.length ? '検索欄の文字を消すと、すべてのアプリを表示します。' : unlocked && managing ? '上の「＋ アプリを登録」ボタンから登録してください。' : '管理担当者が登録すると、ここからアプリを開けます。');
  }
  function renderProjects() {
    var query = C.trim($('projectSearch').value).toLowerCase(), status = $('statusFilter').value, shown = 0;
    var totals = { all: state.projects.length, active: 0, paused: 0, completed: 0 };
    $('projectList').textContent = '';
    state.projects.forEach(function (project) {
      totals[project.status]++;
      if (project.name.toLowerCase().indexOf(query) === -1 || (status && status !== project.status)) return;
      shown++;
      var card = node('article', 'project-card'), top, meta, current, track, i, li, internal, line, docs, edit;
      card.setAttribute('data-project-id', project.id);
      card.className += ' project-' + project.status;
      top = append(card, node('div', 'project-top'));
      append(top, node('h3', '', project.name));
      meta = append(top, node('div', 'project-top-meta'));
      append(meta, node('span', 'status-badge ' + project.status, C.STATUS[project.status]));
      append(meta, node('time', 'updated-at', '進捗更新 ' + dateLabel(project.updatedAt, false))).setAttribute('datetime', project.updatedAt);
      if (unlocked && managing) {
        edit = button('編集', '', function () { editProject(project.id); });
        edit.className = 'edit-button'; edit.setAttribute('aria-label', project.name + 'を編集'); append(meta, edit);
      }
      current = append(card, node('div', 'current-stage'));
      append(current, node('span', 'stage-fraction', '現在の段階（' + project.stage + ' / 8）'));
      append(current, node('strong', '', C.STAGES[project.stage - 1]));
      append(current, embeddedStageButton(project.stage - 1, 'この段階の説明を読む'));
      track = append(card, node('ol', 'progress-track'));
      track.setAttribute('aria-label', '現在の段階：' + C.STAGES[project.stage - 1]);
      for (i = 1; i <= 8; i++) {
        li = append(track, node('li', i < project.stage ? 'done' : i === project.stage ? 'current' : '', C.SHORT_STAGES[i - 1]));
        if (i === 4) { li.textContent = ''; append(li, node('span', 'stage-word', '修正・')); append(li, node('span', 'stage-word', 'アクション')); }
        li.setAttribute('data-step', String(i));
        li.setAttribute('title', i + '. ' + C.STAGES[i - 1]);
        if (i === project.stage) li.setAttribute('aria-current', 'step');
      }
      var progressNote = append(card, node('div', 'progress-note'));
      append(progressNote, node('p', 'description-label', '最近の進捗'));
      append(progressNote, node('p', 'public-note', project.publicNote || '進捗の説明はまだ登録されていません。'));
      if (unlocked) {
        internal = append(card, node('div', 'project-internal'));
        line = append(internal, node('dl', 'internal-line'));
        append(line, node('dt', '', '担当者')); append(line, node('dd', '', project.leader || '未登録'));
        line = append(internal, node('dl', 'internal-line'));
        append(line, node('dt', '', '内部メモ')); append(line, node('dd', '', project.internalNote || '未登録'));
        docs = append(internal, node('div', 'document-links'));
        docs.setAttribute('aria-label', '内部向け資料リンク');
        if (!project.documents.length) append(docs, node('span', 'updated-at', '資料リンクはまだありません'));
        project.documents.forEach(function (doc) { append(docs, makeLink(doc.name, doc.path, 'document-link')); });
      }
      append($('projectList'), card);
    });
    $('projectStats').textContent = '';
    [['all', 'すべてのプロジェクト'], ['active', '進行中'], ['paused', '保留'], ['completed', '完了']].forEach(function (entry) {
      var stat = append($('projectStats'), node('div', 'stat ' + entry[0]));
      append(stat, node('p', 'stat-label', entry[1]));
      append(append(stat, node('p', 'stat-value', String(totals[entry[0]]))), node('small', '', '件'));
    });
    $('projectCount').textContent = state.projects.length + '件';
    $('projectResults').textContent = shown + ' 件を表示';
    show($('projectEmpty'), !shown);
    emptyMessage($('projectEmpty'), state.projects.length ? '条件に合うプロジェクトがありません' : 'プロジェクトはまだ登録されていません', state.projects.length ? '検索欄を空にして状態を「すべて」にすると、全件を表示します。' : unlocked && managing ? '上の「＋ プロジェクトを登録」ボタンから登録してください。' : '管理担当者が登録すると、各プロジェクトの進行状況を確認できます。');
  }
  function openModal(title, builder) {
    if (modalOpen && !closeModal(false)) return;
    modalReturnFocus = document.activeElement;
    $('modalTitle').textContent = title;
    $('modalContent').textContent = '';
    formDirty = false; modalOpen = true;
    builder($('modalContent'));
    show($('modalOverlay'), true);
    document.body.style.overflow = 'hidden';
    $('app').setAttribute('aria-hidden', 'true');
    var first = $('modalContent').querySelector('input:not([readonly]),select,textarea:not([readonly]),button,a[href]');
    (first || $('modal')).focus();
  }
  function closeModal(force) {
    if (!modalOpen) return true;
    if (!force && formDirty && !window.confirm('入力中の内容を破棄して閉じますか？')) return false;
    show($('modalOverlay'), false);
    $('modalContent').textContent = '';
    document.body.style.overflow = '';
    $('app').removeAttribute('aria-hidden');
    modalOpen = false; formDirty = false;
    if (modalReturnFocus && document.documentElement.contains(modalReturnFocus)) modalReturnFocus.focus();
    return true;
  }
  function field(parent, label, type, id, value, options) {
    var wrap = append(parent, node('label', 'field')), input, i, choice;
    append(wrap, node('span', '', label));
    if (type === 'select') {
      input = node('select');
      for (i = 0; i < options.length; i++) {
        choice = append(input, node('option', '', options[i][1])); choice.value = options[i][0];
      }
    } else { input = node(type === 'textarea' ? 'textarea' : 'input'); if (type !== 'textarea') input.type = type; }
    input.id = id; input.name = id;
    if (type === 'password') input.setAttribute('autocomplete', 'off');
    else if (type !== 'select') input.setAttribute('autocomplete', 'off');
    input.value = value === undefined || value === null ? '' : value;
    append(wrap, input);
    return input;
  }
  function help(input, copy) { var el = append(input.parentNode, node('small', '', copy)); el.id = input.id + '-help'; input.setAttribute('aria-describedby', el.id); }
  function form(parent, submit) {
    var el = append(parent, node('form')), error = append(el, node('p', 'error-message hidden'));
    error.setAttribute('role', 'alert');
    el.addEventListener('input', function () { formDirty = true; });
    el.addEventListener('change', function () { formDirty = true; });
    el.addEventListener('submit', function (event) {
      event.preventDefault(); show(error, false);
      try { submit(); } catch (e) { error.textContent = e.message || '操作できませんでした。'; show(error, true); error.scrollIntoView(false); }
    });
    return el;
  }
  function formActions(parent, label, remove) {
    var actions = append(parent, node('div', 'form-actions')), save;
    if (remove) append(actions, button('削除', 'danger', remove));
    append(actions, button('キャンセル', 'secondary', function () { closeModal(false); }));
    save = append(actions, button(label, 'primary')); save.type = 'submit';
  }
  function passwordDialog(mode) {
    if (mode === 'change' && !guard()) return;
    if (mode === 'setup' && state.auth) return;
    openModal(mode === 'setup' ? '共通パスワードを設定' : mode === 'change' ? 'パスワードを変更' : '内部向けを開く', function (parent) {
      append(parent, node('p', '', mode === 'login' ? '内部メンバー共通のパスワードを入力してください。' : '内部資料の閲覧と管理画面に、同じパスワードを使います。4〜128文字で設定してください。'));
      var f = form(parent, function () {
        var value = $('passwordInput').value, next;
        if (mode === 'login') {
          if (!C.verifyPassword(value, state.auth)) { $('passwordInput').value = ''; $('passwordInput').focus(); throw new Error('パスワードが違います。'); }
          closeModal(true); unlocked = true; epoch++; render(); toast('内部向けを開きました。'); return;
        }
        if (mode === 'change' && !guard()) return;
        if (value !== $('passwordConfirm').value) throw new Error('確認用のパスワードが一致しません。');
        next = clone(state); next.auth = C.makeAuth(value);
        closeModal(true); unlocked = true; epoch++; if (mode === 'setup') managing = true;
        setState(next); toast('設定しました。共有するには更新したHTMLを出力してください。');
      });
      var input = field(f, mode === 'login' ? 'パスワード' : '新しいパスワード', 'password', 'passwordInput', '');
      input.required = true; input.maxLength = 128;
      if (mode !== 'login') {
        input = field(f, 'パスワードをもう一度', 'password', 'passwordConfirm', ''); input.required = true; input.maxLength = 128;
        append(f, node('p', 'form-help', '画面への簡易ロックです。HTML内の内部情報は暗号化されません。パスワードは安全な場所に控えてください。'));
      }
      formActions(f, mode === 'login' ? '内部向けを開く' : '設定する');
    });
  }
  function lock() {
    if (!closeModal(false)) return;
    unlocked = false; managing = false; epoch++;
    $('jsonFile').value = '';
    show($('toast'), false);
    render(); $('internalButton').focus();
  }
  function removeItem(collection, id) {
    var item, next;
    if (!guard()) return;
    item = findItem(state[collection], id);
    if (!item || !window.confirm('「' + item.name + '」を削除しますか？共有先にはHTMLを置き換えるまで反映されません。')) return;
    next = clone(state);
    next[collection] = next[collection].filter(function (entry) { return entry.id !== id; });
    closeModal(true); setState(next); toast('この画面から削除しました。');
  }
  function editApp(id) {
    if (!guard()) return;
    var existing = id ? findItem(state.apps, id) : null;
    if (id && !existing) return;
    var app = existing || { id: '', name: '', description: '', kind: 'excel', path: '', instructions: '', order: Math.min(99999, state.apps.length + 1) };
    openModal(existing ? 'アプリを編集' : 'アプリを登録', function (parent) {
      var f = form(parent, function () {
        if (!guard()) return;
        var next = clone(state), item = {
          id: existing ? existing.id : C.uid(), name: C.trim($('appName').value), description: $('appDescription').value,
          kind: $('appKind').value, path: $('appPath').value, instructions: $('appInstructions').value, order: Number($('appOrder').value)
        };
        if (item.kind === 'excel' && C.workbookProblem(item.path)) throw new Error(C.workbookProblem(item.path));
        if (existing) next.apps = next.apps.map(function (entry) { return entry.id === item.id ? item : entry; });
        else next.apps.push(item);
        next = C.normalize(next);
        closeModal(true); setState(next); toast(existing ? 'アプリの変更を反映しました。' : 'アプリを登録しました。');
      });
      var input = field(f, 'アプリ名（必須）', 'text', 'appName', app.name); input.required = true; input.maxLength = 100;
      input = field(f, 'このアプリでできること', 'textarea', 'appDescription', app.description); input.maxLength = 500; input.placeholder = '例：申し送りの内容を入力・確認できます。';
      var row = append(f, node('div', 'field-row'));
      field(row, '起動方式', 'select', 'appKind', app.kind, [['excel', 'ブックから使う（Excelゲートなど）'], ['html', 'HTMLを直接開く']]);
      input = field(row, '表示順（小さい順）', 'number', 'appOrder', app.order); input.min = '0'; input.max = '99999'; input.step = '1'; input.required = true;
      input = field(f, 'リンク先', 'text', 'appPath', app.path); input.maxLength = 2000; input.placeholder = './アプリ/業務ツール.xlsm';
      help(input, '');
      input = field(f, 'ブック内の操作手順・押すボタン名（内部向け）', 'textarea', 'appInstructions', app.instructions); input.maxLength = 1000; input.placeholder = '例：操作パネルの「閲覧する」を押してください。';
      help(input, '内部向けを解除すると、ブックの開き方案内にも表示します。');
      function toggleInstructions() {
        var excel = $('appKind').value === 'excel';
        show($('appInstructions').parentNode, excel);
        $('appPath').placeholder = excel ? './アプリ/引継ぎメモ/引継ぎメモ.xlsm' : './アプリ/申し送り.html';
        $('appPath-help').textContent = excel
          ? 'Excelゲートは、配置済みのアプリ一式にあるアプリ名.xlsmを指定します。Windowsの「パスのコピー」をそのまま貼り付けられます。このHTMLからの相対パスも使えます。共通原本のMVP8th.xlsmやruntime内のHTMLは指定しません。空欄なら「準備中」です。'
          : 'このHTMLからの相対パス、共有パス・Web URLが使えます。空欄なら「準備中」です。';
      }
      $('appKind').addEventListener('change', toggleInstructions); toggleInstructions();
      formActions(f, existing ? '変更を反映' : '登録する', existing ? function () { removeItem('apps', existing.id); } : null);
    });
  }
  function documentRow(container, doc) {
    var n = container.querySelectorAll('.document-row').length, row, input, suffix;
    if (n >= 30) { toast('資料リンクは30件まで登録できます。'); return; }
    suffix = C.uid();
    row = append(container, node('div', 'document-row'));
    input = field(row, '資料名（必須）', 'text', 'docName-' + suffix, doc.name); input.required = true; input.maxLength = 100; input.setAttribute('data-document-name', 'true');
    input = field(row, 'リンク先', 'text', 'docPath-' + suffix, doc.path); input.maxLength = 2000; input.placeholder = './資料/現状分析.xlsx'; input.setAttribute('data-document-path', 'true');
    var remove = button('この資料リンクを削除', '', function () { container.removeChild(row); formDirty = true; }); remove.className = 'remove-link'; append(row, remove);
  }
  function editProject(id) {
    if (!guard()) return;
    var existing = id ? findItem(state.projects, id) : null;
    if (id && !existing) return;
    var project = existing || { id: '', name: '', stage: 1, status: 'active', publicNote: '', leader: '', internalNote: '', documents: [] };
    openModal(existing ? 'プロジェクトを編集' : 'プロジェクトを登録', function (parent) {
      var f = form(parent, function () {
        if (!guard()) return;
        var next = clone(state), rows = $('documentRows').querySelectorAll('.document-row'), documents = [], i;
        for (i = 0; i < rows.length; i++) documents.push({ name: C.trim(rows[i].querySelector('[data-document-name]').value), path: rows[i].querySelector('[data-document-path]').value });
        var item = { id: existing ? existing.id : C.uid(), name: C.trim($('projectName').value), stage: Number($('projectStage').value), status: $('projectStatus').value, publicNote: $('projectPublicNote').value, leader: $('projectLeader').value, internalNote: $('projectInternalNote').value, updatedAt: new Date().toISOString(), documents: documents };
        /* Internal-only edits must not suggest that the public progress was updated. */
        if (existing && item.name === existing.name && item.stage === existing.stage && item.status === existing.status && item.publicNote === existing.publicNote) item.updatedAt = existing.updatedAt;
        if (existing) next.projects = next.projects.map(function (entry) { return entry.id === item.id ? item : entry; });
        else next.projects.push(item);
        next = C.normalize(next);
        closeModal(true); setState(next); toast(existing ? 'プロジェクトの変更を反映しました。' : 'プロジェクトを登録しました。');
      });
      var input = field(f, 'プロジェクト名（必須・外部にも表示）', 'text', 'projectName', project.name); input.maxLength = 100; input.required = true;
      field(f, '現在の段階', 'select', 'projectStage', project.stage, C.STAGES.map(function (stage, index) { return [String(index + 1), (index + 1) + '. ' + stage]; }));
      field(f, '状態', 'select', 'projectStatus', project.status, [['active', '進行中'], ['paused', '保留'], ['completed', '完了']]);
      input = field(f, '最近の進捗（外部にも表示）', 'textarea', 'projectPublicNote', project.publicNote); input.maxLength = 500; input.placeholder = '例：試作品を作成し、現場での検証を進めています。';
      input = field(f, '担当者（内部向け）', 'text', 'projectLeader', project.leader); input.maxLength = 100;
      input = field(f, '内部メモ', 'textarea', 'projectInternalNote', project.internalNote); input.maxLength = 2000;
      var docSection = append(f, node('section', 'document-editor'));
      append(docSection, node('h3', 'document-editor-heading', '資料リンク（内部向け・任意）'));
      var rows = append(docSection, node('div')); rows.id = 'documentRows';
      project.documents.forEach(function (doc) { documentRow(rows, doc); });
      append(docSection, button('＋ 資料リンクを追加', 'text-button', function () { documentRow(rows, { name: '', path: '' }); formDirty = true; }));
      formActions(f, existing ? '変更を反映' : '登録する', existing ? function () { removeItem('projects', existing.id); } : null);
    });
  }
  function resolvedLocation(path) {
    var a = document.createElement('a');
    a.href = path ? C.toHref(path) : window.location.href;
    if (!path) { a.hash = ''; a.search = ''; }
    return C.nativePath(a.href);
  }
  function workbookLink(app, label, className) {
    if (C.workbookProblem(app.path)) return null;
    var target = document.createElement('a'); target.href = C.toHref(app.path);
    var href = C.workbookLaunchHref(app.id, target.href);
    if (!href) return null;
    var link = node('a', className, label);
    link.href = href;
    link.addEventListener('click', function () { toast('ブックの起動を要求しました。開かない場合は「開かないとき・初回設定」を確認してください。'); });
    return link;
  }
  function openWorkbook(app) {
    openModal(app.name + '：ブックを開く', function (parent) {
      var problem = C.workbookProblem(app.path), link = document.createElement('a'), steps, actions, manual, retry;
      if (problem) {
        append(parent, node('p', 'error-message', problem));
        append(parent, node('p', 'form-help', '管理担当者が「アプリ・進捗を編集」から、このアプリのリンク先を修正してください。'));
        return;
      }
      link.href = C.toHref(app.path);
      if (link.protocol === 'file:') {
        retry = workbookLink(app, 'もう一度ブックを開く', 'button primary');
        if (retry) {
          append(parent, retry);
          append(parent, node('p', 'form-help', 'このPCの初回設定が済んでいれば、ボタンから元のブックを開きます。Edgeにアプリ起動の確認が出た場合は、内容を確認して開いてください。'));
        } else append(parent, node('p', 'form-help', '自動起動はWindows用です。Windowsで使う元ブックの共有パスを登録するか、共有先に配置したダッシュボードをWindowsで開いてください。'));
        append(parent, node('h3', 'workbook-note-title', 'このPCで初めて使うとき'));
        steps = append(parent, node('ol', 'steps-list'));
        append(steps, node('li', '', '配布一式の「Windows起動設定」フォルダにある「初回設定.cmd」を実行します。'));
        append(steps, node('li', '', '共有先の登録済みDXダッシュボード.htmlを選び、開くブックと表計算ソフトを確認して「このPCに登録」を押します。ExcelゲートはJUST Calcを使います。'));
        append(steps, node('li', '', 'ダッシュボードに戻り、「ブックを開く」を押します。'));
        append(parent, node('p', 'form-help', 'アプリの追加やリンク先の変更後は、更新HTMLを共有先へ配置し、このPCの登録も更新してください。起動できたかどうかは、開いたブックで確認します。'));
        manual = append(parent, node('details', 'workbook-manual'));
        append(manual, node('summary', '', '手動で元ブックを開く'));
        pathBox(manual, 'ブックの場所', C.nativePath(link.href), 'workbookLocation', 'ブックの場所をコピー');
        append(manual, node('p', '', 'JUST Calcのファイルを開く画面で、コピーした場所をファイル名欄に貼り付けて開けます。'));
        append(parent, node('p', '', 'ブックが開いたら「最新CSVで開く」、または「編集する」「閲覧する」を押します。「初回設定」だけが表示される場合は、導入担当者がExcelゲートの初回設定を行います。'));
      } else {
        append(parent, node('p', 'form-help', '登録先はWeb URLです。Excelゲートを使う場合は、管理担当者が共有フォルダの元ブックのパスを登録してください。Web上のダッシュボードでは、相対パスもWeb URLになります。'));
        pathBox(parent, '登録先URL（元ブックの保存場所ではありません）', link.href, 'workbookWebLocation', '登録先URLをコピー');
      }
      if (unlocked && app.instructions) {
        append(parent, node('h3', 'workbook-note-title', '登録済みの操作メモ（内部向け）'));
        append(parent, node('p', 'workbook-instructions', app.instructions));
      }
      append(parent, node('p', 'form-help', 'ブラウザからブックをダウンロードした場合、そのコピーは使わず、元の場所から開いてください。Excelゲートはブックと同梱フォルダを一緒に使います。'));
      actions = append(parent, node('div', 'form-actions'));
      append(actions, button('閉じる', 'secondary', function () { closeModal(true); }));
    });
  }
  function pathBox(parent, label, value, id, copyLabel) {
    var box = field(parent, label, 'textarea', id, value); box.readOnly = true; box.className = 'path-box'; box.rows = 3;
    var copyButton = append(parent, button(copyLabel || '保存場所をコピー', 'secondary', function () {
      var ok = false;
      box.focus(); box.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      toast(ok ? '保存場所をコピーしました。' : '選択された文字を Ctrl+C（Macでは ⌘C）でコピーしてください。');
    }));
    return copyButton;
  }
  function download(contents, type, filename) {
    var blob = new Blob([contents], { type: type }), url, a;
    if (navigator.msSaveOrOpenBlob) {
      if (navigator.msSaveOrOpenBlob(blob, filename) === false) throw new Error('ダウンロードを開始できませんでした。もう一度操作してください。');
      return;
    }
    url = URL.createObjectURL(blob);
    a = document.createElement('a'); a.href = url; a.download = filename;
    a.style.display = 'none'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  function snapshot() {
    var data = clone(state); data.exportedAt = new Date().toISOString(); return C.normalize(data);
  }
  function showDownloadInfo(kind, filename, retry) {
    openModal(kind === 'html' ? '更新したHTMLの出力を開始しました' : 'JSONバックアップの出力を開始しました', function (parent) {
      append(parent, node('p', '', 'ブラウザのダウンロード表示に「' + filename + '」があることを確認してください。'));
      if (kind === 'html') {
        append(parent, node('p', 'form-help', '共有先への反映はまだ完了していません。'));
        var ol = append(parent, node('ol', 'steps-list'));
        append(ol, node('li', '', 'ダウンロードしたHTMLを共有フォルダへ移し、元のHTMLと同じ名前で置き換えます。置き換え前のファイルは必要に応じて控えを残してください。'));
        append(ol, node('li', '', '相対リンクを維持するため、元のHTMLと同じ場所に置きます。ブラウザが「(1)」などを付けた場合は、元の名前に戻してください。'));
        append(ol, node('li', '', '配置したHTMLを開き直し、更新内容とリンクを確認します。閲覧中のメンバーにも再読み込みを案内してください。'));
        pathBox(parent, 'このHTMLを開いた場所（置き換え先）', resolvedLocation(''), 'publishLocation');
      } else append(parent, node('p', 'form-help', 'このバックアップには内部資料リンク・メモとパスワードの検証設定が含まれます。共有画面はまだ更新されていません。'));
      var actions = append(parent, node('div', 'form-actions'));
      append(actions, button('もう一度ダウンロード', 'secondary', function () { if (!guard()) return; try { retry(); toast('同じ内容のダウンロードを再開しました。'); } catch (e) { toast(e.message); } }));
      append(actions, button('閉じる', 'primary', function () { closeModal(true); }));
    });
  }
  function exportData(kind) {
    if (!guard()) return;
    try {
      var data = snapshot(), contents, filename, mime;
      if (kind === 'html') { contents = C.exportHTML(pristineTemplate, data); filename = activityMode ? 'DX活動ガイド.html' : 'DXダッシュボード.html'; mime = 'text/html;charset=utf-8'; }
      else { contents = JSON.stringify(data); filename = (activityMode ? 'DX活動ガイド' : 'DXダッシュボード') + '-backup-' + data.exportedAt.replace(/[-:]/g, '').slice(0, 15) + '.json'; mime = 'application/json;charset=utf-8'; }
      var retry = function () { download(contents, mime, filename); };
      retry(); showDownloadInfo(kind, filename, retry);
    } catch (e) { toast(e.message || '出力できませんでした。'); }
  }
  function restoreFile(file) {
    if (!guard() || !file) return;
    var startedEpoch = epoch;
    if (file.size > 10 * 1024 * 1024) { toast('10MiB以下のJSONファイルを選んでください。'); return; }
    var reader = new FileReader();
    reader.onerror = function () { if (unlocked && startedEpoch === epoch) toast('ファイルを読み込めませんでした。現在のデータは変更していません。'); };
    reader.onload = function () {
      if (!unlocked || startedEpoch !== epoch) return;
      try {
        var incoming = C.normalize(JSON.parse(String(reader.result).replace(/^\uFEFF/, '')));
        if (!incoming.auth) throw new Error('パスワード設定を含むバックアップを選んでください。');
        openModal('JSONバックアップから復元', function (parent) {
          append(parent, node('p', '', 'アプリ ' + incoming.apps.length + ' 件、プロジェクト ' + incoming.projects.length + ' 件 / 出力日時：' + dateLabel(incoming.exportedAt, true)));
          append(parent, node('p', 'form-help', '現在の内容とパスワード設定を、このバックアップの内容に置き換えます。復元後はロック状態に戻ります。共有先はHTMLを出力・配置するまで変更されません。'));
          var f = form(parent, function () {
            if (!guard() || startedEpoch !== epoch) return;
            if (!C.verifyPassword($('restorePassword').value, incoming.auth)) throw new Error('バックアップのパスワードが違います。');
            closeModal(true); unlocked = false; managing = false; epoch++;
            setState(incoming); $('internalButton').focus(); toast('復元しました。バックアップのパスワードで内部向けを開いてください。');
          });
          var input = field(f, 'このバックアップのパスワード', 'password', 'restorePassword', ''); input.required = true; input.maxLength = 128;
          formActions(f, '内容を置き換えて復元');
        });
      } catch (e) { toast('復元できませんでした：' + e.message + ' 現在のデータは変更していません。'); }
    };
    reader.readAsText(file, 'UTF-8');
  }
  function start() {
    if (document.documentMode || /MSIE|Trident\//.test(navigator.userAgent)) {
      show($('loading'), false); show($('browserNotice'), true); return;
    }
    try {
      if (!C || !window.sha256) throw new Error('必要な処理を読み込めませんでした。');
      state = C.normalize(JSON.parse($('dx-data').textContent));
      $('setupButton').addEventListener('click', function () { passwordDialog('setup'); });
      $('internalButton').addEventListener('click', function () { if (unlocked) lock(); else passwordDialog(state.auth ? 'login' : 'setup'); });
      $('manageButton').addEventListener('click', function () { if (guard()) { managing = !managing; render(); } });
      $('closeManagement').addEventListener('click', function () { managing = false; render(); $('manageButton').focus(); });
      $('editStageDescriptions').addEventListener('click', editStageDescriptions);
      $('editStageLinks').addEventListener('click', editStageLinks);
      $('changePassword').addEventListener('click', function () { passwordDialog('change'); });
      $('addApp').addEventListener('click', function () { editApp(null); });
      $('addProject').addEventListener('click', function () { editProject(null); });
      $('appSearch').addEventListener('input', renderApps);
      $('projectSearch').addEventListener('input', renderProjects);
      $('statusFilter').addEventListener('change', renderProjects);
      $('exportHtml').addEventListener('click', function () { exportData('html'); });
      $('exportJson').addEventListener('click', function () { exportData('json'); });
      $('importJson').addEventListener('click', function () { if (guard()) { $('jsonFile').value = ''; $('jsonFile').click(); } });
      $('jsonFile').addEventListener('change', function () { var file = this.files[0]; this.value = ''; restoreFile(file); });
      $('modalClose').addEventListener('click', function () { closeModal(false); });
      document.addEventListener('keydown', function (event) {
        if (!modalOpen) return;
        if (event.key === 'Escape' || event.keyCode === 27) { event.preventDefault(); closeModal(false); return; }
        if (event.key !== 'Tab' && event.keyCode !== 9) return;
        var all = $('modal').querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]'), eligible = [], i, current = document.activeElement;
        for (i = 0; i < all.length; i++) if (!all[i].disabled && all[i].getClientRects().length) eligible.push(all[i]);
        if (!eligible.length) { event.preventDefault(); $('modal').focus(); return; }
        if (event.shiftKey && (current === eligible[0] || current === $('modal'))) { event.preventDefault(); eligible[eligible.length - 1].focus(); }
        else if (!event.shiftKey && (current === eligible[eligible.length - 1] || eligible.indexOf(current) === -1)) { event.preventDefault(); eligible[0].focus(); }
      });
      window.addEventListener('beforeunload', function (event) {
        if (changed || formDirty) { event.preventDefault(); event.returnValue = '更新したHTMLまたはJSONの出力と、必要な共有先への配置を確認してください。'; return event.returnValue; }
      });
      render(); show($('loading'), false); show($('app'), true);
    } catch (error) {
      show($('loading'), false); show($('app'), false); $('bootErrorText').textContent = error.message; show($('bootError'), true);
    }
  }
  start();
}());
