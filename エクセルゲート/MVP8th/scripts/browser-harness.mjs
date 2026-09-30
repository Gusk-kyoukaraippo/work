import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

export const REQUIRED_CHECKS = ['businessFlow','roundTrip','firstUseAndEmpty','pendingInput','readOnly','persistence','asyncSafety','finishedMutations'];
export async function check(key, action) {
  if (!REQUIRED_CHECKS.includes(key) || typeof action !== 'function') throw new Error('Unknown integration check: ' + key);
  await action();
  if (!process.env.EXCEL_GATE_TEST_RESULTS) throw new Error('Run these tests through integrate.mjs verify');
  await fs.appendFile(process.env.EXCEL_GATE_TEST_RESULTS, JSON.stringify({ key, passed: true, completedAt: new Date().toISOString() }) + '\n');
}
export async function createHarness() {
  const stage = process.env.EXCEL_GATE_STAGE;
  if (!stage) throw new Error('EXCEL_GATE_STAGE is required');
  const config = JSON.parse(await fs.readFile(path.join(stage,'gate.config.json'),'utf8'));
  const executablePath = process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const folders = [];
  return {
    config,
    async open(options = {}) {
      const folder = await fs.mkdtemp(path.join(os.tmpdir(),'gate-case-')); folders.push(folder);
      await fs.cp(path.join(stage,'runtime'),folder,{recursive:true});
      const csvFolder = config.dataSource === 'csvFolder';
      const mode = options.mode ?? (csvFolder ? 'view' : 'edit');
      const context = {runtimeVersion:config.runtimeVersion,displayName:config.displayName,accentColor:config.accentColor,dataSource:config.dataSource ?? 'workbook',mode,readOnly:mode==='view',databaseId:'integration-database',sessionId:'integration-session',dataType:config.appId,schemaVersion:config.dataVersion,baseRevision:0,hasPayload:Object.hasOwn(options,'payload'),authorRequired:config.authorRequired,...(Object.hasOwn(options,'payload')?{payload:options.payload}:{})};
      await fs.writeFile(path.join(folder,'excel-gate-boot.js'),'window.__EXCEL_GATE_CONTEXT__='+JSON.stringify(options.context ?? context)+';');
      if (csvFolder || Object.hasOwn(options,'source')) {
        const source = Object.hasOwn(options,'source') ? options.source : {sourcePath:'\\\\server\\share',readAt:'2026-09-21T12:00:00',files:[]};
        await fs.writeFile(path.join(folder,'excel-gate-source.js'),'window.__EXCEL_GATE_SOURCE__='+JSON.stringify(source)+';');
      }
      const page = await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
      page.on('dialog',d=>d.dismiss());
      page.gateErrors=[]; page.on('pageerror',e=>page.gateErrors.push(e.message));
      await page.addInitScript(()=>{
        window.__gateTestTools=[]; window.__gateStorageReads=0; window.__gateStorageWrites=0;
        Object.defineProperty(document,'modelContext',{configurable:true,value:{registerTool(t){window.__gateTestTools.push(t)}}});
        const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
        Storage.prototype.getItem=function(...args){window.__gateStorageReads++;return get.apply(this,args)};
        Storage.prototype.setItem=function(...args){window.__gateStorageWrites++;return set.apply(this,args)};
      });
      if (options.beforeLoad) await options.beforeLoad(page);
      await page.goto(pathToFileURL(path.join(folder,config.entry)).href);
      await page.locator('excel-gate-panel').waitFor();
      if (options.ready !== false) {
        await page.waitForFunction(()=>!document.querySelector('excel-gate-panel')?.shadowRoot.querySelector('dialog').open);
        assert.deepEqual(page.gateErrors,[]);
      }
      return page;
    },
    async output(page,kind='workCopy') {
      if(config.authorRequired)await page.locator('excel-gate-panel #name').fill('組み込み試験');
      const downloadPromise = page.waitForEvent('download');
      const result = await page.evaluate(kind=>ExcelGate.exportFile(kind),kind);
      assert.ok(result,'No export was produced');
      const download = await downloadPromise;
      const bytes = await fs.readFile(await download.path(),'utf8');
      assert.equal(bytes,result.text); assert.equal(download.suggestedFilename(),result.fileName);
      return JSON.parse(bytes);
    },
    async close() { await browser.close(); await Promise.all(folders.map(folder=>fs.rm(folder,{recursive:true,force:true}))); }
  };
}
