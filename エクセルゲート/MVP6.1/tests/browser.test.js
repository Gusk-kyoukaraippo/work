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
    await buildApp(app,folder,{mode:'development'});
    configurations[app]=JSON.parse(await fs.readFile(path.join(folder,app,'gate.config.json'),'utf8'));
  }
  const executablePath=process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
});
test.after(async()=>{if(browser)await browser.close();if(folder)await fs.rm(folder,{recursive:true,force:true});});
async function open(app, payload, mode='edit', invalid=false){
  const conf=configurations[app];
  const context={runtimeVersion:'0.6.0',displayName:conf.displayName,mode,readOnly:mode==='view',databaseId:'00000000-0000-4000-a000-000000000001',sessionId:'00000000-0000-4000-a000-000000000002',dataType:conf.appId,schemaVersion:conf.dataVersion,baseRevision:0,hasPayload:payload!==undefined,authorRequired:true,payload};
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
test('normal buttons lead to the correct workbook action and retain author across intermediate saves',async()=>{
  const p=await open('progress-board');
  const panel=p.locator('excel-gate-panel');
  assert.equal(await panel.locator('#finish').textContent(),'入力を終える');
  assert.equal(await panel.locator('#work').isVisible(),false);
  assert.equal(await p.locator('#exportBtn').isVisible(),false);
  await panel.locator('#finish').click();
  assert.match(await panel.locator('#status').textContent(),/保存者名を入力/);
  await panel.locator('#name').fill('継続する利用者');
  await panel.locator('summary').click();
  const pending=p.waitForEvent('download');
  await panel.locator('#work').click();
  const intermediate=JSON.parse(await fs.readFile(await (await pending).path(),'utf8'));
  assert.equal(intermediate.saveKind,'workCopy');
  assert.match(await panel.locator('#status').textContent(),/保存して続ける/);
  assert.match(await panel.locator('#status').textContent(),/まだブックへの保存は完了していません/);
  assert.equal(await panel.locator('dialog').isVisible(),false);
  const last=p.waitForEvent('download');
  await panel.locator('#finish').click();
  const complete=JSON.parse(await fs.readFile(await (await last).path(),'utf8'));
  assert.equal(complete.saveKind,'complete');
  assert.equal(complete.authorName,intermediate.authorName);
  assert.equal(complete.exportSequence,intermediate.exportSequence+1);
  assert.equal(complete.parentSaveDataId,intermediate.saveDataId);
  assert.match(await panel.locator('#modal-title').textContent(),/保存して終了/);
  assert.match(await panel.locator('#modal-text').textContent(),/まだブックへの保存は完了していません/);
  assert.equal(await panel.locator('#finish').isDisabled(),true);
  assert.equal(await panel.locator('#close').isVisible(),false);
  const retry=p.waitForEvent('download');await panel.locator('#retry').click();
  assert.deepEqual(JSON.parse(await fs.readFile(await (await retry).path(),'utf8')),complete);
  await p.close();
});
test('progress board: file launch, pending form, payload round trip and isolated UI',async()=>{
  const p=await open('progress-board');
  assert.equal(await p.locator('.project-row').count(),0);
  await p.locator('#addProjectBtn').click();await p.locator('#projectNameInput').fill('MVP5進捗');await p.locator('#leaderInput').fill('担当者');
  await p.locator('excel-gate-panel #name').evaluate(el=>{el.value='テスト利用者';el.dispatchEvent(new Event('input'))});
  const failure=await p.evaluate(()=>ExcelGate.exportFile('complete').catch(e=>e.message));assert.match(failure,/確定|キャンセル/);
  assert.equal(await p.locator('#projectNameInput').inputValue(),'MVP5進捗');
  await p.locator('#projectForm button[type=submit]').click();
  const exported=await output(p);
  assert.equal(exported.exportSequence,1);assert.equal(exported.payload.projects[0].name,'MVP5進捗');
  assert.deepEqual(await p.evaluate(()=>[__storageReads,__storageWrites]),[0,0]);
  const r=await open('progress-board',exported.payload);
  const roundtrip=await output(r,'complete');assert.deepEqual(roundtrip.payload,exported.payload);
  await r.locator('excel-gate-panel dialog').waitFor({state:'visible'});
  assert.match(await r.locator('excel-gate-panel #modal-text').textContent(),/まだブックへの保存は完了していません/);
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
  const runtime=path.join(folder,'progress-board/runtime');const cfg={runtimeVersion:'0.6.0',mode:'edit',readOnly:false,databaseId:'db-000000001',sessionId:'session-00001',dataType:'kaizen-project-progress-board',schemaVersion:2,baseRevision:0,hasPayload:true,payload:{}};
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
test('completed output blocks external mutation while preserving the exact downloaded snapshot',async()=>{
  for(const app of ['progress-board','workflow-studio']) {
    const p=await open(app);
    await p.evaluate(app=>{
      const name=app==='progress-board'?'create_kaizen_project':'create_improvement_project';
      __testTools.find(t=>t.name===name).execute({name:'終了前のデータ',leader:'担当者',stage:1});
    },app);
    const exported=await output(p,'complete');
    const rejected=await p.evaluate(()=>__testTools.filter(t=>!t.annotations.readOnlyHint).map(t=>{
      try{t.execute({name:'終了後の不正な変更',leader:'担当者',stage:2});return null}catch(e){return e.message}
    }));
    assert.ok(rejected.length>0&&rejected.every(message=>/入力を終えた/.test(message)));
    assert.match(await p.evaluate(()=>{try{ExcelGate.assertEditable();return ''}catch(e){return e.message}}),/入力を終えた/);
    const retry=p.waitForEvent('download');await p.locator('excel-gate-panel #retry').click();
    assert.deepEqual(JSON.parse(await fs.readFile(await (await retry).path(),'utf8')),exported);
    if(app==='progress-board') assert.equal((await p.evaluate(()=>__testTools.find(t=>t.annotations.readOnlyHint).execute({}))).projects[0].name,'終了前のデータ');
    else {
      assert.equal(await p.locator('#projectName').textContent(),'終了前のデータ');
      const direct=await p.evaluate(()=>['startProject','setDirty','createProjectPackage'].map(name=>{try{window[name]({});return null}catch(e){return e.message}}));
      assert.ok(direct.every(message=>/入力を終えた/.test(message)));
    }
    await p.close();
  }
});
test('progress board waits for asynchronous JSON import and checks permission at completion',async()=>{
  const p=await open('progress-board');
  await p.locator('excel-gate-panel #name').fill('テスト利用者');
  await p.evaluate(()=>{File.prototype.text=function(){return new Promise((resolve,reject)=>{window.__finishImport=resolve;window.__failImport=reject})}});
  const data={schemaVersion:2,app:'kaizen-project-progress-board',projects:[{id:'imported',name:'非同期読込',leader:'担当',stage:1,status:'active',completedSubsteps:{},documents:[]}]};
  const upload=()=>p.locator('#importFile').setInputFiles({name:'import.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await upload();
  assert.match(await p.evaluate(()=>ExcelGate.exportFile('complete').catch(e=>e.message)),/読み込みが終わって/);
  assert.equal(await p.locator('.project-row').count(),0);
  // Completion must re-check the gate instead of relying on the earlier permission.
  await p.evaluate(data=>{
    const previous=ExcelGate.assertEditable;
    ExcelGate.assertEditable=()=>{const e=Error('テスト：入力を終えたため変更できません');e.code='EXCEL_GATE_NOT_EDITABLE';throw e};
    window.__restoreGate=()=>ExcelGate.assertEditable=previous;
    __finishImport(JSON.stringify(data));
  },data);
  await p.waitForFunction(()=>document.querySelector('#toastArea').textContent.includes('入力を終えた'));
  assert.equal(await p.locator('.project-row').count(),0);await p.evaluate(()=>__restoreGate());
  const empty=await output(p);assert.deepEqual(empty.payload.projects,[]);
  await upload();await p.evaluate(data=>__finishImport(JSON.stringify(data)),data);
  await p.waitForFunction(()=>document.querySelectorAll('.project-row').length===1);
  assert.equal((await output(p)).payload.projects[0].name,'非同期読込');
  await upload();await p.evaluate(()=>__failImport(Error('read failed')));
  await p.waitForFunction(()=>document.querySelector('#toastArea').textContent.includes('読み込めませんでした'));
  assert.equal((await output(p,'complete')).payload.projects[0].name,'非同期読込');
  await p.close();
});
test('workflow FileReader tracks pending, failed and aborted reads and rejects delayed completion writes',async()=>{
  const p=await open('workflow-studio');
  await p.evaluate(()=>__testTools.find(t=>t.name==='create_improvement_project').execute({name:'元データ',leader:'担当'}));
  const data=(await output(p)).payload;data.project.name='非同期読込';
  await p.evaluate(()=>{window.FileReader=class{readAsText(){window.__pendingReader=this}}});
  const upload=()=>p.locator('#fileInput').setInputFiles({name:'import.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await upload();
  assert.match(await p.evaluate(()=>ExcelGate.exportFile('complete').catch(e=>e.message)),/読み込みが終わって/);
  await p.evaluate(data=>{
    const previous=ExcelGate.assertEditable;
    ExcelGate.assertEditable=()=>{throw Error('テスト：入力を終えたため変更できません')};
    __pendingReader.result=JSON.stringify(data);__pendingReader.onload();ExcelGate.assertEditable=previous;
  },data);
  assert.equal(await p.locator('#projectName').textContent(),'元データ');
  assert.equal((await output(p)).payload.project.name,'元データ');
  await upload();await p.evaluate(data=>{__pendingReader.result=JSON.stringify(data);__pendingReader.onload()},data);
  assert.equal((await output(p)).payload.project.name,'非同期読込');
  for(const event of ['onerror','onabort']) {
    await upload();await p.evaluate(event=>__pendingReader[event](),event);
    assert.equal((await output(p)).payload.project.name,'非同期読込');
  }
  await output(p,'complete');
  // A reader that already failed cannot later replace the completed data.
  await p.evaluate(data=>{data.project.name='遅れた上書き';__pendingReader.result=JSON.stringify(data);__pendingReader.onload()},data);
  assert.equal(await p.locator('#projectName').textContent(),'非同期読込');
  await p.close();
});
test('standalone originals and adapted pages retain business controls and standalone editing',async()=>{
  for(const app of ['progress-board','workflow-studio']) {
    const original=await browser.newPage(),adapted=await browser.newPage();
    await original.goto(pathToFileURL(path.join(__dirname,'../reference',app+'.html')).href);
    await adapted.goto(pathToFileURL(path.join(__dirname,'../apps',app,'index.html')).href);
    assert.equal(await adapted.evaluate(()=>ExcelGate.isLinked),false);
    assert.equal(await adapted.evaluate(()=>ExcelGate.assertEditable()),true);
    const controls=page=>page.locator('button,input,select,textarea').evaluateAll(els=>els.map(el=>({tag:el.tagName,id:el.id,type:el.type,text:el.tagName==='BUTTON'?el.textContent.trim():''})));
    assert.deepEqual(await controls(adapted),await controls(original));
    if(app==='progress-board') {
      assert.equal(await adapted.locator('.project-row').count(),await original.locator('.project-row').count());
      await adapted.locator('#addProjectBtn').click();await adapted.locator('#projectNameInput').fill('単体入力');await adapted.locator('#leaderInput').fill('担当');await adapted.locator('#projectForm button[type=submit]').click();
      assert.ok((await adapted.locator('#metricTotal').textContent())>'0');
    } else {
      await adapted.locator('#newProjectBtn').click();await adapted.locator('#newProjectName').fill('単体入力');await adapted.locator('#newProjectLeader').fill('担当');await adapted.locator('#newProjectForm button.primary').click();
      assert.equal(await adapted.locator('#projectName').textContent(),'単体入力');
    }
    await original.close();await adapted.close();
  }
});
