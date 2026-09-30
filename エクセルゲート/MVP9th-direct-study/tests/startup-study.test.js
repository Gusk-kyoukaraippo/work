const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');const {stats,summarize}=require('../startup-study/summary.js');
const root=path.resolve(__dirname,'..');
test('fractional VBA Str literals remain valid in timing JS and export as strict JSON',()=>{
 const vm=require('node:vm'),sandbox={window:{}};vm.runInNewContext('window.timing={phase:.5,drift:-.25};',sandbox);
 assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.timing)),{phase:0.5,drift:-0.25});
});
const row=(profile,time,extra={})=>({schemaVersion:1,study:'excel-gate-startup-study-1',valid:true,profile,totalMs:time,handoffMs:20,phasesMs:{workbookSave:time-20},startedLocalMs:time,browserState:'warm',host:'JUST Calc',dataSet:'初期データ',browser:'Edge test',...extra});
test('summary retains medians and tails, splits conditions and ignores duplicate/reloaded/bad samples',()=>{
 assert.deepEqual(stats([9,1,3,7]),{n:4,mean:5,median:5,p90:9,max:9});
 const data=[row('baseline',10000),row('baseline',12000),row('minimal',2000),row('minimal',3000),row('direct',1000),row('direct',1500),row('baseline',10000),row('minimal',5,{valid:false}),row('minimal',-1),row('minimal',9000,{browserState:'cold'})];
 const result=summarize(data);assert.equal(result.groups.length,2);assert.equal(result.rejected.length,3);
 assert.equal(result.groups[0].medianReductionMs,8500);assert.equal(result.groups[0].medianRemainingVsDirectMs,1250);
 assert.equal(result.groups[1].medianReductionMs,null);assert.equal(result.groups[0].profiles.baseline.total.max,12000);
});
test('startup preserves durable save and copy checks, scopes caches and clears them before rollback',async()=>{
 const main=await fs.readFile(path.join(root,'vba/utf8/GateMain.bas'),'utf8'),s=main.split('Public Sub OpenEditHtml()')[1].split('End Sub')[0];
 assert.ok(s.indexOf('GateSaveWorkbook "start-session"')<s.indexOf('GateStartupWriteReport htmlFile'));
 assert.ok(s.indexOf('GateStartupWriteReport htmlFile')<s.indexOf('GateOpenLocalFile htmlFile'));
 assert.match(s,/openError = Err.Description\s+GateStartupEnd[\s\S]*GateEndSessionPersisted/);
 assert.match(s,/GateStartupEnd\s+GateOpenLocalFile/);
 const storage=await fs.readFile(path.join(root,'vba/utf8/GateStorage.bas'),'utf8');
 assert.match(storage,/FileCopy sourceFile, destinationFile/);assert.equal((storage.split("Public Sub GateCopyRawVerified")[1].split("End Sub")[0].match(/UCase\$\(GateCrc32File\(/g)||[]).length,4);
 for(const routine of ['GateMetaSet','GateEnsureInternalSheets','GateRestoreSheet'])assert.match(storage,new RegExp('(?:Public|Private) Sub '+routine+'[^\\n]*\\n    GateStartupInvalidateMeta'));
});
let browser,tmp;
test.before(async()=>{const {chromium}=require('playwright');browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});tmp=await fs.mkdtemp(path.join(os.tmpdir(),'gate-startup-study-'));for(const name of ['excel-gate.js','excel-gate-core.js'])await fs.copyFile(path.join(root,'shared',name),path.join(tmp,name));await fs.copyFile(path.join(root,'apps/rehab-inventory/excel-gate-benchmark.js'),path.join(tmp,'benchmark.js'));});
test.after(async()=>{await browser?.close();if(tmp)await fs.rm(tmp,{recursive:true,force:true});});
async function fixture(name,{broken=false}={}){
 const context={runtimeVersion:'0.8.0',mode:'edit',readOnly:false,hasPayload:false,dataSource:'workbook',databaseId:'test-only',dataType:'test-app',schemaVersion:2,baseRevision:0,sessionId:'test-session',authorRequired:false};
 const html=`<!doctype html><html><head><script>window.__EXCEL_GATE_CONTEXT__=${JSON.stringify(context)};window.__EXCEL_GATE_TIMING__={schemaVersion:1,profile:'minimal',startedLocalMs:Date.now()-new Date().getTimezoneOffset()*60000-200,handoffLocalMs:Date.now()-new Date().getTimezoneOffset()*60000-10,phasesMs:{workbookSave:190},detailMs:{fileCopy:0,crcWithFileRead:0},runtimeBytes:0};</script><script src="benchmark.js"></script><script src="excel-gate-core.js"></script><script src="excel-gate.js"></script></head><body><input name="staffId"><script>const waiting=new Promise(r=>window.finishLoading=r);ExcelGate.connect({ready:waiting,load(){${broken?"throw Error('test rejected payload');":""}},exportData(){return {a:1}},setReadOnly(){}}).catch(()=>{});</script></body></html>`;
 await fs.writeFile(path.join(tmp,name+'.html'),html);const page=await browser.newPage({acceptDownloads:true});page.on('dialog',d=>d.dismiss());await page.goto(pathToFileURL(path.join(tmp,name+'.html')).href);return page;
}
test('readiness waits for adapter and modal release, reports once, downloads only anonymous timing and rejects reload',async()=>{
 const p=await fixture('ready');assert.equal(await p.evaluate(()=>window.__EXCEL_GATE_BENCHMARK_RESULT__),undefined);
 assert.equal(await p.locator('excel-gate-panel dialog').isVisible(),true);
 await p.evaluate(()=>finishLoading());await p.waitForFunction(()=>window.__EXCEL_GATE_BENCHMARK_RESULT__);
 const report=await p.evaluate(()=>window.__EXCEL_GATE_BENCHMARK_RESULT__);assert.equal(report.valid,true);assert.ok(report.totalMs>=200);assert.ok(report.totalMs>=report.handoffMs);
 await p.locator('input[name="staffId"]').fill('1234');await p.locator('#excel-gate-benchmark summary').click();await p.locator('#excel-gate-benchmark #browser').selectOption('warm');await p.locator('#excel-gate-benchmark #host').selectOption('JUST Calc');
 const downloaded=p.waitForEvent('download');await p.locator('#excel-gate-benchmark button').click();const saved=JSON.parse(await fs.readFile(await(await downloaded).path(),'utf8'));
 assert.equal(saved.userInputObserved,true);assert.equal(saved.browserState,'warm');assert.equal(saved.host,'JUST Calc');for(const k of ['payload','databaseId','sessionId','dataType'])assert.equal(Object.hasOwn(saved,k),false);
 p.removeAllListeners("dialog");p.on("dialog",d=>d.accept());await p.reload();await p.evaluate(()=>finishLoading());await p.waitForFunction(()=>window.__EXCEL_GATE_BENCHMARK_RESULT__);assert.equal(await p.evaluate(()=>__EXCEL_GATE_BENCHMARK_RESULT__.valid),false);await p.close();
});
test('rejected payload never receives a ready success result',async()=>{
 const p=await fixture('broken',{broken:true});await p.evaluate(()=>finishLoading());await p.waitForFunction(()=>document.querySelector('excel-gate-panel').shadowRoot.querySelector('#status').textContent==='test rejected payload');assert.equal(await p.evaluate(()=>window.__EXCEL_GATE_BENCHMARK_RESULT__),undefined);await p.close();
});
test('packaged real app and direct comparator produce ready records with intact images',async()=>{
 const folder=path.resolve(root,'../MVP9th-startup-study/deliverables/起動時間比較一式');
 const {createHarness}=await import('../scripts/browser-harness.mjs');const previous=process.env.EXCEL_GATE_STAGE;process.env.EXCEL_GATE_STAGE=path.join(folder,'B_最小改修比較');const h=await createHarness();
 try{const p=await h.open();await p.evaluate(()=>{const now=Date.now()-new Date().getTimezoneOffset()*60000;window.__EXCEL_GATE_TIMING__={schemaVersion:1,profile:'minimal',startedLocalMs:now-10000,handoffLocalMs:now-20,phasesMs:{runtimeCopyAndVerify:9980},detailMs:{fileCopy:20,crcWithFileRead:9900},runtimeBytes:5900000};ExcelGateBenchmark.ready();});await p.waitForFunction(()=>window.__EXCEL_GATE_BENCHMARK_RESULT__);assert.equal(await p.evaluate(()=>__EXCEL_GATE_BENCHMARK_RESULT__.valid),true);assert.deepEqual(p.gateErrors,[]);await p.screenshot({path:path.join(root,'verification/startup-study/diagnostic-browser-synthetic.png'),fullPage:true});await p.close();}finally{await h.close();if(previous===undefined)delete process.env.EXCEL_GATE_STAGE;else process.env.EXCEL_GATE_STAGE=previous;}
 const direct=path.join(folder,'C_HTML直開き/direct/index.html');const p=await browser.newPage();await p.goto(pathToFileURL(direct).href);await p.evaluate(()=>{const now=Date.now()-new Date().getTimezoneOffset()*60000;window.__EXCEL_GATE_TIMING__={schemaVersion:1,profile:'direct',startedLocalMs:now-100,handoffLocalMs:now-100,phasesMs:{directLaunchPreparation:0},detailMs:{fileCopy:0,crcWithFileRead:0},runtimeBytes:0};ExcelGateBenchmark.ready();});await p.waitForFunction(()=>window.__EXCEL_GATE_BENCHMARK_RESULT__);assert.equal(await p.evaluate(()=>__EXCEL_GATE_BENCHMARK_RESULT__.valid),true);assert.ok(await p.locator('img').count()>=4);await p.close();
});
test('comparison page loads reports and renders measured differences without HTML injection',async()=>{
 const p=await browser.newPage();await p.goto(pathToFileURL(path.join(root,'startup-study/結果を比較.html')).href);
 await p.locator('#files').setInputFiles([row('baseline',10000),row('minimal',2000),row('direct',500)].map((r,i)=>({name:i+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...r,dataSet:'<img src=x onerror=alert(1)>'}))})));
 await p.waitForFunction(()=>document.querySelectorAll('#results section').length===1);assert.match(await p.locator('#results').textContent(),/8\.000 秒/);assert.match(await p.locator('#results').textContent(),/1\.500 秒/);assert.equal(await p.locator('#results img').count(),0);await p.screenshot({path:path.join(root,'verification/startup-study/summary-browser-synthetic.png'),fullPage:true});await p.close();
});
