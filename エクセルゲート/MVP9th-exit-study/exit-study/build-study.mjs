import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildApp,sha256,verifiedWorkbook} from '../scripts/package.mjs';
import {verifyBusinessCopy,textChanges} from './business-copy.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(process.argv[2]||path.join(root,'../outputs/終了UI比較-r4'));
const app='rehab-inventory';
const profiles=[['A_通常UI','manual'],['B_OnTime','onTime'],['C_VBA待機','waitLoop']];
const native=await verifiedWorkbook();
if(!native)throw new Error('Verified native master is required');
const source=await fs.readFile(path.join(root,'apps',app,'index.html'));
const baseline=await fs.readFile(path.join(root,'../MVP9th/apps',app,'index.html'));
const preservation=verifyBusinessCopy(source,baseline);
await fs.mkdir(path.dirname(out),{recursive:true});
await fs.mkdir(out,{recursive:false});
const manifest={schemaVersion:1,study:'excel-gate-exit-ui-r4',revision:'r4',createdAt:new Date().toISOString(),
  status:'candidate',targetPlatformValidation:'pending',
  ui:{layout:'compact-bottom-bar-expand-upward',editingHeight:72,primaryButtonHeight:52,primaryButtonPosition:'fixed-right-bottom',nameEntry:'on-save',guidanceLocation:'same-bottom-dock',businessViewportReserved:true,
    workbook:{primaryAnchor:'B10:J12',guidanceAnchor:'B6:J9',secondaryActions:'B15:J16',settingsAnchor:'H22:J23',reconfigurationPreservesData:true}},
  businessHtmlPreservation:preservation,businessHtmlSha256:sha256(source),baselineHtmlSha256:sha256(baseline),guidanceChanges:textChanges,
  nativeMasterSha256:native.receipt.sha256,profiles:[]};
for(const [folder,exitMode] of profiles){
  const parent=path.join(out,folder);
  const stage=await buildApp(app,parent,{mode:'candidate',exitMode});
  for(const name of await fs.readdir(stage))await fs.rename(path.join(stage,name),path.join(parent,name));
  await fs.rmdir(stage);
  const release=JSON.parse(await fs.readFile(path.join(parent,'release-manifest.json'),'utf8'));
  const instructions=exitMode==='manual'
    ? '1. Edgeで「アプリを終了して保存作業に移る」を押します。\n2. Edgeは開いたまま、開いているブックの「保存して閉じる」を押します。\n3. 「保存しました」が出たらEdgeの作業タブを閉じ、ブック側のOKを押します。ブックも閉じます。'
    : '1. Edgeで「アプリを終了して保存作業に移る」を押します。\n2. 「終了の準備中」が出たら、そのまま待ちます。\n3. 「保存の準備ができました」に変わったら「この作業タブを閉じる」を押します。\n4. 開いているブックの「保存して閉じる」を押します。\n5. 「保存しました」が出たらOKを押します。ブックも閉じます。';
  const guide=`# ${folder}の試し方\n\n同梱の「${release.workbookFileName}」をJUST Calcで開きます。初回は「導入手順.md」に沿って、検証用の新しい場所で初回設定を行います。ブックと付属フォルダは一緒に置きます。\n\n「編集する」で一件入力し、入力欄や小窓を確定します。編集中は画面下部の薄い一段バーに「途中保存」と終了ボタンを表示します。終了ボタンを押すと、同じ下部に案内欄が上へ広がります。名前入力が出たら、お名前を入力し「この名前で保存作業に進む」を押します。その後の案内も同じ欄で切り替わり、進む・再試行・閉じるの主ボタンは同じ位置と大きさを保ちます。この編集作業で入力した名前は、途中保存と終了で引き続き使います。\n\n${instructions}\n\n閉じた後に同じブックから開き直し、入力が残ることを確認します。途中保存は「使い方.md」の手順を使います。進まない場合はEdgeとブックを開いたまま、表示された案内に沿って再試行します。ファイルを選ぶ必要はありません。\n\nこの方式は設定済みです。設定ファイルの編集やVBAの貼り付けは不要です。Windows / JUST Calc / Edgeでの成否・待ち時間は未実測です。親フォルダの「実機比較・記録.md」に結果を記入してください。\n`;
  await fs.writeFile(path.join(parent,'試作の使い方.md'),guide);
  await fs.writeFile(path.join(parent,'最初に読む_検証用です.txt'),`${folder}：終了UIの比較用です。\n「試作の使い方.md」を読んで、検証用データで試してください。\n運用中のブックやdataへ上書きしません。\n`);
  for(const name of ['試作の使い方.md','最初に読む_検証用です.txt'])release.hashes[name]=sha256(await fs.readFile(path.join(parent,name)));
  release.exitStudy={profile:folder,exitMode,windowsJustCalcExecution:false,sharedLockReleaseVerified:false};
  await fs.writeFile(path.join(parent,'release-manifest.json'),JSON.stringify(release,null,2)+'\n');
  manifest.profiles.push({folder,exitMode,workbook:release.workbookFileName,appId:release.appId,
    identity:release.identity,workbookSha256:release.hashes[release.workbookFileName],
    vbaProjectSha256:release.workbookGeneration.vbaProjectSha256,
    runtimeHtmlSha256:release.hashes['runtime/index.html']});
}
if(new Set(manifest.profiles.map(p=>p.runtimeHtmlSha256)).size!==1)throw new Error('Business runtime differs across variants');
if(new Set(manifest.profiles.map(p=>p.vbaProjectSha256)).size!==1)throw new Error('Native VBA differs across variants');
for(const name of ['はじめに.md','実機比較・記録.md','実装の理屈.md','画面を比較.html','Excel側の画面.html'])await fs.copyFile(path.join(root,'exit-study',name),path.join(out,name));
await fs.writeFile(path.join(out,'study-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await fs.copyFile(path.join(root,'workbook/MVP9th.build.json'),path.join(out,'native-source-verification.json'));
console.log(out);
