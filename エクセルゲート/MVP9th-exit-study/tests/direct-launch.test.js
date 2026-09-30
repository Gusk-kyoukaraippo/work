const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {fileUrl,start}=require('../shared/excel-gate-direct-launcher.js');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..');
test('file URLs preserve Japanese, spaces, #, %, drive and UNC paths without interpreting them',()=>{
 assert.equal(fileUrl('C:\\資料 #1%\\index.html'),'file:///C:/%E8%B3%87%E6%96%99%20%231%25/index.html');
 assert.equal(fileUrl('\\\\server\\share\\a b.html'),'file://server/share/a%20b.html');
 assert.equal(fileUrl('/tmp/a?b.html'),'file:///tmp/a%3Fb.html');
 for(const p of ['https://evil.test','relative.html','\\\\bad@host\\share','/tmp/\u0000x'])assert.throws(()=>fileUrl(p));
});
function parentFixture(){
 const listeners={},loads=[],messages=[],sent=[];
 const frame={contentWindow:{postMessage(...m){messages.push(m)}},hidden:true,removeAttribute(){},addEventListener(k,f){loads.push(f)}};
 const status={hidden:false,textContent:''};let onPort;
 const port={postMessage(m){sent.push(m)},start(){},close(){},set onmessage(f){onPort=f}};
 const win={document:{getElementById(id){return id==='app-frame'?frame:status}},MessageChannel:function(){this.port1=port;this.port2={}},setTimeout(){return 1},clearTimeout(){},addEventListener(k,f){listeners[k]=f},removeEventListener(k){delete listeners[k]}};
 const config={token:'a'.repeat(64),entryPath:'/app/index.html',context:{secret:'test-only'}};
 start(config,{window:win});const hello=listeners.message;
 return{frame,status,messages,sent,config,hello,port(data){onPort({data})},loads};
}
test('only the intended window/token may receive a port; context waits for document challenge acknowledgement',()=>{
 const f=parentFixture(),token=f.config.token,challenge='b'.repeat(64),message={type:'excel-gate-hello',token,challenge};
 f.hello({source:{},data:message});f.hello({source:f.frame.contentWindow,data:{...message,token:'c'.repeat(64)}});assert.equal(f.messages.length,0);
 f.hello({source:f.frame.contentWindow,data:message});assert.equal(f.messages.length,1);assert.equal(f.sent.length,0);assert.equal('context' in f.messages[0][0],false);
 f.port({type:'port-ready',token,challenge:'c'.repeat(64)});assert.equal(f.sent.length,0);
 f.port({type:'port-ready',token,challenge});assert.equal(f.sent.length,1);assert.deepEqual(f.sent[0].context,{secret:'test-only'});assert.equal(f.config.context,null);
 f.port({type:'port-ready',token,challenge});f.hello({source:f.frame.contentWindow,data:message});assert.equal(f.sent.length,1);assert.equal(f.messages.length,1);
 f.port({type:'ready',token,challenge});assert.equal(f.frame.hidden,false);
 f.loads[0]();f.loads[0]();assert.equal(f.frame.hidden,true);assert.match(f.status.textContent,/再読込/);
});
test('child ignores another parent, token, challenge and replayed context, and waits for visible acknowledgement',async()=>{
 const listeners={},sent=[],parent={postMessage(m){sent.push(m)}};let portHandler,shown=false;
 const win={location:{hash:'#excel-gate-direct='+'a'.repeat(64)},parent,crypto:webcrypto,addEventListener(k,f){listeners[k]=f},removeEventListener(k){delete listeners[k]},setTimeout(){return 1},clearTimeout(){}};
 vm.runInNewContext(await fs.readFile(path.join(root,'shared/excel-gate-direct-child.js'),'utf8'),{window:win,Uint8Array,Promise,Error});
 const hello=sent[0],portMessages=[],port={postMessage(m){portMessages.push(m)},start(){},set onmessage(f){portHandler=f}},msg={type:'excel-gate-port',token:hello.token,challenge:hello.challenge};
 listeners.message({source:{},data:msg,ports:[port]});listeners.message({source:parent,data:{...msg,challenge:'0'.repeat(64)},ports:[port]});assert.equal(portMessages.length,0);
 listeners.message({source:parent,data:msg,ports:[port]});assert.equal(portMessages[0].type,'port-ready');assert.equal(win.__EXCEL_GATE_CONTEXT__,undefined);
 portHandler({data:{...msg,type:'context',token:'wrong',context:{a:0}}});assert.equal(win.__EXCEL_GATE_CONTEXT__,undefined);
 portHandler({data:{...msg,type:'context',context:{a:1}}});await win.__EXCEL_GATE_DIRECT_PENDING__;assert.equal(win.__EXCEL_GATE_CONTEXT__.a,1);
 portHandler({data:{...msg,type:'context',context:{a:2}}});assert.equal(win.__EXCEL_GATE_CONTEXT__.a,1);
 const waiting=win.ExcelGateDirect.ready().then(()=>{shown=true});await Promise.resolve();assert.equal(shown,false);portHandler({data:{...msg,type:'shown'}});await waiting;assert.equal(shown,true);
});
test('direct VBA skips asset copies but retains data validation and durable session save before browser launch',async()=>{
 const d=await fs.readFile(path.join(root,'vba/utf8/GateDeployment.bas'),'utf8');
 assert.ok(d.indexOf('GateWriteDirectLauncher(contextJson, targetFolder)')<d.indexOf('GateCopyRawVerified '));
 const launcher=d.split('Private Function GateWriteDirectLauncher')[1].split('End Function')[0];assert.doesNotMatch(launcher,/GateCopyRawVerified|GateCrc32/);assert.match(launcher,/Replace\(launchConfig, "<", Chr\$\(92\) & "u003c"\)/);
 const m=(await fs.readFile(path.join(root,'vba/utf8/GateMain.bas'),'utf8')).split('Public Sub OpenEditHtml()')[1].split('End Sub')[0];assert.ok(m.indexOf('GateCurrentPayloadRaw()')<m.indexOf('GateCreateRuntimeHtml'));assert.ok(m.indexOf('GateSaveWorkbook "start-session"')<m.indexOf('GateOpenLocalFile htmlFile'));
});
let folder,h,previous;
test.before(async()=>{folder=await fs.mkdtemp(path.join(os.tmpdir(),'gate-direct-test-'));const{buildApp}=await import('../scripts/package.mjs');const stage=await buildApp('rehab-inventory',folder,{mode:'development'});previous=[process.env.EXCEL_GATE_STAGE,process.env.EXCEL_GATE_DIRECT];process.env.EXCEL_GATE_STAGE=stage;process.env.EXCEL_GATE_DIRECT='1';h=await(await import('../scripts/browser-harness.mjs')).createHarness();});
test.after(async()=>{await h?.close();await fs.rm(folder,{recursive:true,force:true});for(const [i,k]of ['EXCEL_GATE_STAGE','EXCEL_GATE_DIRECT'].entries()){if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i]}});
const context=id=>({runtimeVersion:'0.9.0',displayName:'試験',dataSource:'workbook',mode:'edit',readOnly:false,databaseId:'db-'+id,sessionId:'session-'+id,dataType:'app-e7456ae1-b9f9-4a7d-9839-8bad1f85fffa',schemaVersion:2,baseRevision:0,hasPayload:false,authorRequired:true});
test('two simultaneous launchers retain distinct sessions and exact file-download envelopes',async()=>{
 const pages=await Promise.all(['one','two'].map(id=>h.open({context:context(id)})));
 try{for(const [i,p]of pages.entries()){const value=await h.output(p);assert.equal(value.sessionId,'session-'+['one','two'][i]);assert.equal(value.databaseId,'db-'+['one','two'][i]);assert.equal(await p.evaluate(()=>crypto.subtle!==undefined),true);assert.deepEqual(p.gateErrors,[])}}finally{await Promise.all(pages.map(p=>p.close()))}
});
test('reload hides the child, refuses session reuse and never reports a second usable startup',async()=>{
 const p=await h.open();try{p.removeAllListeners('dialog');p.on('dialog',d=>d.accept());await p.evaluate(()=>location.reload());await p.gateParent.locator('#app-frame').waitFor({state:'hidden'});assert.match(await p.gateParent.locator('#launch-status').textContent(),/再読込/)}finally{await p.close()}
});
test('normal direct launch shows the app and preserves images without timing UI or diagnostic files',async()=>{
 const p=await h.open();try{assert.equal(await p.gateParent.locator('#app-frame').isVisible(),true);assert.equal(await p.locator('#excel-gate-benchmark').count(),0);assert.equal(await p.evaluate(()=>window.__EXCEL_GATE_BENCHMARK_RESULT__),undefined);assert.ok(await p.locator('img').count()>=4);assert.deepEqual(await p.evaluate(()=>[...document.images].filter(i=>!i.complete||!i.naturalWidth).map(i=>i.alt)),[]);await p.screenshot({path:path.join(root,'verification/mvp9-normal-app.png'),fullPage:true});}finally{await p.close()}
});
test('inline launcher preserves HTML-like business JSON without executing or truncating it',async()=>{
 const payload={version:2,revision:0,items:[],loans:[],extensionRequests:[],staff:[],lenders:[],checkers:[],adminAuth:null,extra:{text:'</script><script>window.injected=true</script>日本語\u2028\u2029 & " \\'}};
 const p=await h.open({payload});try{assert.deepEqual((await h.output(p)).payload,payload);assert.equal(await p.gateParent.evaluate(()=>window.injected),undefined);assert.equal(await p.evaluate(()=>window.injected),undefined);}finally{await p.close()}
});
