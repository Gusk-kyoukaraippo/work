/* File format and URL handling shared by the UI and offline tests. ES5 only. */
(function (root) {
  'use strict';
  var FORMAT = 'dx-team-dashboard';
  var STAGES = ['困りごとの発見', 'わけなぜシート作成', 'インタビュー', 'わけなぜシート修正・アクションシート作成', 'MVP作成', 'miharaDB掲載', 'ユーザー検証', '実務実装'];
  var SHORT_STAGES = ['発見', 'わけなぜ作成', 'インタビュー', '修正・アクション', 'MVP', 'DB掲載', '検証', '実装'];
  var DEFAULT_DESCRIPTIONS = ["【仮の説明・内容は今後見直します】\n\n目的\n日々の業務で困っていることを見つけ、改善するテーマを決めます。\n\n行うこと\n・誰が、どの場面で、何に困っているかを具体的に書き出します。\n・手間、待ち時間、入力ミスなど、実際に起きた事例を集めます。\n・影響の大きさや発生頻度を確認し、取り組むテーマを選びます。\n\n次の段階へ進む目安\n対象の業務と困りごとを、関係者に説明できる状態にします。", "【仮の説明・内容は今後見直します】\n\n目的\nわけなぜシートを作成し、困りごとの背景と原因の仮説を整理します。\n\n行うこと\n・現在の業務の流れと、問題が起きる場面を書き出します。\n・なぜ起きるのかを考え、確認できた事実と推測を分けて記入します。\n・分からないことを洗い出し、インタビューで確認する質問を用意します。\n\n次の段階へ進む目安\nわけなぜシートの初稿と、確認したい質問がそろった状態にします。", "【仮の説明・内容は今後見直します】\n\n目的\n実際に業務を行う人や関係者に話を聞き、シートに記載した仮説を確認します。\n\n行うこと\n・普段の業務の進め方と、困ったときの具体的な事例を聞きます。\n・担当者ごとの違いや、例外的な対応を確認します。\n・発言や観察した事実を記録し、仮説と異なる点を整理します。\n\n次の段階へ進む目安\n確認できた事実、認識の違い、追加で調べることが整理された状態にします。", "【仮の説明・内容は今後見直します】\n\n目的\nインタビュー結果をわけなぜシートに反映し、アクションシートで改善の進め方を決めます。\n\n行うこと\n・確認した事実に基づき、わけなぜシートの背景や原因を修正します。\n・目指す状態と、改善の効果を確認する方法を決めます。\n・アクションシートに対応内容、担当者、期限、優先順位を整理します。\n・最初に試す範囲を絞り、関係者と確認します。\n\n次の段階へ進む目安\n修正したわけなぜシートとアクションシートがそろい、最初に作るものが決まった状態にします。", "【仮の説明・内容は今後見直します】\n\n目的\n改善の効果を確かめるために、必要な機能に絞った試作品（MVP）を作ります。\n\n行うこと\n・最初に試す操作と、必要な入力・出力を決めます。\n・HTMLやExcelなど、対象業務に合う方法で試作品を作ります。\n・基本的な動作を確認し、操作方法と制限事項をまとめます。\n\n次の段階へ進む目安\n関係者が試せる試作品と、簡単な操作説明を用意します。", "【仮の説明・内容は今後見直します】\n\n目的\n試作品の情報をmiharaDBに掲載し、試す人が内容と使い方を確認できるようにします。\n\n行うこと\n・解決したい困りごと、対象者、できることをまとめます。\n・試作品の保存場所や起動方法、操作説明を記載します。\n・試用時の注意点と、意見を伝える連絡先を記載します。\n・掲載内容とリンクが正しく開くことを確認します。\n\n次の段階へ進む目安\n試す人が掲載情報から試作品へたどり着ける状態にします。掲載項目などの詳細は運用に合わせて調整します。", "【仮の説明・内容は今後見直します】\n\n目的\n対象の利用者に試してもらい、業務の困りごとが改善するかを確認します。\n\n行うこと\n・試す業務、期間、確認する項目を決めます。\n・操作の迷い、不具合、作業時間などを記録します。\n・利用者の意見と目標に対する結果を整理します。\n・必要な修正を行い、変更した点を再確認します。\n\n次の段階へ進む目安\n効果と残る課題を整理し、実務で使用する範囲と条件を関係者で確認します。", "【仮の説明・内容は今後見直します】\n\n目的\n検証した仕組みを実際の業務に取り入れ、継続して使える状態にします。\n\n行うこと\n・利用対象、保存場所、担当者、問い合わせ先を決めます。\n・操作手順と更新方法を整え、利用者へ案内します。\n・必要な引き継ぎを行い、運用開始後の状況を確認します。\n・効果と残る課題を記録し、次の改善につなげます。\n\n完了の目安\n担当者と運用手順が決まり、実際の業務で利用できる状態にします。プロジェクトの「完了」は別途状態として設定します。"];
  var DEFAULT_SUMMARIES = ["困りごとを見つけ、仲間を集めます。", "困りごとの原因を、わけなぜシートに整理します。", "現場に話を聞き、実態を確かめます。", "シートを見直し、実際の対応を練ります。", "必要な機能に絞り、試作品を作ります。", "miharaDB上で使えるよう編集します。", "利用者に試してもらい、効果と課題を確認します。", "実際の業務に導入し、運用を始めます。"];
  var STATUS = { active: '進行中', paused: '保留', completed: '完了' };
  function owns(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
  function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function trim(value) { return String(value).replace(/^\s+|\s+$/g, ''); }
  function str(value, label, max, required) {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(label + 'が正しくありません。');
    if (required && !trim(value)) throw new Error(label + 'を入力してください。');
    return value;
  }
  function integer(value, min, max, label) {
    if (typeof value !== 'number' || !isFinite(value) || Math.floor(value) !== value || value < min || value > max) throw new Error(label + 'が正しくありません。');
    return value;
  }
  function dateString(value, empty, label) {
    if (empty && value === '') return '';
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value) || isNaN(Date.parse(value))) throw new Error(label + 'が正しくありません。');
    return value;
  }
  function encodePath(path) {
    return path.split('/').map(function (part) { return encodeURIComponent(part); }).join('/');
  }
  function encodeURLPath(path) {
    return path.split('/').map(function (part) {
      try { return encodeURIComponent(decodeURIComponent(part)); }
      catch (error) { throw new Error('file URLの文字コードを確認してください。'); }
    }).join('/');
  }
  function cleanPath(value) {
    var path = trim(value);
    /* Windows Explorer's Copy as path encloses the complete path in quotes. */
    if (path.charAt(0) === '"' && path.charAt(path.length - 1) === '"') path = trim(path.slice(1, -1));
    if (path.charAt(0) === '"' || path.charAt(path.length - 1) === '"') throw new Error('リンク先の前後の引用符を確認してください。');
    return path;
  }
  /* Raw paths encode %, # and ? as filename characters; explicit URLs keep URL semantics. */
  function toHref(value) {
    var path = cleanPath(value), match, prefix, tail;
    if (!path) return '';
    if (/[\u0000-\u001f\u007f]/.test(path)) throw new Error('リンク先に改行や制御文字は使用できません。');
    if (/^https?:/i.test(path)) {
      if (!/^https?:\/\/[^\s\/?#\\]+(?:[\/?#][^\\]*)?$/i.test(path)) throw new Error('Web URLを確認してください。');
      return path;
    }
    if (/^file:/i.test(path)) {
      match = /^file:\/\/([^\/]*)(\/.*)$/i.exec(path.replace(/\\/g, '/'));
      if (!match || /[\s?#:@]/.test(match[1])) throw new Error('file URLを確認してください。');
      tail = match[2];
      if (/^\/[A-Za-z]:\//.test(tail)) return 'file://' + match[1] + tail.slice(0, 4) + encodeURLPath(tail.slice(4));
      return 'file://' + match[1] + encodeURLPath(tail);
    }
    path = path.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(path)) return 'file:///' + path.slice(0, 3) + encodePath(path.slice(3));
    if (/^\/\//.test(path)) {
      match = /^\/\/([^\/]+)\/(.+)$/.exec(path);
      if (!match || /[\s?#:@]/.test(match[1])) throw new Error('共有パスは「\\\\サーバー名\\共有名\\ファイル名」で入力してください。');
      return 'file://' + match[1] + '/' + encodePath(match[2]);
    }
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) || path.indexOf(':') !== -1) throw new Error('リンク先には相対パス、共有パス、http / https / file URLを指定してください。');
    prefix = path.charAt(0) === '/' ? 'file://' : '';
    return prefix + encodePath(path);
  }
  function pathValue(value, label) {
    value = cleanPath(str(value, label, 2000, false));
    toHref(value);
    return value;
  }
  function workbookProblem(value) {
    var href = toHref(value), filename;
    if (!href) return '';
    filename = /^https?:/i.test(href) ? href.split(/[?#]/)[0] : href;
    if (/\.zip$/i.test(filename)) return 'ZIPを展開し、配布フォルダ内のアプリ名.xlsmを指定してください。';
    if (!/\.(xls|xlsx|xlsm|xlsb|xlt|xltx|xltm)$/i.test(filename)) return 'ブックのファイルを指定してください。Excelゲートは、配布フォルダ内のアプリ名.xlsmを使います。';
    return '';
  }
  function windowsWorkbookPath(value) {
    var path = value.replace(/\//g, '\\'), root, parts, normalized = [], i, part;
    function validSegment(text) {
      return text && text !== '.' && text !== '..' && !/[<>:"|?*\u0000-\u001f\u007f]/.test(text) && !/[. ]$/.test(text) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(text);
    }
    if (!path || path.length > 2000) return '';
    if (/^[A-Za-z]:\\/.test(path)) { root = path.slice(0, 2); parts = path.slice(3).split('\\'); }
    else if (path.slice(0, 2) === '\\\\') {
      parts = path.slice(2).split('\\');
      if (parts.length < 3 || !validSegment(parts[0]) || !validSegment(parts[1])) return '';
      root = '\\\\' + parts.shift() + '\\' + parts.shift();
    } else return '';
    for (i = 0; i < parts.length; i++) {
      part = parts[i];
      if (!part || part === '.') continue;
      if (part === '..') { if (!normalized.length) return ''; normalized.pop(); }
      else { if (!validSegment(part)) return ''; normalized.push(part); }
    }
    if (!normalized.length || !/\.(xls|xlsx|xlsm|xlsb|xlt|xltx|xltm)$/i.test(normalized[normalized.length - 1])) return '';
    return root + '\\' + normalized.join('\\');
  }
  function workbookLaunchHref(id, absoluteFileURL) {
    identifier(id);
    if (!/^file:/i.test(absoluteFileURL)) return '';
    var path = windowsWorkbookPath(nativePath(absoluteFileURL));
    if (!path) return '';
    /* Only an app ID and a path fingerprint reach Windows; never an executable or shell command. */
    return 'dx-workbook://open/v1/' + id + '/' + root.sha256(path.replace(/[A-Z]/g, function (letter) { return letter.toLowerCase(); }));
  }
  function stageHref(link) {
    var href = toHref(link.path);
    return href && link.anchor ? href.replace(/#.*$/, '') + '#' + encodeURIComponent(link.anchor) : href;
  }
  function identifier(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value) || /[\r\n]/.test(value)) throw new Error('項目IDが正しくありません。');
    return value;
  }
  function utf8Size(text) {
    var total = 0, i, code, next;
    for (i = 0; i < text.length; i++) {
      code = text.charCodeAt(i);
      if (code < 128) total++;
      else if (code < 2048) total += 2;
      else {
        next = text.charCodeAt(i + 1);
        if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) { total += 4; i++; }
        else total += 3;
      }
    }
    return total;
  }
  function normalize(raw) {
    var result, seen = {}, i, item, id;
    if (!record(raw) || raw.format !== FORMAT || raw.schemaVersion !== 1) throw new Error('このダッシュボードのJSONではないか、対応していないバージョンです。');
    if (!Array.isArray(raw.apps) || raw.apps.length > 1000 || !Array.isArray(raw.projects) || raw.projects.length > 1000) throw new Error('アプリ・プロジェクト一覧が正しくありません（各1,000件まで）。');
    result = { format: FORMAT, schemaVersion: 1, exportedAt: dateString(raw.exportedAt, true, '出力日時'), auth: null, apps: [], projects: [] };
    if (owns(raw, 'stageSummaries')) {
      if (!Array.isArray(raw.stageSummaries) || raw.stageSummaries.length !== 8) throw new Error('段階の短い説明は8段階分を指定してください。');
      result.stageSummaries = raw.stageSummaries.map(function (text) { return str(text, '段階の短い説明', 240, true); });
    } else result.stageSummaries = DEFAULT_SUMMARIES.slice();
    if (owns(raw, 'stageDescriptions')) {
      if (!Array.isArray(raw.stageDescriptions) || raw.stageDescriptions.length !== 8) throw new Error('段階の説明文は8段階分を指定してください。');
      result.stageDescriptions = raw.stageDescriptions.map(function (text) { return str(text, '段階の説明文', 10000, true); });
    } else result.stageDescriptions = DEFAULT_DESCRIPTIONS.slice();
    if (owns(raw, 'stageLinks')) {
      if (!Array.isArray(raw.stageLinks) || raw.stageLinks.length !== 8) throw new Error('段階の説明リンクは8段階分を指定してください。');
      result.stageLinks = raw.stageLinks.map(function (link) {
        if (!record(link)) throw new Error('段階の説明リンクが正しくありません。');
        return { path: pathValue(link.path, '説明のリンク先'), anchor: trim(str(link.anchor, '説明ページ内の見出しID', 200, false)) };
      });
    } else result.stageLinks = STAGES.map(function () { return { path: '', anchor: '' }; });
    if (raw.auth !== null) {
      if (!record(raw.auth) || raw.auth.algorithm !== 'sha256-salt-v1' || !/^[a-f0-9]{32}$/.test(raw.auth.salt) || !/^[a-f0-9]{64}$/.test(raw.auth.hash)) throw new Error('パスワード設定が正しくありません。');
      result.auth = { algorithm: 'sha256-salt-v1', salt: raw.auth.salt, hash: raw.auth.hash };
    }
    for (i = 0; i < raw.apps.length; i++) {
      item = raw.apps[i];
      if (!record(item)) throw new Error('アプリ情報が正しくありません。');
      id = identifier(item.id);
      if (owns(seen, '$' + id)) throw new Error('項目IDが重複しています。');
      seen['$' + id] = true;
      if (item.kind !== 'html' && item.kind !== 'excel') throw new Error('アプリの起動方式が正しくありません。');
      result.apps.push({ id: id, name: str(item.name, 'アプリ名', 100, true), description: str(item.description, '説明', 500, false), kind: item.kind, path: pathValue(item.path, 'アプリのリンク先'), instructions: str(item.instructions, '操作手順', 1000, false), order: integer(item.order, 0, 99999, '表示順') });
    }
    for (i = 0; i < raw.projects.length; i++) {
      item = raw.projects[i];
      if (!record(item)) throw new Error('プロジェクト情報が正しくありません。');
      id = identifier(item.id);
      if (owns(seen, '$' + id)) throw new Error('項目IDが重複しています。');
      seen['$' + id] = true;
      if (!owns(STATUS, item.status)) throw new Error('プロジェクトの状態が正しくありません。');
      if (!Array.isArray(item.documents) || item.documents.length > 30) throw new Error('資料リンクは1プロジェクトにつき30件までです。');
      result.projects.push({ id: id, name: str(item.name, 'プロジェクト名', 100, true), stage: integer(item.stage, 1, 8, '現在の段階'), status: item.status, publicNote: str(item.publicNote, '公開用の近況', 500, false), leader: str(item.leader, '担当者', 100, false), internalNote: str(item.internalNote, '内部メモ', 2000, false), updatedAt: dateString(item.updatedAt, false, '進捗更新日'), documents: item.documents.map(function (doc) {
        if (!record(doc)) throw new Error('資料リンクが正しくありません。');
        return { name: str(doc.name, '資料名', 100, true), path: pathValue(doc.path, '資料のリンク先') };
      }) });
    }
    if (!result.auth && (result.apps.length || result.projects.length)) throw new Error('パスワード未設定のデータに登録内容を含めることはできません。');
    if (utf8Size(JSON.stringify(result)) > 10 * 1024 * 1024) throw new Error('登録データ全体は10MiBまでです。資料の内容はリンク先に保存し、説明やメモを短くしてください。');
    return result;
  }
  function randomHex(bytes) {
    var provider = root.crypto || root.msCrypto, values, result = '', i;
    if (!provider || !provider.getRandomValues) throw new Error('このブラウザでは初期設定できません。Microsoft Edgeで開き直してください。');
    values = new Uint8Array(bytes);
    provider.getRandomValues(values);
    for (i = 0; i < values.length; i++) result += ('0' + values[i].toString(16)).slice(-2);
    return result;
  }
  function passwordHash(password, salt) { return root.sha256('dx-team-dashboard/v1\n' + salt + '\n' + password); }
  function makeAuth(password) {
    var salt;
    if (typeof password !== 'string' || password.length < 4 || password.length > 128 || !trim(password) || /[\u0000-\u001f\u007f]/.test(password)) throw new Error('パスワードは4〜128文字で設定してください。空白だけのパスワードや改行は使えません。');
    salt = randomHex(16);
    return { algorithm: 'sha256-salt-v1', salt: salt, hash: passwordHash(password, salt) };
  }
  function verifyPassword(password, auth) {
    var computed, diff = 0, i;
    if (!auth || typeof password !== 'string') return false;
    computed = passwordHash(password, auth.salt);
    for (i = 0; i < 64; i++) diff |= computed.charCodeAt(i) ^ auth.hash.charCodeAt(i);
    return diff === 0;
  }
  function jsonForHTML(data) {
    return JSON.stringify(normalize(data)).replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }
  function exportHTML(template, data) {
    var marker = /(<script id="dx-data" type="application\/json">)[\s\S]*?(<\/script>)/;
    if (!marker.test(template)) throw new Error('HTMLの出力元が見つかりません。元ファイルを開き直してください。');
    if (!data.auth) throw new Error('配布前にパスワードを設定してください。');
    return '<!doctype html>\n' + template.replace(/^<!doctype html>\s*/i, '').replace(marker, function (whole, start, end) { return start + jsonForHTML(data) + end; });
  }
  function nativePath(fileURL) {
    var match = /^file:\/\/([^\/]*)(\/.*)$/i.exec(fileURL), path;
    if (!match) return fileURL;
    try { path = decodeURIComponent(match[2]); } catch (error) { path = match[2]; }
    if (match[1] && match[1] !== 'localhost') return '\\\\' + match[1] + path.replace(/\//g, '\\');
    if (/^\/[A-Za-z]:\//.test(path)) return path.slice(1).replace(/\//g, '\\');
    return path;
  }
  root.DXCore = { DEFAULT_SUMMARIES: DEFAULT_SUMMARIES, DEFAULT_DESCRIPTIONS: DEFAULT_DESCRIPTIONS, FORMAT: FORMAT, STAGES: STAGES, SHORT_STAGES: SHORT_STAGES, STATUS: STATUS, normalize: normalize, trim: trim, toHref: toHref, workbookProblem: workbookProblem, windowsWorkbookPath: windowsWorkbookPath, workbookLaunchHref: workbookLaunchHref, stageHref: stageHref, makeAuth: makeAuth, verifyPassword: verifyPassword, exportHTML: exportHTML, nativePath: nativePath, uid: function () { return 'dx_' + randomHex(10); } };
}(typeof window !== 'undefined' ? window : this));
