import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pbkdf2Sync} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHarness,check} from '../../scripts/browser-harness.mjs';
const here=fileURLToPath(new URL('.',import.meta.url));
const recipe=JSON.parse(await fs.readFile(here+'recipe.json','utf8'));
const originalUrl=pathToFileURL(here+`revisions/${recipe.revision}/original/index.html`).href;
const salt='1234567890abcdef1234567890abcdef';
const auth={algorithm:'PBKDF2',iterations:150000,salt,hash:pbkdf2Sync('admin',Buffer.from(salt,'hex'),150000,32,'sha256').toString('hex')};
const empty=()=>({version:2,revision:0,items:[],loans:[],extensionRequests:[],staff:[],lenders:[],checkers:[],adminAuth:null});
const seed={...empty(),revision:7,adminAuth:auth,staff:[{id:'0123',name:'試験 職員',active:true},{id:'0456',name:'確認 担当',active:true}],items:[{id:'item-pt',name:'歩行器',number:'PT-001',category:'PT',location:'リハ室',isActive:true},{id:'item-ot',name:'訓練用具',number:'OT-001',category:'OT',location:'棚A',isActive:true}],extra:{preserve:['追加属性',0,false]}};
let h;
test.before(async()=>{h=await createHarness()});
test.after(async()=>{await h?.close()});
const action=(p,a)=>p.locator(`[data-action="${a}"]`);
async function submit(p,form){await p.locator(`form[data-form="${form}"] [type="submit"]`).click()}
async function login(p,id='0123'){await p.locator('[name="staffId"]').fill(id);await submit(p,'login');await p.locator('.shell').waitFor()}
async function adminLogin(p){await p.locator('.admin-entry summary').click();await p.locator('form[data-form="admin-login"] [name="password"]').fill('admin');await submit(p,'admin-login');await action(p,'new-item').waitFor()}
async function adminPage(p,tab='items'){
 await p.locator('[data-action="page"][data-page="admin"]').click();
 if(await action(p,'admin-auth').count()){
  await action(p,'admin-auth').click();await p.locator('#modal [name="password"]').fill('admin');await submit(p,'admin-auth');
 }
 await p.locator(`[data-action="admin-tab"][data-tab="${tab}"]`).click();
}
async function named(p){await p.evaluate(()=>{const n=document.querySelector('excel-gate-panel').shadowRoot.querySelector('#name');n.value='検証担当';n.dispatchEvent(new Event('input'))})}
async function rejectOutput(p,pattern){await named(p);const error=await p.evaluate(async()=>{try{await ExcelGate.exportFile('complete');return 'allowed'}catch(e){return e.message}});assert.match(error,pattern)}
async function originalOutput(p){await adminPage(p,'data');const d=p.waitForEvent('download');await action(p,'export').click();const raw=JSON.parse(await fs.readFile(await (await d).path(),'utf8'));delete raw.exportedAt;return raw}
function normalize(value){
 const ids=new Map();let n=0;
 function walk(v){if(Array.isArray(v))return v.map(walk);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!['createdAt','updatedAt','requestedAt','reviewedAt','approvedAt','returnedAt'].includes(k)).map(([k,x])=>[k,['id','loanId'].includes(k)&&typeof x==='string'&&!['item-pt','item-ot','0123','0456','0789','0101'].includes(x)?(ids.has(x)?ids.get(x):(ids.set(x,'generated-'+(++n)),ids.get(x))):walk(x)]));return v}return walk(value)
}
async function flow(p){
 await login(p);
 await p.locator('[name="search"]').fill('PT-001');assert.equal(await p.locator('.item-card').count(),1);
 await p.locator('[name="search"]').fill('');
 await p.locator('.category-card[data-category="OT"]').click();assert.equal(await p.locator('.item-card h3').textContent(),'訓練用具');
 await p.locator('.category-card[data-category="OT"]').click();
 await p.locator('[data-action="view"][data-view="grid"]').click();assert.equal(await p.locator('.inventory-grid.is-grid').count(),1);
 await p.locator('[data-action="item"][data-id="item-pt"]').click();await p.locator('#modal [name="userName"]').fill('試験利用者');await submit(p,'borrow');await p.locator('#modal').waitFor({state:'hidden'});
 await p.locator('[data-action="item"][data-id="item-pt"]').click();await action(p,'extension').click();await p.locator('#modal [name="reason"]').fill('訓練継続のため');await submit(p,'extension');await p.locator('#modal').waitFor({state:'hidden'});
 await adminPage(p,'requests');assert.equal(await p.locator('.request-card').count(),1);await action(p,'approve').click();await p.locator('.request-card').waitFor({state:'hidden'});
 await p.locator('[data-action="page"][data-page="inventory"]').click();await p.locator('[data-action="item"][data-id="item-pt"]').click();
 assert.equal(await p.locator('form[data-form="return"] [type="submit"]').isEnabled(),false);
 await p.locator('#modal [name="cleaned"]').check();await submit(p,'return');await p.locator('#modal').waitFor({state:'hidden'});
 await p.locator('[data-action="page"][data-page="history"]').click();assert.match(await p.locator('.table-wrap').textContent(),/返却済み/);
 await action(p,'edit-loan').click();await p.locator('#modal [name="userName"]').fill('試験利用者 修正');await submit(p,'edit-loan');await p.locator('#modal').waitFor({state:'hidden'});
 await adminPage(p);await action(p,'new-item').click();await p.locator('#modal [name="category"]').selectOption('BAR');await p.locator('#modal [name="name"]').fill('追加バー');await p.locator('#modal [name="number"]').fill('BAR-002');await p.locator('#modal [name="location"]').fill('倉庫');await submit(p,'save-item');await p.locator('#modal').waitFor({state:'hidden'});
 const row=p.locator('tr').filter({hasText:'追加バー'});await row.locator('[data-action="edit-item"]').click();await p.locator('#modal [name="name"]').fill('編集したバー');await p.locator('#modal [name="active"]').uncheck();await submit(p,'save-item');await p.locator('#modal').waitFor({state:'hidden'});
 assert.match(await p.locator('tr').filter({hasText:'編集したバー'}).textContent(),/使用停止/);
 await p.locator('tr').filter({hasText:'編集したバー'}).locator('[data-action="edit-item"]').click();await action(p,'delete-item').click();await action(p,'confirm-delete').click();await p.locator('#modal').waitFor({state:'hidden'});assert.equal(await p.locator('tr').filter({hasText:'編集したバー'}).count(),0);
 await adminPage(p,'staff');await action(p,'new-staff').click();await p.locator('#modal [name="id"]').fill('0789');await p.locator('#modal [name="name"]').fill('追加 職員');await submit(p,'save-staff');await p.locator('#modal').waitFor({state:'hidden'});
 await action(p,'bulk-staff').click();await p.locator('#modal [name="rows"]').fill('0101 一括 職員');await submit(p,'bulk-staff');await p.locator('#modal').waitFor({state:'hidden'});
 await p.locator('[data-action="edit-staff"][data-id="0789"]').click();await p.locator('#modal [name="name"]').fill('追加 職員改');await p.locator('#modal [name="active"]').uncheck();await submit(p,'save-staff');await p.locator('#modal').waitFor({state:'hidden'});
}
test('original and adapted lending, returns, extension, history, item and staff operations agree',async()=>{
 await check('businessFlow',async()=>{
  const p=await h.open({payload:seed});const original=await p.context().browser().newPage({acceptDownloads:true});
  await original.addInitScript(value=>localStorage.setItem('rehab_inventory_v2',JSON.stringify(value)),seed);await original.goto(originalUrl);
  await flow(original);await flow(p);
  const old=await originalOutput(original),adapted=(await h.output(p)).payload;
  assert.deepEqual(normalize(adapted),normalize(old));assert.equal(adapted.loans[0].cleanedChecked,true);assert.equal(adapted.extensionRequests[0].status,'APPROVED');
  assert.equal(adapted.loans[0].userName,'試験利用者 修正');assert.equal(adapted.staff.find(s=>s.id==='0789').active,false);
  await adminPage(p,'data');assert.equal(await action(p,'export').isVisible(),false);assert.match(await p.locator('.local-status').textContent(),/ブック/);
  await p.locator('[data-action="page"][data-page="inventory"]').click();await p.evaluate(()=>Promise.all([...document.querySelectorAll('img')].map(i=>i.decode())));assert.equal(await p.locator('img').evaluateAll(images=>images.every(i=>i.naturalWidth>0)),true);await p.screenshot({path:here+'adapted-screen.png',fullPage:true});
  await p.setViewportSize({width:390,height:844});await p.screenshot({path:here+'adapted-mobile-screen.png',fullPage:true});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(p.gateErrors,[]);await p.close();await original.close();
 });
});
test('business JSON and unknown metadata survive exact output and reopening',async()=>{
 await check('roundTrip',async()=>{
  const p=await h.open({payload:seed});const out=await h.output(p);assert.deepEqual(out.payload,seed);assert.equal(out.schemaVersion,2);
  const reopened=await h.open({payload:out.payload});assert.deepEqual((await h.output(reopened)).payload,seed);await reopened.close();await p.close();
 });
});
test('first use, saved empty database, invalid null, array and object',async()=>{
 await check('firstUseAndEmpty',async()=>{
  for(const options of [{},{payload:empty()}]){const p=await h.open(options);assert.deepEqual((await h.output(p)).payload,empty());await p.close()}
  const first=await h.open();await adminLogin(first);await adminPage(first,'staff');await action(first,'new-staff').click();await first.locator('#modal [name="id"]').fill('0001');await first.locator('#modal [name="name"]').fill('初回 職員');await submit(first,'save-staff');await first.locator('#modal').waitFor({state:'hidden'});const initial=(await h.output(first)).payload;assert.equal(initial.staff[0].id,'0001');assert.equal(initial.items.length,0);assert.equal(initial.adminAuth.algorithm,'PBKDF2');await first.close();
  for(const payload of [null,[],{}]){const p=await h.open({payload,ready:false});await p.waitForFunction(()=>document.querySelector('#app [data-error]')?.textContent.length>0);assert.equal(await p.locator('excel-gate-panel dialog').isVisible(),true);assert.equal(await p.locator('excel-gate-panel #finish').isEnabled(),false);await p.close()}
 });
});
test('pending forms and import confirmation prevent output without losing input',async()=>{
 await check('pendingInput',async()=>{
  const p=await h.open({payload:seed});await login(p);await p.locator('[data-action="item"][data-id="item-pt"]').click();await p.locator('#modal [name="userName"]').fill('未確定の使用者');
  await rejectOutput(p,/確定またはキャンセル/);assert.equal(await p.locator('#modal [name="userName"]').inputValue(),'未確定の使用者');await submit(p,'borrow');await p.locator('#modal').waitFor({state:'hidden'});assert.equal((await h.output(p)).payload.loans[0].userName,'未確定の使用者');
  await adminPage(p,'data');await p.locator('#backup-file').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(seed))});await p.locator('form[data-form="restore"]').waitFor();await rejectOutput(p,/確定またはキャンセル/);await action(p,'close').click();assert.equal((await h.output(p)).payload.loans.length,1);
  await p.locator('#backup-file').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(seed))});await p.locator('#modal [name="confirm"]').check();await submit(p,'restore');await p.locator('#modal').waitFor({state:'hidden'});const restored=(await h.output(p)).payload;assert.deepEqual({...restored,revision:seed.revision},seed);await p.close();
 });
});
async function captureAdapter(page){await page.addInitScript(()=>{
 Object.defineProperty(window,'ExcelGate',{configurable:true,get(){return this.__gateAPI},set(api){
  this.__gateAPI=api;const connect=api.connect;api.connect=adapter=>{window.__adapter=adapter;try{api.assertEditable();window.__startupGuard='allowed'}catch(e){window.__startupGuard=e.message}return connect(adapter)};
 }});
})}
async function forge(p,code){return p.evaluate(code)}
test('view permits search, filters, details and navigation but rejects writes and imports',async()=>{
 await check('readOnly',async()=>{
  const p=await h.open({payload:seed,mode:'view',beforeLoad:captureAdapter});await login(p);await p.locator('[name="search"]').fill('PT-001');assert.equal(await p.locator('.item-card').count(),1);await p.locator('[data-action="item"][data-id="item-pt"]').click();assert.equal(await p.locator('form[data-form="borrow"]').count(),0);assert.match(await p.locator('#modal').textContent(),/閲覧専用/);await action(p,'close').click();await adminPage(p);assert.equal(await action(p,'new-item').isEnabled(),false);
  await forge(p,()=>{const b=document.querySelector('[data-action="new-item"]');b.disabled=false;b.click()});assert.equal(await p.locator('#modal').isVisible(),false);assert.match(await p.locator('#toast').textContent(),/閲覧専用/);
  await adminPage(p,'data');await forge(p,()=>{window.__fileReads=0;File.prototype.text=async()=>{window.__fileReads++;return '{}'};const dt=new DataTransfer();dt.items.add(new File(['{}'],'blocked.json'));const f=document.querySelector('#backup-file');f.files=dt.files;f.dispatchEvent(new Event('change',{bubbles:true}))});assert.equal(await p.evaluate(()=>__fileReads),0);
  assert.deepEqual(await p.evaluate(()=>__adapter.exportData()),seed);await rejectOutput(p,/現在は出力できません/);assert.deepEqual(p.gateErrors,[]);await p.close();
  const virgin=await h.open({mode:'view',beforeLoad:captureAdapter});await adminLogin(virgin);assert.deepEqual(await virgin.evaluate(()=>__adapter.exportData()),empty());await virgin.close();
 });
});
test('linked startup, login, mutations and storage events never use browser persistence',async()=>{
 await check('persistence',async()=>{
  const p=await h.open({payload:seed,beforeLoad:async page=>{
   await captureAdapter(page);await page.addInitScript(()=>{try{localStorage.setItem('rehab_inventory_v2','broken cache');localStorage.setItem('items','[{"id":"stale"}]');}catch(e){if(e.name!=='SecurityError')throw e;}window.__gateStorageReads=0;window.__gateStorageWrites=0});
  }});await adminLogin(p);await adminPage(p,'staff');await action(p,'bulk-staff').click();await p.locator('#modal [name="rows"]').fill('0010 永続化 試験');await submit(p,'bulk-staff');await p.locator('#modal').waitFor({state:'hidden'});
  await p.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'rehab_inventory_v2',newValue:null})));const out=await h.output(p);assert.equal(out.payload.staff.length,3);assert.equal(out.payload.items[0].name,'歩行器');
  assert.deepEqual(await p.evaluate(()=>({reads:__gateStorageReads,writes:__gateStorageWrites,tools:__gateTestTools.length})),{reads:0,writes:0,tools:0});await p.close();
 });
});
test('pending file reads and post-await permission loss prevent late mutations',async()=>{
 await check('asyncSafety',async()=>{
  const p=await h.open({payload:seed,beforeLoad:captureAdapter});assert.match(await p.evaluate(()=>__startupGuard),/読み込み中/);await adminLogin(p);await adminPage(p,'data');
  await p.evaluate(()=>{const read=File.prototype.text;File.prototype.text=async function(){window.__importStarted=true;await new Promise(resolve=>window.__releaseImport=resolve);return read.call(this)}});
  await p.locator('#backup-file').setInputFiles({name:'delayed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...seed,items:[]}))});await p.waitForFunction(()=>__importStarted);await rejectOutput(p,/読み込みを完了/);
  await p.evaluate(()=>{window.__savedGuard=ExcelGate.assertEditable;ExcelGate.assertEditable=()=>{throw Error('変更権限を失いました。')};__releaseImport()});await p.waitForFunction(()=>document.querySelector('#toast').textContent.includes('変更権限を失いました'));
  assert.equal(await p.locator('#modal').isVisible(),false);await p.evaluate(()=>{ExcelGate.assertEditable=__savedGuard});assert.deepEqual((await h.output(p)).payload,seed);await p.close();
  // Initial admin hashing is the other asynchronous database mutation.
  const q=await h.open({beforeLoad:captureAdapter});await q.evaluate(()=>{const derive=crypto.subtle.deriveBits.bind(crypto.subtle);crypto.subtle.deriveBits=async(...args)=>{window.__hashStarted=true;await new Promise(resolve=>window.__releaseHash=resolve);return derive(...args)}});
  await q.locator('.admin-entry summary').click();await q.locator('form[data-form="admin-login"] [name="password"]').fill('admin');await submit(q,'admin-login');await q.waitForFunction(()=>__hashStarted);await rejectOutput(q,/処理・読み込み/);
  await q.evaluate(()=>{window.__savedGuard=ExcelGate.assertEditable;ExcelGate.assertEditable=()=>{throw Error('ハッシュ処理後に変更不可')};__releaseHash()});await q.waitForFunction(()=>document.querySelector('#app [data-error]').textContent.includes('ハッシュ処理後'));
  await q.evaluate(()=>{ExcelGate.assertEditable=__savedGuard});assert.deepEqual((await h.output(q)).payload,empty());await q.close();
 });
});
test('finished sessions reject forged click, submit and import without changing data',async()=>{
 await check('finishedMutations',async()=>{
  const p=await h.open({payload:seed,beforeLoad:captureAdapter});await adminLogin(p);await adminPage(p,'data');const out=await h.output(p,'complete');assert.deepEqual(out.payload,seed);
  await p.evaluate(()=>{
   const form=document.createElement('form');form.dataset.form='save-item';form.innerHTML='<input name="name" value="不正追加"><input name="number" value="X"><input name="category" value="PT">';document.body.append(form);form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
   const b=document.createElement('button');b.dataset.action='approve';b.dataset.id='fake';document.body.append(b);b.click();
   window.__fileReads=0;File.prototype.text=async()=>{window.__fileReads++;return '{}'};const dt=new DataTransfer();dt.items.add(new File(['{}'],'late.json'));const f=document.querySelector('#backup-file');f.files=dt.files;f.dispatchEvent(new Event('change',{bubbles:true}));
  });await p.waitForFunction(()=>document.querySelector('#toast').textContent.includes('入力を終えた'));
  assert.equal(await p.evaluate(()=>__fileReads),0);assert.deepEqual(await p.evaluate(()=>__adapter.exportData()),seed);assert.equal(await p.locator('excel-gate-panel dialog').isVisible(),true);assert.deepEqual(p.gateErrors,[]);await p.close();
 });
});
