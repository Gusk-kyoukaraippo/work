import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAppFiles, validRelative } from './package.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function initApp(inputPath, appName, appId, displayName) {
  validRelative(appName);
  if (appName.includes('/') || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(appId) || !displayName?.trim()) throw new Error('Specify an app folder name, stable app ID and display name');
  const input = path.resolve(inputPath), stat = await fs.lstat(input);
  if (stat.isSymbolicLink()) throw new Error('Use a regular file or app folder');
  const out = path.join(root, 'apps', appName);
  const files = stat.isDirectory() ? await collectAppFiles(input) : ['index.html'];
  if (!stat.isDirectory() && !stat.isFile()) throw new Error('Use a regular file or app folder');
  if (!files.includes('index.html')) throw new Error('The app folder must contain index.html');
  if (files.some(file => /^(gate-adapter|excel-gate(?:-boot|-core)?)\.js$/i.test(file))) throw new Error('Input already contains gate files');
  let html = await fs.readFile(stat.isDirectory() ? path.join(input, 'index.html') : input, 'utf8');
  if (/EXCEL_GATE_START|ExcelGate\.connect/.test(html)) throw new Error('Input already has an integration; copy its reviewed source instead');
  if (!/<head\b[^>]*>/i.test(html) || !/<\/body\s*>/i.test(html)) throw new Error('The starter requires explicit head and body tags');
  const boot = '\n<!-- EXCEL_GATE_START -->\n<script src="../../shared/standalone-boot.js"></script>\n<script src="../../shared/excel-gate-core.js"></script>\n<script src="../../shared/excel-gate.js"></script>\n<!-- EXCEL_GATE_END -->';
  html = html.replace(/<head\b[^>]*>/i, match => match + boot).replace(/<\/body\s*>/i, '<script src="gate-adapter.js"></script>\n</body>');
  await fs.mkdir(path.dirname(out), { recursive: true });
  try { await fs.mkdir(out); } catch (error) { if (error.code === 'EEXIST') throw new Error('App already exists; no files were overwritten'); throw error; }
  for (const file of files) {
    const target = path.join(out, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (file === 'index.html') await fs.writeFile(target, html);
    else await fs.copyFile(path.join(input, file), target);
  }
  await fs.writeFile(path.join(out, 'gate.config.json'), JSON.stringify({ displayName, appId, dataVersion: 1, entry: 'index.html' }, null, 2) + '\n');
  await fs.copyFile(path.join(root, 'templates/gate-adapter.js'), path.join(out, 'gate-adapter.js'));
  return out;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4) throw new Error('Usage: node scripts/init-app.mjs <source.html|app-folder> <app-folder-name> <stable-app-id> <display-name>');
  console.log(await initApp(...args));
  console.log('Finish gate-adapter.js and verify initialization, storage and read-only behavior before building.');
}
