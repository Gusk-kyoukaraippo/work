const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

// Additional single-computer checks against the actual recorded candidate.
// Only temporary copies receive simulated workbook boot contexts. These checks
// do not execute JUST Calc/VBA, commit a workbook, or exercise shared-PC locks.
const root = path.resolve(__dirname, '..');
const author = '追加試験 担当者';
const databaseId = '00000000-0000-4000-a000-000000000071';
let browser, temporaryRoot, runtimeSource, sourceHashes, config;
const pages = [];

async function hashes(folder) {
  const result = {};
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const [name, hash] of Object.entries(await hashes(path.join(folder, entry.name)))) {
        result[path.join(entry.name, name)] = hash;
      }
    } else {
      result[entry.name] = createHash('sha256').update(await fs.readFile(path.join(folder, entry.name))).digest('hex');
    }
  }
  return result;
}

test.before(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'excel-gate-single-pc-'));
  const { buildApp } = await import('../scripts/package.mjs');
  const candidate = { folder: await buildApp('progress-board', path.join(temporaryRoot, 'candidate'), { mode: 'candidate' }) };
  runtimeSource = path.join(candidate.folder, 'runtime');
  config = JSON.parse(await fs.readFile(path.join(candidate.folder, 'gate.config.json'), 'utf8'));
  sourceHashes = await hashes(runtimeSource);
  const executablePath = process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  console.log(JSON.stringify({ scope: 'Mac Chrome file://; simulated boot only; no JUST Calc or shared-PC acceptance', runtimeSource, browser: browser.version(), sourceHashes }));
});

