import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHarness,check} from '../../scripts/browser-harness.mjs';

const metadata={sourcePath:'\\\\server\\共有\\地ケアCSV',readAt:'2026-09-21T12:00:00'};
const header='病床区分,対象月,指標コード,分子,分母,値,基準日';
const codes={acute:['acute_acuity','acute_los','acute_coordination','acute_emergency_admit'],disability:['disability_core','disability_medical_care','disability_los','disability_return'],community:['community_home_return','community_nursing','community_home_admission','community_emergency']};
const completeRows=Object.entries(codes).flatMap(([category,metrics])=>metrics.flatMap((code,index)=>Array.from({length:6},(_,i)=>`${category},20260${i+1},${code},${20+i+index},100,${code==='community_emergency'?i:''},2026-07-10`)));
const completeCsv=header+'\r\n'+completeRows.join('\r\n');
function wire(name,content){const bytes=Buffer.isBuffer(content)?content:Buffer.from(content);return {name,size:bytes.length,lastModified:'2026-09-21T11:00:00',base64:bytes.toString('base64')}}
function source(...files){return {...metadata,files}}
function generic(...rows){return wire('統合指標.csv',header+'\r\n'+rows.join('\r\n'))}
async function values(p){return p.locator('#metric-grid .value-number').allTextContents()}
async function noSaving(p){
  for(const id of ['work','finish','name'])if(await p.locator('excel-gate-panel #'+id).count())assert.equal(await p.locator('excel-gate-panel #'+id).isVisible(),false);
  const result=await p.evaluate(async()=>{try{await ExcelGate.exportFile('complete');return 'allowed'}catch(e){return e.message}});
  assert.match(result,/閲覧|CSV/);
}
async function badSource(files,pattern){
  const p=await h.open({source:source(...files),ready:false});
  await p.waitForFunction(()=>document.querySelector('#source-state').textContent==='読込エラー');
  assert.match(await p.locator('#import-status').textContent(),pattern);
  assert.ok((await values(p)).every(v=>v==='データなし'));
  assert.equal(await p.locator('excel-gate-panel dialog').isVisible(),true);
  await noSaving(p);assert.deepEqual(p.gateErrors,[]);await p.close();
}
let h,originalPath;
test.before(async()=>{h=await createHarness();const recipe=JSON.parse(await fs.readFile(new URL('recipe.json',import.meta.url)));originalPath=fileURLToPath(new URL(`revisions/${recipe.revision}/original/index.html`,import.meta.url));assert.equal(crypto.createHash('sha256').update(await fs.readFile(originalPath)).digest('hex'),recipe.sourceHashes['index.html'])});
test.after(async()=>{await h?.close()});

test('valid six-month CSV preserves original calculations, all category tabs and month selection',async()=>{
  await check('businessFlow',async()=>{
    const p=await h.open({source:source(wire('6ヶ月.csv',completeCsv))});
    const original=await p.context().browser().newPage();await original.goto(pathToFileURL(originalPath).href);
    await original.locator('#file-input').setInputFiles({name:'6ヶ月.csv',mimeType:'text/csv',buffer:Buffer.from(completeCsv)});
    await original.waitForFunction(()=>document.querySelector('#import-status').textContent.includes('反映しました'));
    for(const category of Object.keys(codes)){
      await p.locator('#tab-'+category).click();await original.locator('#tab-'+category).click();
      assert.deepEqual(await values(p),await values(original));
      assert.deepEqual(await p.locator('#trend-body').allTextContents(),await original.locator('#trend-body').allTextContents());
    }
    await p.locator('#month-select').selectOption('202604');assert.match(await p.locator('#summary-as-of').textContent(),/2026年4月/);
    assert.equal((await values(p))[1],'データなし');assert.match(await p.locator('#metric-grid .metric-foot').first().textContent(),/2025年11月/);
    await p.locator('#month-select').selectOption('202606');
    await p.locator('#open-csv-button').click();assert.match(await p.locator('#app-source-info').textContent(),/2026-09-21T12:00:00/);
    assert.match(await p.locator('#loaded-files').textContent(),/6ヶ月.csv.*更新/);
    await p.screenshot({path:fileURLToPath(new URL('adapted-screen.png',import.meta.url)),fullPage:true});
    assert.deepEqual(p.gateErrors,[]);await original.close();await p.close();
  });
});

