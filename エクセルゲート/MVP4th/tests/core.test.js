const test = require('node:test');
const assert = require('node:assert/strict');
const gate = require('../shared/excel-gate.js');
const core = require('../shared/excel-gate-core.js');
const context = (extra = {}) => ({runtimeVersion:'0.4.0',mode:'edit',readOnly:false,databaseId:'db-00000001',sessionId:'session-0001',dataType:'example',schemaVersion:1,baseRevision:0,hasPayload:false,authorRequired:true,...extra});
function fixture(extra = {}, download = async () => {}) { return gate.createController(context(extra), { download }); }
test('first use is distinct from every valid saved JSON value', () => {
  for (const payload of [{}, [], null, false, 0, '']) assert.deepEqual(fixture({hasPayload:true,payload}).initialData(()=>['sample']), payload);
  assert.deepEqual(fixture().initialData(()=>['initial']), ['initial']);
});
test('boot metadata and protocol mismatch fail closed', () => {
  for (const extra of [{runtimeVersion:'0.3.0'}, {mode:'x'}, {readOnly:true}, {hasPayload:true}, {schemaVersion:0}, {sessionId:''}]) assert.throws(()=>fixture(extra));
});
test('ready and asynchronous load complete before exporting', async () => {
  let ready, load, value;
  const controller = fixture({hasPayload:true,payload:{from:'Excel'}});
  const connected = controller.connect({ready:new Promise(r=>ready=r), load:p=>new Promise(r=>{value=p;load=r}),exportData:()=>value});
  await assert.rejects(controller.exportFile('利用者'), /出力できません/);
  ready(); await new Promise(r=>setImmediate(r));
  assert.deepEqual(value,{from:'Excel'}); assert.equal(controller.state().phase,'loading');
  load(); await connected;
  const out=await controller.exportFile('利用者'); assert.equal(out.envelope.payload.from,'Excel');
});
test('load failure and read-only failure do not expose editable state', async () => {
  for (const adapter of [{load:()=>{throw Error('load')},exportData:()=>({})}, {load:()=>{},exportData:()=>({}),setReadOnly:()=>false}]) {
    const c=fixture({mode:'view',readOnly:true}); await assert.rejects(c.connect(adapter));
    assert.equal(c.state().phase,'error'); await assert.rejects(c.exportFile('名前'));
  }
});
test('read-only is applied before asynchronous load and export is forbidden', async () => {
  const order=[]; const c=fixture({mode:'view',readOnly:true});
  await c.connect({load:async()=>order.push('load'), exportData:()=>({}),setReadOnly:async()=>order.push('readOnly')});
  assert.deepEqual(order,['readOnly','load']); await assert.rejects(c.exportFile('名前'));
});
test('exceptions, cancellation, validation and download failures keep sequence and editor state', async () => {
  let mode='throw', downloadFails=false;
  const c=fixture({}, async()=>{if(downloadFails)throw Error('download')});
  await c.connect({load:()=>{},exportData:async()=>{if(mode==='throw')throw Error('入力未確定');if(mode==='cancel')return gate.CANCEL;if(mode==='invalid')return {v:undefined};return {value:1}}});
  for(const m of ['throw','cancel','invalid','download']) {
    mode=m; downloadFails=m==='download';
    if(m==='cancel')assert.equal(await c.exportFile('名前','complete'),null); else await assert.rejects(c.exportFile('名前','complete'));
    assert.equal(c.state().exportSequence,0);assert.equal(c.state().phase,'editing');
  }
  downloadFails=false;mode='ok';await c.exportFile('名前','complete');assert.equal(c.state().phase,'exported');
});
test('snapshots detach data, retries reuse identical bytes and parent chain advances once', async () => {
  const outputs=[]; const state={schemaVersion:99,nested:[null,false,12,'日本語😀']};
  const c=fixture({}, async out=>outputs.push(out.text));
  await c.connect({load:()=>{},exportData:()=>state});
  const first=await c.exportFile('　佐藤 花子　');state.nested.push('later');
  await c.redownload();assert.equal(outputs[0],outputs[1]);assert.equal(first.envelope.payload.nested.length,4);
  const last=await c.exportFile('佐藤 花子','complete');
  assert.equal(last.envelope.exportSequence,2);assert.equal(last.envelope.parentSaveDataId,first.envelope.saveDataId);
  assert.equal(last.envelope.schemaVersion,1);assert.equal(last.envelope.payload.schemaVersion,99);
  await assert.rejects(c.exportFile('名前'));
});
test('concurrent export clicks cannot fork a sequence', async () => {
  let release;const c=fixture();await c.connect({load:()=>{},exportData:()=>new Promise(r=>release=r)});
  const first=c.exportFile('名前');await assert.rejects(c.exportFile('名前'));release({ok:true});await first;assert.equal(c.state().exportSequence,1);
});
test('non-JSON data, cycles, oversized UTF-8 and dangerous filename characters', async () => {
  const cycle={};cycle.a=cycle;
  for(const value of [undefined,NaN,Infinity,1n,()=>{},new Date(),{a:undefined},cycle,{toJSON(){return 1}}]) assert.throws(()=>gate.snapshot(value));
  const c=fixture();await c.connect({load:()=>{},exportData:()=> 'あ'.repeat(3600000)});await assert.rejects(c.exportFile('名前'),/10MiB/);
  const file=core.makeFileName(core.createEnvelope(context(),{exportSequence:0},'A/B:*?','workCopy',{}));assert.ok(file.startsWith('Excelゲート受け渡し_'));assert.doesNotMatch(file,/[\\/:*?"<>|]/);
});
