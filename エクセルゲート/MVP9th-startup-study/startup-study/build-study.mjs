import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {buildApp,sha256} from '../scripts/package.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(process.argv[2]||path.join(root,'deliverables/起動時間比較一式'));
await fs.mkdir(path.dirname(out),{recursive:true});
await fs.mkdir(out,{recursive:false});
const app='rehab-inventory',source=await fs.readFile(path.join(root,'integrations',app,'revisions/2026-09-22T13-46-36-128Z-caaeb2/original/index.html'),'utf8');
const variants=[['A_旧方式診断','baseline'],['B_最小改修比較','minimal'],['C_HTML直開き','direct']];
const manifest={study:'excel-gate-startup-study-1',status:'Windows / JUST Calc performance and acceptance pending',originalHtmlSha256:sha256(Buffer.from(source)),nativeMasterSha256:sha256(await fs.readFile(path.join(root,'workbook/MVP8th.xlsm'))),profiles:[]};
for(const [folder,profile]of variants){
 const parent=path.join(out,folder);const stage=await buildApp(app,parent,{mode:'candidate'});
 // Flatten the application within each clearly labelled variant folder.
 for(const name of await fs.readdir(stage))await fs.rename(path.join(stage,name),path.join(parent,name));await fs.rmdir(stage);
 const release=JSON.parse(await fs.readFile(path.join(parent,'release-manifest.json'),'utf8')),book=path.join(parent,release.workbookFileName);
 const change=JSON.parse(execFileSync('python3',[path.join(root,'startup-study/set-profile.py'),book,profile],{encoding:'utf8'}));
 const generation=JSON.parse(await fs.readFile(path.join(parent,'workbook-generation.json'),'utf8'));generation.startupStudy=change;generation.workbookSha256=change.afterSha256;
 await fs.writeFile(path.join(parent,'workbook-generation.json'),JSON.stringify(generation,null,2)+'\n');
 release.workbookGeneration=generation;release.hashes[release.workbookFileName]=change.afterSha256;release.hashes['workbook-generation.json']=sha256(await fs.readFile(path.join(parent,'workbook-generation.json')));release.startupStudy={profile,performanceVerified:false};
 if(profile==='direct'){
  const direct=path.join(parent,'direct');await fs.mkdir(direct);
  let html=source.replace('<head>','<head>\n<script src="excel-gate-timing.js"></script>\n<script src="excel-gate-benchmark.js"></script>');
  const hook='load();render();';if(html.split(hook).length!==2)throw Error('Original ready hook changed');html=html.replace(hook,hook+'\nwindow.ExcelGateBenchmark.ready();');
  await fs.writeFile(path.join(direct,'index.html'),html);
  for(const n of ['excel-gate-timing.js','excel-gate-benchmark.js'])await fs.copyFile(path.join(root,'apps',app,n),path.join(direct,n));
  for(const n of await fs.readdir(direct))release.hashes['direct/'+n]=sha256(await fs.readFile(path.join(direct,n)));
 }
 await fs.writeFile(path.join(parent,'最初に読む_検証用です.txt'),`${folder}：起動時間の比較専用です。正式版ではありません。\n親フォルダの「はじめに.md」を読んでから、検証用データで測定してください。\n運用中のブック・dataには上書きしません。\n`);
 await fs.writeFile(path.join(parent,'release-manifest.json'),JSON.stringify(release,null,2)+'\n');
 manifest.profiles.push({folder,profile,appId:release.appId,dataVersion:2,workbook:release.workbookFileName,workbookSha256:change.afterSha256,vbaProjectSha256:change.vbaProjectSha256,runtimeHtmlSha256:sha256(await fs.readFile(path.join(parent,'runtime/index.html')))});
}
for(const [src,dst]of [['結果を比較.html','結果を比較.html'],['summary.js','summary.js'],['はじめに.md','はじめに.md'],['判定記録.md','判定記録.md']])await fs.copyFile(path.join(root,'startup-study',src),path.join(out,dst));
await fs.writeFile(path.join(out,'study-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(out);
