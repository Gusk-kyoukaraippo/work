const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');

const target={os:'Windows',windowsVersion:'11 24H2 26100.6584',justCalcVersion:'JUST Calc 5 5.0.1',edgeVersion:'140.0.3485.54'};
const deploymentLocation={platform:'win32',path:'\\\\server\\share\\sample'};
const identity={schemaVersion:1,runtimeVersion:'0.8.0',appId:'sample',engine:{assembled:true,digest:'engine-sha',workbookSha256:'master-sha',files:{'shared/excel-gate.js':'runtime-sha'}},app:{digest:'app-sha',files:{'runtime/index.html':'html-sha'}}};
async function fixture(){
  const api=await import('../scripts/evidence.mjs');
  const report=kind=>({testedAt:'2026-09-21T01:00:00.000Z',tester:'実機確認担当',method:'user-reported',environment:'target-platform',notes:'記録対象の導入先を二台の実機で開いて操作結果を報告。これは単体テスト用の架空データです。',target,pcIds:['PC-A','PC-B'],homogeneousTargets:true,siteId:'\\\\server\\share\\sample',shareLocation:'\\\\SERVER\\SHARE\\sample\\',checks:Object.fromEntries(api.CHECKS[kind].map(key=>[key,true]))});
  const receipts=['engine','app','site'].map(kind=>api.createReceipt({kind,identity,report:report(kind),deploymentLocation,now:'2026-09-21T02:00:00.000Z'}));
  return {api,report,receipts};
}
test('engine/app acceptance permits distribution while commissioning remains separate',async()=>{
  const {api,receipts}=await fixture();
  let result=api.assessAcceptance({identity,receipts:receipts.slice(0,2),target});
  assert.equal(result.releaseReady,true);assert.equal(result.distributionReady,true);assert.equal(result.siteReady,false);
  result=api.assessAcceptance({identity,receipts,target,siteId:'\\\\server\\share\\sample',deploymentLocation});
  assert.equal(result.siteReady,true);assert.deepEqual(result.reasons,[]);
  result=api.assessAcceptance({identity,receipts,target,siteId:'\\\\other\\share',deploymentLocation});
  assert.equal(result.releaseReady,true);assert.equal(result.siteReady,false);
});
test('common changes invalidate all tiers; app changes reuse common evidence; versions must match exactly',async()=>{
  const {api,receipts}=await fixture();
  const changedEngine={...identity,engine:{...identity.engine,digest:'changed'}};
  let result=api.assessAcceptance({identity:changedEngine,receipts,target,siteId:receipts[2].siteId});
  assert.deepEqual(Object.keys(result.receipts),[]);assert.equal(result.siteReady,false);
  const changedApp={...identity,app:{...identity.app,digest:'changed'}};
  result=api.assessAcceptance({identity:changedApp,receipts,target,siteId:receipts[2].siteId});
  assert.deepEqual(Object.keys(result.receipts),['engine']);assert.equal(result.releaseReady,false);
  result=api.assessAcceptance({identity,receipts,target:{...target,edgeVersion:'140.0.3485.55'}});
  assert.equal(result.releaseReady,false);assert.deepEqual(Object.keys(result.receipts),[]);
  assert.equal(api.assessAcceptance({identity,receipts,target:{...target,windowsVersion:''}}).releaseReady,false);
  assert.equal(api.assessAcceptance({identity:{...identity,engine:{...identity.engine,assembled:false}},receipts,target}).releaseReady,false);
});
test('browser-only, one-PC common, incomplete checks, stale master and later failures cannot pass target acceptance',async()=>{
  const {api,report,receipts}=await fixture();
  assert.throws(()=>api.createReceipt({kind:'engine',identity,report:{...report('engine'),environment:'browser'}}),/actual observed/);
  assert.throws(()=>api.createReceipt({kind:'engine',identity,report:{...report('engine'),pcIds:['A','A']}}),/two distinct/);
  assert.throws(()=>api.createReceipt({kind:'app',identity,report:{...report('app'),target:{...target,os:'macOS'}}}),/Windows/);
  const failed=api.createReceipt({kind:'engine',identity,report:{...report('engine'),checks:{...report('engine').checks,networkFailure:false}},now:'2026-09-21T03:00:00.000Z'});
  assert.equal(failed.status,'failed');
  assert.equal(api.assessAcceptance({identity,receipts:[...receipts,failed],target}).releaseReady,false);
  const stale=structuredClone(receipts);stale[0].masterWorkbookSha256='different-master';
  assert.equal(api.assessAcceptance({identity,receipts:stale,target}).releaseReady,false);
  const unchecked=structuredClone(receipts);delete unchecked[1].checks.pendingInput;
  assert.equal(api.assessAcceptance({identity,receipts:unchecked,target}).releaseReady,false);
});
test('engine receipt is reusable for a second application without repeating common tests',async()=>{
  const {api,report,receipts}=await fixture();
  const other={...identity,appId:'other-app',app:{digest:'other-app-sha',files:{'runtime/index.html':'other-html'}}};
  const app=api.createReceipt({kind:'app',identity:other,report:report('app')});
  const result=api.assessAcceptance({identity:other,receipts:[receipts[0],app],target});
  assert.equal(result.releaseReady,true);assert.equal(result.receipts.engine.id,receipts[0].id);
});
test('commissioning appends only receipts and accepts an initialized workbook without rehashing live data',async()=>{
  const {api,report,receipts}=await fixture();
  const {sha256}=await import('../scripts/package.mjs');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gate-commissioning-'));
  const evidenceDir=await fs.mkdtemp(path.join(os.tmpdir(),'gate-records-'));
  try{
    await fs.mkdir(path.join(directory,'runtime'));await fs.mkdir(path.join(directory,'verification'));await fs.mkdir(path.join(directory,'data'));
    const config=JSON.stringify({appId:'sample'}),runtime='/* immutable runtime */';
    await fs.writeFile(path.join(directory,'gate.config.json'),config);await fs.writeFile(path.join(directory,'runtime/excel-gate.js'),runtime);
    const manifest={schemaVersion:2,mode:'release',distributionReady:true,target,identity,immutableFiles:{'gate.config.json':sha256(config),'runtime/excel-gate.js':sha256(runtime)}};
    const manifestText=JSON.stringify(manifest);
    await fs.writeFile(path.join(directory,'release-manifest.json'),manifestText);
    await fs.writeFile(path.join(directory,'MVP8th.xlsm'),'initialized workbook with operational state');
    await fs.writeFile(path.join(directory,'data/saved.json'),'業務データ');
    for(const receipt of receipts.slice(0,2))await fs.writeFile(path.join(directory,'verification',receipt.kind+'.json'),JSON.stringify(receipt));
    let status=await api.assessDeployment(directory,{siteId:report('site').siteId});
    assert.equal(status.releaseReady,true);assert.equal(status.siteReady,false);
    const recorded=await api.recordEvidence({kind:'site',report:report('site'),deploymentDir:directory,evidenceDir});
    assert.equal(recorded.acceptance.siteReady,true);
    assert.equal(recorded.receipt.engineDigest,identity.engine.digest);
    assert.deepEqual(recorded.receipt.deploymentLocation,await api.canonicalDeploymentLocation(directory));
    assert.equal(recorded.receipt.shareLocation,'\\\\server\\share\\sample');
    if(process.platform!=='win32')assert.equal(recorded.receipt.shareLocationVerified,false);
    assert.equal(await fs.readFile(path.join(directory,'MVP8th.xlsm'),'utf8'),'initialized workbook with operational state');
    assert.equal(await fs.readFile(path.join(directory,'data/saved.json'),'utf8'),'業務データ');
    assert.equal(await fs.readFile(path.join(directory,'release-manifest.json'),'utf8'),manifestText);
    assert.equal((await api.readReceipts(evidenceDir)).length,1);
    await fs.writeFile(path.join(directory,'MVP8th.xlsm'),'another legitimate save');
    status=await api.assessDeployment(directory,{siteId:report('site').siteId});assert.equal(status.siteReady,true);
    const moved=path.join(evidenceDir,'moved-deployment');await fs.cp(directory,moved,{recursive:true});
    const movedStatus=await api.assessDeployment(moved,{siteId:report('site').siteId});
    assert.equal(movedStatus.releaseReady,true);assert.equal(movedStatus.siteReady,false);
    assert.match(movedStatus.reasons.join(' '),/filesystem location differs/);
    await fs.writeFile(path.join(directory,'runtime/excel-gate.js'),'changed runtime');
    await assert.rejects(api.assessDeployment(directory,{siteId:report('site').siteId}),/Deployment files changed/);
  }finally{await fs.rm(directory,{recursive:true,force:true});await fs.rm(evidenceDir,{recursive:true,force:true});}
});
test('changed acceptance requirements invalidate the affected evidence independently of file hashes',async()=>{
  const {api,receipts}=await fixture();
  for(const kind of ['engine','app','site']){
    assert.equal(receipts.find(receipt=>receipt.kind===kind).requirementsVersion,api.REQUIREMENTS_VERSIONS[kind]);
    const requirementsVersions={...api.REQUIREMENTS_VERSIONS,[kind]:api.REQUIREMENTS_VERSIONS[kind]+1};
    const result=api.assessAcceptance({identity,receipts,target,siteId:receipts[2].siteId,deploymentLocation,requirementsVersions});
    assert.equal(result.receipts[kind],undefined);assert.equal(result.siteReady,false);
    assert.equal(result.releaseReady,kind==='site');
    assert.match(result.reasons.join(' '),/requirements version changed/);
  }
  const legacy=structuredClone(receipts);delete legacy[0].requirementsVersion;
  assert.equal(api.assessAcceptance({identity,receipts:legacy,target}).releaseReady,false);
});
test('all reported PCs must explicitly use the target versions and heterogeneous software cannot pass',async()=>{
  const {api,report,receipts}=await fixture();
  assert.throws(()=>api.createReceipt({kind:'engine',identity,report:{...report('engine'),homogeneousTargets:false}}),/all listed PCs/);
  const pcTargets={'PC-A':target,'PC-B':{...target,edgeVersion:'141.0.1'}};
  assert.throws(()=>api.createReceipt({kind:'engine',identity,report:{...report('engine'),pcTargets}}),/per-PC software versions differ/);
  const forged=structuredClone(receipts);forged[0].pcTargets=pcTargets;
  assert.equal(api.assessAcceptance({identity,receipts:forged,target}).releaseReady,false);
  const matching=api.createReceipt({kind:'engine',identity,report:{...report('engine'),pcTargets:{'PC-A':target,'PC-B':target}}});
  assert.deepEqual(matching.pcTargets,{'PC-A':target,'PC-B':target});
});
test('UNC identity normalizes Windows case and aliases while local recorder paths remain local',async()=>{
  const {api,report,receipts}=await fixture();
  assert.equal(api.normalizeShareLocation('//Server/Share/folder/../sample/'),'\\\\server\\share\\sample');
  assert.throws(()=>api.normalizeShareLocation('/Volumes/share/sample'),/UNC/);
  assert.throws(()=>api.normalizeShareLocation('S:\\sample'),/UNC/);
  const normalized=api.normalizeDeploymentLocation({platform:'win32',path:'\\\\SERVER\\Share\\SAMPLE\\'});
  assert.deepEqual(normalized,deploymentLocation);
  assert.equal(api.assessAcceptance({identity,receipts,target,siteId:receipts[2].siteId,deploymentLocation:normalized}).siteReady,true);
  assert.equal(api.assessAcceptance({identity,receipts,target,siteId:receipts[2].siteId}).siteReady,false);
  assert.throws(()=>api.createReceipt({kind:'site',identity,deploymentLocation,report:{...report('site'),shareLocation:'\\\\other\\share\\sample'}}),/differs from the actual/);
  assert.throws(()=>api.createReceipt({kind:'site',identity,deploymentLocation:{platform:'darwin',path:'/Volumes/share/sample'},report:{...report('site'),method:'observed'}}),/method=user-reported/);
  const recorded=api.createReceipt({kind:'site',identity,deploymentLocation:{platform:'darwin',path:'/Volumes/share/sample'},report:report('site')});
  assert.equal(recorded.shareLocationVerified,false);assert.equal(recorded.deploymentLocation.path,'/Volumes/share/sample');
});
test('missing evidence and unset default versions remain visibly pending',async()=>{
  const {api}=await fixture();
  const directory=path.join(os.tmpdir(),'nonexistent-gate-evidence-'+process.pid);
  assert.deepEqual(await api.readReceipts(directory),[]);
  assert.equal(await api.readTarget(path.join(directory,'missing.json')),null);
  const result=api.assessAcceptance({identity,receipts:[],target:{os:'Windows',windowsVersion:'',justCalcVersion:'',edgeVersion:''}});
  assert.equal(result.releaseReady,false);assert.match(result.reasons.join(' '),/versions are required/);
});