test('legacy nursing and master CSV sets retain original aggregation on synthetic rows',async()=>{
  const files=Array.from({length:6},(_,i)=>{
    const month=i+1, stamp=`2026-${String(month).padStart(2,'0')}-28`;
    return [
      wire(`病棟別人数分布表(条件指定)_${stamp}.csv`,'6階,Ⅱ,該当,3,3\n6階,Ⅱ,対象,10,10\n6階,Ⅱ,割合,30'),
      wire(`地ケアマスタ_${stamp}.csv`,`合成テストデータ\n番号,ID,今回入院日,今回退院日,入院経路,転出先,備考とSCU日数,再入院\n1,synthetic-a,2026/${month}/1,2026/${month}/20,自宅,自宅,予定外,\n2,synthetic-b,2026/${month}/2,2026/${month}/21,一般病棟,一般病棟,,`)
    ];
  }).flat();
  const p=await h.open({source:source(...files)}), original=await p.context().browser().newPage();
  await original.goto(pathToFileURL(originalPath).href);
  await original.locator('#file-input').setInputFiles(files.map(f=>({name:f.name,mimeType:'text/csv',buffer:Buffer.from(f.base64,'base64')})));
  await original.waitForFunction(()=>document.querySelector('#import-status').textContent.includes('反映しました'));
  assert.deepEqual(await values(p),await values(original));
  assert.deepEqual(await values(p),['50.0%','50.0%','30.0%','30.0%','50.0%','50.0%','1人','3人']);
  await p.locator('#tab-acute').click();assert.ok((await values(p)).every(v=>v==='データなし'));
  assert.deepEqual(p.gateErrors,[]);await original.close();await p.close();
});

test('reopening a fresh snapshot reflects file updates; UTF-8 and Shift_JIS produce identical values',async()=>{
  await check('roundTrip',async()=>{
    const japaneseCsv=completeCsv.replaceAll('community,','地ケア,').replaceAll('acute,','急性期,').replaceAll('disability,','障害者,');
    const sjis=execFileSync(process.env.PYTHON||'python3',['-c','import sys;sys.stdout.buffer.write(sys.stdin.buffer.read().decode("utf-8").encode("cp932"))'],{input:japaneseCsv});
    const p=await h.open({source:source(wire('日本語_UTF8.csv','\uFEFF'+japaneseCsv))});
    const q=await h.open({source:source(wire('日本語_Shift_JIS.csv',sjis))});
    assert.deepEqual(await values(p),await values(q));
    assert.match(await q.locator('#loaded-files').textContent(),/日本語_Shift_JIS.csv/);
    const next=await h.open({source:source(generic('community,202609,community_emergency,,,9,2026-09-21'))});
    assert.equal((await values(next))[6],'9人');assert.equal((await values(next))[7],'データなし');
    assert.deepEqual(await next.locator('#month-select option').allTextContents(),['2026年9月']);
    await p.close();await q.close();await next.close();
  });
});

