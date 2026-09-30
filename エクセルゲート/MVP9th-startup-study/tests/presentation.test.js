const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');

test('Windows filename rules preserve the visible name, long Unicode and optional color',async()=>{
 const {presentation,workbookFileName}=await import('../scripts/presentation.mjs');
 const p=presentation({displayName:'病棟 / 管理: "確認" <記録>?'});
 assert.equal(p.displayName,'病棟 / 管理: "確認" <記録>?');assert.equal(p.workbookFileName,'病棟 _ 管理_ _確認_ _記録__.xlsm');assert.equal(p.accentColor,'#1769AA');
 for(const name of ['CON','nul.txt','LPT9','AUX'])assert.ok(workbookFileName(name).startsWith('_'));
 const name='長い日本語の業務アプリ'.repeat(16);assert.ok(workbookFileName(name).length<106);assert.equal(presentation({displayName:name}).displayName,name);
 assert.notEqual(workbookFileName(name+'甲'),workbookFileName(name+'乙'));
 assert.equal(presentation({displayName:'=1+1',accentColor:'#aabbcc'}).accentColor,'#AABBCC');
 for(const invalid of ['', 'a\nname','あ'.repeat(257)])assert.throws(()=>presentation({displayName:invalid}));
 assert.throws(()=>presentation({displayName:'正しい名前',accentColor:'red'}));
});

test('ordinary integration generates arbitrary names, rechecks renamed HTML, keeps ID and user overrides',async()=>{
 const {prepareApp,identifyApp,verifyApp,inspectSource}=await import('../scripts/integrate.mjs');
 const {buildApp}=await import('../scripts/package.mjs');
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'gate-naming-')),name='naming-'+crypto.randomBytes(5).toString('hex'),app=path.join(root,'apps',name),record=path.join(root,'integrations',name);
 const original=path.join(tmp,'source.html');
 const source=(title,heading)=>`<!doctype html><html><head><title>${title}</title></head><body><h1>${heading}</h1><script>let data=[];</script></body></html>`;
 const adapted=async()=>{const file=path.join(app,'index.html');await fs.writeFile(file,(await fs.readFile(file,'utf8')).replace(/<!-- EXCEL_GATE_ADAPTER_TODO:[\s\S]*?-->/,'<script>ExcelGate.connect({load(p,i){data=i.hasPayload?p:[]},exportData(){return data},setReadOnly(){}})</script>'))};
 try{
  await fs.writeFile(original,source('社内ツール v2','物品貸出ノート'));
  const candidates=await inspectSource(original);assert.equal(candidates.title,'社内ツール v2');assert.deepEqual(candidates.headings,['物品貸出ノート']);
  const first=await prepareApp(original,{appName:name});await adapted();
  await assert.rejects(verifyApp(name),/アプリ名が未確認/);
  // AI reads the mismatching title/heading and records its actual decision.
  await identifyApp(name,{title:'物品貸出ノート'});
  const out=await buildApp(name,path.join(tmp,'first'),{mode:'development'}),manifest=JSON.parse(await fs.readFile(path.join(out,'release-manifest.json')));
  assert.equal(manifest.workbookFileName,'物品貸出ノート.xlsm');
  assert.match(await fs.readFile(path.join(out,'導入手順.md'),'utf8'),/物品貸出ノート\.xlsm/);
  assert.doesNotMatch(await fs.readFile(path.join(out,'導入手順.md'),'utf8'),/MVP8th\.xlsm|\{\{APP_NAME\}\}/);
  await fs.writeFile(original,source('改名済みタイトル','新しい貸出管理'));
  const second=await prepareApp(original,{update:name});assert.equal(second.appId,first.appId);await adapted();
  await assert.rejects(verifyApp(name),/アプリ名が未確認/);
  await identifyApp(name,{title:'新しい貸出管理'});
  const updated=await buildApp(name,path.join(tmp,'second'),{mode:'development'}),m=JSON.parse(await fs.readFile(path.join(updated,'release-manifest.json')));
  assert.equal(m.workbookFileName,'新しい貸出管理.xlsm');assert.equal(m.appId,manifest.appId);assert.equal(m.presentation.displayName,'新しい貸出管理');
  assert.equal(JSON.parse(await fs.readFile(path.join(out,'release-manifest.json'))).workbookFileName,'物品貸出ノート.xlsm');
  await identifyApp(name,{title:'利用者が指定した名称',origin:'user'});
  await fs.writeFile(original,source('さらに異なるtitle','画面名'));
  await prepareApp(original,{update:name});await adapted();
  assert.equal(JSON.parse(await fs.readFile(path.join(app,'gate.config.json'))).displayName,'利用者が指定した名称');
  await assert.rejects(identifyApp(name,{title:'画面名'}),/ユーザー指定名/);
  await identifyApp(name,{title:'利用者が指定した名称'});
  await fs.appendFile(path.join(app,'index.html'),'<!-- 最終HTMLの変更 -->');
  await assert.rejects(verifyApp(name),/再確認/);
 }finally{for(const f of [tmp,app,record])await fs.rm(f,{recursive:true,force:true})}
});

