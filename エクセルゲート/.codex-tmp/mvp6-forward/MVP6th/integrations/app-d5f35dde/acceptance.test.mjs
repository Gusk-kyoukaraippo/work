import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHarness, check } from '../../scripts/browser-harness.mjs';

const seed = [{id:'handoff-1',text:'朝の引継ぎ',metadata:{owner:'担当A',checked:false}}, {id:'handoff-2',text:'午後の確認'}];
let h;
test.before(async()=>{h=await createHarness()});
test.after(async()=>{await h?.close()});
async function named(page){await page.locator('excel-gate-panel #name').fill('確認担当')}
async function rejectOutput(page, pattern){
  await named(page);
  const result=await page.evaluate(async()=>{try{return {value:await ExcelGate.exportFile('complete')}}catch(e){return {error:e.message}}});
  assert.match(result.error,pattern);
}
async function readOriginal(page){
  const event=page.waitForEvent('download');await page.locator('#export').click();
  return JSON.parse(await fs.readFile(await (await event).path(),'utf8'));
}
async function businessFlow(page){
  await page.locator('#add').click();await page.locator('#draft').fill('午後の連絡');await page.locator('#commit').click();
  assert.equal(await page.locator('#notes article').count(),3);
  await page.locator('#notes article').first().getByRole('button',{name:'編集',exact:true}).click();
  await page.locator('#draft').fill('朝の引継ぎを更新');await page.locator('#commit').click();
  await page.locator('#filter').fill('午後');assert.equal(await page.locator('#notes article').count(),2);
  await page.locator('#filter').fill('');
}
async function importData(page,value,linked=true){
  await page.locator('#import').setInputFiles({name:'notes.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  if(linked)await page.waitForFunction(()=>document.querySelector('#import').value==='');
  else await page.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('#notes article span')].map(x=>x.textContent))===JSON.stringify(expected),(value||[]).map(n=>n.text));
}

test('original and adapted memo operations agree',async()=>{
  await check('businessFlow',async()=>{
    const p=await h.open({payload:seed});
    const original=await p.context().browser().newPage({acceptDownloads:true});
    await original.addInitScript(value=>localStorage.setItem('handoff-notes',JSON.stringify(value)),seed);
    await original.goto(pathToFileURL(fileURLToPath(new URL('../../../original.html',import.meta.url))).href);
    await original.waitForFunction(()=>document.querySelector('#status').textContent==='編集できます');
    await businessFlow(original);await businessFlow(p);
    const old=await readOriginal(original),adapted=(await h.output(p)).payload;
    assert.deepEqual(adapted.map(({id,...rest})=>rest),old.map(({id,...rest})=>rest));
    assert.equal(adapted[0].id,seed[0].id);assert.equal(adapted[1].id,seed[1].id);assert.equal(typeof adapted[2].id,'string');
    const imported=[{id:'import-1',text:'取込したメモ',extra:['保持する']}];
    await importData(original,imported,false);await importData(p,imported);
    assert.deepEqual(await readOriginal(original),(await h.output(p)).payload);
    assert.equal(await p.locator('#export').isVisible(),false);
    assert.doesNotMatch(await p.locator('body > #status').textContent(),/保存済み/);
    await p.screenshot({path:fileURLToPath(new URL('adapted-screen.png',import.meta.url)),fullPage:true});
    assert.deepEqual(p.gateErrors,[]);await original.close();await p.close();
  });
});

test('business JSON survives output and reopening including extra properties',async()=>{
  await check('roundTrip',async()=>{
    const p=await h.open({payload:seed});const output=await h.output(p);
    assert.deepEqual(output.payload,seed);assert.equal(output.saveKind,'workCopy');
    const reopened=await h.open({payload:output.payload});assert.deepEqual((await h.output(reopened)).payload,seed);
    assert.equal(await reopened.locator('#notes article').count(),2);
    await reopened.close();await p.close();
  });
});

test('only absent payload uses original first-use sample; empty and null are preserved',async()=>{
  await check('firstUseAndEmpty',async()=>{
    const first=await h.open();assert.deepEqual((await h.output(first)).payload,[{id:'sample',text:'使い方のサンプル'}]);await first.close();
    for(const payload of [[],null]){const p=await h.open({payload});assert.equal(await p.locator('#notes article').count(),0);assert.deepEqual((await h.output(p)).payload,payload);await p.close()}
    const bad=await h.open({payload:{},ready:false});
    await bad.waitForFunction(()=>document.querySelector('#status').textContent.includes('形式が不正'));
    assert.equal(await bad.locator('excel-gate-panel #finish').isEnabled(),false);
    assert.equal(await bad.locator('excel-gate-panel dialog').isVisible(),true);
    assert.equal(await bad.locator('#notes article').count(),0);await bad.close();
  });
});

test('draft export and replacement are blocked without losing text',async()=>{
  await check('pendingInput',async()=>{
    const p=await h.open({payload:seed});await p.locator('#add').click();await p.locator('#draft').fill('まだ確定していない連絡');
    await rejectOutput(p,/確定またはキャンセル/);
    assert.equal(await p.locator('#draft').inputValue(),'まだ確定していない連絡');assert.equal(await p.locator('#editor').isVisible(),true);
    await importData(p,[]);assert.match(await p.locator('body > #status').textContent(),/確定またはキャンセル/);
    assert.equal(await p.locator('#draft').inputValue(),'まだ確定していない連絡');
    await p.locator('#commit').click();const saved=(await h.output(p)).payload;assert.equal(saved.at(-1).text,'まだ確定していない連絡');
    await p.locator('#add').click();await p.locator('#draft').fill('破棄する入力');await p.locator('#cancel').click();
    assert.deepEqual((await h.output(p)).payload,saved);await p.close();
  });
});

