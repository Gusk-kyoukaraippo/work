const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
test('distribution rejects traversal, aliases, collisions and incompatible runtime versions',async()=>{
  const {validRelative,validateConfig}=await import('../scripts/package.mjs');
  for(const path of ['../x','/absolute','C:/x','a\\b','x/../a','a//b','a/','a./x','CON.txt'])assert.throws(()=>validRelative(path));
  assert.equal(validRelative('sub/日本語.html'),'sub/日本語.html');
  const config={displayName:'例',appId:'example',dataVersion:1,entry:'index.html',files:['index.html'],runtimeVersion:'0.4.0',viewPolicy:'view',authorRequired:true};
  assert.deepEqual(validateConfig(config),config);
  for(const update of [{files:['index.html','INDEX.HTML']},{runtimeVersion:'0.3'},{files:['other']},{files:['index.html','excel-gate.js']},{viewPolicy:'unknown'}])assert.throws(()=>validateConfig({...config,...update}));
});
test('nested entry and assets preserve relative paths, and rebuild cannot overwrite a deployment',async()=>{
  const {buildApp}=await import('../scripts/package.mjs');
  const source=await fs.mkdtemp(path.join(__dirname,'../apps/test-assets-'));
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'gate-package-test-'));
  try{
    await fs.mkdir(path.join(source,'pages'));await fs.mkdir(path.join(source,'assets'));
    const config={displayName:'配置試験',appId:'asset-test',dataVersion:1,entry:'pages/index.html',files:['pages/index.html','assets/日本語.svg'],runtimeVersion:'0.4.0',viewPolicy:'view',authorRequired:true};
    await fs.writeFile(path.join(source,'gate.config.json'),JSON.stringify(config));
    await fs.writeFile(path.join(source,'pages/index.html'),'<!doctype html><meta charset="utf-8"><!-- EXCEL_GATE_START --><!-- EXCEL_GATE_END --><img src="../assets/日本語.svg"><script>window.example=true;</script>');
    const svg='<svg xmlns="http://www.w3.org/2000/svg"><text>日本語</text></svg>';
    await fs.writeFile(path.join(source,'assets/日本語.svg'),svg);
    const out=await buildApp(path.basename(source),output);
    const html=await fs.readFile(path.join(out,'runtime/pages/index.html'),'utf8');
    assert.match(html,/src="\.\.\/excel-gate-boot.js"/);assert.match(html,/src="\.\.\/assets\/日本語.svg"/);
    assert.equal(await fs.readFile(path.join(out,'runtime/assets/日本語.svg'),'utf8'),svg);
    const kept=path.join(out,'data/accepted/do-not-overwrite.txt');await fs.writeFile(kept,'existing data');
    await assert.rejects(buildApp(path.basename(source),output),/Output already exists/);
    assert.equal(await fs.readFile(kept,'utf8'),'existing data');
    const manifest=JSON.parse(await fs.readFile(path.join(out,'release-manifest.json'),'utf8'));
    assert.equal(manifest.hashes['runtime/assets/日本語.svg'].length,64);
  }finally{await fs.rm(source,{recursive:true,force:true});await fs.rm(output,{recursive:true,force:true});}
});
