import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHarness, check } from '../../scripts/browser-harness.mjs';

let h;
test.before(async()=>{h=await createHarness()});
test.after(async()=>{await h?.close()});
const empty={schemaVersion:2,app:'kaizen-project-progress-board',projects:[]};
const sample=()=>({...empty,projects:[{id:'acceptance-project',name:'正式データ',leader:'担当者',stage:2,status:'active',note:'日本語😀のメモ',completedSubsteps:{3:[0]},documents:[{id:'doc1',name:'資料',url:'https://example.com/guide'}],createdAt:'2026-09-21T00:00:00Z',updatedAt:'2026-09-21T00:00:00Z',sample:false}]});
async function nameAuthor(p){await p.locator('excel-gate-panel #name').fill('組み込み試験')}
async function addProjectDialog(p){
  await p.locator('#addProjectBtn').click();
  // The original screen focuses the name 30 ms after opening its dialog.
  await p.waitForTimeout(40);
}
const rejectedOutput=p=>p.evaluate(()=>ExcelGate.exportFile('complete').then(()=>'',e=>e.message));

test('businessFlow: original add and edit controls update the business JSON',()=>check('businessFlow',async()=>{
  const p=await h.open();
  await addProjectDialog(p);
  await p.locator('#projectNameInput').fill('組み込み後の業務入力');
  await p.locator('#leaderInput').fill('担当者');
  await p.locator('#stageInput').selectOption('3');
  await p.locator('#noteInput').fill('入力内容を維持する😀');
  await p.locator('#projectForm button[type=submit]').click();
  assert.equal(await p.locator('.project-row').count(),1);
  const out=await h.output(p);
  assert.equal(out.payload.projects[0].name,'組み込み後の業務入力');
  assert.equal(out.payload.projects[0].stage,3);
  assert.equal(out.payload.projects[0].note,'入力内容を維持する😀');
  assert.equal(out.payload.app,empty.app);
  assert.deepEqual(p.gateErrors,[]);await p.close();
}));

test('roundTrip: full project metadata and document links survive export and reopen',()=>check('roundTrip',async()=>{
  const p=await h.open({payload:sample()});const first=await h.output(p);await p.close();
  const reopened=await h.open({payload:first.payload});
  assert.deepEqual((await h.output(reopened)).payload,first.payload);
  assert.equal(await reopened.locator('.project-row').count(),1);await reopened.close();
}));

test('firstUseAndEmpty: first use, saved empty and invalid saved data remain distinct',()=>check('firstUseAndEmpty',async()=>{
  for(const options of [{},{payload:empty}]){
    const p=await h.open(options);assert.equal(await p.locator('.project-row').count(),0);
    assert.deepEqual((await h.output(p)).payload,empty);await p.close();
  }
  const invalid=await h.open({payload:{},ready:false});
  await invalid.locator('excel-gate-panel dialog').waitFor({state:'visible'});
  assert.match(await invalid.locator('excel-gate-panel #modal-title').textContent(),/停止/);
  assert.equal(await invalid.locator('excel-gate-panel #finish').isEnabled(),false);
  assert.equal(await invalid.locator('.project-row').count(),0);await invalid.close();
}));

test('pendingInput: unconfirmed form content cannot be silently omitted from output',()=>check('pendingInput',async()=>{
  const p=await h.open();await nameAuthor(p);await addProjectDialog(p);
  await p.locator('#projectNameInput').fill('未確定の入力');await p.locator('#leaderInput').fill('担当');
  assert.match(await rejectedOutput(p),/確定|キャンセル/);
  assert.equal(await p.locator('#projectNameInput').inputValue(),'未確定の入力');
  await p.locator('#projectForm button[type=submit]').click();
  assert.equal((await h.output(p)).payload.projects[0].name,'未確定の入力');await p.close();
}));

