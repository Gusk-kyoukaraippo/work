import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './browser-harness.mjs';
let h;
test.before(async()=>{h=await createHarness()});
test.after(async()=>{await h?.close()});
test('integration starts from an empty edit session and original read-only screen',async()=>{
  for(const mode of ['edit','view']) {
    const p=await h.open({mode});
    assert.equal(await p.locator('excel-gate-panel #finish').isVisible(),mode==='edit');
    if(mode==='view') assert.match(await p.evaluate(()=>{try{ExcelGate.assertEditable();return 'allowed'}catch(e){return e.message}}),/閲覧|編集|変更/);
    await p.close();
  }
});
test('invalid launch context blocks data export',async()=>{
  const p=await h.open({context:{invalid:true},ready:false});
  assert.equal(await p.locator('excel-gate-panel dialog').isVisible(),true);
  assert.equal(await p.locator('excel-gate-panel #finish').isEnabled(),false);
  await p.close();
});
