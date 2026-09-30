const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
test('source configuration is minimal and assets are collected without a handwritten file list',async()=>{
  const {resolveConfig,collectAppFiles}=await import('../scripts/package.mjs');
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'gate-source-'));
  try{
    await fs.writeFile(path.join(folder,'gate.config.json'),JSON.stringify({displayName:'業務',appId:'business'}));
    await fs.writeFile(path.join(folder,'index.html'),'<!doctype html>');
    await fs.mkdir(path.join(folder,'assets'));await fs.writeFile(path.join(folder,'assets','日本語.css'),'body{}');
    await fs.writeFile(path.join(folder,'.DS_Store'),'ignored');
    const config=await resolveConfig(folder);
    assert.deepEqual(config.files,['assets/日本語.css','index.html']);
    assert.equal(config.runtimeVersion,'0.5.0');assert.equal(config.authorRequired,true);assert.equal(config.viewPolicy,'view');
    await fs.symlink(path.join(folder,'index.html'),path.join(folder,'linked.html'));
    await assert.rejects(collectAppFiles(folder),/Symlinks/);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});
test('release evidence requires both PCs, each scenario, and exact deployed bytes',async()=>{
  const {validateAcceptance}=await import('../scripts/package.mjs');
  const evidence={status:'passed',workbookSha256:'book',testedAt:'2026-09-21',tester:'QA',windowsVersion:'test',justCalcVersion:'test',edgeVersion:'test',pcIds:['A','B'],appIds:['app'],appHashes:{app:{'runtime/index.html':'html'}},checks:{}};
  for(const key of ['setup','roundTrip','midSave','readOnly','twoPcLock','handoff','wrongKind','missingDuplicateForeignBranch','networkFailure','restartRecovery','closeFailure','otherWorkbookUnchanged'])evidence.checks[key]=true;
  assert.doesNotThrow(()=>validateAcceptance(evidence,'book',{'runtime/index.html':'html'},'app'));
  assert.throws(()=>validateAcceptance({...evidence,pcIds:['A','A']},'book',{},'app'),/incomplete/);
  assert.throws(()=>validateAcceptance({...evidence,checks:{...evidence.checks,networkFailure:false}},'book',{},'app'),/networkFailure/);
  assert.throws(()=>validateAcceptance(evidence,'book',{'runtime/index.html':'changed'},'app'),/stale/);
  assert.throws(()=>validateAcceptance({...evidence,status:'pending'},'book',{},'app'),/incomplete/);
});
test('an unverified build cannot create a normal distribution folder',async()=>{
  const {buildApp}=await import('../scripts/package.mjs');
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'gate-release-'));
  try{
    await assert.rejects(buildApp('progress-board',output,{acceptanceFile:path.join(output,'no-acceptance.json')}),/source-verified|ENOENT/);
    await assert.rejects(fs.access(path.join(output,'progress-board')));
  }finally{await fs.rm(output,{recursive:true,force:true});}
});
test('starter preserves original files and unfinished adapters cannot be packaged',async()=>{
  const {initApp}=await import('../scripts/init-app.mjs');
  const {buildApp}=await import('../scripts/package.mjs');
  const input=await fs.mkdtemp(path.join(os.tmpdir(),'gate-starter-'));
  const app='test-starter-'+process.pid;
  const source=path.join(__dirname,'../apps',app);
  try{
    const html='<!doctype html><html><head><meta charset="utf-8"></head><body><p>元の画面</p><script>window.app=1</script></body></html>';
    await fs.writeFile(path.join(input,'index.html'),html);
    await initApp(input,app,'starter-app','ひな型');
    assert.equal(await fs.readFile(path.join(input,'index.html'),'utf8'),html);
    const created=await fs.readFile(path.join(source,'index.html'),'utf8');
    assert.match(created,/EXCEL_GATE_START/);assert.match(created,/元の画面/);
    assert.ok(created.indexOf('excel-gate.js')<created.indexOf('window.app'));
    await assert.rejects(initApp(input,app,'starter-app','ひな型'),/already exists/);
    await assert.rejects(buildApp(app,path.join(input,'output'),{mode:'development'}),/Finish the app-specific adapter/);
    await assert.rejects(fs.access(path.join(input,'output',app)));
  }finally{await fs.rm(input,{recursive:true,force:true});await fs.rm(source,{recursive:true,force:true});}
});
test('distribution rejects traversal, aliases, collisions and incompatible runtime versions',async()=>{
  const {validRelative,validateConfig}=await import('../scripts/package.mjs');
  for(const path of ['../x','/absolute','C:/x','a\\b','x/../a','a//b','a/','a./x','CON.txt'])assert.throws(()=>validRelative(path));
  assert.equal(validRelative('sub/日本語.html'),'sub/日本語.html');
  const config={displayName:'例',appId:'example',dataVersion:1,entry:'index.html',files:['index.html'],runtimeVersion:'0.5.0',viewPolicy:'view',authorRequired:true};
  assert.deepEqual(validateConfig(config),config);
  for(const update of [{files:['index.html','INDEX.HTML']},{runtimeVersion:'0.3'},{files:['other']},{files:['index.html','excel-gate.js']},{viewPolicy:'unknown'}])assert.throws(()=>validateConfig({...config,...update}));
});
test('nested entry and assets preserve relative paths, and rebuild cannot overwrite a deployment',async()=>{
  const {buildApp}=await import('../scripts/package.mjs');
  const source=await fs.mkdtemp(path.join(__dirname,'../apps/test-assets-'));
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'gate-package-test-'));
  try{
    await fs.mkdir(path.join(source,'pages'));await fs.mkdir(path.join(source,'assets'));
    const config={displayName:'配置試験',appId:'asset-test',dataVersion:1,entry:'pages/index.html',files:['pages/index.html','assets/日本語.svg'],runtimeVersion:'0.5.0',viewPolicy:'view',authorRequired:true};
    await fs.writeFile(path.join(source,'gate.config.json'),JSON.stringify(config));
    await fs.writeFile(path.join(source,'pages/index.html'),'<!doctype html><meta charset="utf-8"><!-- EXCEL_GATE_START --><!-- EXCEL_GATE_END --><img src="../assets/日本語.svg"><script>window.example=true;</script>');
    const svg='<svg xmlns="http://www.w3.org/2000/svg"><text>日本語</text></svg>';
    await fs.writeFile(path.join(source,'assets/日本語.svg'),svg);
    const out=await buildApp(path.basename(source),output,{mode:'development'});
    const html=await fs.readFile(path.join(out,'runtime/pages/index.html'),'utf8');
    assert.match(html,/src="\.\.\/excel-gate-boot.js"/);assert.match(html,/src="\.\.\/assets\/日本語.svg"/);
    assert.equal(await fs.readFile(path.join(out,'runtime/assets/日本語.svg'),'utf8'),svg);
    const kept=path.join(out,'data/accepted/do-not-overwrite.txt');await fs.writeFile(kept,'existing data');
    await assert.rejects(buildApp(path.basename(source),output,{mode:'development'}),/Output already exists/);
    assert.equal(await fs.readFile(kept,'utf8'),'existing data');
    const manifest=JSON.parse(await fs.readFile(path.join(out,'release-manifest.json'),'utf8'));
    assert.equal(manifest.hashes['runtime/assets/日本語.svg'].length,64);
  }finally{await fs.rm(source,{recursive:true,force:true});await fs.rm(output,{recursive:true,force:true});}
});
