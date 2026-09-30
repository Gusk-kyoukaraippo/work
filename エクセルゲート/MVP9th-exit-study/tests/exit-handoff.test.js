const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {matchesReceipt}=require('../shared/excel-gate-direct-launcher.js');
let h,tmp,previous;
test.before(async()=>{
 const {buildApp}=await import('../scripts/package.mjs');tmp=await fs.mkdtemp(path.join(os.tmpdir(),'gate-exit-browser-'));
 const stage=await buildApp('handoff-notes',tmp,{mode:'development'});
 previous=process.env.EXCEL_GATE_STAGE;process.env.EXCEL_GATE_STAGE=stage;
 h=await (await import('../scripts/browser-harness.mjs')).createHarness();
});
test.after(async()=>{await h?.close();if(previous===undefined)delete process.env.EXCEL_GATE_STAGE;else process.env.EXCEL_GATE_STAGE=previous;if(tmp)await fs.rm(tmp,{recursive:true,force:true})});
async function open(mode,options={}) {
 const initial=await h.open({payload:[]});const context=await initial.evaluate(()=>({...window.__EXCEL_GATE_CONTEXT__}));await initial.close();
 return h.open({...options,context:{...context,exitMode:mode}});
}
async function publish(page,receipt) {
 const file=page.gateHandoff.path,temporary=file+'.new';
 await fs.writeFile(temporary,'window.__EXCEL_GATE_HANDOFF__='+JSON.stringify(receipt)+';');await fs.rename(temporary,file);
}
function receipt(page,output) {
 const {databaseId,sessionId,dataType,schemaVersion,baseRevision,saveDataId,exportSequence}=output;
 return {state:'ready',token:page.gateHandoff.token,databaseId,sessionId,dataType,schemaVersion,baseRevision,saveDataId,exportSequence};
}
test('receipt binds every current identity field and only a ready notification is accepted',()=>{
 const expected={token:'a'.repeat(64),databaseId:'db-123456',sessionId:'sid-123456',dataType:'notes',schemaVersion:1,baseRevision:4,saveDataId:'save-123456',exportSequence:3};
 assert.equal(matchesReceipt({state:'ready',...expected},expected),true);
 for(const key of Object.keys(expected))assert.equal(matchesReceipt({state:'ready',...expected,[key]:typeof expected[key]==='number'?expected[key]+1:expected[key]+'x'},expected),false,key);
 for(const state of ['waiting','error',null])assert.equal(matchesReceipt({state,...expected},expected),false);
});
for(const mode of ['onTime','waitLoop'])test(mode+': real local receipt controls the close guidance; failed notifications stay waiting',async()=>{
 const p=await open(mode),panel=p.locator('excel-gate-panel');
 await p.gateParent.evaluate(()=>{window.__closeCalls=0;window.close=()=>window.__closeCalls++});
 await p.evaluate(()=>NoteActions.add('終了時の入力'));
 const output=await h.output(p,'complete'),correct=receipt(p,output);
 assert.equal(await panel.locator('#modal-title').textContent(),'終了の準備中');
 assert.equal(await panel.locator('#close').isVisible(),false);
 assert.equal(await p.gateParent.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}),true);
 // A wrong schema must not stop polling: a subsequent correct notification can still complete.
 await publish(p,{...correct,schemaVersion:correct.schemaVersion+1});
 await p.gateParent.waitForFunction(()=>window.__EXCEL_GATE_HANDOFF__?.schemaVersion!==undefined);
 assert.equal(await panel.locator('#modal-title').textContent(),'終了の準備中');
 await publish(p,{...correct,saveDataId:'other-save-id'});
 await p.gateParent.waitForFunction(()=>window.__EXCEL_GATE_HANDOFF__?.saveDataId==='other-save-id');
 assert.equal(await panel.locator('#close').isVisible(),false);
 await publish(p,correct);
 await panel.locator('#close').waitFor({state:'visible'});
 assert.equal(await panel.locator('#modal-title').textContent(),'保存の準備ができました');
 assert.match(await panel.locator('#modal-text').textContent(),/タブを閉じてから/);
 assert.match(await panel.locator('#modal-text').textContent(),/ブックへの保存は、そこで完了/);
 assert.equal(await p.gateParent.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}),false);
 await panel.locator('#close').click();await p.gateParent.waitForFunction(()=>window.__closeCalls===1);
 assert.match(await panel.locator('#modal-text').textContent(),/タブの×/);
 assert.match(await p.evaluate(()=>{try{NoteActions.add('完了後');return ''}catch(e){return e.message}}),/入力を終えた/);
 assert.deepEqual(p.gateErrors,[]);await p.close();
});
test('slow preparation offers one-action retry using identical output and no false readiness',async()=>{
 const p=await open('onTime',{beforeLoad:async page=>{await page.clock.install()}}),panel=p.locator('excel-gate-panel');
 const complete=await h.output(p,'complete');
 await p.gateParent.clock.runFor(31000);
 assert.equal(await panel.locator('#modal-title').textContent(),'準備を続けています');assert.equal(await panel.locator('#close').isVisible(),false);
 const download=p.waitForEvent('download');await panel.locator('#retry').click();
 const replay=JSON.parse(await fs.readFile(await (await download).path(),'utf8'));assert.deepEqual(replay,complete);
 assert.equal(await panel.locator('#modal-title').textContent(),'終了の準備中');
 await publish(p,receipt(p,complete));await p.gateParent.clock.runFor(2000);await panel.locator('#close').waitFor({state:'visible'});
 assert.deepEqual(p.gateErrors,[]);await p.close();
});
test('manual guidance needs no download confirmation and keeps Edge open until workbook save',async()=>{
 const p=await open('manual'),panel=p.locator('excel-gate-panel');await h.output(p,'complete');
 assert.equal(await panel.locator('#modal-title').textContent(),'ブックで保存して閉じる');
 const text=await panel.locator('#modal-text').textContent();assert.match(text,/この画面は開いたまま/);assert.doesNotMatch(text,/ダウンロード|確認|ファイルを選/);
 assert.equal(await panel.locator('#close').isVisible(),false);await p.close();
});
test('all three modes keep every transition at the bottom and reserve a scrollable business viewport',async()=>{
 for(const mode of ['manual','onTime','waitLoop']){
  for(const width of [1200,900,390,320]){
  const p=await open(mode,{beforeLoad:page=>page.clock.install()}),panel=p.locator('excel-gate-panel');
  await p.setViewportSize({width,height:900});
  const original=await panel.locator('#finish').boundingBox();
  async function dockFits(){
   const result=await p.evaluate(()=>{
    const host=document.querySelector('excel-gate-panel'),shadow=host.shadowRoot;
    const dialog=shadow.querySelector('dialog'),dock=dialog.open?dialog:shadow.querySelector('footer');
    const rect=dock.getBoundingClientRect(),work=document.querySelector('excel-gate-workspace').getBoundingClientRect();
    const overflow=[...dock.querySelectorAll('button,input')].filter(el=>el.getClientRects().length).some(el=>{const r=el.getBoundingClientRect();return r.left<0||r.right>innerWidth+1});
    const slot=dock.querySelector('.next-actions').getBoundingClientRect();
    return {bottom:Math.abs(rect.bottom-innerHeight),reserved:work.bottom<=rect.top+1,overflow,top:rect.top,height:innerHeight,
     slot:{x:slot.x,y:slot.y,width:slot.width,height:slot.height}};
   });
   assert.ok(result.bottom<1,mode+' bottom');assert.equal(result.reserved,true,mode+' business space');assert.equal(result.overflow,false,mode+' controls');assert.ok(result.top>result.height/2,mode+' stays in lower area');
   for(const key of ['x','y','width','height'])assert.ok(Math.abs(result.slot[key]-original[key])<1,mode+' '+width+' fixed '+key);
  }
   await p.waitForFunction(()=>{
    const s=document.querySelector('excel-gate-panel').shadowRoot,d=s.querySelector('dialog'),r=(d.open?d:s.querySelector('footer')).getBoundingClientRect();
    return document.querySelector('excel-gate-workspace').getBoundingClientRect().bottom<=r.top+1;
   });
   assert.equal(await panel.locator('footer').evaluate(e=>e.getBoundingClientRect().height),72,mode+' '+width+' compact editing bar');
   assert.equal(await panel.locator('#edit-title').isVisible(),false);
   assert.equal(await panel.locator('#status').isVisible(),false);
   await dockFits();await panel.locator('#finish').click();await dockFits();
   assert.deepEqual(await panel.locator('#next').boundingBox(),original);
   await panel.locator('#name').fill('');await panel.locator('#next').click();await dockFits();
   assert.deepEqual(await panel.locator('#next').boundingBox(),original);
   await panel.locator('#back').click();
  await h.output(p,'workCopy');await dockFits();
  const complete=await h.output(p,'complete');await dockFits();
  if(mode==='manual')assert.deepEqual(await panel.locator('#retry').boundingBox(),original);
  else{
   await p.gateParent.clock.runFor(31000);await dockFits();
   assert.deepEqual(await panel.locator('#retry').boundingBox(),original);
   await publish(p,receipt(p,complete));await p.gateParent.clock.runFor(2000);
   await panel.locator('#close').waitFor({state:'visible'});await dockFits();
   assert.deepEqual(await panel.locator('#close').boundingBox(),original);
  }
  assert.equal(await panel.locator('#name-label').isVisible(),false);
  assert.match(await p.evaluate(()=>{try{ExcelGate.assertEditable();return ''}catch(e){return e.message}}),/入力を終えた/);
  assert.deepEqual(p.gateErrors,[]);await p.close();
  }
 }
});
