import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHarness, check } from '../../scripts/browser-harness.mjs';

let h;
test.before(async()=>{h=await createHarness()});
test.after(async()=>{await h?.close()});
async function createProject(p,name='正式データ'){
  await p.locator('#newProjectBtn').click();
  // Match the original screen's delayed autofocus before filling the next field.
  await p.waitForTimeout(60);await p.locator('#newProjectName').fill(name);
  await p.locator('#newProjectLeader').fill('担当者');await p.locator('#newProjectForm button.primary').click();
}
async function makePayload(){const p=await h.open();await createProject(p);const out=await h.output(p);await p.close();return out.payload}
async function nameAuthor(p){await p.locator('excel-gate-panel #name').fill('組み込み試験')}
const rejectedOutput=p=>p.evaluate(()=>ExcelGate.exportFile('complete').then(()=>'',e=>e.message));

test('businessFlow: original project and document editing controls preserve content',()=>check('businessFlow',async()=>{
  const p=await h.open();await createProject(p,'業務入力');
  await p.locator('[data-edit=sheetField][data-key=problem]').first().click();
  await p.locator('#markdownValue').fill('未解決の業務課題😀');await p.locator('#confirmEdit').click();
  const out=await h.output(p);assert.equal(out.payload.project.name,'業務入力');
  assert.equal(out.payload.sheets.documents.improvement1.fields.problem,'未解決の業務課題😀');
  assert.equal(out.payload.app,'dx-project-package');
  assert.deepEqual(p.gateErrors,[]);await p.close();
}));

test('roundTrip: project identity, documents, references and print settings survive reopen',()=>check('roundTrip',async()=>{
  const payload=await makePayload();
  payload.sheets.documents.improvement1.fields.problem='往復テスト😀';
  payload.sheets.documents.stakeholders.people=[{id:'person1',name:'関係者',importance:'高',influence:'中',interest:'高',engagement:'相談する',values:[{id:'value1',text:'時間短縮'}]}];
  payload.documentLinks=[{id:'doc1',name:'資料',url:'https://example.com/guide'}];
  payload.sheets.printSettings.improvement1.globalScale=95;
  const p=await h.open({payload}),first=(await h.output(p)).payload;await p.close();
  const reopened=await h.open({payload:first}),second=(await h.output(reopened)).payload;
  assert.equal(second.project.id,first.project.id);assert.equal(second.project.name,first.project.name);
  assert.deepEqual(second.sheets.documents,first.sheets.documents);
  assert.deepEqual(second.sheets.printSettings,first.sheets.printSettings);
  assert.deepEqual(second.documentLinks,first.documentLinks);assert.deepEqual(second.progress,first.progress);
  await reopened.close();
}));

test('firstUseAndEmpty: no project differs from a saved project with empty documents',()=>check('firstUseAndEmpty',async()=>{
  const first=await h.open();await nameAuthor(first);
  assert.equal(await first.locator('#welcome').isVisible(),true);
  assert.match(await rejectedOutput(first),/プロジェクトを作成/);await first.close();
  const payload=await makePayload(),saved=await h.open({payload});
  assert.equal(await saved.locator('#welcome').isVisible(),false);
  assert.deepEqual((await h.output(saved)).payload.sheets.documents,payload.sheets.documents);await saved.close();
  const view=await h.open({mode:'view'});assert.match(await view.locator('#welcome').textContent(),/正式保存されたデータはありません/);await view.close();
  const invalid=await h.open({payload:{},ready:false});
  await invalid.locator('excel-gate-panel dialog').waitFor({state:'visible'});
  assert.match(await invalid.locator('excel-gate-panel #modal-title').textContent(),/停止/);
  assert.equal(await invalid.locator('excel-gate-panel #finish').isEnabled(),false);await invalid.close();
}));

test('pendingInput: drawer drafts remain visible and cannot be skipped during output',()=>check('pendingInput',async()=>{
  const p=await h.open();await createProject(p);await nameAuthor(p);
  await p.locator('[data-edit=sheetField][data-key=problem]').first().click();await p.locator('#markdownValue').fill('未確定の内容');
  assert.match(await rejectedOutput(p),/確定|閉じて/);
  assert.equal(await p.locator('#markdownValue').inputValue(),'未確定の内容');await p.locator('#confirmEdit').click();
  assert.equal((await h.output(p)).payload.sheets.documents.improvement1.fields.problem,'未確定の内容');await p.close();
}));

