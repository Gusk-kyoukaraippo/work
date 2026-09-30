import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['src/shell.html', 'src/core.js', 'src/app.js', 'node_modules/js-sha256/build/sha256.min.js', 'node_modules/js-sha256/LICENSE.txt'];
const [shell, core, app, sha, license] = await Promise.all(files.map(f => readFile(path.join(root, f), 'utf8')));
const jsLicense = `/* js-sha256 0.11.1 — https://github.com/emn178/js-sha256\n${license.replace(/\*\//g, '* /')}\n*/\n`;
let html = shell;
for (const [marker, contents] of [['/* DX_SHA256 */', jsLicense + sha], ['/* DX_CORE */', core], ['/* DX_APP */', app]]) {
  if (!html.includes(marker)) throw new Error(`Missing build marker: ${marker}`);
  html = html.replace(marker, () => contents);
}
await writeFile(path.join(root, 'DXダッシュボード.html'), html, 'utf8');
console.log('単体HTMLを生成しました: DXダッシュボード.html');
// Activity-only companion to the Excel launcher. Keep the original dashboard.
let guide = html.replace('<html lang="ja">', '<html lang="ja" data-dashboard-view="activities">');
guide = guide.replace('<title>DXチーム ダッシュボード</title>', '<title>DX活動ガイド</title>');
guide = guide.replace('<a href="#appsSection">DXアプリ一覧</a>', '');
guide = guide.replace('<a class="skip-link" href="#appsSection">アプリ一覧へ移動</a>', '<a class="skip-link" href="#stagesSection">改善の進め方へ移動</a>');
guide = guide.replace('<h1 id="pageTitle">DXチーム ダッシュボード</h1>', '<h1 id="pageTitle">DX活動ガイド</h1>');
guide = guide.replace('DXアプリ・改善の進め方・プロジェクトの進捗を確認できます。', '改善の進め方と、プロジェクトの進行状況を確認できます。');
guide = guide.replace('アプリへの入口と', '');
guide = guide.replace('アプリ・進行状況の登録と編集', '進行状況の登録と編集');
guide = guide.replace('アプリとプロジェクトを登録できます。', 'プロジェクトを登録できます。');
guide = guide.replace('アプリや進捗を<strong>登録・編集</strong>', '進捗を<strong>登録・編集</strong>');
guide = guide.replace('<span class="section-number">2</span><h2 id="stagesTitle">', '<span class="section-number">1</span><h2 id="stagesTitle">');
guide = guide.replace('<span class="section-number">3</span><h2 id="projectsTitle">', '<span class="section-number">2</span><h2 id="projectsTitle">');
guide = guide.replace('</style>', '\nhtml[data-dashboard-view="activities"] #appsSection{display:none!important}\n</style>');
await writeFile(path.join(root, 'DX活動ガイド.html'), guide, 'utf8');
console.log('Excelランチャー用の案内HTMLを生成しました: DX活動ガイド.html');