test.after(async () => {
  try {
    if (browser) await browser.close();
    if (runtimeSource && sourceHashes) assert.deepEqual(await hashes(runtimeSource), sourceHashes, 'Original candidate runtime must remain unchanged');
  } finally {
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

const empty = () => ({ schemaVersion: 2, app: 'kaizen-project-progress-board', projects: [] });
function project(id, values = {}) {
  return {
    id, name: `案件 ${id}`, leader: '担当者', stage: 2, status: 'active', note: `メモ ${id}`,
    completedSubsteps: { 3: [] }, documents: [], createdAt: '2026-09-20T01:00:00.000Z',
    updatedAt: '2026-09-20T01:00:00.000Z', sample: false, ...values
  };
}

async function open(payload = empty(), { mode = 'edit', baseRevision = 7 } = {}) {
  const runtime = path.join(temporaryRoot, randomUUID());
  await fs.cp(runtimeSource, runtime, { recursive: true });
  assert.deepEqual(await hashes(runtime), sourceHashes, 'Each session starts from the exact candidate bytes');
  const context = {
    runtimeVersion: config.runtimeVersion, displayName: config.displayName, mode, readOnly: mode === 'view',
    databaseId, sessionId: randomUUID(), dataType: config.appId, schemaVersion: config.dataVersion,
    baseRevision, hasPayload: true, authorRequired: true, payload
  };
  await fs.writeFile(path.join(runtime, 'excel-gate-boot.js'), `window.__EXCEL_GATE_CONTEXT__=${JSON.stringify(context)};\n`);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  pages.push(page);
  page.setDefaultTimeout(10000);
  page.gateErrors = [];
  page.downloads = [];
  page.gateContext = context;
  page.on('dialog', dialog => dialog.dismiss());
  page.on('pageerror', error => page.gateErrors.push(error.message));
  page.on('download', download => page.downloads.push(download));
  await page.addInitScript(() => {
    window.__singlePcStorage = { reads: 0, writes: 0 };
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (...args) { window.__singlePcStorage.reads++; return get.apply(this, args); };
    Storage.prototype.setItem = function (...args) { window.__singlePcStorage.writes++; return set.apply(this, args); };
    // Observe the full business snapshot in view mode, where legitimate gate
    // output is unavailable. Delegate connect unchanged; do not relax guards.
    let api;
    Object.defineProperty(window, 'ExcelGate', {
      configurable: true,
      get() { return api; },
      set(value) {
        const connect = value.connect;
        value.connect = function (adapter) {
          window.__singlePcSnapshot = () => JSON.parse(JSON.stringify(adapter.exportData()));
          return connect.call(this, adapter);
        };
        api = value;
      }
    });
  });
  await page.goto(pathToFileURL(path.join(runtime, 'index.html')).href);
  await page.waitForFunction(() => {
    const panel = document.querySelector('excel-gate-panel')?.shadowRoot;
    return panel && !panel.querySelector('dialog').open && typeof window.__singlePcSnapshot === 'function';
  });
  assert.equal(await page.evaluate(() => ExcelGate.isLinked), true);
  if (mode === 'edit') await page.locator('excel-gate-panel #name').fill(author);
  return page;
}

async function close(page) {
  assert.deepEqual(page.gateErrors, [], 'No unhandled browser exception');
  assert.deepEqual(await page.evaluate(() => __singlePcStorage), { reads: 0, writes: 0 });
  await page.close();
}

async function output(page, kind = 'workCopy') {
  const [download, result] = await Promise.all([
    page.waitForEvent('download'), page.evaluate(kind => ExcelGate.exportFile(kind), kind)
  ]);
  assert.ok(result);
  const bytes = await fs.readFile(await download.path());
  assert.equal(download.suggestedFilename(), result.fileName);
  assert.deepEqual(bytes, Buffer.from(result.text, 'utf8'), 'Downloaded UTF-8 bytes match the emitted file');
  return { envelope: JSON.parse(bytes.toString('utf8')), bytes, download };
}

async function beginAdd(page) {
  await page.locator('#addProjectBtn').click();
  await page.waitForFunction(() => document.activeElement === document.querySelector('#projectNameInput'));
}
async function beginEdit(page, id) {
  await page.locator(`.project-row[data-id="${id}"]`).click();
  await page.locator('#detailEditBtn').click();
  await page.waitForFunction(() => document.activeElement === document.querySelector('#projectNameInput'));
}
async function submit(page) {
  await page.locator('#projectForm button[type=submit]').click();
  await page.locator('#projectDialog').waitFor({ state: 'hidden' });
}
function assertNext(current, previous, page, sequence, kind) {
  assert.equal(current.exportSequence, sequence);
  assert.equal(current.parentSaveDataId, previous ? previous.saveDataId : null);
  if (previous) assert.notEqual(current.saveDataId, previous.saveDataId);
  assert.equal(current.saveKind, kind);
  assert.equal(current.databaseId, databaseId);
  assert.equal(current.sessionId, page.gateContext.sessionId);
  assert.equal(current.baseRevision, page.gateContext.baseRevision);
  assert.equal(current.authorName, author);
  assert.equal(current.readOnly, false);
}

test('candidate: three intermediate exports, intervening edits and replay retain the complete parent chain', async () => {
  const seed = { ...empty(), projects: [project('chain-a'), project('chain-b')] };
  const page = await open(seed);
  await beginEdit(page, 'chain-a');
  await page.locator('#noteInput').fill('1回目の途中出力');
  await submit(page);
  const first = await output(page);
  assertNext(first.envelope, null, page, 1, 'workCopy');
  await beginAdd(page);
  await page.locator('#projectNameInput').fill('途中で追加した案件');
  await page.locator('#leaderInput').fill('第二担当');
  await submit(page);
  const second = await output(page);
  assertNext(second.envelope, first.envelope, page, 2, 'workCopy');
  assert.equal(second.envelope.payload.projects.length, 3);
  await beginEdit(page, 'chain-a');
  await page.locator('#noteInput').fill('編集後・3回目の途中出力');
  await page.locator('#statusInput').selectOption('paused');
  await submit(page);
  await page.locator('excel-gate-panel summary').click();
  const replayPending = page.waitForEvent('download');
  await page.locator('excel-gate-panel #again').click();
  assert.deepEqual(await fs.readFile(await (await replayPending).path()), second.bytes, 'Replay after more edits still returns the previous snapshot');
  const third = await output(page);
  assertNext(third.envelope, second.envelope, page, 3, 'workCopy');
  assert.equal(third.envelope.payload.projects[0].status, 'paused');
  await beginEdit(page, 'chain-a');
  await page.locator('#statusInput').selectOption('completed');
  await page.locator('#noteInput').fill('最終出力の確定内容');
  await submit(page);
  const final = await output(page, 'complete');
  assertNext(final.envelope, third.envelope, page, 4, 'complete');
  assert.equal(new Set([first, second, third, final].map(out => out.envelope.saveDataId)).size, 4);
  assert.equal(final.envelope.payload.projects[0].stage, 8);
  assert.equal(final.envelope.payload.projects[0].note, '最終出力の確定内容');
  assert.equal(first.envelope.payload.projects.length, 2);
  assert.equal(first.envelope.payload.projects[0].note, '1回目の途中出力');
  assert.equal(second.envelope.payload.projects[0].status, 'active');
  for (const out of [first, second, third, final]) assert.deepEqual(await fs.readFile(await out.download.path()), out.bytes);
  await close(page);
});

test('candidate: Unicode, quotes, backslashes, multiline notes and HTML-like text survive UI input and a new-session round trip', async () => {
  const values = {
    name: '改善𠮷野 👩🏽‍💻 e\u0301 "引用" \'単引用\' \\ <b>題名</b>',
    leader: '担当 <img src=x onerror="window.__unexpected=1">',
    note: '一行目\n二行目\t日本語・😀・𠮷\n"引用" \'単引用\' \\server\\資料\n</script><script>window.__unexpected=1</script>\n区切り\u2028次\u2029末尾',
    docName: '資料 "最終" <b>表示名</b> 😀',
    docUrl: '\\\\server\\共有\\計画 "改訂"\\資料.xlsx'
  };
  const page = await open();
  await beginAdd(page);
  await page.locator('#projectNameInput').fill(values.name);
  await page.locator('#leaderInput').fill(values.leader);
  await page.locator('#noteInput').fill(values.note);
  await page.locator('#stageInput').selectOption('3');
  await page.locator('#substepList input[type=checkbox]').first().check();
  await page.locator('#addDocumentBtn').click();
  await page.locator('#documentList input[aria-label="資料名"]').fill(values.docName);
  await page.locator('#documentList input[aria-label="リンク先"]').fill(values.docUrl);
  await submit(page);
  const first = await output(page, 'complete');
  const item = first.envelope.payload.projects[0];
  assert.equal(item.name, values.name);
  assert.equal(item.leader, values.leader);
  assert.equal(item.note, values.note);
  assert.deepEqual(item.completedSubsteps, { 3: [0] });
  assert.equal(item.documents[0].name, values.docName);
  assert.equal(item.documents[0].url, values.docUrl);
  const reopened = await open(first.envelope.payload, { baseRevision: 8 });
  await reopened.locator('.project-row').click();
  assert.equal(await reopened.locator('#detailTitle').textContent(), values.name);
  assert.equal(await reopened.locator('#detailLeader').textContent(), values.leader);
  assert.equal(await reopened.locator('#detailNote').textContent(), values.note);
  assert.equal(await reopened.locator('#detailDocuments a span').textContent(), values.docName);
  assert.equal(await reopened.locator('#detailDocuments a').getAttribute('title'), values.docUrl);
  assert.equal(await reopened.locator('#detailTitle b, #detailLeader img, #detailNote script, #detailDocuments b').count(), 0);
  assert.equal(await reopened.evaluate(() => window.__unexpected), undefined);
  await reopened.locator('#detailBackBtn').click();
  const second = await output(reopened, 'complete');
  assert.deepEqual(second.envelope.payload, first.envelope.payload);
  assertNext(second.envelope, null, reopened, 1, 'complete');
  assert.notEqual(second.envelope.sessionId, first.envelope.sessionId);
  await close(reopened);
  await close(page);
});

test('candidate: repeated view filters, keyboard detail navigation and guide access leave the full multi-project payload unchanged', async () => {
  const seed = { ...empty(), projects: [
    project('view-active', { note: '進行中の詳細\n2行目', documents: [{ id: 'read-doc', name: '参照資料', url: './guide.html#step-2' }] }),
    project('view-paused', { status: 'paused', stage: 3, completedSubsteps: { 3: [0] }, note: '保留中の詳細' }),
    project('view-completed', { status: 'completed', stage: 8, note: '完了の詳細' })
  ] };
  const page = await open(seed, { mode: 'view', baseRevision: 12 });
  assert.deepEqual(await page.evaluate(() => __singlePcSnapshot()), seed);
  for (const status of ['paused', 'completed', 'active', '', 'completed', '']) {
    await page.locator('#statusFilter').selectOption(status);
    const expected = seed.projects.filter(item => !status || item.status === status);
    assert.deepEqual((await page.locator('.project-row').evaluateAll(rows => rows.map(row => row.dataset.id))).sort(), expected.map(item => item.id).sort());
    for (const item of expected) {
      const row = page.locator(`.project-row[data-id="${item.id}"]`);
      await row.focus();
      await row.press('Enter');
      assert.equal(await page.locator('#detailTitle').textContent(), item.name);
      assert.equal(await page.locator('#detailNote').textContent(), item.note);
      assert.equal(await page.locator('#detailEditBtn').isDisabled(), true);
      await page.locator('#detailBackBtn').click();
    }
    assert.deepEqual(await page.evaluate(() => __singlePcSnapshot()), seed);
  }
  const popupPending = page.waitForEvent('popup');
  await page.locator('#workflowOverview a').nth(2).click();
  const guide = await popupPending;
  await guide.waitForLoadState('domcontentloaded');
  assert.ok(guide.url().startsWith('file://'));
  assert.match(guide.url(), /guide\.html#step-3$/);
  await guide.close();
  assert.deepEqual(await page.evaluate(() => __singlePcSnapshot()), seed);
  assert.equal(await page.locator('#metricTotal').textContent(), '3');
  assert.equal(page.downloads.length, 0);
  await close(page);
});

test('candidate: invalid draft after an earlier export is retained, corrected and exported without consuming sequence numbers', async () => {
  const seed = { ...empty(), projects: [project('draft-existing')] };
  const page = await open(seed);
  const first = await output(page);
  await beginEdit(page, 'draft-existing');
  await page.locator('#projectNameInput').fill('修正中の案件');
  await page.locator('#leaderInput').fill('');
  await page.locator('#noteInput').fill('出力失敗後も残る入力\n確定前');
  await page.locator('#projectForm button[type=submit]').click();
  assert.equal(await page.locator('#projectDialog').isVisible(), true);
  assert.equal(await page.locator('#leaderInput').evaluate(input => input.validity.valueMissing), true);
  for (const kind of ['workCopy', 'complete']) {
    const failure = await page.evaluate(kind => ExcelGate.exportFile(kind).then(() => '', error => error.message), kind);
    assert.match(failure, /確定|キャンセル/);
    assert.equal(await page.locator('#projectNameInput').inputValue(), '修正中の案件');
    assert.equal(await page.locator('#noteInput').inputValue(), '出力失敗後も残る入力\n確定前');
  }
  assert.equal(page.downloads.length, 1, 'Rejected exports must not download partial data');
  await page.locator('#leaderInput').fill('訂正後の担当');
  await page.locator('#noteInput').fill('修正して確定した入力');
  await submit(page);
  const corrected = await output(page);
  assertNext(corrected.envelope, first.envelope, page, 2, 'workCopy');
  assert.equal(corrected.envelope.payload.projects.length, 1);
  assert.equal(corrected.envelope.payload.projects[0].id, 'draft-existing');
  assert.equal(corrected.envelope.payload.projects[0].leader, '訂正後の担当');
  assert.equal(corrected.envelope.payload.projects[0].note, '修正して確定した入力');
  assert.deepEqual(first.envelope.payload, seed);
  await beginEdit(page, 'draft-existing');
  await page.locator('#noteInput').fill('キャンセルする再編集');
  await page.locator('#cancelBtn').click();
  const final = await output(page, 'complete');
  assertNext(final.envelope, corrected.envelope, page, 3, 'complete');
  assert.deepEqual(final.envelope.payload, corrected.envelope.payload);
  await close(page);
});
