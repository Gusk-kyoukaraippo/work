import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectAppFiles, validRelative, buildApp, computeIdentity } from './package.mjs';
import { zipFolder } from './zip.mjs';
import { displayName as checkedName, accentColor, markdownText } from './presentation.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha = bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const json = async file=>JSON.parse(await fs.readFile(file,'utf8'));
const save = (file,value)=>fs.writeFile(file,JSON.stringify(value,null,2)+'\n');
const now = ()=>new Date().toISOString();
const stamp = ()=>now().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex');
const nameOf = value=>{validRelative(value);if(value.includes('/')||!/^[a-z0-9][a-z0-9-]{0,99}$/.test(value))throw new Error('Invalid app folder');return value};
const workspace = name=>path.join(ROOT,'integrations',nameOf(name));
const appFolder = name=>path.join(ROOT,'apps',nameOf(name));
const decode = value=>value.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");

export async function inspectSource(inputPath) {
  const input=path.resolve(inputPath), stat=await fs.lstat(input);
  if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))throw new Error('Use a regular HTML file or app directory');
  const files=stat.isDirectory()?await collectAppFiles(input):['index.html'];
  if(!files.includes('index.html'))throw new Error('Directory input requires index.html');
  const content=new Map();
  for(const file of files)content.set(file,await fs.readFile(stat.isDirectory()?path.join(input,file):input));
  const html=content.get('index.html').toString('utf8');
  if(!/<head\b[^>]*>/i.test(html)||!/<\/body\s*>/i.test(html))throw new Error('HTML needs explicit head and body tags');
  if(/EXCEL_GATE_START|ExcelGate\.connect/.test(html))throw new Error('Pass the original unadapted HTML; use the saved recipe when updating');
  const issues=[];
  if(/<script\b[^>]*\bsrc\s*=/i.test(html))issues.push('外部JavaScriptを参照しています。内包版を用意するか、AIが依存関係を確認する必要があります。');
  if(/http-equiv\s*=\s*["']Content-Security-Policy/i.test(html))issues.push('独自CSPがあります。通常の配布には対応していません。');
  if(/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(html))issues.push('通信処理があります。file://で必要な業務機能が動くか確認してください。');
  const missing=[];
  for(const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"'#]+)["']/gi)) {
    const ref=match[1].split(/[?#]/)[0];
    if(!ref||/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref))continue;
    try {const local=decodeURIComponent(ref.replace(/^\.\//,''));validRelative(local);if(!files.includes(local))missing.push(local)}catch{missing.push(ref)}
  }
  if(missing.length)issues.push('不足する相対参照: '+[...new Set(missing)].join(', ')+'。元の位置関係を保ったアプリ専用フォルダを指定してください。');
  const title=decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??path.basename(input,path.extname(input))).replace(/\s+/g,' ').trim();
  const headings=[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m=>decode(m[1].replace(/<[^>]*>/g,'')).replace(/\s+/g,' ').trim()).filter(Boolean);
  return {input,content,html,title,headings,issues,sourceHashes:Object.fromEntries([...content].map(([name,bytes])=>[name,sha(bytes)]))};
}
export async function prepareApp(inputPath,options={}) {
  const source=await inspectSource(inputPath);
  const name=nameOf(options.update??options.appName??'app-'+crypto.randomUUID().slice(0,8));
  const dir=workspace(name), dest=appFolder(name);
  let previous=null;
  if(options.update)previous=await json(path.join(dir,'recipe.json'));
  else {try{await fs.access(dir);throw new Error('Integration already exists; update its saved recipe')}catch(e){if(e.code!=='ENOENT')throw e}}
  let config;
  if(options.adopt)config=await json(path.join(dest,'gate.config.json'));
  else if(previous)config=await json(path.join(dest,'gate.config.json'));
  else config={displayName:options.displayName??source.title,appId:'app-'+crypto.randomUUID(),dataVersion:1,entry:'index.html'};
  if(previous&&(config.appId!==previous.appId||config.dataVersion!==previous.dataVersion))throw new Error('Identity/schema changed; explicit migration is required');
  config.displayName=checkedName(options.displayName??previous?.requestedDisplayName??source.title);
  if(!options.adopt&&!previous){try{await fs.access(dest);throw new Error('App folder already exists; use its saved recipe or explicitly adopt reviewed code')}catch(e){if(e.code!=='ENOENT')throw e}}
  const id=stamp(), revisionDir=path.join(dir,'revisions',id);
  await fs.mkdir(path.join(revisionDir,'original'),{recursive:true});
  for(const [file,bytes] of source.content){const target=path.join(revisionDir,'original',file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx'})}
  if(!options.adopt) {
    const next=path.join(revisionDir,'prepared');await fs.mkdir(next);
    const boot='\n<!-- EXCEL_GATE_START -->\n<script src="../../shared/standalone-boot.js"></script>\n<script src="../../shared/excel-gate-core.js"></script>\n<script src="../../shared/excel-gate.js"></script>\n<!-- EXCEL_GATE_END -->';
    for(const [file,bytes] of source.content){const target=path.join(next,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,file==='index.html'?source.html.replace(/<head\b[^>]*>/i,m=>m+boot).replace(/<\/body\s*>/i,'<!-- EXCEL_GATE_ADAPTER_TODO: AI implements inline connection in the business data scope. -->\n</body>'):bytes)}
    await save(path.join(next,'gate.config.json'),config);
    await fs.mkdir(path.dirname(dest),{recursive:true});
    if(previous)await fs.rename(dest,path.join(revisionDir,'previous-adapted'));
    try{await fs.rename(next,dest)}catch(e){if(previous)await fs.rename(path.join(revisionDir,'previous-adapted'),dest);throw e}
  }
  if(options.adopt)await save(path.join(dest,'gate.config.json'),config);
  const recipe={schemaVersion:1,appName:name,appId:config.appId,dataVersion:config.dataVersion,displayName:config.displayName,createdAt:previous?.createdAt??now(),updatedAt:now(),revision:id,sourcePath:source.input,sourceHashes:source.sourceHashes,issues:source.issues,stage:'prepared',previousRevision:previous?.revision??null,requestedDisplayName:options.displayName??previous?.requestedDisplayName??null,operatorMeasurement:null};
  if(previous)await save(path.join(revisionDir,'previous-recipe.json'),previous);
  await save(path.join(dir,'recipe.json'),recipe);
  // Old receipts remain in revisions; they cannot approve a changed input or test.
  for(const file of ['browser-receipt.json','acceptance.test.mjs']) {
    try{await fs.rename(path.join(dir,file),path.join(revisionDir,'previous-'+file))}catch(e){if(e.code!=='ENOENT')throw e}
  }
  return {appName:name,appId:config.appId,source:dest,recipe:path.join(dir,'recipe.json'),nameCandidates:{title:source.title,headings:source.headings,userName:recipe.requestedDisplayName},next:'Review the final HTML and run identify with the app name before verify/package.',issues:source.issues};
}
export async function identifyApp(name,options={}) {
  name=nameOf(name);
  const dir=workspace(name),recipe=await json(path.join(dir,'recipe.json')),file=path.join(appFolder(name),'gate.config.json'),config=await json(file);
  if(config.appId!==recipe.appId||config.dataVersion!==recipe.dataVersion)throw new Error('Identity/schema changed; explicit migration is required');
  const origin=options.origin??'ai';if(!['ai','user'].includes(origin))throw new Error('Name origin must be ai or user');
  const chosen=checkedName(options.title);
  if(origin==='ai'&&recipe.requestedDisplayName&&chosen!==recipe.requestedDisplayName)throw new Error('ユーザー指定名が記録されています。変更依頼がある場合だけ --name-source=user で更新してください。');
  config.displayName=chosen;config.accentColor=accentColor(options.accent??config.accentColor);
  const entry=config.entry??'index.html';validRelative(entry);
  const entrySha256=sha(await fs.readFile(path.join(appFolder(name),entry)));
  await save(file,config);
  if(origin==='user')recipe.requestedDisplayName=config.displayName;
  recipe.displayName=config.displayName;recipe.nameReview={revision:recipe.revision,displayName:config.displayName,accentColor:config.accentColor,origin,entrySha256,reviewedAt:now()};
  await save(path.join(dir,'recipe.json'),recipe);
  return {appName:name,...recipe.nameReview};
}
async function requireNameReview(name) {
  const recipe=await json(path.join(workspace(name),'recipe.json')),config=await json(path.join(appFolder(name),'gate.config.json')),review=recipe.nameReview;
  const entry=config.entry??'index.html';validRelative(entry);
  if(!review||review.revision!==recipe.revision||review.displayName!==config.displayName||review.accentColor!==accentColor(config.accentColor)||review.entrySha256!==sha(await fs.readFile(path.join(appFolder(name),entry))))throw new Error('アプリ名が未確認、またはHTML更新後の再確認が必要です。identify --title で最終HTMLの名前を確定してください。');
}
function runNode(args,env,timeout=120000) {
  return new Promise((resolve,reject)=>{
    const environment={...process.env,...env};delete environment.NODE_TEST_CONTEXT;
    const child=spawn(process.execPath,args,{cwd:ROOT,env:environment,stdio:['ignore','pipe','pipe']});let output='';
    child.stdout.on('data',b=>{output+=b});child.stderr.on('data',b=>{output+=b});
    const timer=setTimeout(()=>{child.kill('SIGTERM')},timeout);
    child.on('error',e=>{clearTimeout(timer);reject(e)});
    child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,output})});
  });
}
export async function testToolsDigest() {
  const files=['scripts/browser-harness.mjs','scripts/integration-smoke.test.mjs','scripts/integrate.mjs'];
  return sha(Buffer.concat(await Promise.all(files.map(file=>fs.readFile(path.join(ROOT,file))))));
}
export async function verifyApp(name,options={}) {
  await requireNameReview(name);
  nameOf(name);const dir=workspace(name), recipe=await json(path.join(dir,'recipe.json'));
  const testFile=path.join(dir,'acceptance.test.mjs'), testHash=sha(await fs.readFile(testFile));
  const toolsDigest=await testToolsDigest(),before=await computeIdentity(name), work=await fs.mkdtemp(path.join(os.tmpdir(),'gate-verify-'));
  const startedAt=now();let result,checks=[],problems=[];
  try{
    const stage=await buildApp(name,work,{mode:'development'}), coverage=path.join(work,'checks.jsonl');
    result=await runNode(['--test','--test-concurrency=1','scripts/integration-smoke.test.mjs',testFile],{EXCEL_GATE_APP:name,EXCEL_GATE_STAGE:stage,EXCEL_GATE_TEST_RESULTS:coverage},options.timeout);
    try{checks=(await fs.readFile(coverage,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))}catch(e){if(e.code!=='ENOENT')throw e}
    const {REQUIRED_CHECKS}=await import('./browser-harness.mjs');
    problems=REQUIRED_CHECKS.filter(key=>!checks.some(c=>c.key===key&&c.passed===true)).map(key=>'未確認: '+key);
    const after=await computeIdentity(name);
    if(before.engine.digest!==after.engine.digest||before.app.digest!==after.app.digest||testHash!==sha(await fs.readFile(testFile))||toolsDigest!==await testToolsDigest())problems.push('試験中に実行物または試験内容が変更されました。');
    if(result.code!==0)problems.push('ブラウザ試験が失敗または中断されました。');
  }catch(e){result??={code:1,output:''};problems.push(e.message)}
  finally{await fs.rm(work,{recursive:true,force:true})}
  const logName='browser-'+stamp()+'.log';await fs.writeFile(path.join(dir,logName),result.output);
  const receipt={schemaVersion:1,requirementsVersion:1,kind:'browser',status:problems.length?'failed':'passed',engineDigest:before.engine.digest,appDigest:before.app.digest,testHash,toolsDigest,recipeRevision:recipe.revision,startedAt,completedAt:now(),platform:{os:process.platform,node:process.version},checks,problems,log:logName};
  await save(path.join(dir,'browser-receipt.json'),receipt);
  recipe.stage=receipt.status==='passed'?'browser-verified':'needs-fix';await save(path.join(dir,'recipe.json'),recipe);
  return receipt;
}
export async function requireBrowserReceipt(name) {
  await requireNameReview(name);
  const dir=workspace(name),recipe=await json(path.join(dir,'recipe.json')),r=await json(path.join(dir,'browser-receipt.json')),identity=await computeIdentity(name);
  const {REQUIRED_CHECKS}=await import('./browser-harness.mjs');
  if(r.status!=='passed'||r.requirementsVersion!==1||r.recipeRevision!==recipe.revision||r.engineDigest!==identity.engine.digest||r.appDigest!==identity.app.digest||r.testHash!==sha(await fs.readFile(path.join(dir,'acceptance.test.mjs')))||r.toolsDigest!==await testToolsDigest()||REQUIRED_CHECKS.some(key=>!r.checks?.some(c=>c.key===key&&c.passed===true)))throw new Error('ブラウザ試験が未完了、または変更後の再検証が必要です。');
  return {recipe,receipt:r,identity};
}
export async function packageIntegratedApp(name,options={}) {
  const {recipe,receipt,identity}=await requireBrowserReceipt(name);
  const {assessAcceptance,readReceipts}=await import('./evidence.mjs');
  let target=options.target;
  if(!target){try{target=await json(path.join(ROOT,'verification/target-platform.json'))}catch(e){if(e.code!=='ENOENT')throw e}}
  const evidenceDir=options.evidenceDir??path.join(ROOT,'verification/receipts');
  const assessment=assessAcceptance({identity,receipts:await readReceipts(evidenceDir),target});
  const mode=options.mode??(assessment.releaseReady?'release':identity.engine.assembled?'candidate':'development');
  const outputRoot=path.resolve(options.outputRoot??path.join(ROOT,'deliverables',stamp()));
  const folder=await buildApp(name,outputRoot,{mode,evidenceDir,target});
  try {
    const built=await json(path.join(folder,'release-manifest.json'));
    if(built.identity.engine.digest!==receipt.engineDigest||built.identity.app.digest!==receipt.appDigest)throw new Error('梱包中に対象が変わりました。再検証してください。');
    await requireBrowserReceipt(name);
  }catch(error){
    // This folder was exclusively created by this build; never remove a prior deployment.
    await fs.rm(folder,{recursive:true,force:true});throw error;
  }
  const status=mode==='release'?'配布可能。導入先の確認は別途必要です。':mode==='candidate'?'実機検証用。利用開始できません。':'開発用。完成ブックと実機検証が必要です。';
  await fs.copyFile(path.join(workspace(name),'browser-receipt.json'),path.join(folder,'browser-verification.json'));
  await fs.writeFile(path.join(folder,'組み込み結果.md'),`# ${markdownText(recipe.displayName)} — Excelゲート MVP8th\n\n${status}\n\nHTMLの改修とブラウザ試験は完了しました。元HTMLは組み込み作業フォルダに保管済みです。${identity.engine.assembled?'マクロ入りの共通ブックも同梱しています。ブック作成・VBA編集は不要です。':'この出力には完成ブックがありません。AIによる準備が必要です。'}\n\n## 次に行うこと\n\n1. AIが案内する画面で、いつもの業務操作と入力内容を確認します。\n2. [導入手順](導入手順.md)に沿って、フォルダ一式を新しい場所へ置き、同梱ブックの「初回設定」を押します。実機検証用の場合は検証場所で行います。\n3. [実機試験](実機試験.md)の一台でできる確認から進めます。二台の確認は環境がそろってから行い、未実施は未実施として記録します。\n4. 結果をAIへ伝えます。AIが残りの確認を整理し、利用開始できるかを案内します。\n\nWindows／JUST Calcでの検収とブラウザ試験は別です。既存のブックやdataへ重ねて配置しないでください。\n\n自動試験: ${receipt.completedAt}\n組み込み作業の計測: ${recipe.operatorMeasurement?'記録済み':'未計測（時間短縮率は算出していません）'}\n`);
  const manifest=await json(path.join(folder,'release-manifest.json'));
  async function includeHashes(relative='') {
    for(const entry of await fs.readdir(path.join(folder,relative),{withFileTypes:true})) {
      const file=relative?relative+'/'+entry.name:entry.name;
      if(entry.isDirectory())await includeHashes(file);
      else if(entry.isFile()&&file!=='release-manifest.json')manifest.hashes[file]=sha(await fs.readFile(path.join(folder,file)));
    }
  }
  await includeHashes();await save(path.join(folder,'release-manifest.json'),manifest);
  const zip=await zipFolder(folder,folder+'.zip');
  recipe.stage=mode;recipe.lastOutput={folder,zip,createdAt:now()};await save(path.join(workspace(name),'recipe.json'),recipe);
  return {appName:name,mode,status,folder,zip,siteReady:false};
}
export async function recordEffort(name,report) {
  if(!report?.reporter||!report?.source||!report?.startedAt||!report?.completedAt)throw new Error('Actual measurement reporter/source/start/end required');
  for(const key of ['codeEdits','commandInputs','configEdits','vbaEdits','hashTranscriptions'])if(!Number.isInteger(report[key])||report[key]<0)throw new Error('Actual count required: '+key);
  const duration=Date.parse(report.completedAt)-Date.parse(report.startedAt);if(!Number.isFinite(duration)||duration<0)throw new Error('Invalid measurement times');
  const dir=workspace(name),recipe=await json(path.join(dir,'recipe.json'));recipe.operatorMeasurement={...report,elapsedSeconds:duration/1000};await save(path.join(dir,'recipe.json'),recipe);return recipe.operatorMeasurement;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [command,input,...args]=process.argv.slice(2),options={};
    for(const arg of args){const m=arg.match(/^--([^=]+)=(.*)$/);if(!m)throw new Error('Use --key=value options');options[m[1]]=m[2]}
    let result;
    if(command==='prepare')result=await prepareApp(input,{appName:options.name,update:options.update,displayName:options.title,adopt:options.adopt==='true'});
    else if(command==='identify')result=await identifyApp(input,{title:options.title,accent:options.accent,origin:options['name-source']});
    else if(command==='verify'){result=await verifyApp(input);if(result.status!=='passed')process.exitCode=1}
    else if(command==='package')result=await packageIntegratedApp(input,{outputRoot:options.output,mode:options.mode,target:options.target?await json(options.target):undefined});
    else if(command==='measure')result=await recordEffort(input,await json(options.report));
    else if(command==='status'){const {identity}=await requireBrowserReceipt(input);result={identity,recipe:await json(path.join(workspace(input),'recipe.json'))}}
    else throw new Error('Usage: integrate.mjs prepare <original.html|folder> | identify <app> --title=NAME [--accent=#RRGGBB] | verify <app> | package <app> | measure <app> --report=file | status <app>');
    console.log(JSON.stringify(result,null,2));
  }catch(e){console.error(e.message);process.exitCode=1}
}
