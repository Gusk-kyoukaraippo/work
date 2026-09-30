const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
let browser,root;
const stamp='2026-09-21T12:00:00';
const source=(files=[])=>({sourcePath:'\\\\server\\共有',readAt:stamp,files});
test.before(async()=>{
  root=await fs.mkdtemp(path.join(os.tmpdir(),'gate-csv-browser-'));
  const executablePath=process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
});
test.after(async()=>{await browser?.close();if(root)await fs.rm(root,{recursive:true,force:true});});
async function open(src,hold=false) {
  const dir=await fs.mkdtemp(path.join(root,'session-'));
  for(const name of ['excel-gate.js','excel-gate-core.js'])await fs.copyFile(path.join(__dirname,'../shared',name),path.join(dir,name));
  const context={runtimeVersion:'0.9.0',dataSource:'csvFolder',mode:'view',readOnly:true,databaseId:'db',dataType:'csv',schemaVersion:1,baseRevision:0,hasPayload:false,authorRequired:true};
  await fs.writeFile(path.join(dir,'boot.js'),'window.__EXCEL_GATE_REQUIRED__=true;window.__EXCEL_GATE_CONTEXT__='+JSON.stringify(context)+';'+(src===undefined?'':'window.__EXCEL_GATE_SOURCE__='+JSON.stringify(src)+';'));
  await fs.writeFile(path.join(dir,'index.html'),`<!doctype html><meta charset="utf-8"><script src="boot.js"></script><script src="excel-gate-core.js"></script><script src="excel-gate.js"></script><body><h1>CSVアプリ</h1><script>
    window.__calls=[];window.__result=[];
    window.__connected=ExcelGate.connect({setReadOnly(value){__calls.push('readonly:'+value)},ready:${hold?'new Promise(resolve=>window.__ready=resolve)':'Promise.resolve()'},async loadSourceFiles(files,info){__calls.push('load');window.__result=await Promise.all(files.map(async f=>({name:f.name,size:f.size,bytes:Array.from(new Uint8Array(await f.arrayBuffer()))})));window.__info=info;}}).catch(e=>window.__error=e.message);
  </script></body>`);
  const p=await browser.newPage();p.downloads=[];p.on('download',d=>p.downloads.push(d));
  await p.addInitScript(()=>{window.__storageCount=0;Storage.prototype.getItem=Storage.prototype.setItem=function(){window.__storageCount++;throw Error('CSV source must not use browser storage');};});
  await p.goto(pathToFileURL(path.join(dir,'index.html')).href);
  await p.locator('excel-gate-panel').waitFor();
  return p;
}
async function assertNoSave(p) {
  for(const selector of ['#name-label','#finish','#work','#more','#again'])assert.equal(await p.locator('excel-gate-panel '+selector).isVisible(),false);
  assert.match(await p.evaluate(()=>ExcelGate.exportFile('complete').then(()=>'',e=>e.message)),/CSV|起動|受け渡し/);
  assert.equal(p.downloads.length,0);assert.equal(await p.evaluate(()=>__storageCount),0);
}
test('CSV view hides all save controls while loading, shows escaped source metadata, preserves binary files and blocks direct export',async()=>{
  const bytes=Buffer.from([0x82,0xa0,0xff,0x00,0x0a]);
  const p=await open(source([{name:'日本語.csv',size:bytes.length,lastModified:stamp,base64:bytes.toString('base64')}]),true);
  await assertNoSave(p);assert.equal(await p.locator('excel-gate-panel dialog').isVisible(),true);
  assert.deepEqual(await p.evaluate(()=>__calls),['readonly:true']);
  await p.evaluate(()=>__ready());await p.evaluate(()=>__connected);
  assert.equal(await p.locator('excel-gate-panel dialog').isVisible(),false);await assertNoSave(p);
  assert.deepEqual(await p.evaluate(()=>__result),[{name:'日本語.csv',size:bytes.length,bytes:[...bytes]}]);
  assert.match(await p.locator('excel-gate-panel #status').textContent(),/読込時点のCSV/);
  assert.doesNotMatch(await p.locator('excel-gate-panel #status').textContent(),/ブックに保存/);
  assert.match(await p.locator('excel-gate-panel #source-info').textContent(),/2026-09-21T12:00:00/);
  assert.match(await p.locator('excel-gate-panel #source-info').textContent(),/日本語.csv/);
  assert.match(await p.evaluate(()=>{try{ExcelGate.assertEditable();return ''}catch(e){return e.message}}),/閲覧専用/);
  await p.close();
});
test('empty snapshot renders data-none and malformed/missing source blocks initialization without save UI',async()=>{
  const empty=await open(source());await empty.evaluate(()=>__connected);
  assert.match(await empty.locator('excel-gate-panel #status').textContent(),/データなし/);await assertNoSave(empty);await empty.close();
  for(const src of [undefined,source([{name:'bad.csv',size:3,lastModified:stamp,base64:'$$$$'}])]){
    const p=await open(src);await p.evaluate(()=>__connected);
    await assertNoSave(p);assert.equal(await p.locator('excel-gate-panel dialog').isVisible(),true);
    assert.match(await p.locator('excel-gate-panel #modal-title').textContent(),/停止/);
    assert.deepEqual(await p.evaluate(()=>__calls),[]);await p.close();
  }
});
