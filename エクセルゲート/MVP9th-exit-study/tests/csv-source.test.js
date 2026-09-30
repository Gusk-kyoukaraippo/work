const test = require('node:test');
const assert = require('node:assert/strict');
const gate = require('../shared/excel-gate.js');
const context = (extra = {}) => ({runtimeVersion:'0.9.0',dataSource:'csvFolder',mode:'view',readOnly:true,databaseId:'csv-db',dataType:'csv-app',schemaVersion:1,baseRevision:0,hasPayload:false,...extra});
const file = (name, bytes = Buffer.from('指標,値\r\n患者数,12\r\n')) => ({name,size:bytes.length,lastModified:'2026-09-21T09:30:00',base64:bytes.toString('base64')});
const source = (files = []) => ({sourcePath:'\\\\server\\共有\\CSV',readAt:'2026-09-21T09:31:00',files});
const controller = (src = source(), extra = {}) => gate.createController(context(extra), {source:src,download(){assert.fail('CSV view must never download');}});

test('CSV mode is explicitly view-only, without a workbook payload, while existing contexts default to workbook', () => {
  const old = context(); delete old.dataSource;
  assert.equal(gate.validateContext(old).dataSource,'workbook');
  for (const extra of [{dataSource:'unknown'},{mode:'edit',readOnly:false,sessionId:'edit'},{hasPayload:true,payload:[]},{payload:null},{payload:{}},{payload:[]},{payload:{stale:'data'}}]) {
    assert.throws(()=>controller(source(),extra),/起動情報/);
  }
});

test('UTF-8 BOM, Shift_JIS, every byte, Japanese names and empty files arrive unchanged as native Files', async () => {
  const utf8 = Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('指標,値\r\n患者数,12\r\n')]);
  // CP932/Shift_JIS bytes for 患者,12 (no text decoder is used by the common gate).
  const sjis = Buffer.from([0x8a,0xb3,0x8e,0xd2,0x2c,0x31,0x32,0x0d,0x0a]);
  assert.match(new TextDecoder('shift_jis').decode(sjis),/患者,12/);
  const bytes = [utf8,sjis,Buffer.from(Array.from({length:256},(_,i)=>i)),Buffer.alloc(0)];
  const records = bytes.map((b,i)=>file(['日本語.csv','患者_ＳＪＩＳ.CSV','全バイト.csv','空.csv'][i],b));
  const c = controller(source(records));
  let calls = 0;
  await c.connect({setReadOnly(value){assert.equal(value,true);},async loadSourceFiles(files,info){
    calls++;
    assert.equal(info.readOnly,true); assert.equal(info.sourcePath,'\\\\server\\共有\\CSV');
    assert.equal(info.readAt,'2026-09-21T09:31:00');
    for (let i=0;i<files.length;i++) {
      assert.ok(files[i] instanceof File); assert.equal(files[i].name,records[i].name);
      assert.equal(files[i].size,records[i].size); assert.equal(files[i].lastModified,Date.parse(records[i].lastModified));
      assert.deepEqual(Buffer.from(await files[i].arrayBuffer()),bytes[i]);
      assert.deepEqual(info.files[i],{name:records[i].name,size:records[i].size,lastModified:records[i].lastModified});
    }
  }});
  assert.equal(calls,1); assert.equal(c.state().phase,'view');
  await assert.rejects(c.connect({}),/一度だけ/);
  await assert.rejects(c.exportFile('利用者'),/CSVフォルダ閲覧型/);
  await assert.rejects(c.redownload(),/ありません/);
  assert.throws(()=>c.assertEditable(),/閲覧専用/);
});

test('source bytes are detached from the launch manifest and metadata cannot be changed', async () => {
  const src = source([file('確定.csv',Buffer.from('a,1'))]);
  const c = controller(src);
  src.files[0].base64 = Buffer.from('a,9').toString('base64'); src.files[0].name='変更.csv'; src.readAt='2000-01-01T00:00:00';
  await c.connect({setReadOnly(){},async loadSourceFiles(files,info){
    assert.equal(await files[0].text(),'a,1'); assert.equal(files[0].name,'確定.csv');
    assert.equal(info.readAt,'2026-09-21T09:31:00');
    assert.ok(Object.isFrozen(info)); assert.ok(Object.isFrozen(info.files)); assert.ok(Object.isFrozen(info.files[0]));
  }});
});

