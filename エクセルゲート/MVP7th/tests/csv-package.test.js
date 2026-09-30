const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');

test('CSV source configuration defaults to viewing without authors and rejects incompatible modes and reserved source assets',async()=>{
  const {resolveConfig,validateConfig}=await import('../scripts/package.mjs');
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'gate-csv-config-'));
  try{
    await fs.writeFile(path.join(folder,'index.html'),'<!doctype html>');
    await fs.writeFile(path.join(folder,'gate.config.json'),JSON.stringify({appId:'csv-test',displayName:'CSV試験',dataSource:'csvFolder'}));
    const config=await resolveConfig(folder);
    assert.equal(config.dataSource,'csvFolder');assert.equal(config.viewPolicy,'view');assert.equal(config.authorRequired,false);
    assert.equal(config.runtimeVersion,'0.7.1');
    for(const update of [{dataSource:'csv'},{viewPolicy:'block'},{authorRequired:true},{files:['index.html','excel-gate-source.js']}]){
      assert.throws(()=>validateConfig({...config,...update}));
    }
    await fs.writeFile(path.join(folder,'gate.config.json'),JSON.stringify({appId:'workbook-test',displayName:'保存試験'}));
    const old=await resolveConfig(folder);
    assert.equal(old.dataSource,'workbook');assert.equal(old.authorRequired,true);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});

test('packaged CSV transport is ordered before business code, immutable, empty at rest and mode-specific in identity',async()=>{
  const {buildApp,computeIdentity}=await import('../scripts/package.mjs');
  const source=await fs.mkdtemp(path.join(__dirname,'../apps/test-csv-package-'));
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'gate-csv-package-'));
  const name=path.basename(source);
  try{
    await fs.mkdir(path.join(source,'pages'));
    await fs.writeFile(path.join(source,'pages/index.html'),'<!doctype html><meta charset="utf-8"><!-- EXCEL_GATE_START --><!-- EXCEL_GATE_END --><script>window.businessStarted=true</script>');
    const config={displayName:'CSV配置試験',appId:'csv-package-test',entry:'pages/index.html',authorRequired:false,viewPolicy:'view',dataSource:'workbook'};
    await fs.writeFile(path.join(source,'gate.config.json'),JSON.stringify(config));
    const workbookIdentity=await computeIdentity(name);
    await fs.writeFile(path.join(source,'gate.config.json'),JSON.stringify({...config,dataSource:'csvFolder'}));
    const csvIdentity=await computeIdentity(name);
    assert.equal(csvIdentity.dataSource,'csvFolder');assert.equal(workbookIdentity.dataSource,'workbook');
    assert.equal(csvIdentity.engine.digest,workbookIdentity.engine.digest);
    assert.notEqual(csvIdentity.app.digest,workbookIdentity.app.digest,'A source-mode change must invalidate app acceptance even with identical business HTML');
    const folder=await buildApp(name,output,{mode:'development'});
    const html=await fs.readFile(path.join(folder,'runtime/pages/index.html'),'utf8');
    const scripts=['../excel-gate-boot.js','../excel-gate-source.js','../excel-gate-core.js','../excel-gate.js','window.businessStarted'];
    scripts.forEach((script,i)=>{assert.ok(html.includes(script));if(i)assert.ok(html.indexOf(scripts[i-1])<html.indexOf(script));});
    assert.equal(await fs.readFile(path.join(folder,'runtime/excel-gate-source.js'),'utf8'),'window.__EXCEL_GATE_SOURCE__=null;\n');
    assert.match(await fs.readFile(path.join(folder,'runtime/excel-gate-boot.js'),'utf8'),/invalid:true/);
    assert.ok((await fs.readFile(path.join(folder,'runtime-files.txt'),'utf8')).split(/\r?\n/).includes('excel-gate-source.js'));
    const manifest=JSON.parse(await fs.readFile(path.join(folder,'release-manifest.json'),'utf8'));
    assert.equal(manifest.identity.dataSource,'csvFolder');assert.equal(manifest.distributionReady,false);
    assert.match(manifest.immutableFiles['runtime/excel-gate-source.js'],/^[a-f0-9]{64}$/);
    const deployed=JSON.parse(await fs.readFile(path.join(folder,'gate.config.json'),'utf8'));
    assert.equal(deployed.dataSource,'csvFolder');assert.equal(deployed.authorRequired,false);assert.equal(deployed.csvSourcePath,undefined);
  }finally{await fs.rm(source,{recursive:true,force:true});await fs.rm(output,{recursive:true,force:true});}
});

test('release builder rejects workbook-mode evidence even when receipt byte identities are the exact CSV candidate',async()=>{
  const {buildApp,computeIdentity}=await import('../scripts/package.mjs');
  const {createReceipt,CHECKS}=await import('../scripts/evidence.mjs');
  const source=await fs.mkdtemp(path.join(__dirname,'../apps/test-csv-release-'));
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'gate-csv-release-'));
  const evidenceDir=path.join(output,'fake-test-receipts');
  const name=path.basename(source);
  const target={os:'Windows',windowsVersion:'fixture 11',justCalcVersion:'fixture JUST Calc',edgeVersion:'fixture Edge'};
  try{
    await fs.writeFile(path.join(source,'index.html'),'<!doctype html><!-- EXCEL_GATE_START --><!-- EXCEL_GATE_END -->');
    await fs.writeFile(path.join(source,'gate.config.json'),JSON.stringify({appId:'csv-release-test',displayName:'CSV判定試験',dataSource:'csvFolder'}));
    const identity=await computeIdentity(name);
    assert.equal(identity.engine.assembled,true,'Run package acceptance tests after assembling and verifying the native master');
    await fs.mkdir(evidenceDir);
    for(const kind of ['engine','app']){
      const report={dataSource:'workbook',testedAt:'2026-09-21T01:00:00Z',tester:'自動試験専用',method:'user-reported',environment:'target-platform',notes:'単体テスト用の架空報告。実機試験結果ではない。',target,pcIds:['fixture-1','fixture-2'],homogeneousTargets:true,checks:Object.fromEntries(CHECKS[kind].map(key=>[key,true]))};
      const receipt=createReceipt({kind,identity:{...identity,dataSource:'workbook'},report});
      await fs.writeFile(path.join(evidenceDir,kind+'.json'),JSON.stringify(receipt));
    }
    await assert.rejects(buildApp(name,output,{mode:'release',target,evidenceDir}),/Release acceptance is incomplete/);
    await assert.rejects(fs.access(path.join(output,name)));
  }finally{await fs.rm(source,{recursive:true,force:true});await fs.rm(output,{recursive:true,force:true});}
});
