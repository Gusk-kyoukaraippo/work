import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'test-results');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.DX_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
const errors = [], requests = [];
context.on('page', p => { p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept()); });
context.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
const page = await context.newPage();
const url = pathToFileURL(path.join(root, 'DXダッシュボード.html')).href;
const visible = async (p, selector) => assert.equal(await p.locator(selector).isVisible(), true, `${selector} should be visible`);
const hidden = async (p, selector) => assert.equal(await p.locator(selector).isVisible(), false, `${selector} should be hidden`);
const clickText = (p, text) => p.getByRole('button', { name: text, exact: true }).click();
const appColors = p => p.locator('.app-card').evaluateAll(cards => cards.map(card => {
  const style = getComputedStyle(card.querySelector('.app-icon'));
  return { id: card.getAttribute('data-app-id'), background: style.backgroundColor, foreground: style.color };
}).sort((a, b) => a.id.localeCompare(b.id)));
async function login(p, password = '内部用1234') {
  await p.locator('#internalButton').click();
  await p.locator('#passwordInput').fill(password);
  await clickText(p, '内部向けを開く');
}
async function exportFile(p, id, destination) {
  const waiting = p.waitForEvent('download'); await p.locator(id).click();
  const dl = await waiting; await dl.saveAs(destination); return dl;
}
try {
  await page.goto(url);
  await visible(page, '#setupBanner'); await hidden(page, '#management');
  await page.screenshot({ path: path.join(out, 'initial-desktop.png'), fullPage: true });
  assert.equal(await page.locator('#stageGuide').locator('xpath=ancestor::details').count(), 0);
  assert.deepEqual(await page.locator('main > section.content-section').evaluateAll(els => els.map(el => el.id)), ['appsSection', 'stagesSection', 'projectsSection']);
  assert.equal(await page.locator('#stageGuide .stage-summary').count(), 8);
  for (let i = 0; i < 8; i++) {
    assert.equal(await page.locator('#stageGuide .stage-summary').nth(i).isVisible(), true);
    await page.locator('#stageGuide li').nth(i).locator('button').click();
    assert.match(await page.locator('.stage-description-body').textContent(), /目的/);
    assert.match(await page.locator('.stage-description-body').textContent(), /仮の説明/);
    await page.locator('#modalClose').click();
  }
  await hidden(page, '#editStageDescriptions');
  await page.locator('#setupButton').click();
  await page.locator('#passwordInput').fill('内部用1234');
  await page.locator('#passwordConfirm').fill('内部用1234');
  await clickText(page, '設定する');
  await visible(page, '#management'); await hidden(page, '#setupBanner');
  await page.locator('#editStageDescriptions').click();
  await page.locator('#descriptionStage').selectOption('1');
  await page.locator('#stageSummaryText').fill('短い説明 <b>確認</b>');
  await page.locator('#stageDescriptionText').fill('修正済みの説明 <b>HTMLとして解釈しない</b>\n二行目');
  await page.locator('#descriptionStage').selectOption('2');
  await page.locator('#descriptionStage').selectOption('1');
  assert.match(await page.locator('#stageDescriptionText').inputValue(), /修正済みの説明/);
  assert.equal(await page.locator('#stageSummaryText').inputValue(), '短い説明 <b>確認</b>');
  await clickText(page, '説明文を保存');
  await page.locator('#editStageLinks').click();
  await page.locator('#stagePath1').fill('./説明 #1.html');
  await page.locator('#stageAnchor1').fill('step-2');
  await clickText(page, '説明リンクを保存');
  await page.locator('#editStageLinks').click();
  assert.equal(await page.locator('#stagePath1').inputValue(), './説明 #1.html');
  await page.locator('#modalClose').click();
  await page.locator('#addApp').click();
  assert.equal(await page.locator('#appKind').inputValue(), 'excel');
  await visible(page, '#appInstructions');
  await page.locator('#appKind').selectOption('html');
  await hidden(page, '#appInstructions');
  await page.locator('#appName').fill('申し送りアプリ');
  await page.locator('#appDescription').fill('部署間の申し送りをまとめます。');
  await page.locator('#appPath').fill('./アプリ/申し送り #1.html');
  await clickText(page, '登録する');
  await page.locator('#addApp').click();
  await page.locator('#appName').fill('業務改善ツール');
  await page.locator('#appDescription').fill('Excelから始める、日々の改善。');
  assert.equal(await page.locator('#appKind').inputValue(), 'excel');
  await page.locator('#appOrder').fill('0');
  await page.locator('#appPath').fill('./アプリ/配布.zip');
  await clickText(page, '登録する');
  await visible(page, '.error-message');
  assert.match(await page.locator('.error-message').textContent(), /ZIPを展開/);
  assert.equal(await page.locator('.app-card').count(), 1);
  await page.locator('#appPath').fill(' "./アプリ/業務 #1%.xlsm" ');
  await page.locator('#appInstructions').fill('操作パネルの「閲覧する」を押してください。');
  await clickText(page, '登録する');
  assert.equal(await page.locator('.app-card h3').first().textContent(), '業務改善ツール');
  let workbookDownloads = 0;
  const countWorkbookDownload = () => { workbookDownloads++; };
  page.on('download', countWorkbookDownload);
  await page.getByRole('button', { name: '業務改善ツール：ブックを開く', exact: true }).click();
  assert.equal(await page.locator('#workbookLocation').inputValue(), path.join(root, 'アプリ/業務 #1%.xlsm'));
  assert.match(await page.locator('#modalContent').textContent(), /JUST Calc/);
  assert.equal(await page.locator('.workbook-instructions').textContent(), '操作パネルの「閲覧する」を押してください。');
  assert.equal(await page.locator('#modalContent a').count(), 0, 'Manual guidance must not offer a link that downloads the workbook');
  await page.evaluate(() => {
    window.dxOriginalCopy = document.execCommand;
    document.execCommand = function (command) { window.dxCopied = command === 'copy' ? document.activeElement.value : null; return true; };
  });
  await page.locator('.workbook-manual summary').click();
  await clickText(page, 'ブックの場所をコピー');
  assert.equal(await page.evaluate(() => window.dxCopied), path.join(root, 'アプリ/業務 #1%.xlsm'));
  await page.evaluate(() => { document.execCommand = function () { return false; }; });
  await clickText(page, 'ブックの場所をコピー');
  assert.match(await page.locator('#toast').textContent(), /Ctrl\+C/);
  assert.equal(await page.locator('#workbookLocation').evaluate(el => el.selectionEnd - el.selectionStart), (await page.locator('#workbookLocation').inputValue()).length);
  await page.evaluate(() => { document.execCommand = window.dxOriginalCopy; });
  await page.locator('#modalClose').click();
  assert.equal(workbookDownloads, 0);
  page.off('download', countWorkbookDownload);
  const colorsBeforeAddition = await appColors(page);
  await page.locator('#addApp').click();
  await page.locator('#appName').fill('準備中のアプリ');
  await clickText(page, '登録する');
  const expectedAppColors = await appColors(page);
  for (const before of colorsBeforeAddition) assert.deepEqual(expectedAppColors.find(item => item.id === before.id), before);
  await page.getByRole('button', { name: '業務改善ツールを編集', exact: true }).click();
  assert.equal(await page.locator('#appKind').inputValue(), 'excel');
  await page.locator('#appName').fill('業務改善ツール（名称変更テスト）');
  await page.locator('#appOrder').fill('99');
  await clickText(page, '変更を反映');
  assert.equal(await page.locator('.app-card h3').last().textContent(), '業務改善ツール（名称変更テスト）');
  assert.deepEqual(await appColors(page), expectedAppColors);
  assert.equal(await page.locator('.app-open.pending').count(), 1);
  await page.locator('#appSearch').fill('Excelから'); assert.equal(await page.locator('.app-card').count(), 1);
  await page.locator('#appSearch').fill('');

  await page.locator('#addProject').click();
  await page.locator('#projectName').fill('病棟申し送りの改善');
  await page.locator('#projectStage').selectOption('3');
  await page.locator('#projectPublicNote').fill('現場の声を集め、改善案を検討しています。');
  await page.locator('#projectLeader').fill('内部担当者');
  await page.locator('#projectInternalNote').fill('INTERNAL_SECRET_下書き資料');
  await clickText(page, '＋ 資料リンクを追加');
  await page.locator('[data-document-name]').fill('内部資料_現状分析');
  await page.locator('[data-document-path]').fill('../資料/現状分析.xlsx');
  await clickText(page, '登録する');
  await page.locator('#addProject').click();
  await page.locator('#projectName').fill('備品の在庫管理');
  await page.locator('#projectStage').selectOption('5');
  await page.locator('#projectStatus').selectOption('paused');
  await clickText(page, '登録する');
  await page.locator('#statusFilter').selectOption('paused'); assert.equal(await page.locator('.project-card').count(), 1);
  await page.locator('#statusFilter').selectOption('');
  await page.locator('#projectSearch').fill('申し送り'); assert.equal(await page.locator('.project-card').count(), 1);
  await page.locator('#projectSearch').fill('');
  await page.screenshot({ path: path.join(out, 'internal-desktop.png'), fullPage: true });

  // Editing internal information keeps the public progress date intact.
  const previousDate = await page.locator('.project-card').first().locator('time').getAttribute('datetime');
  await page.getByRole('button', { name: '病棟申し送りの改善を編集', exact: true }).click();
  await page.locator('#projectInternalNote').fill('INTERNAL_SECRET_更新した下書き');
  await clickText(page, '変更を反映');
  assert.equal(await page.locator('.project-card').first().locator('time').getAttribute('datetime'), previousDate);
  await page.getByRole('button', { name: '備品の在庫管理を編集', exact: true }).click();
  await page.locator('#projectStage').selectOption('8');
  await page.locator('#projectStatus').selectOption('completed');
  await clickText(page, '変更を反映');
  assert.equal(await page.locator('.project-card').last().locator('[aria-current="step"]').getAttribute('data-step'), '8');
  await page.getByRole('button', { name: '申し送りアプリを編集', exact: true }).click();
  assert.equal(await page.locator('#appKind').inputValue(), 'html');
  await page.locator('#appDescription').fill('部署間の申し送りを、わかりやすくまとめます。');
  await clickText(page, '変更を反映');

  // Changed password must survive HTML and JSON, and not leak into either file.
  await page.locator('#changePassword').click();
  await page.locator('#passwordInput').fill('変更後5678');
  await page.locator('#passwordConfirm').fill('変更後5678');
  await clickText(page, '設定する');
  const publishedPath = path.join(out, 'published.html');
  await page.evaluate(() => { location.hash = 'projectsSection'; });
  await exportFile(page, '#exportHtml', publishedPath);
  await visible(page, '#publishLocation');
  assert.doesNotMatch(await page.locator('#publishLocation').inputValue(), /#projectsSection/);
  const published = await readFile(publishedPath, 'utf8');
  assert.doesNotMatch(published, /内部用1234|変更後5678/);
  const jsonPath = path.join(out, 'backup.json');
  await page.locator('#modalClose').click();
  await exportFile(page, '#exportJson', jsonPath);
  const data = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.equal(data.apps.length, 3); assert.equal(data.projects.length, 2);
  assert.equal(data.auth.hash.length, 64); assert.doesNotMatch(JSON.stringify(data), /内部用1234|変更後5678/);
  await page.locator('#modalClose').click();
  await page.locator('#internalButton').click();
  await hidden(page, '#management'); assert.equal(await page.locator('.project-internal').count(), 0);
  assert.doesNotMatch(await page.locator('#app').innerText(), /INTERNAL_SECRET|内部担当者|内部資料_現状分析/);
  assert.equal(await page.locator('#modalContent').innerHTML(), '');
  // Hidden controls are guarded in addition to being absent from the normal view.
  await page.locator('#addProject').evaluate(el => el.click()); await hidden(page, '#modalOverlay');

  const publicPage = await context.newPage();
  await publicPage.goto(pathToFileURL(publishedPath).href);
  await hidden(publicPage, '#setupBanner'); await hidden(publicPage, '#management');
  assert.equal(await publicPage.locator('.app-card').count(), 3);
  assert.deepEqual(await appColors(publicPage), expectedAppColors);
  assert.equal(await publicPage.locator('.project-card').count(), 2);
  assert.equal(await publicPage.locator('.project-internal').count(), 0);
  assert.equal(await publicPage.locator('#stageGuide .stage-summary').nth(1).textContent(), '短い説明 <b>確認</b>');
  assert.equal(await publicPage.locator('#stageGuide .stage-summary b').count(), 0);
  await publicPage.locator('#stageGuide li').nth(1).locator('button').click();
  assert.match(await publicPage.locator('.stage-description-body').textContent(), /修正済みの説明/);
  assert.equal(await publicPage.locator('.stage-description-body b').count(), 0);
  await publicPage.screenshot({ path: path.join(out, 'embedded-description.png') });
  await publicPage.locator('#modalClose').click();
  assert.equal(await publicPage.locator('#stageGuide li').nth(1).locator('a').getAttribute('href'), './%E8%AA%AC%E6%98%8E%20%231.html#step-2');
  assert.match(await publicPage.locator('#stageGuide li').nth(3).textContent(), /わけなぜシート修正・アクションシート作成/);
  await writeFile(path.join(out, '説明 #1.html'), '<!doctype html><h1 id="step-2">わけなぜシート作成の説明</h1>');
  const guideEvent = publicPage.waitForEvent('popup');
  await publicPage.locator('#stageGuide li').nth(1).locator('a').click();
  const guidePage = await guideEvent; await guidePage.waitForLoadState();
  assert.match(guidePage.url(), /#step-2$/);
  assert.equal(await guidePage.locator('h1').textContent(), 'わけなぜシート作成の説明');
  await guidePage.close();
  await publicPage.screenshot({ path: path.join(out, 'public-desktop.png'), fullPage: true });
  for (const width of [1024, 1366, 1920]) {
    await publicPage.setViewportSize({ width, height: width === 1920 ? 1080 : 768 });
    assert.equal(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `PC width ${width}`);
    await publicPage.screenshot({ path: path.join(out, `public-pc-${width}.png`), fullPage: true });
  }
  await login(publicPage, '内部用1234');
  await visible(publicPage, '.error-message'); await hidden(publicPage, '#management');
  await publicPage.locator('#passwordInput').fill('変更後5678'); await clickText(publicPage, '内部向けを開く');
  assert.equal(await publicPage.locator('.project-internal').count(), 2);
  await publicPage.reload(); assert.equal(await publicPage.locator('.project-internal').count(), 0);
  await publicPage.setViewportSize({ width: 1440, height: 1100 });
  await login(publicPage, '変更後5678'); await publicPage.locator('#manageButton').click();

  // Reject malformed restoration atomically, then restore the correct backup.
  await publicPage.locator('#jsonFile').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await publicPage.waitForFunction(() => document.getElementById('toast').textContent.includes('復元できません'));
  assert.equal(await publicPage.locator('.project-card').count(), 2);
  await publicPage.locator('#jsonFile').setInputFiles(jsonPath);
  await visible(publicPage, '#restorePassword');
  await publicPage.locator('#restorePassword').fill('変更後5678');
  await clickText(publicPage, '内容を置き換えて復元');
  assert.deepEqual(await appColors(publicPage), expectedAppColors);
  assert.equal(await publicPage.locator('.project-internal').count(), 0);
  await login(publicPage, '変更後5678'); await publicPage.locator('#manageButton').click();
  await exportFile(publicPage, '#exportHtml', path.join(out, 'roundtrip.html'));
  const roundtrip = await readFile(path.join(out, 'roundtrip.html'), 'utf8');
  const extracted = JSON.parse(roundtrip.match(/<script id="dx-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(extracted.apps, data.apps); assert.deepEqual(extracted.projects, data.projects);
  assert.deepEqual(extracted.auth, data.auth);
  assert.deepEqual(extracted.stageLinks, data.stageLinks);
  assert.deepEqual(extracted.stageDescriptions, data.stageDescriptions);
  assert.deepEqual(extracted.stageSummaries, data.stageSummaries);
  await publicPage.locator('#modalClose').click();
  await publicPage.getByRole('button', { name: '備品の在庫管理を編集', exact: true }).click();
  await clickText(publicPage, '削除'); assert.equal(await publicPage.locator('.project-card').count(), 1);
  await publicPage.getByRole('button', { name: '準備中のアプリを編集', exact: true }).click();
  await clickText(publicPage, '削除'); assert.equal(await publicPage.locator('.app-card').count(), 2);

  // A linked HTML file really opens, including Japanese names and a literal #.
  await mkdir(path.join(out, 'アプリ'), { recursive: true });
  await writeFile(path.join(out, 'アプリ/申し送り #1.html'), '<!doctype html><title>リンク確認</title><h1>相対リンク成功</h1>');
  const popupEvent = publicPage.waitForEvent('popup');
  await publicPage.getByRole('link', { name: '申し送りアプリ：アプリを開く', exact: true }).click();
  const popup = await popupEvent; await popup.waitForLoadState(); assert.equal(await popup.locator('h1').innerText(), '相対リンク成功'); await popup.close();
  await mkdir(path.join(out, 'moved/アプリ'), { recursive: true });
  await copyFile(publishedPath, path.join(out, 'moved/dashboard.html'));
  await copyFile(path.join(out, 'アプリ/申し送り #1.html'), path.join(out, 'moved/アプリ/申し送り #1.html'));
  const moved = await context.newPage(); await moved.goto(pathToFileURL(path.join(out, 'moved/dashboard.html')).href);
  await moved.getByRole('button', { name: '業務改善ツール（名称変更テスト）：ブックを開く', exact: true }).click();
  assert.equal(await moved.locator('#workbookLocation').inputValue(), path.join(out, 'moved/アプリ/業務 #1%.xlsm'));
  assert.equal(await moved.locator('.workbook-instructions').count(), 0, 'Internal notes stay locked in public launch guidance');
  await moved.screenshot({ path: path.join(out, 'workbook-launch.png') });
  await moved.locator('#modalClose').click();
  const movedPopupEvent = moved.waitForEvent('popup'); await moved.getByRole('link', { name: '申し送りアプリ：アプリを開く', exact: true }).click();
  const movedPopup = await movedPopupEvent; await movedPopup.waitForLoadState(); assert.equal(await movedPopup.locator('h1').innerText(), '相対リンク成功'); await movedPopup.close();

  // Resolve real Windows target strings without requiring Windows or opening business workbooks.
  const workbookCases = [
    { path: ' "\\\\server\\共有\\引継ぎ メモ #1%.xlsm" ', expected: '\\\\server\\共有\\引継ぎ メモ #1%.xlsm' },
    { path: 'C:\\業務\\引継ぎ メモ #1%.xlsm', expected: 'C:\\業務\\引継ぎ メモ #1%.xlsm' },
    { path: 'file://server/share/%E6%97%A5%E6%9C%AC%E8%AA%9E%20%231%25.xlsm', expected: '\\\\server\\share\\日本語 #1%.xlsm' },
    { path: 'https://intranet.example/app.xlsm?download=1', web: true },
    { path: './runtime/index.html', invalid: true }
  ];
  for (const [index, item] of workbookCases.entries()) {
    const next = JSON.parse(JSON.stringify(data));
    next.apps = [{ ...next.apps.find(app => app.kind === 'excel' && app.path), path: item.path }];
    const fixtureHTML = await page.evaluate(({ template, next }) => DXCore.exportHTML(template, next), { template: published, next });
    const fixturePath = path.join(out, `workbook-case-${index}.html`);
    await writeFile(fixturePath, fixtureHTML);
    const fixturePage = await context.newPage();
    let downloads = 0; fixturePage.on('download', () => downloads++);
    await fixturePage.goto(pathToFileURL(fixturePath).href);
    if (item.expected) {
      const nativeLink = fixturePage.locator('a.app-open');
      assert.match(await nativeLink.getAttribute('href'), /^dx-workbook:\/\/open\/v1\/[A-Za-z0-9_-]+\/[a-f0-9]{64}$/);
      await fixturePage.evaluate(() => {
        document.addEventListener('click', event => {
          const link = event.target.closest('a[href^="dx-workbook:"]');
          if (link) { event.preventDefault(); window.dxNativeRequest = link.getAttribute('href'); }
        }, true);
      });
      await nativeLink.click();
      assert.equal(await fixturePage.evaluate(() => window.dxNativeRequest), await nativeLink.getAttribute('href'));
      await hidden(fixturePage, '#modalOverlay');
    }
    await fixturePage.locator('.workbook-help').click();
    assert.equal(await fixturePage.locator('#modalContent a').evaluateAll(links => links.every(link => link.getAttribute('href').startsWith('dx-workbook://'))), true, 'Workbook guidance only offers native launch links');
    assert.equal(await fixturePage.locator('.workbook-instructions').count(), 0);
    if (item.invalid) {
      assert.match(await fixturePage.locator('.error-message').textContent(), /アプリ名.xlsm/);
      assert.equal(await fixturePage.locator('#modalContent a').count(), 0);
    } else if (item.web) {
      assert.equal(await fixturePage.locator('#workbookLocation').count(), 0);
      assert.equal(await fixturePage.locator('#workbookWebLocation').inputValue(), item.path);
      assert.match(await fixturePage.locator('#modalContent').textContent(), /元ブックのパスを登録/);
    } else {
      assert.equal(await fixturePage.locator('#workbookLocation').inputValue(), item.expected);
      assert.equal(await fixturePage.getByRole('link', { name: 'もう一度ブックを開く', exact: true }).count(), 1);
      const retryLink = fixturePage.getByRole('link', { name: 'もう一度ブックを開く', exact: true });
      await fixturePage.evaluate(() => { window.dxNativeRequest = null; });
      await retryLink.click();
      assert.equal(await fixturePage.evaluate(() => window.dxNativeRequest), await retryLink.getAttribute('href'));
      if (index === 0) {
        await fixturePage.setViewportSize({ width: 1024, height: 768 });
        await fixturePage.screenshot({ path: path.join(out, 'windows-launch-help.png') });
        assert.equal(await fixturePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await fixturePage.locator('#modalClose').click();
        await fixturePage.screenshot({ path: path.join(out, 'windows-launch-card.png'), fullPage: true });
      }
    }
    assert.equal(downloads, 0);
    await fixturePage.close();
  }

  // Detect IE branches in modern Chromium, without claiming to test the old engine.
  const ie = await context.newPage();
  await ie.addInitScript(() => { Object.defineProperty(document, 'documentMode', { value: 11 }); });
  await ie.goto(url); await visible(ie, '#browserNotice'); await hidden(ie, '#app');
  const broken = await context.newPage();
  await writeFile(path.join(out, 'bad-data.html'), published.replace('"schemaVersion":1', '"schemaVersion":999'));
  await broken.goto(pathToFileURL(path.join(out, 'bad-data.html')).href); await visible(broken, '#bootError'); await hidden(broken, '#app');

  // Exercise the legacy save branch with a shim; this is not a real EdgeHTML engine test.
  const legacySave = await context.newPage();
  await legacySave.addInitScript(() => { navigator.msSaveOrOpenBlob = function (blob, filename) { window.dxSavedBlob = blob; window.dxSavedName = filename; return true; }; });
  await legacySave.goto(pathToFileURL(publishedPath).href);
  await login(legacySave, '変更後5678'); await legacySave.locator('#manageButton').click();
  await legacySave.locator('#exportHtml').click();
  assert.equal(await legacySave.evaluate(() => window.dxSavedName), 'DXダッシュボード.html');
  assert.match(await legacySave.evaluate(() => window.dxSavedBlob.type), /^text\/html/);
  const legacyContents = await legacySave.evaluate(() => window.dxSavedBlob.text());
  assert.doesNotMatch(legacyContents, /変更後5678/);
  assert.ok(legacyContents.includes('sha256-salt-v1'));

  // Browser rendering treats imported HTML-like text as text, without executing it.
  const specialData = JSON.parse(JSON.stringify(data));
  specialData.projects[0].publicNote = '</script><img src=x onerror="window.dxUnsafe=true"> & 😀';
  const specialHTML = await legacySave.evaluate(({ template, next }) => DXCore.exportHTML(template, next), { template: published, next: specialData });
  await writeFile(path.join(out, 'special-text.html'), specialHTML);
  const special = await context.newPage(); await special.goto(pathToFileURL(path.join(out, 'special-text.html')).href);
  assert.equal(await special.locator('.public-note').first().innerText(), specialData.projects[0].publicNote);
  assert.equal(await special.locator('#app img').count(), 0);
  assert.equal(await special.evaluate(() => window.dxUnsafe), undefined);
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  console.log('Browser checks passed: setup, password change/lock, CRUD, filtering, HTML/JSON roundtrip, restore rejection, relative-link relocation, PC widths 1024/1366/1920, IE gate, legacy save shim, text safety, zero external requests.');
  console.log('Screenshots: test-results/*.png（登録内容は検証用サンプル）');
} finally { await browser.close(); }
