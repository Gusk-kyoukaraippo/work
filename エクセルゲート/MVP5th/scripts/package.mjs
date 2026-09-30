import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = '0.5.0';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
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
  const keys = config.files.map(x => x.toLowerCase());
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
  const config = {
    displayName: input.displayName, appId: input.appId, dataVersion: input.dataVersion ?? 1,
    entry: input.entry ?? 'index.html', files: await collectAppFiles(source), runtimeVersion: VERSION,
    viewPolicy: input.viewPolicy ?? 'view', authorRequired: input.authorRequired ?? true
  };
  return validateConfig(config);
}
async function verifiedWorkbook() {
  const file = path.join(root, 'workbook/MVP5th.xlsm');
  try { await fs.access(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const receipt = JSON.parse(await fs.readFile(path.join(root, 'workbook/MVP5th.build.json'), 'utf8'));
  if (sha256(await fs.readFile(file)) !== receipt.sha256 || !receipt.validation.embeddedSourceMatches || !receipt.validation.uninitialized || !receipt.validation.setupButton) throw new Error('Workbook verification receipt is invalid');
  for (const [relative, expected] of Object.entries(receipt.sourceHashes)) {
    validRelative(relative);
    if (sha256(await fs.readFile(path.join(root, relative))) !== expected) throw new Error('Rebuild and verify the common workbook after VBA changes: ' + relative);
  }
  // Every source must be covered; a stale/incomplete receipt must not approve a new module.
  for (const name of (await fs.readdir(path.join(root, 'vba/utf8'))).filter(x => x.endsWith('.bas'))) {
    for (const relative of ['vba/utf8/' + name, 'vba/' + name]) if (!receipt.sourceHashes[relative]) throw new Error('Missing source hash: ' + relative);
  }
  if (!receipt.sourceHashes['vba/ThisWorkbook.txt']) throw new Error('Missing workbook event hash');
  return { file, receipt };
}
export function validateAcceptance(evidence, workbookHash, hashes, appId) {
  if (!evidence || evidence.status !== 'passed' || evidence.workbookSha256 !== workbookHash ||
      !evidence.testedAt || !evidence.tester || !evidence.justCalcVersion || !evidence.edgeVersion || !evidence.windowsVersion ||
      !Array.isArray(evidence.pcIds) || evidence.pcIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(evidence.pcIds.map(id => id.trim())).size < 2 || !evidence.appIds?.includes(appId)) throw new Error('Windows / JUST Calc / Edge acceptance evidence is incomplete');
  for (const key of ['setup', 'roundTrip', 'midSave', 'readOnly', 'twoPcLock', 'handoff', 'wrongKind', 'missingDuplicateForeignBranch', 'networkFailure', 'restartRecovery', 'closeFailure', 'otherWorkbookUnchanged']) {
    if (evidence.checks?.[key] !== true) throw new Error('Acceptance check has not passed: ' + key);
  }
  for (const [file, hash] of Object.entries(hashes)) if (evidence.appHashes?.[appId]?.[file] !== hash) throw new Error('Acceptance evidence is stale for ' + appId + '/' + file);
}
export async function buildApp(appName, outputRoot = path.join(root, 'dist'), options = {}) {
  validRelative(appName);
  if (appName.includes('/')) throw new Error('App name must be a single folder name');
  const mode = options.mode ?? 'release';
  if (!['release', 'candidate', 'development'].includes(mode)) throw new Error('Unknown package mode');
  const source = path.join(root, 'apps', appName);
  const config = await resolveConfig(source);
  const workbook = await verifiedWorkbook();
  if (mode !== 'development' && !workbook) throw new Error('A source-verified, uninitialized MVP5th.xlsm is required. Development packages are not user releases.');
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
  for (const file of ['excel-gate-core.js', 'excel-gate.js']) assets.set('runtime/' + file, await fs.readFile(path.join(root, 'shared', file)));
  assets.set('runtime/excel-gate-boot.js', Buffer.from('window.__EXCEL_GATE_CONTEXT__={invalid:true};\n'));
  const files = [...config.files, 'excel-gate-boot.js', 'excel-gate-core.js', 'excel-gate.js'];
  assets.set('runtime-files.txt', Buffer.from(files.join('\r\n') + '\r\n'));
  assets.set('gate.config.json', Buffer.from(JSON.stringify(config, null, 2) + '\n'));
  for (const file of ['help.html', 'history.template.html']) assets.set('shared/' + file, await fs.readFile(path.join(root, 'shared', file)));
  for (const [sourceName, targetName] of [['user-guide.md', '使い方.md'], ['install.md', '導入手順.md'], ['recovery.md', '管理者向け復旧.md']]) assets.set(targetName, await fs.readFile(path.join(root, 'docs', sourceName)));
  if (workbook) assets.set('MVP5th.xlsm', await fs.readFile(workbook.file));
  const hashes = Object.fromEntries([...assets].map(([file, bytes]) => [file, sha256(bytes)]));
  if (mode === 'release') {
    const evidence = JSON.parse(await fs.readFile(options.acceptanceFile ?? path.join(root, 'verification/target-acceptance.json'), 'utf8'));
    validateAcceptance(evidence, workbook.receipt.sha256, hashes, config.appId);
  }
  // Validate everything before creating a destination. Never overwrite a deployment.
  const out = path.join(path.resolve(outputRoot), appName);
  await fs.mkdir(path.dirname(out), { recursive: true });
  try { await fs.mkdir(out); } catch (error) { if (error.code === 'EEXIST') throw new Error('Output already exists. Use a new output directory: ' + out); throw error; }
  for (const [relative, bytes] of assets) {
    const target = path.join(out, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }
  for (const folder of ['accepted', 'rejected', '.pending', '.sessions', 'backups']) await fs.mkdir(path.join(out, 'data', folder), { recursive: true });
  if (mode !== 'release') {
    await fs.writeFile(path.join(out, '最初に読む_検証用です.txt'), mode === 'development'
      ? '開発検証用です。完成ブックがない場合はHTMLの検証にだけ使用してください。利用者向け配布ではありません。\n'
      : '実機検証用です。Windows / JUST Calc / Edgeでの検収が完了するまで、業務データを入れたり利用者へ配布したりしないでください。\n');
    await fs.copyFile(path.join(root, 'docs/acceptance-test.md'), path.join(out, '実機試験.md'));
  }
  await fs.writeFile(path.join(out, 'release-manifest.json'), JSON.stringify({ runtimeVersion: VERSION, appId: config.appId, mode, workbookAssembly: workbook ? 'source-verified' : 'not-assembled', targetPlatformValidation: mode === 'release' ? 'passed' : 'pending', hashes }, null, 2) + '\n');
  return out;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const modeArg = args.find(a => a.startsWith('--mode='));
  const mode = modeArg ? modeArg.slice(7) : 'release';
  const positional = args.filter(a => !a.startsWith('--'));
  const output = positional[0] ?? path.join(root, mode === 'release' ? 'dist' : mode === 'candidate' ? 'candidates' : 'dev-dist');
  const apps = positional.slice(1).length ? positional.slice(1) : ['progress-board', 'workflow-studio'];
  for (const name of apps) console.log(await buildApp(name, output, { mode }));
}
