const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const target={os:'Windows',windowsVersion:'11 24H2 26100.6584',justCalcVersion:'JUST Calc 5 5.0.1',edgeVersion:'140.0.3485.54'};
const deploymentLocation={platform:'win32',path:'\\\\server\\share\\csv-view'};
const csvSourcePath='\\\\server\\data\\地ケアCSV';
const identity={schemaVersion:1,runtimeVersion:'0.7.1',dataSource:'csvFolder',appId:'csv-view',engine:{assembled:true,digest:'csv-engine-sha',workbookSha256:'csv-master-sha',files:{}},app:{digest:'csv-app-sha',files:{}}};
async function fixture(){
  const api=await import('../scripts/evidence.mjs');
  const report=kind=>({dataSource:'csvFolder',testedAt:'2026-09-21T01:00:00Z',tester:'試験用の架空担当者',method:'user-reported',environment:'target-platform',notes:'単体試験専用の架空データ。実際のWindows受け入れ結果ではありません。',target,pcIds:['fixture-A','fixture-B'],homogeneousTargets:true,siteId:'csv-fixture-site',shareLocation:deploymentLocation.path,csvSourcePath,checks:Object.fromEntries(api.CSV_CHECKS[kind].map(key=>[key,true]))});
  const receipts=['engine','app','site'].map(kind=>api.createReceipt({kind,identity,report:report(kind),deploymentLocation,now:'2026-09-21T02:00:00Z'}));
  return {api,report,receipts};
}
test('CSV acceptance uses explicit CSV checks and does not demand workbook saving or edit locks',async()=>{
  const {api,receipts}=await fixture();
  for(const receipt of receipts){
    assert.equal(receipt.dataSource,'csvFolder');assert.equal(receipt.status,'passed');
    assert.deepEqual(Object.keys(receipt.checks),api.CSV_CHECKS[receipt.kind]);
    for(const key of ['midSave','roundTrip','twoPcLock','handoff','pendingInput','finalFreeze'])assert.equal(receipt.checks[key],undefined);
  }
  const result=api.assessAcceptance({identity,receipts,target,siteId:'csv-fixture-site',deploymentLocation,csvSourcePath});
  assert.equal(result.siteReady,true);assert.deepEqual(result.reasons,[]);
  assert.ok(api.CHECKS.engine.includes('midSave'));assert.ok(api.CHECKS.site.includes('twoPcLock'));
});
test('source modes isolate receipts even for identical engine, workbook and app hashes',async()=>{
  const {api,report,receipts}=await fixture();
  const workbookIdentity={...identity,dataSource:'workbook'};
  const workbookReceipts=['engine','app'].map(kind=>api.createReceipt({kind,identity:workbookIdentity,report:{...report(kind),dataSource:'workbook',checks:Object.fromEntries(api.CHECKS[kind].map(key=>[key,true]))}}));
  assert.equal(api.assessAcceptance({identity,receipts:workbookReceipts,target}).distributionReady,false);
  assert.equal(api.assessAcceptance({identity:workbookIdentity,receipts,target}).distributionReady,false);
  const unmarked=structuredClone(receipts);for(const receipt of unmarked)delete receipt.dataSource;
  assert.equal(api.assessAcceptance({identity,receipts:unmarked,target}).distributionReady,false);
  assert.throws(()=>api.createReceipt({kind:'engine',identity,report:{...report('engine'),dataSource:undefined}}),/dataSource/);
  assert.throws(()=>api.createReceipt({kind:'app',identity,report:{...report('app'),dataSource:'workbook'}}),/dataSource/);
});
test('every CSV-specific check is required, and a later failure supersedes previous passing evidence',async()=>{
  const {api,report,receipts}=await fixture();
  for(const kind of ['engine','app','site'])for(const key of api.CSV_CHECKS[kind]){
    const changed=structuredClone(receipts);delete changed.find(r=>r.kind===kind).checks[key];
    const result=api.assessAcceptance({identity,receipts:changed,target,siteId:'csv-fixture-site',deploymentLocation,csvSourcePath});
    assert.equal(result.siteReady,false,key);assert.equal(result.distributionReady,kind==='site',key);
    assert.match(result.reasons.join(' '),new RegExp(key));
  }
  const failed=api.createReceipt({kind:'engine',identity,report:{...report('engine'),checks:{...report('engine').checks,changedDuringRead:false}},now:'2026-09-21T03:00:00Z'});
  assert.equal(failed.status,'failed');assert.equal(api.assessAcceptance({identity,receipts:[...receipts,failed],target}).distributionReady,false);
  assert.throws(()=>api.createReceipt({kind:'engine',identity,report:{...report('engine'),pcIds:['only-one']}}),/two distinct/);
});
test('CSV site receipt binds the separately tested CSV source and requires its current absolute path',async()=>{
  const {api,report,receipts}=await fixture();
  const args={identity,receipts,target,siteId:'csv-fixture-site',deploymentLocation};
  for(const value of [undefined,'','S:csv',csvSourcePath+'-other']){
    const result=api.assessAcceptance({...args,csvSourcePath:value});
    assert.equal(result.distributionReady,true);assert.equal(result.siteReady,false);
    assert.match(result.reasons.join(' '),/CSV source path/);
  }
  assert.equal(api.assessAcceptance({...args,csvSourcePath:'//SERVER/DATA/地ケアCSV/'}).siteReady,true);
  assert.equal(receipts[2].csvSourcePath,csvSourcePath.toLowerCase());
  for(const value of [undefined,'','S:csv'])assert.throws(()=>api.createReceipt({kind:'site',identity,report:{...report('site'),csvSourcePath:value},deploymentLocation}),/CSV source path/);
  const forged=structuredClone(receipts);delete forged[2].csvSourcePath;
  assert.equal(api.assessAcceptance({...args,receipts:forged,csvSourcePath}).siteReady,false);
});
test('CSV requirements versions remain independently enforceable and invalid modes fail closed',async()=>{
  const {api,receipts}=await fixture();
  for(const kind of ['engine','app','site']){
    const result=api.assessAcceptance({identity,receipts,target,siteId:'csv-fixture-site',deploymentLocation,csvSourcePath,requirementsVersions:{...api.CSV_REQUIREMENTS_VERSIONS,[kind]:api.CSV_REQUIREMENTS_VERSIONS[kind]+1}});
    assert.equal(result.receipts[kind],undefined);assert.equal(result.siteReady,false);
  }
  assert.throws(()=>api.assessAcceptance({identity:{...identity,dataSource:'anything'},receipts,target}),/dataSource/);
});
test('record/status require a current CSV source for commissioning without modifying live workbook or source data',async()=>{
  const {api,report,receipts}=await fixture();
  const {sha256}=await import('../scripts/package.mjs');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gate-csv-commissioning-'));
  const evidenceDir=await fs.mkdtemp(path.join(os.tmpdir(),'gate-csv-receipts-'));
  try{
    await fs.mkdir(path.join(directory,'runtime'));await fs.mkdir(path.join(directory,'verification'));await fs.mkdir(path.join(directory,'source'));
    const config=JSON.stringify({appId:'csv-view',dataSource:'csvFolder'}),runtime='/* CSV immutable fixture */';
    await fs.writeFile(path.join(directory,'gate.config.json'),config);await fs.writeFile(path.join(directory,'runtime/excel-gate.js'),runtime);
    const manifest=JSON.stringify({schemaVersion:2,mode:'release',distributionReady:true,target,identity,immutableFiles:{'gate.config.json':sha256(config),'runtime/excel-gate.js':sha256(runtime)}});
    await fs.writeFile(path.join(directory,'release-manifest.json'),manifest);
    await fs.writeFile(path.join(directory,'MVP7th.xlsm'),'initialized CSV configuration workbook');
    await fs.writeFile(path.join(directory,'source/fixture.csv'),'name,value\r\noriginal,1');
    for(const receipt of receipts.slice(0,2))await fs.writeFile(path.join(directory,'verification',receipt.kind+'.json'),JSON.stringify(receipt));
    const recorded=await api.recordEvidence({kind:'site',report:report('site'),deploymentDir:directory,evidenceDir});
    assert.equal(recorded.receipt.csvSourcePath,csvSourcePath.toLowerCase());
    assert.equal(recorded.acceptance.siteReady,false,'A reported tested path does not silently become the current path');
    assert.equal((await api.assessDeployment(directory,{siteId:'csv-fixture-site',csvSourcePath})).siteReady,true);
    assert.equal((await api.assessDeployment(directory,{siteId:'csv-fixture-site',csvSourcePath:csvSourcePath+'-changed'})).siteReady,false);
    const script=path.join(__dirname,'../scripts/evidence.mjs');
    const cli=await run(process.execPath,[script,'status','--deployment='+directory,'--site=csv-fixture-site','--csv-source='+csvSourcePath]);
    assert.equal(JSON.parse(cli.stdout).siteReady,true);
    const missing=await run(process.execPath,[script,'status','--deployment='+directory,'--site=csv-fixture-site']);
    assert.equal(JSON.parse(missing.stdout).siteReady,false);
    assert.equal(await fs.readFile(path.join(directory,'MVP7th.xlsm'),'utf8'),'initialized CSV configuration workbook');
    assert.equal(await fs.readFile(path.join(directory,'source/fixture.csv'),'utf8'),'name,value\r\noriginal,1');
    assert.equal(await fs.readFile(path.join(directory,'release-manifest.json'),'utf8'),manifest);
  }finally{await fs.rm(directory,{recursive:true,force:true});await fs.rm(evidenceDir,{recursive:true,force:true});}
});