test('view keeps search but denies UI, import and external API mutation',async()=>{
  await check('readOnly',async()=>{
    const p=await h.open({payload:seed,mode:'view'});
    for(const id of ['add','import','draft','commit'])assert.equal(await p.locator('#'+id).isEnabled(),false);
    assert.equal(await p.locator('#notes button').first().isEnabled(),false);
    await p.locator('#filter').fill('午後');assert.equal(await p.locator('#notes article').count(),1);await p.locator('#filter').fill('');
    assert.match(await p.evaluate(()=>{try{NoteActions.add('不正な追加');return 'allowed'}catch(e){return e.message}}),/閲覧専用/);
    await p.evaluate(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['[]'],'blocked.json'));document.querySelector('#import').files=transfer.files;document.querySelector('#import').dispatchEvent(new Event('change'))});
    await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('閲覧専用'));
    assert.deepEqual(await p.locator('#notes article span').allTextContents(),seed.map(n=>n.text));
    assert.deepEqual(p.gateErrors,[]);await p.close();
  });
});

test('linked asynchronous startup and edits never read or write browser storage',async()=>{
  await check('persistence',async()=>{
    const p=await h.open({payload:seed,beforeLoad:async page=>page.addInitScript(()=>{
      localStorage.setItem('handoff-notes',JSON.stringify([{id:'stale',text:'古いキャッシュ'}]));
      window.__gateStorageReads=0;window.__gateStorageWrites=0;
    })});
    await p.waitForTimeout(100);assert.deepEqual((await h.output(p)).payload,seed);
    await p.evaluate(()=>NoteActions.add('APIからの連絡'));await h.output(p);
    assert.deepEqual(await p.evaluate(()=>({reads:__gateStorageReads,writes:__gateStorageWrites,tools:__gateTestTools.length})),{reads:0,writes:0,tools:0});
    await p.close();
  });
});

test('startup guard, pending import and post-await edit guard prevent late overwrite',async()=>{
  await check('asyncSafety',async()=>{
    const p=await h.open({payload:seed,beforeLoad:async page=>page.addInitScript(()=>{
      Object.defineProperty(window,'NoteActions',{configurable:true,set(value){this.__actions=value;try{value.add('初期化前');this.__startupEdit='allowed'}catch(e){this.__startupEdit=e.message}},get(){return this.__actions}});
    })});
    assert.match(await p.evaluate(()=>__startupEdit),/読み込み中/);
    await p.evaluate(()=>{const read=File.prototype.text;File.prototype.text=async function(){window.__importStarted=true;await new Promise(resolve=>window.__releaseImport=resolve);return read.call(this)}});
    await p.locator('#import').setInputFiles({name:'delayed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{id:'late',text:'遅延取込'}]))});
    await p.waitForFunction(()=>window.__importStarted);
    await rejectOutput(p,/読み込みを完了/);
    assert.match(await p.evaluate(()=>{try{NoteActions.add('並行変更');return 'allowed'}catch(e){return e.message}}),/読み込みが終わるまで/);
    await p.evaluate(()=>{window.__originalGuard=ExcelGate.assertEditable;ExcelGate.assertEditable=()=>{throw Error('変更権限を失いました。')};__releaseImport()});
    await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('変更権限を失いました'));
    assert.deepEqual(await p.locator('#notes article span').allTextContents(),seed.map(n=>n.text));
    await p.evaluate(()=>{ExcelGate.assertEditable=__originalGuard});assert.deepEqual((await h.output(p)).payload,seed);
    assert.deepEqual(p.gateErrors,[]);await p.close();
  });
});

test('completion blocks external API, forged click and file import mutations',async()=>{
  await check('finishedMutations',async()=>{
    const p=await h.open({payload:seed});const completed=await h.output(p,'complete');assert.deepEqual(completed.payload,seed);
    assert.match(await p.evaluate(()=>{try{NoteActions.add('終了後の変更');return 'allowed'}catch(e){return e.message}}),/入力を終えた/);
    await p.evaluate(()=>{document.querySelector('#draft').value='終了後の書換え';document.querySelector('#commit').click();document.querySelector('#add').click();window.__readsAfterFinish=0;File.prototype.text=async()=>{window.__readsAfterFinish++;return '[]'};const dt=new DataTransfer();dt.items.add(new File(['[]'],'late.json'));document.querySelector('#import').files=dt.files;document.querySelector('#import').dispatchEvent(new Event('change'))});
    assert.equal(await p.evaluate(()=>__readsAfterFinish),0);
    assert.deepEqual(await p.locator('#notes article span').allTextContents(),seed.map(n=>n.text));
    assert.equal(await p.locator('#editor').isVisible(),false);assert.equal(await p.locator('excel-gate-panel dialog').isVisible(),true);
    assert.deepEqual(p.gateErrors,[]);await p.close();
  });
});