test('readOnly: document navigation and zoom work while edits and external writes stop',()=>check('readOnly',async()=>{
  const payload=await makePayload(),p=await h.open({payload,mode:'view'});
  await p.locator('[data-edit=sheetField][data-key=problem]').first().click();
  assert.equal(await p.locator('#editorDrawer').getAttribute('aria-hidden'),'true');
  await p.locator('[data-doc=stakeholders]').first().click();assert.match(await p.locator('#canvasTitle').textContent(),/ステークホルダー/);
  await p.locator('#zoomOut').click();assert.equal(await p.locator('#zoomLabel').textContent(),'90%');
  const blocked=await p.evaluate(()=>__gateTestTools.map(t=>{try{t.execute({});return ''}catch(e){return e.message}}));
  assert.equal(blocked.length,2);assert.ok(blocked.every(message=>/閲覧専用/.test(message)));
  await p.locator('excel-gate-panel #name').evaluate(el=>{el.value='組み込み試験';el.dispatchEvent(new Event('input'))});
  assert.match(await rejectedOutput(p),/出力できません/);await p.close();
}));

test('persistence: linked edits use workbook payload without browser storage access',()=>check('persistence',async()=>{
  const payload=await makePayload(),p=await h.open({payload,beforeLoad:page=>page.addInitScript(()=>{
    localStorage.setItem('unrelated-stale-data','古い内容');window.__gateStorageReads=0;window.__gateStorageWrites=0;
  })});
  await p.evaluate(()=>__gateTestTools.find(t=>t.name==='update_improvement_field').execute({sheet:'improvement1',field:'problem',value:'新しい入力'}));
  assert.equal((await h.output(p)).payload.sheets.documents.improvement1.fields.problem,'新しい入力');
  assert.deepEqual(await p.evaluate(()=>[__gateStorageReads,__gateStorageWrites]),[0,0]);await p.close();
}));

test('asyncSafety: FileReader completion, errors and aborts cannot lose pending or final data',()=>check('asyncSafety',async()=>{
  const p=await h.open();await createProject(p);const payload=(await h.output(p)).payload;payload.project.name='非同期読込';
  await p.evaluate(()=>{window.FileReader=class{readAsText(){window.__pendingReader=this}}});
  const upload=()=>p.locator('#fileInput').setInputFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
  await upload();assert.match(await rejectedOutput(p),/読み込みが終わって/);
  // Output cannot finish while reading; independently prove callback permission rechecking.
  await p.evaluate(data=>{const previous=ExcelGate.assertEditable;ExcelGate.assertEditable=()=>{throw Error('完了後は変更できません')};__pendingReader.result=JSON.stringify(data);__pendingReader.onload();ExcelGate.assertEditable=previous},payload);
  assert.equal((await h.output(p)).payload.project.name,'正式データ');
  await upload();await p.evaluate(data=>{__pendingReader.result=JSON.stringify(data);__pendingReader.onload()},payload);
  assert.equal((await h.output(p)).payload.project.name,'非同期読込');
  for(const event of ['onerror','onabort']){
    await upload();await p.evaluate(event=>__pendingReader[event](),event);
    assert.equal((await h.output(p)).payload.project.name,'非同期読込');
  }
  await h.output(p,'complete');
  await p.evaluate(data=>{data.project.name='遅れた上書き';__pendingReader.result=JSON.stringify(data);__pendingReader.onload()},payload);
  assert.equal(await p.locator('#projectName').textContent(),'非同期読込');await p.close();
}));

test('finishedMutations: external APIs and public mutators reject changes after final output',()=>check('finishedMutations',async()=>{
  const p=await h.open();await createProject(p);const out=await h.output(p,'complete');
  const blocked=await p.evaluate(()=>__gateTestTools.map(t=>{try{t.execute({name:'終了後の追加'});return ''}catch(e){return e.message}}));
  assert.equal(blocked.length,2);assert.ok(blocked.every(message=>/入力を終えた/.test(message)));
  const direct=await p.evaluate(()=>['startProject','setDirty','createProjectPackage'].map(name=>{try{window[name]({});return ''}catch(e){return e.message}}));
  assert.ok(direct.every(message=>/入力を終えた/.test(message)));
  assert.equal(await p.locator('#projectName').textContent(),'正式データ');
  const download=p.waitForEvent('download');await p.locator('excel-gate-panel #retry').click();
  assert.deepEqual(JSON.parse(await fs.readFile(await (await download).path(),'utf8')),out);await p.close();
}));
