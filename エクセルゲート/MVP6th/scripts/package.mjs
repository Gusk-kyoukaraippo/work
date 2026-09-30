import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assessAcceptance, readReceipts, readTarget } from './evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = '0.6.0';
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function validRelative(file) {
  if (typeof file !== 'string' || !file || /[\\:"<>|?*\x00-\x1f]/.test(file) || file.startsWith('/') ||
      file.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Invalid relative path: ' + file);
  return file;
}
export function validateConfig(config) {
  if (!config || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(config.appId) || typeof config.displayName !== 'string' || !config.displayName.trim() || /[\x00-\x1f]/.test(config.displayName) ||
      config.runtimeVersion !== VERSION || !Number.isInteger(config.dataVersion) || config.dataVersion < 1 ||
      !['view', 'block'].includes(config.viewPolicy) || typeof config.authorRequired !== 'boolean' ||
      !Array.isArray(config.files) || !config.files.includes(config.entry)) throw new Error('Invalid deployment configuration');
  config.files.forEach(validRelative); validRelative(config.entry);
  const keys = config.files.map(x => x.normalize('NFC').toLowerCase());
  if (new Set(keys).size !== keys.length || keys.some(x => ['excel-gate-boot.js', 'excel-gate.js', 'excel-gate-core.js'].includes(x))) throw new Error('Duplicate or reserved runtime file');
  return config;
}
export async function collectAppFiles(source) {
  if (!(await fs.lstat(source)).isDirectory()) throw new Error('Use a regular app folder, not a symlink');
  const files = [];
  async function walk(relative = '') {
    const names = new Set();
    for (const item of await fs.readdir(path.join(source, relative), { withFileTypes: true })) {
      if (item.name.startsWith('.') || item.name.startsWith('~$') || (!relative && item.name === 'gate.config.json')) continue;
      if (['node_modules', 'data', 'vba', 'workbook'].includes(item.name)) throw new Error('Use an app-only source folder; development/data folder found: ' + item.name);
      const file = relative ? relative + '/' + item.name : item.name;
      const nameKey = item.name.normalize('NFC').toLowerCase();
      if (names.has(nameKey)) throw new Error('Windows filename collision: ' + file);
      names.add(nameKey);
      validRelative(file);
      if (item.isSymbolicLink()) throw new Error('Symlinks are not app assets: ' + file);
      if (item.isDirectory()) await walk(file);
      else if (item.isFile()) files.push(file);
      else throw new Error('Only regular app files are supported: ' + file);
    }
  }
  await walk();
  return files.sort();
}
export async function resolveConfig(source) {
  const input = JSON.parse(await fs.readFile(path.join(source, 'gate.config.json'), 'utf8'));
  if (input.runtimeVersion && input.runtimeVersion !== VERSION) throw new Error('Update the app integration before changing its runtime version');
  return validateConfig({
    displayName: input.displayName, appId: input.appId, dataVersion: input.dataVersion ?? 1,
    entry: input.entry ?? 'index.html', files: await collectAppFiles(source), runtimeVersion: VERSION,
    viewPolicy: input.viewPolicy ?? 'view', authorRequired: input.authorRequired ?? true
  });
}
export async function verifiedWorkbook() {
  const file = path.join(root, 'workbook/MVP6th.xlsm');
  try { await fs.access(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const receipt = JSON.parse(await fs.readFile(path.join(root, 'workbook/MVP6th.build.json'), 'utf8'));
  if (sha256(await fs.readFile(file)) !== receipt.sha256 || receipt.validation?.embeddedSourceMatches !== true || receipt.validation?.uninitialized !== true || receipt.validation?.setupButton !== true || !receipt.sourceHashes) throw new Error('Workbook verification receipt is invalid');
  for (const [relative, expected] of Object.entries(receipt.sourceHashes)) {
    validRelative(relative);
    if (sha256(await fs.readFile(path.join(root, relative))) !== expected) throw new Error('Rebuild and verify the common workbook after VBA changes: ' + relative);
  }
  for (const name of (await fs.readdir(path.join(root, 'vba/utf8'))).filter(x => x.endsWith('.bas'))) {
    for (const relative of ['vba/utf8/' + name, 'vba/' + name]) if (!receipt.sourceHashes[relative]) throw new Error('Missing source hash: ' + relative);
  }
  if (!receipt.sourceHashes['vba/ThisWorkbook.txt']) throw new Error('Missing workbook event hash');
  return { file, receipt };
}
async function readApp(appName) {
  validRelative(appName);
  if (appName.includes('/')) throw new Error('App name must be a single folder name');
  const source = path.join(root, 'apps', appName);
  const config = await resolveConfig(source);
  const assets = new Map();
  for (const relative of config.files) {
    let bytes = await fs.readFile(path.join(source, relative));
    if (/\.(?:html|js)$/i.test(relative) && bytes.includes(Buffer.from('EXCEL_GATE_ADAPTER_TODO'))) throw new Error('Finish the app-specific adapter before building: ' + relative);
    if (relative === config.entry) {
      let html = bytes.toString('utf8');
      const marker = /<!-- EXCEL_GATE_START -->[\s\S]*?<!-- EXCEL_GATE_END -->/g;
      if ((html.match(marker) || []).length !== 1) throw new Error('Exactly one explicit gate boot block is required');
      const index = html.indexOf('<!-- EXCEL_GATE_START -->');
      if (/<script\b/i.test(html.slice(0, index))) throw new Error('Gate boot must precede business scripts');
      if (/http-equiv\s*=\s*["']Content-Security-Policy/i.test(html)) throw new Error('CSP entry needs an explicitly tested integration');
      const prefix = path.posix.relative(path.posix.dirname(config.entry), '.') || '.';
      html = html.replace(marker, '<script>window.__EXCEL_GATE_REQUIRED__=true;</script>\n' + ['excel-gate-boot.js', 'excel-gate-core.js', 'excel-gate.js'].map(file => '<script src="' + prefix + '/' + file + '"></script>').join('\n'));
      bytes = Buffer.from(html);
    }
    assets.set('runtime/' + relative, bytes);
  }
  assets.set('gate.config.json', Buffer.from(JSON.stringify(config, null, 2) + '\n'));
  const files = [...config.files, 'excel-gate-boot.js', 'excel-gate-core.js', 'excel-gate.js'];
  assets.set('runtime-files.txt', Buffer.from(files.join('\r\n') + '\r\n'));
  return { config, assets };
}
const hashesOf = assets => Object.fromEntries([...assets].map(([file, bytes]) => [file, sha256(bytes)]));
async function prepareIdentity(appName) {
  const { config, assets } = await readApp(appName);
  const workbook = await verifiedWorkbook();
  const engineFiles = {};
  for (const file of ['excel-gate-core.js', 'excel-gate.js', 'help.html', 'history.template.html']) {
    const bytes = await fs.readFile(path.join(root, 'shared', file));
    // The static help page is documentation; executable history/runtime assets
    // are the common engine. Documentation wording never expires execution tests.
    if (file !== 'help.html') engineFiles['shared/' + file] = sha256(bytes);
    assets.set((file.endsWith('.js') ? 'runtime/' : 'shared/') + file, bytes);
  }
  // Keep source identity meaningful before a native master is available, too.
  for (const folder of ['vba', 'vba/utf8']) {
    for (const name of (await fs.readdir(path.join(root, folder))).filter(name => name.endsWith('.bas')).sort()) {
      const relative = folder + '/' + name;
      engineFiles[relative] = sha256(await fs.readFile(path.join(root, relative)));
    }
  }
  engineFiles['vba/ThisWorkbook.txt'] = sha256(await fs.readFile(path.join(root, 'vba/ThisWorkbook.txt')));
  if (workbook) engineFiles['workbook/MVP6th.xlsm'] = workbook.receipt.sha256;
  assets.set('runtime/excel-gate-boot.js', Buffer.from('window.__EXCEL_GATE_CONTEXT__={invalid:true};\n'));
  const appFiles = Object.fromEntries(config.files.map(file => ['runtime/' + file, sha256(assets.get('runtime/' + file))]));
  // Canonical semantic settings avoid invalidating results on JSON whitespace/key order changes.
  appFiles['gate.config.json'] = sha256(stableJson(config));
  const identity = {
    schemaVersion: 1, runtimeVersion: VERSION, appId: config.appId,
    engine: { digest: sha256(stableJson({ runtimeVersion: VERSION, files: engineFiles })), files: engineFiles, workbookSha256: workbook?.receipt.sha256 ?? null, assembled: Boolean(workbook) },
    app: { digest: sha256(stableJson({ appId: config.appId, files: appFiles })), files: appFiles }
  };
  return { config, assets, workbook, identity };
}
export async function computeIdentity(appName) { return (await prepareIdentity(appName)).identity; }

export async function buildApp(appName, outputRoot = path.join(root, 'dist'), options = {}) {
  const mode = options.mode ?? 'release';
  if (!['release', 'candidate', 'development'].includes(mode)) throw new Error('Unknown package mode');
  const { config, assets, workbook, identity } = await prepareIdentity(appName);
  if (mode !== 'development' && !workbook) throw new Error('A source-verified, uninitialized MVP6th.xlsm is required. Development packages are not user releases.');
  const target = options.target ?? await readTarget(options.targetFile);
  const receipts = await readReceipts(options.evidenceDir);
  const acceptance = assessAcceptance({ identity, receipts, target });
  if (mode === 'release' && !acceptance.distributionReady) throw new Error('Release acceptance is incomplete: ' + acceptance.reasons.join('; '));
  // Only runtime/configuration bytes are checked after commissioning. Never hash a live book.
  const immutableFiles = hashesOf(new Map([...assets].filter(([file]) => file !== 'shared/help.html')));
  for (const [sourceName, targetName] of [['user-guide.md', '使い方.md'], ['install.md', '導入手順.md'], ['recovery.md', '管理者向け復旧.md']]) assets.set(targetName, await fs.readFile(path.join(root, 'docs', sourceName)));
  if (workbook) assets.set('MVP6th.xlsm', await fs.readFile(workbook.file));
  if (mode === 'release') {
    for (const kind of ['engine', 'app']) assets.set('verification/' + kind + '.json', Buffer.from(JSON.stringify(acceptance.receipts[kind], null, 2) + '\n'));
  }
  const hashes = hashesOf(assets);
  // Validate everything before creating a destination. Never overwrite a deployment.
  const out = path.join(path.resolve(outputRoot), appName);
  await fs.mkdir(path.dirname(out), { recursive: true });
  try { await fs.mkdir(out); } catch (error) { if (error.code === 'EEXIST') throw new Error('Output already exists. Use a new output directory: ' + out); throw error; }
  for (const [relative, bytes] of assets) {
    const targetFile = path.join(out, relative);
    await fs.mkdir(path.dirname(targetFile), { recursive: true });
    await fs.writeFile(targetFile, bytes);
  }
  for (const folder of ['accepted', 'rejected', '.pending', '.sessions', 'backups']) await fs.mkdir(path.join(out, 'data', folder), { recursive: true });
  if (mode !== 'release') {
    await fs.writeFile(path.join(out, '最初に読む_検証用です.txt'), mode === 'development'
      ? '開発検証用です。完成ブックがない場合はHTMLの検証にだけ使用してください。利用者向け配布ではありません。\n'
      : '実機検証用です。Windows / JUST Calc / Edgeでの検収が完了するまで、業務データを入れたり利用者へ配布したりしないでください。\n');
    await fs.copyFile(path.join(root, 'docs/acceptance-test.md'), path.join(out, '実機試験.md'));
  }
  await fs.writeFile(path.join(out, 'release-manifest.json'), JSON.stringify({
    schemaVersion: 2, runtimeVersion: VERSION, appId: config.appId, mode,
    workbookAssembly: workbook ? 'source-verified' : 'not-assembled',
    targetPlatformValidation: mode === 'release' ? 'passed' : 'pending',
    distributionReady: mode === 'release', siteReady: false,
    commissioning: '導入先での確認は verification/site-*.json に追記します。ブックと業務データは差し替えません。',
    target, identity, immutableFiles, hashes
  }, null, 2) + '\n');
  return out;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = name => args.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
  const mode = flag('mode') ?? 'release';
  const positional = args.filter(arg => !arg.startsWith('--'));
  const output = positional[0] ?? path.join(root, mode === 'release' ? 'dist' : mode === 'candidate' ? 'candidates' : 'dev-dist');
  const apps = positional.slice(1).length ? positional.slice(1) : ['progress-board', 'workflow-studio'];
  for (const name of apps) console.log(await buildApp(name, output, { mode, evidenceDir: flag('evidence-dir'), targetFile: flag('target') }));
}
