import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'deliverables/DXダッシュボード-Windows連携');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false' } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
run(process.execPath, ['scripts/build.mjs']);
run(process.env.DX_DOTNET || 'dotnet', ['build', 'launcher/DXWorkbookLauncher.csproj', '-c', 'Release', '--nologo']);
const copies = [
  ['DXダッシュボード.html', 'DXダッシュボード.html'],
  ['README.md', 'ダッシュボードの使い方.md'],
  ['検証記録.md', '検証記録.md'],
  ['launcher/使い方.md', 'Windows起動設定/使い方.md'],
  ['launcher/bin/Release/net48/DXWorkbookLauncher.exe', 'Windows起動設定/DXWorkbookLauncher.exe'],
  ['launcher/bin/Release/net48/DXWorkbookLauncher.exe.config', 'Windows起動設定/DXWorkbookLauncher.exe.config'],
  ...['LauncherCore.cs', 'Program.cs', 'DXWorkbookLauncher.csproj'].map(file => [`launcher/${file}`, `Windows起動設定/source/${file}`])
];
for (const [from, to] of copies) {
  await mkdir(path.dirname(path.join(output, to)), { recursive: true });
  if (from === 'README.md') {
    const contents = (await readFile(path.join(root, from), 'utf8'))
      .replace('(deliverables/DXダッシュボード-Windows連携.zip)', '(Windows起動設定/使い方.md)')
      .replace('(launcher/使い方.md)', '(Windows起動設定/使い方.md)');
    await writeFile(path.join(output, to), contents);
  } else await copyFile(path.join(root, from), path.join(output, to));
}
const generated = [
  ['Windows起動設定/初回設定.cmd', '@echo off\r\nsetlocal DisableDelayedExpansion\r\nstart "" "%~dp0DXWorkbookLauncher.exe" --setup\r\n'],
  ['Windows起動設定/登録を解除.cmd', '@echo off\r\nsetlocal DisableDelayedExpansion\r\nstart "" "%~dp0DXWorkbookLauncher.exe" --uninstall\r\n'],
  ['最初に読む.txt', 'DXダッシュボード Windows連携版\r\n\r\n1. ZIPを展開します。\r\n2. DXダッシュボード.htmlにブックを登録し、更新HTMLを共有先へ配置します。\r\n3. 各PCのWindows起動設定/初回設定.cmdを実行し、配置済みのHTMLを選んで登録します。\r\n4. Edgeで共有先のHTMLを開き、「ブックを開く」を押します。\r\n\r\n詳しい手順は Windows起動設定/使い方.md にあります。\r\nWindows実機検証用です。Edgeの起動確認が出る場合があります。\r\n配布HTMLは空データです。実データ入りのHTMLを上書きしないでください。\r\n']
];
for (const [file, contents] of generated) await writeFile(path.join(output, file), contents, 'utf8');
const files = [...copies.map(pair => pair[1]), ...generated.map(pair => pair[0])];
const hashes = {};
for (const file of files) hashes[file] = createHash('sha256').update(await readFile(path.join(output, file))).digest('hex');
const manifest = { version: '1.0.0', status: 'Windows実機検証用', windowsRuntimeVerified: false, files: hashes };
await writeFile(path.join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
run(process.env.DX_PYTHON || 'python3', ['-c', 'import pathlib,sys,zipfile\np=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(str(p)+".zip","w",zipfile.ZIP_DEFLATED) as z:\n for f in sorted(p.rglob("*")):\n  if f.is_file() and f.name != ".DS_Store": z.write(f,f.relative_to(p.parent))\n', output]);
console.log(`Windows連携の配布一式: ${output}.zip`);