test('readOnly: filters remain usable while UI and external writes are rejected',()=>check('readOnly',async()=>{
  const p=await h.open({payload:sample(),mode:'view'});
  assert.equal(await p.locator('#addProjectBtn').isDisabled(),true);
  assert.equal(await p.locator('#statusFilter').isEnabled(),true);
  await p.locator('#statusFilter').selectOption('completed');assert.equal(await p.locator('.project-row').count(),0);
  await p.locator('#statusFilter').selectOption('active');assert.equal(await p.locator('.project-row').count(),1);
  const blocked=await p.evaluate(()=>__gateTestTools.filter(t=>!t.annotations.readOnlyHint).map(t=>{try{t.execute({});return ''}catch(e){return e.message}}));
  assert.equal(blocked.length,2);assert.ok(blocked.every(message=>/閲覧専用/.test(message)));
  await p.locator('excel-gate-panel #name').evaluate(el=>{el.value='組み込み試験';el.dispatchEvent(new Event('input'))});
  assert.match(await rejectedOutput(p),/出力できません/);await p.close();
}));

test('persistence: stale browser storage never replaces workbook data or receives edits',()=>check('persistence',async()=>{
  const p=await h.open({payload:sample(),beforeLoad:page=>page.addInitScript(()=>{
    localStorage.setItem('kaizen-project-progress-board.v2',JSON.stringify({schemaVersion:2,app:'kaizen-project-progress-board',projects:[]}));
    window.__gateStorageReads=0;window.__gateStorageWrites=0;
  })});
  assert.equal(await p.locator('.project-row').count(),1);
  await p.evaluate(()=>__gateTestTools.find(t=>t.name==='create_kaizen_project').execute({name:'追加',leader:'担当',stage:1}));
  assert.equal((await h.output(p)).payload.projects.length,2);
  assert.deepEqual(await p.evaluate(()=>[__gateStorageReads,__gateStorageWrites]),[0,0]);await p.close();
}));

test('asyncSafety: pending import blocks output and completion rechecks edit permission',()=>check('asyncSafety',async()=>{
  const p=await h.open();await nameAuthor(p);
  await p.evaluate(()=>{File.prototype.text=function(){return new Promise((resolve,reject)=>{window.__finishImport=resolve;window.__failImport=reject})}});
  const upload=()=>p.locator('#importFile').setInputFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sample()))});
  await upload();assert.match(await rejectedOutput(p),/読み込みが終わって/);
  // Force permission loss at callback time to verify the second guard independently.
  await p.evaluate(data=>{const previous=ExcelGate.assertEditable;ExcelGate.assertEditable=()=>{const e=Error('完了後は変更できません');e.code='EXCEL_GATE_NOT_EDITABLE';throw e};window.__restoreGate=()=>ExcelGate.assertEditable=previous;__finishImport(JSON.stringify(data))},sample());
  await p.waitForFunction(()=>document.querySelector('#toastArea').textContent.includes('完了後'));
  assert.equal(await p.locator('.project-row').count(),0);await p.evaluate(()=>__restoreGate());
  assert.deepEqual((await h.output(p)).payload,empty);
  await upload();await p.evaluate(data=>__finishImport(JSON.stringify(data)),sample());
  await p.waitForFunction(()=>document.querySelectorAll('.project-row').length===1);
  assert.equal((await h.output(p)).payload.projects[0].name,'正式データ');
  await upload();await p.evaluate(()=>__failImport(Error('read failed')));
  await p.waitForFunction(()=>document.querySelector('#toastArea').textContent.includes('読み込めませんでした'));
  assert.equal((await h.output(p)).payload.projects.length,1);await p.close();
}));

test('finishedMutations: complete output blocks all external writers and retry keeps its bytes',()=>check('finishedMutations',async()=>{
  const p=await h.open({payload:sample()}),out=await h.output(p,'complete');
  const blocked=await p.evaluate(()=>__gateTestTools.filter(t=>!t.annotations.readOnlyHint).map(t=>{try{t.execute({name:'不正な追加',leader:'担当',stage:1});return ''}catch(e){return e.message}}));
  assert.equal(blocked.length,2);assert.ok(blocked.every(message=>/入力を終えた/.test(message)));
  const data=await p.evaluate(()=>__gateTestTools.find(t=>t.name==='list_kaizen_projects').execute({}));
  assert.equal(data.projects.length,1);assert.equal(data.projects[0].name,'正式データ');
  const download=p.waitForEvent('download');await p.locator('excel-gate-panel #retry').click();
  assert.deepEqual(JSON.parse(await fs.readFile(await (await download).path(),'utf8')),out);await p.close();
}));
