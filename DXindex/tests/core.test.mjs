import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { parse } from 'acorn';

const html = await readFile(new URL('../DXダッシュボード.html', import.meta.url), 'utf8');
const sha = await readFile(new URL('../node_modules/js-sha256/build/sha256.min.js', import.meta.url), 'utf8');
const core = await readFile(new URL('../src/core.js', import.meta.url), 'utf8');
const context = { crypto: webcrypto, Uint8Array };
context.window = context;
vm.createContext(context);
vm.runInContext(sha, context);
vm.runInContext(core, context);
const C = context.DXCore;
const plain = v => JSON.parse(JSON.stringify(v));
const empty = () => ({ format: 'dx-team-dashboard', schemaVersion: 1, exportedAt: '', auth: null, apps: [], projects: [], stageSummaries: plain(C.DEFAULT_SUMMARIES), stageDescriptions: plain(C.DEFAULT_DESCRIPTIONS), stageLinks: Array.from({ length: 8 }, () => ({ path: '', anchor: '' })) });
const fixture = () => ({ ...empty(), auth: plain(C.makeAuth('テスト<&> 123')), apps: [{ id: 'app1', name: '業務アプリ', description: '説明', kind: 'excel', path: './アプリ/業務 #1%.xlsm', instructions: '操作パネルから開く', order: 1 }], projects: [{ id: 'project1', name: '業務改善', stage: 3, status: 'active', publicNote: 'インタビュー中', leader: '内部担当者', internalNote: '内部メモ', updatedAt: '2026-09-20T12:00:00.000Z', documents: [{ name: '現状分析', path: '../資料/現状分析.xlsx' }] }] });

test('全ての配布JavaScriptがES5として構文解析でき、外部読み込みを持たない', () => {
  let scripts = 0;
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (match[1].includes('application/json')) continue;
    parse(match[2], { ecmaVersion: 5 }); scripts++;
  }
  assert.equal(scripts, 3);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|@import|url\(https?:/i);
});

test('SHA-256同梱実装が既知の値・UTF-8・複数ブロックでNodeの実装と一致する', () => {
  for (const text of ['', 'abc', '日本語\n<&>😀', 'a'.repeat(10000)]) {
    assert.equal(context.sha256(text), createHash('sha256').update(text).digest('hex'));
  }
});

test('パスワードはsaltごとに変わる検証値になり、誤入力では解除されない', () => {
  const a = C.makeAuth('内部用パスワード123'), b = C.makeAuth('内部用パスワード123');
  assert.notEqual(a.salt, b.salt); assert.notEqual(a.hash, b.hash);
  assert.equal(C.verifyPassword('内部用パスワード123', a), true);
  assert.equal(C.verifyPassword('内部用パスワード124', a), false);
  assert.equal(C.verifyPassword('', a), false);
  assert.doesNotMatch(JSON.stringify(a), /内部用パスワード123/);
  assert.throws(() => C.makeAuth('   '));
});

test('空データ、公開用進捗、内部資料を往復し、未知の項目を出力に残さない', () => {
  assert.deepEqual(plain(C.normalize(empty())), empty());
  const input = fixture(); input.unlocked = true; input.password = 'plain-password';
  const output = plain(C.normalize(input));
  assert.equal(output.unlocked, undefined); assert.equal(output.password, undefined);
  assert.equal(output.projects[0].internalNote, '内部メモ');
  assert.deepEqual(plain(C.normalize(JSON.parse(JSON.stringify(output)))), output);
});

test('不正・重複・危険なリンクを拒否し、渡されたデータを変更しない', () => {
  const invalids = [
    d => { d.schemaVersion = 2; }, d => { d.projects[0].stage = 3.5; }, d => { d.projects[0].status = '__proto__'; },
    d => { d.projects[0].updatedAt = 'invalid'; }, d => { d.auth.hash = ''; }, d => { d.apps.push({ ...d.apps[0] }); },
    d => { d.apps[0].path = 'javascript:alert(1)'; }, d => { d.apps[0].path = 'data:text/html,test'; },
    d => { d.apps[0].path = './some\nfile.xlsm'; }, d => { d.auth = null; }, d => { d.projects[0].documents = [null]; }
  ];
  for (const mutate of invalids) {
    const data = fixture(); mutate(data); const before = JSON.stringify(data);
    assert.throws(() => C.normalize(data)); assert.equal(JSON.stringify(data), before);
  }
});

