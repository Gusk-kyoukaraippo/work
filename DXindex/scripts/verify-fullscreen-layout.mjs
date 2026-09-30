// Read-only workbook comparison; native Excel preserves and compiles the VBA.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const base = path.resolve('outputs/01a0c900-623e-71d2-9af0-a2392f990288');
const work = path.join(base, 'fullscreen-r4/.build');
try {
  await fs.symlink(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), path.join(work, 'node_modules'));
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
const require = createRequire(path.join(work, 'verify.mjs'));
const {SpreadsheetFile, FileBlob} = await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
const oldFile = (await fs.readdir(path.join(base, 'fullscreen-r3'))).find(n => n.endsWith('.xlsm'));
const newFile = (await fs.readdir(path.join(base, 'fullscreen-r4'))).find(n => n.endsWith('.xlsm'));
const old = await SpreadsheetFile.importXlsx(await FileBlob.load(path.join(base, 'fullscreen-r3', oldFile)));
const revised = await SpreadsheetFile.importXlsx(await FileBlob.load(path.join(base, 'fullscreen-r4', newFile)));
for (const name of ['アプリホーム', 'アプリ登録']) {
  const a = old.worksheets.getItem(name).getRange('A1:AF43');
  const b = revised.worksheets.getItem(name).getRange('A1:AF43');
  assert.deepEqual(a.formulas, b.formulas, `Formulas changed: ${name}`);
  const av = a.values, bv = b.values;
  for (let r = 0; r < av.length; r++) {
    for (let c = 0; c < av[r].length; c++) {
      assert.equal(bv[r][c] ?? null, av[r][c] ?? null, `Unexpected value change: ${name} R${r+1}C${c+1}`);
    }
  }
}
revised.recalculate();
const errors = await revised.inspect({kind:'match', searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!', options:{useRegex:true,maxResults:50}, summary:'r4 formula scan'});
await fs.writeFile(path.join(work, 'formula-scan.ndjson'), errors.ndjson);
const png = await revised.render({sheetName:'アプリ登録', range:'A1:G15', scale:1.4, format:'png'});
await fs.writeFile(path.join(work, 'admin-r4.png'), new Uint8Array(await png.arrayBuffer()));
console.log('PASS: unchanged registration data and formulas; rendered revised administration view.');
console.log(errors.ndjson);
