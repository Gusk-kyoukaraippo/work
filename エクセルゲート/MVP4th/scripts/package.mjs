import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '0.4.0';
async function verifiedWorkbook() {
  const file = path.join(root, 'workbook/MVP4th.xlsm');
  try { await fs.access(file); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const receipt = JSON.parse(await fs.readFile(path.join(root, 'workbook/MVP4th.build.json'), 'utf8'));
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash(await fs.readFile(file)) !== receipt.sha256 || !receipt.validation.embeddedSourceMatches || !receipt.validation.uninitialized) throw new Error('Workbook verification receipt is invalid');
  for (const [relative, expected] of Object.entries(receipt.sourceHashes)) {
    validRelative(relative);
    if (hash(await fs.readFile(path.join(root, relative))) !== expected) throw new Error('Rebuild and verify the common workbook after VBA changes: ' + relative);
  }
  return file;
}
export function validRelative(file) {
  if (typeof file !== 'string' || !file || /[\\:"<>|?*\x00-\x1f]/.test(file) || file.startsWith('/') ||
      file.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Invalid relative path: ' + file);
  return file;
}
export function validateConfig(config) {
  if (!config || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(config.appId) || !config.displayName || /[\x00-\x1f]/.test(config.displayName) ||
      config.runtimeVersion !== VERSION || !Number.isInteger(config.dataVersion) || config.dataVersion < 1 ||
      !['view', 'block'].includes(config.viewPolicy) || typeof config.authorRequired !== 'boolean' ||
      !Array.isArray(config.files) || !config.files.includes(config.entry)) throw new Error('Invalid deployment configuration');
  config.files.forEach(validRelative); validRelative(config.entry);
  const keys = config.files.map(x => x.toLowerCase());
  if (new Set(keys).size !== keys.length || keys.some(x => ['excel-gate-boot.js', 'excel-gate.js', 'excel-gate-core.js'].includes(x))) throw new Error('Duplicate or reserved runtime file');
  return config;
}
export async function buildApp(appName, outputRoot = path.join(root, 'dist')) {
  validRelative(appName);
  const source = path.join(root, 'apps', appName);
  const config = validateConfig(JSON.parse(await fs.readFile(path.join(source, 'gate.config.json'), 'utf8')));
  const workbookFile = await verifiedWorkbook();
  const out = path.join(outputRoot, appName);
  // Never overwrite a deployed workbook or archived data with a build.
  try { await fs.access(out); throw new Error('Output already exists. Use a new output directory: ' + out); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  await fs.mkdir(path.join(out, 'runtime'), { recursive: true });
  const files = [...config.files, 'excel-gate-boot.js', 'excel-gate-core.js', 'excel-gate.js'];
  for (const relative of config.files) {
    const input = path.join(source, relative);
    const stat = await fs.lstat(input);
    if (!stat.isFile() || !path.relative(source, await fs.realpath(input)).split(path.sep).every(p => p !== '..')) throw new Error('Only regular app files inside the source directory are allowed');
    const target = path.join(out, 'runtime', relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (relative !== config.entry) await fs.copyFile(input, target);
    else {
      let html = await fs.readFile(input, 'utf8');
      const marker = /<!-- EXCEL_GATE_START -->[\s\S]*?<!-- EXCEL_GATE_END -->/g;
      if ((html.match(marker) || []).length !== 1) throw new Error('Exactly one explicit gate boot block is required');
      const index = html.indexOf('<!-- EXCEL_GATE_START -->');
      if (/<script\b/i.test(html.slice(0, index))) throw new Error('Gate boot must precede business scripts');
      if (/http-equiv\s*=\s*["']Content-Security-Policy/i.test(html)) throw new Error('CSP entry needs an explicitly tested integration');
      const prefix = path.posix.relative(path.posix.dirname(config.entry), '.') || '.';
      html = html.replace(marker, '<script>window.__EXCEL_GATE_REQUIRED__=true;</script>\n' + ['excel-gate-boot.js', 'excel-gate-core.js', 'excel-gate.js'].map(file => '<script src="' + prefix + '/' + file + '"></script>').join('\n'));
      await fs.writeFile(target, html);
    }
  }
  for (const file of ['excel-gate-core.js', 'excel-gate.js']) await fs.copyFile(path.join(root, 'shared', file), path.join(out, 'runtime', file));
  await fs.writeFile(path.join(out, 'runtime/excel-gate-boot.js'), 'window.__EXCEL_GATE_CONTEXT__={invalid:true};\n');
  await fs.writeFile(path.join(out, 'runtime-files.txt'), files.join('\r\n') + '\r\n');
  await fs.writeFile(path.join(out, 'gate.config.json'), JSON.stringify(config, null, 2) + '\n');
  for (const folder of ['accepted', 'rejected', '.pending', '.sessions', 'backups']) await fs.mkdir(path.join(out, 'data', folder), { recursive: true });
  await fs.cp(path.join(root, 'vba'), path.join(out, 'vba'), { recursive: true });
  await fs.mkdir(path.join(out, 'shared'));
  for (const file of ['help.html', 'history.template.html']) await fs.copyFile(path.join(root, 'shared', file), path.join(out, 'shared', file));
  await fs.copyFile(path.join(root, 'workbook/MVP4th-template.xlsx'), path.join(out, 'MVP4th-template.xlsx'));
  if (workbookFile) await fs.copyFile(workbookFile, path.join(out, 'MVP4th.xlsm'));
  await fs.copyFile(path.join(root, 'docs/install.md'), path.join(out, '導入手順.md'));
  for (const file of ['acceptance-test.md', 'recovery.md', 'verification.md', 'test-report.txt']) await fs.copyFile(path.join(root, 'docs', file), path.join(out, file));
  await fs.cp(path.join(root, 'tests/windows'), path.join(out, 'tests/windows'), { recursive: true });
  const hashes = {};
  for (const file of files) hashes['runtime/' + file] = crypto.createHash('sha256').update(await fs.readFile(path.join(out, 'runtime', file))).digest('hex');
  for (const file of (await fs.readdir(path.join(out, 'vba'))).filter(x => x.endsWith('.bas'))) hashes['vba/' + file] = crypto.createHash('sha256').update(await fs.readFile(path.join(out, 'vba', file))).digest('hex');
  for (const file of ['MVP4th-template.xlsx', 'vba/ThisWorkbook.txt', 'gate.config.json', 'runtime-files.txt', 'shared/help.html', 'shared/history.template.html', ...(workbookFile ? ['MVP4th.xlsm'] : [])]) hashes[file] = crypto.createHash('sha256').update(await fs.readFile(path.join(out, file))).digest('hex');
  await fs.writeFile(path.join(out, 'release-manifest.json'), JSON.stringify({ runtimeVersion: VERSION, appId: config.appId, workbookAssembly: workbookFile ? 'source-verified' : 'import-required', targetPlatformValidation: 'pending', hashes }, null, 2) + '\n');
  return out;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  for (const name of ['progress-board', 'workflow-studio']) console.log(await buildApp(name, output));
}