test('generated native book has literal saved titles, local button, constant names and identical VBA',async()=>{
 const {presentation}=await import('../scripts/presentation.mjs');
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'gate-book-test-'));
 try{
  for(const name of ['設備点検日誌','=1+1 / "記録" & <確認>','長い日本語の業務アプリ'.repeat(16)]){
   const p=presentation({displayName:name,accentColor:'#6b4fa3'}),output=path.join(tmp,p.workbookFileName);
   const receipt=JSON.parse(execFileSync('python3',[path.join(root,'scripts/personalize-workbook.py')],{input:JSON.stringify({master:path.join(root,'workbook/MVP8th.xlsm'),output,presentation:p}),encoding:'utf8'}));
   const result=JSON.parse(execFileSync('python3',['-c',`
import sys,json,zipfile,hashlib,xml.etree.ElementTree as E
ns='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
a=zipfile.ZipFile(sys.argv[1]);b=zipfile.ZipFile(sys.argv[2]);p=json.loads(sys.argv[3]);s=E.fromstring(b.read('xl/worksheets/sheet1.xml'));w=E.fromstring(b.read('xl/workbook.xml'))
assert a.namelist()==b.namelist()
assert len(w.findall(ns+'sheets/'+ns+'sheet'))==1
order=[c.tag.removeprefix(ns) for c in w]
assert order.index('definedNames')<order.index('calcPr')
for preceding in ['sheets','functionGroups','externalReferences']:
 if preceding in order: assert order.index(preceding)<order.index('definedNames')
for address,expected in [('B2',p['displayName']),('B4',p['workbookCredit'])]:
 c=s.find('.//'+ns+'c[@r="'+address+'"]');assert c.find(ns+'f') is None;assert ''.join(c.itertext())==expected
 names={n.get('name'):n.text for n in w.findall(ns+'definedNames/'+ns+'definedName')}
decoded=''.join(names.get('_GateDisplayName'+(str(i) if i>1 else ''),'""')[1:-1].replace('""','"') for i in range(1,7))
assert decoded==p['displayName']
assert names['_GateAccentColor']=='"#6B4FA3"'
assert 'macro="[0]!InitializeGate"' in b.read('xl/drawings/drawing1.xml').decode()
allowed={'xl/workbook.xml','xl/styles.xml','xl/worksheets/sheet1.xml','xl/drawings/drawing1.xml'}
for member in a.namelist():
 if member not in allowed: assert a.read(member)==b.read(member),member
assert 'FF6B4FA3' in b.read('xl/styles.xml').decode()
print(json.dumps({'vba':hashlib.sha256(b.read('xl/vbaProject.bin')).hexdigest()}))
`,path.join(root,'workbook/MVP8th.xlsm'),output,JSON.stringify(p)],{encoding:'utf8'}));
   assert.equal(result.vba,receipt.vbaProjectSha256);assert.equal(receipt.uninitialized,true);assert.equal(receipt.unchangedMembersVerified,true);
   assert.throws(()=>execFileSync('python3',[path.join(root,'scripts/personalize-workbook.py')],{input:JSON.stringify({master:path.join(root,'workbook/MVP8th.xlsm'),output,presentation:p}),stdio:['pipe','pipe','pipe']}),/overwrite/);
  }
 }finally{await fs.rm(tmp,{recursive:true,force:true})}
});