test('empty folder is a successful empty snapshot, not first-use workbook data', async () => {
  const changes=[];
  const c=gate.createController(context(),{source:source(),onChange:s=>changes.push(s)});
  await c.connect({setReadOnly(){},loadSourceFiles(files,info){assert.deepEqual(files,[]);assert.deepEqual(info.files,[]);}});
  assert.equal(c.state().phase,'view'); assert.match(changes.at(-1).message,/データなし/);
  assert.doesNotMatch(changes.at(-1).message,/ブックに保存/);
});

test('read-only and readiness finish before one asynchronous source load, with exports blocked throughout', async () => {
  let releaseReadOnly, releaseReady, releaseLoad;
  const order=[];
  const c=controller(source([file('a.csv')]));
  const pending=c.connect({
    setReadOnly(){order.push('lock');return new Promise(r=>releaseReadOnly=r);},
    ready:new Promise(r=>releaseReady=r),
    loadSourceFiles(){order.push('load');return new Promise(r=>releaseLoad=r);}
  });
  assert.deepEqual(order,['lock']); await assert.rejects(c.exportFile(),/CSVフォルダ閲覧型/);
  releaseReadOnly(); await new Promise(r=>setImmediate(r)); assert.deepEqual(order,['lock']);
  releaseReady(); await new Promise(r=>setImmediate(r)); assert.deepEqual(order,['lock','load']);
  assert.equal(c.state().phase,'loading'); assert.throws(()=>c.assertEditable(),/読み込み中/);
  await assert.rejects(c.exportFile(),/CSVフォルダ閲覧型/);
  releaseLoad(); await pending; assert.equal(c.state().phase,'view');
});

test('missing source, malformed base64, inconsistent sizes, unsafe/duplicate names and limits fail before app initialization', () => {
  const invalid = [undefined,null,{},source([file('../a.csv')]),source([file('a.csv'),file('A.CSV')]),
    source([{...file('a.csv'),size:-1}]),source([{...file('a.csv'),lastModified:'yesterday'}]),
    source([{...file('a.csv'),base64:'////'}]),source([{...file('a.csv',Buffer.from('a')),base64:'YR=='}]),
    source([{...file('a.csv',Buffer.from('a')),base64:'Y Q='}]),source([{...file('a.csv',Buffer.from('a')),base64:'YQ=A'}]),
    source([file('a.json')]),source([file('bad\\a.csv')]),source([file('bad\u0000.csv')]),
    {...source(),readAt:'not-a-date'},{...source(),sourcePath:''},
    source(Array.from({length:1001},(_,i)=>file(i+'.csv',Buffer.alloc(0)))),
    source([{name:'huge.csv',size:50*1024*1024+1,lastModified:'2026-09-21T12:00:00',base64:''}])
  ];
  for(const src of invalid) assert.throws(()=>gate.createController(context(),{source:src}),/CSVの受け渡しデータ/);
  // The last file's error rejects the entire batch; no partial file list escapes.
  assert.throws(()=>controller(source([file('valid.csv'),{...file('invalid.csv'),base64:'!'.repeat(4)}])),/CSVの受け渡しデータ/);
});

test('CSV transport is separate from the 10MiB workbook JSON payload limit', async () => {
  const bytes = Buffer.alloc(8*1024*1024,0x82);
  const src = source([file('大きいCSV.csv',bytes)]);
  assert.ok(JSON.stringify(src).length > 10485760);
  const c=controller(src);
  await c.connect({setReadOnly(){},async loadSourceFiles(files){assert.deepEqual(Buffer.from(await files[0].arrayBuffer()),bytes);}});
  assert.equal(c.state().phase,'view');
});

test('missing callbacks, read-only failures and canceled/failed parsing remain blocked', async () => {
  for(const adapter of [
    {loadSourceFiles(){}}, {setReadOnly(){},load(){},exportData(){}},
    {setReadOnly(){return false;},loadSourceFiles(){assert.fail('must not load');}},
    {setReadOnly(){},loadSourceFiles(){return gate.CANCEL;}},
    {setReadOnly(){},async loadSourceFiles(){throw Error('CSV形式を確認してください');}}
  ]) {
    const c=controller(); await assert.rejects(c.connect(adapter));
    assert.equal(c.state().phase,'error'); await assert.rejects(c.exportFile(),/CSVフォルダ閲覧型/);
    assert.throws(()=>c.assertEditable(),/起動に失敗/);
  }
});