test('empty, unsupported and incomplete CSV show explicit missing data without demo or fabricated values',async()=>{
  await check('firstUseAndEmpty',async()=>{
    const empty=await h.open({source:source()});assert.ok((await values(empty)).every(v=>v==='データなし'));
    assert.equal(await empty.locator('#month-select').isEnabled(),false);assert.match(await empty.locator('#import-status').textContent(),/CSVがありません/);
    assert.doesNotMatch(await empty.locator('body').textContent(),/デモ|CSV＋/);await empty.close();
    const unknown=await h.open({source:source(wire('未対応.csv','未知,列\n1,2'))});
    assert.match(await unknown.locator('#source-warnings').textContent(),/未対応CSV: 未対応.csv/);assert.ok((await values(unknown)).every(v=>v==='データなし'));await unknown.close();
    const partial=await h.open({source:source(wire('病棟別人数分布表(条件指定)_2026-06-30.csv','6階,Ⅱ,該当,3\n6階,Ⅱ,対象,10'))});
    assert.match(await partial.locator('#source-warnings').textContent(),/2026年6月のCSV不足: 地ケアマスタ/);assert.ok((await values(partial)).every(v=>v==='データなし'));await partial.close();
    const gaps=await h.open({source:source(generic('community,202601,community_emergency,,,2,','community,202603,community_emergency,,,4,'))});
    assert.deepEqual(await gaps.locator('#month-select option').allTextContents(),['2026年1月','2026年2月','2026年3月']);
    assert.equal((await values(gaps))[6],'4人');assert.equal((await values(gaps))[7],'データなし');
    await gaps.locator('#month-select').selectOption('202602');assert.ok((await values(gaps)).every(v=>v==='データなし'));
    await gaps.locator('#tab-acute').click();assert.ok((await values(gaps)).every(v=>v==='データなし'));await gaps.close();
  });
});

test('recognized malformed CSV is rejected atomically with its file name',async()=>{
  await check('pendingInput',async()=>{
    await badSource([generic('community,202606,community_emergency,,,broken,')],/統合指標.csv.*有効な数値/);
    await badSource([generic('community,202606,community_emergency,,,%,')],/有効な数値/);
    await badSource([wire('引用符.csv',header+'\n"community,202606')],/引用符.csv.*引用符/);
    await badSource([generic('community,202606,community_emergency,,,3,','unknown,202606,community_emergency,,,2,')],/病床区分/);
    await badSource([generic('community,202606,community_emergency,,,3,','community,202606,community_emergency,,,2,')],/重複/);
    await badSource([wire('病棟別人数分布表(条件指定)_2026-06-30.csv','6階,Ⅱ,該当,3\n6階,Ⅱ,対象,10'),wire('地ケアマスタ_2026-06-30.csv','title\nwrong,headers\n1,example')],/地ケアマスタ.*必要な列/);
  });
});

test('legacy duplicate revision selection is order-independent and tied revisions stop',async()=>{
  const nursing=(date,num)=>wire(`病棟別人数分布表(条件指定)_2026-06-${date}.csv`,`6階,Ⅱ,該当,${num},${num}\n6階,Ⅱ,対象,10,10`);
  const masterText='合成テストデータ\n番号,ID,今回入院日,今回退院日,入院経路,転出先,備考とSCU日数,再入院\n1,synthetic,2026/06/01,2026/06/20,自宅,自宅,予定外,';
  const master=wire('地ケアマスタ_2026-06-30.csv',masterText);
  for(const files of [[nursing('29',3),nursing('28',2),master],[nursing('28',2),nursing('29',3),master]]){
    const p=await h.open({source:source(...files)});assert.equal((await values(p))[2],'30.0%');
    assert.match(await p.locator('#source-warnings').textContent(),/対象外: 病棟別人数分布表\(条件指定\)_2026-06-28.csv/);await p.close();
  }
  await badSource([nursing('29',3),master,wire('地ケアマスタデータ_2026-06-30.csv',masterText)],/基準日のCSVが重複/);
  await badSource([nursing('29',3),wire(master.name,masterText.replace('2026/06/01','2026/06/99'))],/読み取れない入退院日/);
});

