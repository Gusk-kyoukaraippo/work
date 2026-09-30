const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
let h,tmp,previous;
test.before(async()=>{
 const {buildApp}=await import('../scripts/package.mjs');tmp=await fs.mkdtemp(path.join(os.tmpdir(),'gate-common-browser-'));
 const stage=await buildApp('handoff-notes',tmp,{mode:'development'});
 previous=process.env.EXCEL_GATE_STAGE;process.env.EXCEL_GATE_STAGE=stage;
 h=await (await import('../scripts/browser-harness.mjs')).createHarness();
});
test.after(async()=>{await h?.close();if(previous===undefined)delete process.env.EXCEL_GATE_STAGE;else process.env.EXCEL_GATE_STAGE=previous;if(tmp)await fs.rm(tmp,{recursive:true,force:true})});
async function download(page,action){const pending=page.waitForEvent('download');await action();return JSON.parse(await fs.readFile(await (await pending).path(),'utf8'))}
test('bottom dock keeps name entry, intermediate and complete guidance together and retains author and retry snapshot',async()=>{
 const p=await h.open({payload:[]}),panel=p.locator('excel-gate-panel');
 assert.equal(await panel.locator('#app-title').textContent(),h.config.displayName);
 assert.equal(await panel.locator('#finish').textContent(),'アプリを終了して保存作業に移る');assert.equal(await p.locator('#export').isVisible(),false);
 assert.equal(await panel.locator('#name-label').isVisible(),false);
 const finishBox=await panel.locator('#finish').boundingBox();
 await panel.locator('#finish').click();assert.match(await panel.locator('#status').textContent(),/保存者名を入力/);
 assert.equal(await panel.locator('#name-label').isVisible(),true);
 const nextBox=await panel.locator('#next').boundingBox();assert.equal(nextBox.y+nextBox.height,finishBox.y+finishBox.height);
 await panel.locator('#next').click();assert.equal(await panel.locator('#name-error').isVisible(),true);
 await panel.locator('#name').fill('継続する利用者');await panel.locator('#back').click();
 let previous=null;
 for(let i=1;i<=3;i++){
  await p.evaluate(i=>NoteActions.add('途中のメモ'+i),i);
  const out=await download(p,()=>panel.locator('#work').click());
  assert.equal(out.exportSequence,i);assert.equal(out.parentSaveDataId,previous?.saveDataId??null);assert.equal(out.authorName,'継続する利用者');assert.equal(out.payload.length,i);assert.equal(out.saveKind,'workCopy');previous=out;
  assert.match(await panel.locator('#status').textContent(),/保存して続ける/);assert.equal(await panel.locator('dialog').isVisible(),true);
  assert.equal(await panel.locator('#modal-title').textContent(),'ブックで途中保存する');
  await panel.locator('#back').click();assert.equal(await panel.locator('dialog').isVisible(),false);
 }
 const complete=await download(p,()=>panel.locator('#finish').click());assert.equal(complete.saveKind,'complete');assert.equal(complete.parentSaveDataId,previous.saveDataId);assert.equal(complete.authorName,previous.authorName);
 assert.equal(await panel.locator('#modal-title').textContent(),'ブックで保存して閉じる');assert.match(await panel.locator('#modal-text').textContent(),/保存して閉じる/);assert.ok((await panel.locator('#modal-text').textContent()).includes(h.config.displayName));
 assert.equal(await panel.locator('#finish').isDisabled(),true);assert.equal(await panel.locator('#close').isVisible(),false);
 const replay=await download(p,()=>panel.locator('#retry').click());assert.deepEqual(replay,complete);
 assert.match(await p.evaluate(()=>{try{NoteActions.add('遅い更新');return ''}catch(e){return e.message}}),/入力を終えた/);
 await p.close();
});
test('arbitrary HTML characters stay literal in header and return-to-book guidance',async()=>{
 const name='=台帳 / "記録" <img src=x onerror=alert(1)> & 確認';
 const p=await h.open({payload:[],beforeLoad:async page=>page.addInitScript(()=>{})});
 const context=await p.evaluate(()=>({...window.__EXCEL_GATE_CONTEXT__}));await p.close();
 const q=await h.open({context:{...context,displayName:name,accentColor:'#6B4FA3'}});
 assert.equal(await q.locator('excel-gate-panel #app-title').textContent(),name);assert.equal(await q.locator('excel-gate-panel img').count(),0);
 await h.output(q,'complete');assert.equal(await q.locator('excel-gate-panel #modal-title').textContent(),'ブックで保存して閉じる');assert.ok((await q.locator('excel-gate-panel #modal-text').textContent()).includes(name));
 assert.deepEqual(q.gateErrors,[]);await q.close();
});
test('invalid boot and malformed data remain blocked; view retains search and forbids output',async()=>{
 const bad=await h.open({context:{invalid:true},ready:false});await bad.locator('excel-gate-panel dialog').waitFor({state:'visible'});assert.equal(await bad.locator('excel-gate-panel #finish').isEnabled(),false);await bad.close();
 const p=await h.open({payload:[{id:'x',text:'閲覧テスト'}],mode:'view'});assert.equal(await p.locator('#add').isDisabled(),true);await p.locator('#filter').fill('該当なし');assert.equal(await p.locator('#notes article').count(),0);assert.equal(await p.locator('excel-gate-panel #name-label').isVisible(),false);
 assert.match(await p.evaluate(()=>ExcelGate.exportFile('complete').then(()=>'',e=>e.message)),/現在は出力できません/);await p.close();
});
