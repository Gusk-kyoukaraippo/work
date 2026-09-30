const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function fixture(action){
  const input=await fs.mkdtemp(path.join(os.tmpdir(),'gate-integration-')),name='integration-test-'+crypto.randomBytes(5).toString('hex');
  const original='<!doctype html><html><head><title>日本語 &amp; 業務</title></head><body><p>そのままの画面</p><script>let business=[];</script></body></html>';
  await fs.writeFile(path.join(input,'index.html'),original);
  try{return await action({input,name,original,app:path.join(root,'apps',name),dir:path.join(root,'integrations',name)})}
  finally{await fs.rm(input,{recursive:true,force:true});await fs.rm(path.join(root,'apps',name),{recursive:true,force:true});await fs.rm(path.join(root,'integrations',name),{recursive:true,force:true})}
}
test('AI prepare snapshots exact source, derives title/ID and refuses duplicate or unfinished packaging',async()=>{
  const {prepareApp}=await import('../scripts/integrate.mjs');const {buildApp}=await import('../scripts/package.mjs');
  await fixture(async({input,name,original,app,dir})=>{
    const r=await prepareApp(input,{appName:name});const recipe=JSON.parse(await fs.readFile(path.join(dir,'recipe.json')));
    assert.match(r.appId,/^app-/);assert.equal(recipe.displayName,'日本語 & 業務');
    assert.equal(await fs.readFile(path.join(dir,'revisions',recipe.revision,'original/index.html'),'utf8'),original);
    assert.equal(await fs.readFile(path.join(input,'index.html'),'utf8'),original);
    const adapted=await fs.readFile(path.join(app,'index.html'),'utf8');assert.ok(adapted.indexOf('EXCEL_GATE_START')<adapted.indexOf('let business'));assert.match(adapted,/そのままの画面/);
    await assert.rejects(prepareApp(input,{appName:name}),/already exists/);
    await assert.rejects(buildApp(name,path.join(input,'output'),{mode:'development'}),/Finish the app-specific adapter/);
  });
});
test('updates retain app identity and archive adaptation/receipts, without touching source or operational data',async()=>{
  const {prepareApp}=await import('../scripts/integrate.mjs');
  await fixture(async({input,name,app,dir})=>{
    await prepareApp(input,{appName:name});const before=JSON.parse(await fs.readFile(path.join(dir,'recipe.json')));
    before.operatorMeasurement={reporter:'previous revision only'};await fs.writeFile(path.join(dir,'recipe.json'),JSON.stringify(before));
    await fs.writeFile(path.join(dir,'browser-receipt.json'),'old-receipt');await fs.writeFile(path.join(dir,'acceptance.test.mjs'),'old-test');
    const adapted=await fs.readFile(path.join(app,'index.html'),'utf8');await fs.writeFile(path.join(input,'index.html'),'<html><head><title>新版</title></head><body>更新</body></html>');
    await prepareApp(input,{update:name});const after=JSON.parse(await fs.readFile(path.join(dir,'recipe.json')));
    assert.equal(after.appId,before.appId);assert.equal(after.dataVersion,before.dataVersion);assert.equal(after.previousRevision,before.revision);
    assert.equal(after.operatorMeasurement,null);assert.equal(JSON.parse(await fs.readFile(path.join(dir,'revisions',after.revision,'previous-recipe.json'))).operatorMeasurement.reporter,'previous revision only');
    assert.equal(await fs.readFile(path.join(dir,'revisions',after.revision,'previous-adapted/index.html'),'utf8'),adapted);
    assert.equal(await fs.readFile(path.join(dir,'revisions',after.revision,'previous-browser-receipt.json'),'utf8'),'old-receipt');
    await assert.rejects(fs.access(path.join(dir,'browser-receipt.json')));
  });
});
test('real browser verification honors no-author config but cannot pass without all business checks',async()=>{
  const {prepareApp,verifyApp,packageIntegratedApp}=await import('../scripts/integrate.mjs');
  await fixture(async({input,name,app,dir})=>{
    await prepareApp(input,{appName:name});let html=await fs.readFile(path.join(app,'index.html'),'utf8');
    html=html.replace(/<!-- EXCEL_GATE_ADAPTER_TODO:[\s\S]*?-->/,'').replace('let business=[];', 'let business=[]; ExcelGate.connect({load(p,i){business=i.hasPayload?p:[]},exportData(){return business},setReadOnly(){}});');
    await fs.writeFile(path.join(app,'index.html'),html);
    const cf=path.join(app,'gate.config.json'),config=JSON.parse(await fs.readFile(cf));config.authorRequired=false;await fs.writeFile(cf,JSON.stringify(config));
    await fs.writeFile(path.join(dir,'acceptance.test.mjs'),`import test from 'node:test';import assert from 'node:assert/strict';import {createHarness} from '../../scripts/browser-harness.mjs';test('configured optional author',async()=>{const h=await createHarness();try{const p=await h.open({payload:[]});assert.equal(await p.locator('excel-gate-panel #name-label').isVisible(),false);const out=await h.output(p);assert.equal(out.authorName,'記名なし');assert.deepEqual(out.payload,[])}finally{await h.close()}});`);
    await (await import('../scripts/integrate.mjs')).identifyApp(name,{title:'日本語 & 業務'});
    const r=await verifyApp(name);assert.equal(r.status,'failed');assert.ok(r.problems.some(p=>p.includes('businessFlow')));
    assert.ok(!r.problems.some(p=>p.includes('失敗または中断')),await fs.readFile(path.join(dir,r.log),'utf8'));
    await assert.rejects(packageIntegratedApp(name,{outputRoot:path.join(input,'output')}),/未完了/);
  });
});
test('prepared names cannot traverse paths and unresolved assets are reported',async()=>{
  const {prepareApp,inspectSource}=await import('../scripts/integrate.mjs');
  await fixture(async({input})=>{
    await assert.rejects(prepareApp(input,{appName:'../escape'}),/Invalid/);
    await fs.writeFile(path.join(input,'index.html'),'<html><head><title>assets</title></head><body><img src="missing.png"></body></html>');
    const info=await inspectSource(input);assert.match(info.issues.join('\n'),/missing.png/);
  });
});
test('browser receipts cannot approve changed source, tests or recipe',async()=>{
  const {prepareApp,requireBrowserReceipt,testToolsDigest}=await import('../scripts/integrate.mjs');const {computeIdentity}=await import('../scripts/package.mjs');
  const {REQUIRED_CHECKS}=await import('../scripts/browser-harness.mjs');
  await fixture(async({input,name,app,dir})=>{
    await prepareApp(input,{appName:name});let html=await fs.readFile(path.join(app,'index.html'),'utf8');html=html.replace(/<!-- EXCEL_GATE_ADAPTER_TODO:[\s\S]*?-->/,'');await fs.writeFile(path.join(app,'index.html'),html);
    const testFile=path.join(dir,'acceptance.test.mjs');await fs.writeFile(testFile,'// unit-test receipt fixture');
    await (await import('../scripts/integrate.mjs')).identifyApp(name,{title:'日本語 & 業務'});
    const recipe=JSON.parse(await fs.readFile(path.join(dir,'recipe.json'))),identity=await computeIdentity(name);
    const receipt={status:'passed',requirementsVersion:1,recipeRevision:recipe.revision,engineDigest:identity.engine.digest,appDigest:identity.app.digest,testHash:hash(await fs.readFile(testFile)),toolsDigest:await testToolsDigest(),checks:REQUIRED_CHECKS.map(key=>({key,passed:true}))};
    await fs.writeFile(path.join(dir,'browser-receipt.json'),JSON.stringify(receipt));await requireBrowserReceipt(name);
    await fs.appendFile(testFile,' changed');await assert.rejects(requireBrowserReceipt(name),/再検証|再確認/);
    await fs.writeFile(testFile,'// unit-test receipt fixture');await fs.appendFile(path.join(app,'index.html'),'<!-- new code -->');await assert.rejects(requireBrowserReceipt(name),/再検証|再確認/);
  });
});
test('ZIP keeps Japanese filenames and empty internal folders; rejects overwriting destination',async()=>{
  const {zipFolder}=await import('../scripts/zip.mjs');
  await fixture(async({input})=>{
    const folder=path.join(input,'配布');await fs.mkdir(path.join(folder,'data/.pending'),{recursive:true});await fs.writeFile(path.join(folder,'日本語.html'),'正確な内容');
    const zip=path.join(input,'out.zip');await zipFolder(folder,zip);
    const result=execFileSync(process.env.PYTHON||'python3',['-c','import sys,zipfile,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({"names":z.namelist(),"data":z.read("配布/日本語.html").decode()},ensure_ascii=False))',zip],{encoding:'utf8'});
    const check=JSON.parse(result);assert.equal(check.data,'正確な内容');assert.ok(check.names.includes('配布/data/.pending/'));
    await assert.rejects(zipFolder(folder,zip),/EEXIST/);
  });
});
test('operator effort requires actual counts; missing measurements never become zero',async()=>{
  const {prepareApp,recordEffort}=await import('../scripts/integrate.mjs');
  await fixture(async({input,name,dir})=>{
    await prepareApp(input,{appName:name});assert.equal(JSON.parse(await fs.readFile(path.join(dir,'recipe.json'))).operatorMeasurement,null);
    await assert.rejects(recordEffort(name,{reporter:'test'}),/Actual/);
    const r=await recordEffort(name,{reporter:'テスト報告',source:'test fixture only',startedAt:'2026-09-21T00:00:00Z',completedAt:'2026-09-21T00:01:00Z',codeEdits:0,commandInputs:0,configEdits:0,vbaEdits:0,hashTranscriptions:0});assert.equal(r.elapsedSeconds,60);
  });
});