test('相対パス・共有パス・ドライブパス・file URLを正しく扱う', () => {
  assert.equal(C.toHref('./アプリ/業務 #1%.xlsm'), './%E3%82%A2%E3%83%97%E3%83%AA/%E6%A5%AD%E5%8B%99%20%231%25.xlsm');
  assert.equal(C.toHref('..\\apps\\a b.xlsm'), '../apps/a%20b.xlsm');
  assert.equal(C.toHref('\\\\server\\share\\a #.xlsm'), 'file://server/share/a%20%23.xlsm');
  assert.equal(C.toHref('C:\\Apps\\a b.xlsm'), 'file:///C:/Apps/a%20b.xlsm');
  assert.equal(C.toHref('file://server/share/a%20%23.xlsm'), 'file://server/share/a%20%23.xlsm');
  assert.equal(C.toHref('https://intranet/app?q=1#section'), 'https://intranet/app?q=1#section');
  assert.equal(C.nativePath('file://server/share/a%20%23.xlsm'), '\\\\server\\share\\a #.xlsm');
  assert.equal(C.nativePath('file:///C:/Apps/a%20b.xlsm'), 'C:\\Apps\\a b.xlsm');
  assert.equal(C.toHref(''), '');
});

test('Windowsの「パスのコピー」の引用符を除き、HTML・JSON往復でも正本のパスを保持する', () => {
  const paths = ['\\\\server\\共有\\引継ぎ メモ #1%.xlsm', 'C:\\業務\\引継ぎ メモ #1%.xlsm', './アプリ/引継ぎ メモ #1%.xlsm'];
  for (const path of paths) {
    const input = fixture(); input.apps[0].path = '  "' + path + '"  ';
    assert.equal(C.toHref(input.apps[0].path), C.toHref(path));
    const output = plain(C.normalize(input));
    assert.equal(output.apps[0].path, path);
    const htmlOutput = C.exportHTML(html, output);
    const saved = JSON.parse(htmlOutput.match(/<script id="dx-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(C.normalize(saved).apps[0].path, path);
  }
  assert.throws(() => C.toHref('"C:\\app.xlsm'), /引用符/);
  assert.throws(() => C.toHref('"javascript:alert(1)"'));
  assert.throws(() => C.toHref('"data:text/html,test"'));
});

test('ブック登録ではZIP・業務HTML・フォルダを区別し、既存JSON自体は互換読込できる', () => {
  for (const path of ['./アプリ/引継ぎメモ.xlsm', '"\\\\server\\share\\業務.XLSM"', 'C:\\Apps\\book.xlsx', './旧ブック.xls', 'https://intranet/book.xlsm?download=1#part', '']) {
    assert.equal(C.workbookProblem(path), '');
  }
  assert.match(C.workbookProblem('./引継ぎメモ.zip'), /ZIPを展開/);
  for (const path of ['./runtime/index.html', './apps/handoff-notes/', './gate.config.json', './book.xlsm.html', './app.xlsm/']) {
    assert.match(C.workbookProblem(path), /アプリ名.xlsm/);
    const legacy = fixture(); legacy.apps[0].path = path;
    assert.equal(C.normalize(legacy).apps[0].path, path);
  }
});

test('Windowsの元ブックに対する起動リンクを生成し、場所の変更と危険な指定を区別する', async () => {
  const cases = JSON.parse(await readFile(new URL('launcher-paths.json', import.meta.url), 'utf8'));
  for (const item of cases) {
    const href = new URL(C.toHref(item.path), item.baseURL).href;
    assert.equal(C.windowsWorkbookPath(C.nativePath(href)), item.expected);
    const expectedHash = createHash('sha256').update(item.expected.replace(/[A-Z]/g, c => c.toLowerCase())).digest('hex');
    assert.equal(C.workbookLaunchHref(item.id, href), `dx-workbook://open/v1/${item.id}/${expectedHash}`);
  }
  assert.notEqual(C.workbookLaunchHref('app', 'file://server/share/a.xlsm'), C.workbookLaunchHref('app', 'file://server/share/b.xlsm'));
  for (const url of ['https://example.com/book.xlsm', 'file:///Users/test/book.xlsm', 'file:///C:/book.xlsm.exe', 'file:///C:/book.xlsm:stream', 'file:///C:/CON.xlsm']) assert.equal(C.workbookLaunchHref('app', url), '');
  for (const id of ['app\n', 'app/other', 'app?x=1', '--setup\"']) assert.throws(() => C.workbookLaunchHref(id, 'file:///C:/book.xlsm'));
  assert.throws(() => C.toHref('dx-workbook://open/v1/app/hash'), 'Arbitrary protocol URLs stay disallowed in user-entered links');
});

test('日本語を含む登録データの容量も制限し、自分のバックアップを復元できる範囲に保つ', () => {
  const data = fixture();
  data.projects = Array.from({ length: 220 }, (_, index) => ({ ...data.projects[0], id: 'large' + index, documents: Array.from({ length: 30 }, () => ({ name: '資料', path: './' + '日'.repeat(1900) })) }));
  assert.throws(() => C.normalize(data), /10MiB/);
});

test('相対リンクは配置先基準で解決され、共有フォルダ移動にも追従する', () => {
  const relative = C.toHref('./アプリ/業務.xlsm');
  assert.equal(new URL(relative, 'file://server/share/team/dashboard.html').pathname, '/share/team/%E3%82%A2%E3%83%97%E3%83%AA/%E6%A5%AD%E5%8B%99.xlsm');
  assert.equal(new URL(relative, 'file://server2/share2/team/dashboard.html').host, 'server2');
  assert.ok(new URL(relative, 'file://server2/share2/team/dashboard.html').pathname.startsWith('/share2/team/'));
});

test('HTML出力がscript終端・特殊文字を安全に保持し、再出力にも対応する', () => {
  const data = fixture();
  data.projects[0].publicNote = '</script><img src=x onerror=alert(1)> & $& $1 😀\u2028';
  data.exportedAt = '2026-09-20T12:30:00.000Z';
  const first = C.exportHTML(html, data), second = C.exportHTML(first, data);
  assert.equal(first, second);
  const embedded = JSON.parse(first.match(/<script id="dx-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(embedded, data);
  assert.doesNotMatch(first, /<img src=x onerror/);
  assert.equal((first.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '').match(/<!doctype html>/gi) || []).length, 1);
  assert.throws(() => C.exportHTML(html, empty()));
});

test('説明リンクは旧JSONを受け入れ、安全なリンクと見出しIDを保存する', () => {
  const old = empty(); delete old.stageLinks;
  assert.deepEqual(plain(C.normalize(old)).stageLinks, empty().stageLinks);
  const data = fixture();
  data.stageLinks[1] = { path: './資料/説明 #1.html', anchor: 'step-2' };
  assert.equal(C.stageHref(data.stageLinks[1]), './%E8%B3%87%E6%96%99/%E8%AA%AC%E6%98%8E%20%231.html#step-2');
  const exported = C.exportHTML(html, data);
  const restored = JSON.parse(exported.match(/<script id="dx-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(restored.stageLinks, data.stageLinks);
  data.stageLinks[0].path = 'javascript:alert(1)';
  assert.throws(() => C.normalize(data));
  assert.throws(() => C.normalize({ ...empty(), stageLinks: [] }));
});

test('内蔵説明文の旧データ補完と安全な出力・入力検証', () => {
  const old = empty(); delete old.stageDescriptions;
  assert.equal(C.normalize(old).stageDescriptions.length, 8);
  const data = fixture(); data.stageDescriptions[2] = '説明</script><script>alert(1)</script>\n次の行';
  const exported = C.exportHTML(html, data);
  assert.doesNotMatch(exported, /説明<\/script>/);
  assert.throws(() => C.normalize({ ...data, stageDescriptions: ['説明'] }));
  assert.throws(() => C.normalize({ ...data, stageDescriptions: Array(8).fill('') }));
});

test('段階の短い説明は旧JSONを補完し、空欄・長すぎる入力を拒否する', () => {
  const old = empty(); delete old.stageSummaries;
  assert.deepEqual(plain(C.normalize(old)).stageSummaries, plain(C.DEFAULT_SUMMARIES));
  assert.throws(() => C.normalize({ ...empty(), stageSummaries: [] }));
  assert.throws(() => C.normalize({ ...empty(), stageSummaries: Array(8).fill(' ') }));
  assert.throws(() => C.normalize({ ...empty(), stageSummaries: Array(8).fill('文'.repeat(241)) }));
});