test('source metadata stays text and empty layouts fit a small screen',async()=>{
  const p=await h.open({source:{...source(),sourcePath:'\\\\server\\'+('共有の長いフォルダ名'.repeat(8))+'<img src=x onerror="window.__sourceInjected=true">'}});
  await p.setViewportSize({width:390,height:844});
  assert.equal(await p.evaluate(()=>window.__sourceInjected),undefined);
  assert.equal(await p.locator('#csv-panel img').count(),0);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.ok((await values(p)).every(v=>v==='データなし'));
  await p.screenshot({path:fileURLToPath(new URL('empty-mobile-screen.png',import.meta.url)),fullPage:true});
  assert.deepEqual(p.gateErrors,[]);await p.close();
});

test('read-only presentation keeps navigation and has no file picker, demo or saving UI',async()=>{
  await check('readOnly',async()=>{
    const p=await h.open({source:source(wire('閲覧.csv',completeCsv))});
    assert.equal(await p.locator('input[type=file],#drop-zone,#reset-demo,#download-sample').count(),0);
    await noSaving(p);await p.locator('#tab-disability').click();await p.locator('#month-select').selectOption('202605');
    assert.match(await p.locator('#detail-hero').textContent(),/障害者/);
    assert.match(await p.evaluate(()=>{try{ExcelGate.assertEditable();return 'allowed'}catch(e){return e.message}}),/閲覧/);
    assert.equal(await p.evaluate(()=>typeof window.loadCsvFiles),'undefined');
    await p.close();
  });
});

test('browser storage is not used and dropping files cannot replace workbook source',async()=>{
  await check('persistence',async()=>{
    const p=await h.open({source:source(wire('保存なし.csv',completeCsv))});const before=await values(p);
    assert.equal(await p.evaluate(()=>{const dt=new DataTransfer();dt.items.add(new File(['anything'],'replacement.csv'));const e=new DragEvent('drop',{dataTransfer:dt,cancelable:true,bubbles:true});document.body.dispatchEvent(e);return e.defaultPrevented}),true);
    assert.deepEqual(await values(p),before);assert.deepEqual(await p.evaluate(()=>({reads:__gateStorageReads,writes:__gateStorageWrites,tools:__gateTestTools.length})),{reads:0,writes:0,tools:0});
    await p.close();
  });
});

test('async source loading never flashes demo data and rejects export while pending',async()=>{
  await check('asyncSafety',async()=>{
    const p=await h.open({source:source(wire('遅延.csv',completeCsv)),ready:false,beforeLoad:async page=>page.addInitScript(()=>{
      const read=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){window.__sourceWaiting=true;await new Promise(resolve=>window.__releaseSource=resolve);return read.call(this)};
    })});
    await p.waitForFunction(()=>window.__sourceWaiting);assert.ok((await values(p)).every(v=>v==='データなし'));
    assert.doesNotMatch(await p.locator('body').textContent(),/デモ/);await noSaving(p);
    await p.evaluate(()=>__releaseSource());await p.waitForFunction(()=>document.querySelector('#source-state').textContent==='CSVデータ・閲覧専用');
    assert.equal((await values(p))[6],'5人');assert.deepEqual(p.gateErrors,[]);await p.close();
  });
});

test('zero observations remain zero; failed saves and external calls cannot mutate the snapshot',async()=>{
  await check('finishedMutations',async()=>{
    const rows=Array.from({length:6},(_,i)=>`community,20260${i+1},community_emergency,,,0,`);
    const p=await h.open({source:source(generic(...rows))});assert.equal((await values(p))[6],'0人');assert.equal((await values(p))[7],'0人');
    assert.match(await p.locator('#detail-hero .status-pill').textContent(),/データなし/);
    const initial=await values(p);await noSaving(p);await noSaving(p);assert.deepEqual(await values(p),initial);
    await p.locator('#tab-acute').click();assert.ok((await values(p)).every(v=>v==='データなし'));
    await p.locator('#tab-community').click();assert.deepEqual(await values(p),initial);assert.deepEqual(p.gateErrors,[]);await p.close();
    const zeroDen=await h.open({source:source(generic('community,202606,community_nursing,0,0,,2026-06-30'))});assert.equal((await values(zeroDen))[2],'データなし');await zeroDen.close();
  });
});
