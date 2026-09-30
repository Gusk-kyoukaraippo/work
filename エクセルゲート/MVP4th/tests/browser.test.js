const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
let browser, folder;
const configurations={};
test.before(async()=>{
  folder=await fs.mkdtemp(path.join(os.tmpdir(),'excel-gate-browser-'));
  const {buildApp}=await import('../scripts/package.mjs');
  for(const app of ['progress-board','workflow-studio']){
    await buildApp(app,folder);
    configurations[app]=JSON.parse(await fs.readFile(path.join(folder,app,'gate.config.json'),'utf8'));
  }
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
});
test.after(async()=>{if(browser)await browser.close();if(folder)await fs.rm(folder,{recursive:true,force:true});});
async function open(app, payload, mode='edit', invalid=false){
  const conf=configurations[app];
  const context={runtimeVersion:'0.4.0',displayName:conf.displayName,mode,readOnly:mode==='view',databaseId:'00000000-0000-4000-a000-000000000001',sessionId:'00000000-0000-4000-a000-000000000002',dataType:conf.appId,schemaVersion:conf.dataVersion,baseRevision:0,hasPayload:payload!==undefined,authorRequired:true,payload};
  const runtime=path.join(folder,app,'runtime');
  await fs.writeFile(path.join(runtime,'excel-gate-boot.js'),'window.__EXCEL_GATE_CONTEXT__='+JSON.stringify(invalid?{invalid:true}:context)+';');
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  page.on('dialog',d=>d.dismiss());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.__testTools=[];window.__storageWrites=0;window.__storageReads=0;
    Object.defineProperty(document,'modelContext',{configurable:true,value:{registerTool(t){window.__testTools.push(t)}}});
    const set=Storage.prototype.setItem,get=Storage.prototype.getItem;
    Storage.prototype.setItem=function(...args){window.__storageWrites++;return set.apply(this,args)};
    Storage.prototype.getItem=function(...args){window.__storageReads++;return get.apply(this,args)};
  });
  await page.goto(pathToFileURL(path.join(runtime,'index.html')).href);
  await page.locator('excel-gate-panel').waitFor();
  if(!invalid){await page.waitForFunction(()=>{const s=document.querySelector('excel-gate-panel').shadowRoot;return !s.querySelector('dialog').open});assert.deepEqual(errors,[]);}
  return page;
}
async function output(page, kind='workCopy'){
  await page.locator('excel-gate-panel #name').fill('テスト利用者');
  const pending=page.waitForEvent('download');
  const result=await page.evaluate(kind=>ExcelGate.exportFile(kind),kind);
  const download=await pending;
  assert.equal(download.suggestedFilename(),result.fileName);
  assert.equal(await fs.readFile(await download.path(),'utf8'),result.text);
  return JSON.parse(result.text);
}
test('progress board: file launch, pending form, payload round trip and isolated UI',async()=>{
  const p=await open('progress-board');
  assert.equal(await p.locator('.project-row').count(),0);
  await p.locator('#addProjectBtn').click();await p.locator('#projectNameInput').fill('MVP4進捗');await p.locator('#leaderInput').fill('担当者');
  await p.locator('excel-gate-panel #name').evaluate(el=>{el.value='テスト利用者';el.dispatchEvent(new Event('input'))});
  const failure=await p.evaluate(()=>ExcelGate.exportFile('complete').catch(e=>e.message));assert.match(failure,/確定|キャンセル/);
  assert.equal(await p.locator('#projectNameInput').inputValue(),'MVP4進捗');
  await p.locator('#projectForm button[type=submit]').click();
  const exported=await output(p);
  assert.equal(exported.exportSequence,1);assert.equal(exported.payload.projects[0].name,'MVP4進捗');
  assert.deepEqual(await p.evaluate(()=>[__storageReads,__storageWrites]),[0,0]);
  const r=await open('progress-board',exported.payload);
  const roundtrip=await output(r,'complete');assert.deepEqual(roundtrip.payload,exported.payload);
  await r.locator('excel-gate-panel dialog').waitFor({state:'visible'});
  assert.match(await r.locator('excel-gate-panel #modal-text').textContent(),/まだExcelへの正式保存ではありません/);
  const download=r.waitForEvent('download');await r.locator('excel-gate-panel #retry').click();
  assert.equal(await fs.readFile(await (await download).path(),'utf8'),JSON.stringify(roundtrip,null,2));
  await fs.mkdir(path.join(__dirname,'../test-results'),{recursive:true});
  await p.screenshot({path:path.join(__dirname,'../test-results/progress-board.png'),fullPage:true});
  await p.close();await r.close();
});
test('progress board: read-only preserves filters and rejects WebMCP writes',async()=>{
  const data={schemaVersion:2,app:'kaizen-project-progress-board',projects:[{id:'p1',name:'閲覧テスト',leader:'担当者',stage:2,status:'active',note:'',completedSubsteps:{},documents:[],createdAt:'2026-09-21T00:00:00Z',updatedAt:'2026-09-21T00:00:00Z',sample:false}]};
  const p=await open('progress-board',data,'view');
  assert.equal(await p.locator('#addProjectBtn').isDisabled(),true);assert.equal(await p.locator('#statusFilter').isEnabled(),true);
  assert.equal(await p.locator('excel-gate-panel #name-label').isVisible(),false);
  const blocked=await p.evaluate(()=>__testTools.filter(t=>!t.annotations.readOnlyHint).map(t=>{try{t.execute({});return false}catch(e){return /閲覧専用/.test(e.message)}}));
  assert.equal(blocked.length,2);assert.ok(blocked.every(Boolean));
  await p.locator('#statusFilter').selectOption('completed');assert.equal(await p.locator('.project-row').count(),0);await p.close();
});
test('workflow studio: drawer draft cannot be lost, full document payload survives reopen',async()=>{
  const p=await open('workflow-studio');await p.locator('#newProjectBtn').click();
  await p.locator('#newProjectName').fill('文書データ往復');await p.locator('#newProjectLeader').fill('担当者');await p.locator('#newProjectForm button.primary').click();
  await p.locator('[data-edit=sheetField][data-key=problem]').first().click();await p.locator('#markdownValue').fill('未確定の業務入力');
  await p.locator('excel-gate-panel #name').evaluate(el=>{el.value='テスト利用者';el.dispatchEvent(new Event('input'))});
  assert.match(await p.evaluate(()=>ExcelGate.exportFile('complete').catch(e=>e.message)),/確定|閉じて/);
  assert.equal(await p.locator('#markdownValue').inputValue(),'未確定の業務入力');await p.locator('#confirmEdit').click();
  const exported=await output(p);assert.equal(exported.payload.sheets.documents.improvement1.fields.problem,'未確定の業務入力');assert.equal(exported.payload.app,'dx-project-package');
  const r=await open('workflow-studio',exported.payload);const roundtrip=await output(r);assert.deepEqual(roundtrip.payload.sheets.documents,exported.payload.sheets.documents);assert.equal(roundtrip.payload.project.id,exported.payload.project.id);
  assert.deepEqual(await p.evaluate(()=>[__storageReads,__storageWrites]),[0,0]);
  await p.screenshot({path:path.join(__dirname,'../test-results/workflow-studio.png'),fullPage:true});await p.close();await r.close();
});
test('workflow studio: read-only blocks events and external APIs, retains document navigation',async()=>{
  const edit=await open('workflow-studio');await edit.locator('#newProjectBtn').click();await edit.locator('#newProjectName').fill('閲覧');await edit.locator('#newProjectLeader').fill('担当');await edit.locator('#newProjectForm button.primary').click();const data=(await output(edit)).payload;await edit.close();
  const p=await open('workflow-studio',data,'view');await p.locator('[data-edit=sheetField][data-key=problem]').first().click();assert.equal(await p.locator('#editorDrawer').getAttribute('aria-hidden'),'true');
  await p.locator('[data-doc=stakeholders]').first().click();assert.match(await p.locator('#canvasTitle').textContent(),/ステークホルダー/);
  const blocked=await p.evaluate(()=>__testTools.map(t=>{try{t.execute({});return false}catch(e){return /閲覧専用/.test(e.message)}}));assert.ok(blocked.length>0&&blocked.every(Boolean));await p.close();
});
test('distribution opened outside Excel and corrupted saved data both stay blocked',async()=>{
  const p=await open('progress-board',undefined,'edit',true);assert.equal(await p.locator('excel-gate-panel dialog').isVisible(),true);assert.equal(await p.locator('excel-gate-panel #work').isEnabled(),false);
  assert.equal(await p.evaluate(()=>ExcelGate.CANCEL===ExcelGate.cancel()),true);
  // A missing boot file must not silently revert to standalone localStorage/sample mode.
  await fs.unlink(path.join(folder,'progress-board/runtime/excel-gate-boot.js'));
  await p.reload();await p.locator('excel-gate-panel dialog').waitFor({state:'visible'});
  assert.equal(await p.evaluate(()=>ExcelGate.isLinked),true);
  assert.deepEqual(await p.evaluate(()=>[__storageReads,__storageWrites]),[0,0]);await p.close();
  // Saved {} is not first use. A business-level load error must not display samples.
  const runtime=path.join(folder,'progress-board/runtime');const cfg={runtimeVersion:'0.4.0',mode:'edit',readOnly:false,databaseId:'db-000000001',sessionId:'session-00001',dataType:'kaizen-project-progress-board',schemaVersion:2,baseRevision:0,hasPayload:true,payload:{}};
  await fs.writeFile(path.join(runtime,'excel-gate-boot.js'),'window.__EXCEL_GATE_CONTEXT__='+JSON.stringify(cfg));
  const r=await browser.newPage();await r.goto(pathToFileURL(path.join(runtime,'index.html')).href);await r.locator('excel-gate-panel dialog').waitFor({state:'visible'});assert.match(await r.locator('excel-gate-panel #modal-title').textContent(),/停止/);await r.close();
});
test('first-use viewing opens both apps without creating sample or editable data',async()=>{
  for(const app of ['progress-board','workflow-studio']) {
    const p=await open(app,undefined,'view');
    assert.equal(await p.locator('excel-gate-panel #work').isVisible(),false);
    assert.deepEqual(await p.evaluate(()=>[__storageReads,__storageWrites]),[0,0]);
    if(app==='workflow-studio') assert.match(await p.locator('#welcome').textContent(),/正式保存されたデータはありません/);
    else assert.equal(await p.locator('.project-row').count(),0);
    await p.close();
  }
});
