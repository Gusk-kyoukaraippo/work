import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.env.DX_EXCEL_OUTPUT || path.join(root, 'outputs/01a0c900-623e-71d2-9af0-a2392f990288'));
for (const script of ['build.mjs', 'build-excel-launcher.mjs']) {
  const run = spawnSync(process.execPath, [path.join(root, 'scripts', script)], { cwd: root, stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status || 1);
}
const visual = spawnSync(process.execPath, [path.join(root,'scripts/build-excel-launcher.mjs')], {cwd:root,stdio:'inherit',env:{...process.env,DX_VISUAL_STRESS:'1'}});
if (visual.status !== 0) process.exit(visual.status || 1);
await fs.copyFile(path.join(root, 'DX活動ガイド.html'), path.join(output, 'DX活動ガイド.html'));
await fs.copyFile(path.join(root, 'excel-launcher/使い方.md'), path.join(output, '使い方.md'));
const python = process.env.DX_PYTHON || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
const run = spawnSync(python, ['-c', 'import sys,zipfile,pathlib; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(p/"DXアプリホーム-配布一式.zip","w",zipfile.ZIP_DEFLATED); [z.write(p/n,n) for n in ["DXアプリホーム.xlsx","DX活動ガイド.html","使い方.md"]]; z.close()', output], { encoding: 'utf8' });
if (run.status !== 0) throw new Error(run.stderr);
console.log(`配布一式: ${output}`);
