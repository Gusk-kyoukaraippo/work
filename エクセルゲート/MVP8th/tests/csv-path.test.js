const test = require('node:test');
const assert = require('node:assert/strict');
const cases = require('./fixtures/csv-path-cases.json');

test('CSV evidence normalizes the supported native local/UNC input cases', async () => {
  const { normalizeCsvSourcePath } = await import('../scripts/evidence.mjs');
  for (const [input, expected] of cases.valid) assert.equal(normalizeCsvSourcePath(input), expected.normalize('NFC').toLowerCase(), input);
  for (const input of [...cases.invalid, null, undefined, 123]) assert.throws(() => normalizeCsvSourcePath(input), /CSV source path/, String(input));
});

test('local CSV evidence is accepted only for the tested absolute source path', async () => {
  const api = await import('../scripts/evidence.mjs');
  const source = 'C:/業務データ/CSV';
  const identity = {dataSource:'csvFolder',appId:'local-fixture',engine:{assembled:true,digest:'engine',workbookSha256:'book',files:{}},app:{digest:'app',files:{}}};
  const target = {os:'Windows',windowsVersion:'fixture Windows',justCalcVersion:'fixture Calc',edgeVersion:'fixture Edge'};
  const deploymentLocation = {platform:'win32',path:'\\\\server\\share\\app'};
  const receipts = ['engine','app','site'].map(kind => api.createReceipt({kind,identity,deploymentLocation,report:{
    dataSource:'csvFolder',testedAt:'2026-09-21T12:00:00Z',tester:'fixture',method:'user-reported',environment:'target-platform',
    notes:'Synthetic test fixture, not actual Windows acceptance.',target,pcIds:['fixture-a','fixture-b'],homogeneousTargets:true,
    siteId:'fixture',shareLocation:deploymentLocation.path,csvSourcePath:source,checks:Object.fromEntries(api.CSV_CHECKS[kind].map(key=>[key,true]))
  }}));
  const args = {identity,receipts,target,siteId:'fixture',deploymentLocation};
  assert.equal(api.assessAcceptance({...args,csvSourcePath:'"c:\\業務データ\\CSV\\"'}).siteReady,true);
  for (const csvSourcePath of ['D:/業務データ/CSV','C:業務データ/CSV','C:/other',undefined]) assert.equal(api.assessAcceptance({...args,csvSourcePath}).siteReady,false);
});
