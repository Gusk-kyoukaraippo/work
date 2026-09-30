import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifiedWorkbook,VERSION} from './package.mjs';
import {requireBrowserReceipt} from './integrate.mjs';
import {zipFolder} from './zip.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const apps=['rehab-inventory','community-care','handoff-notes'];
const destination=path.resolve(process.argv[2]??path.join(root,'../MVP9th.zip'));
try{
 const master=await verifiedWorkbook();if(!master)throw Error('Verified native master is required');
 for(const app of apps){
  const {identity}=await requireBrowserReceipt(app);
  const folder=path.join(root,'deliverables',app),m=JSON.parse(await fs.readFile(path.join(folder,'release-manifest.json')));
  if(m.identity.engine.digest!==identity.engine.digest||m.identity.app.digest!==identity.app.digest)throw Error('Stale distribution: '+app);
  if(m.workbookGeneration?.masterSha256!==master.receipt.sha256)throw Error('Master mismatch: '+app);
  for(const [file,expected] of Object.entries(m.hashes))if(sha(await fs.readFile(path.join(folder,file)))!==expected)throw Error('Changed distribution: '+file);
  await fs.access(folder+'.zip');
 }
 const stage=await fs.mkdtemp(path.join(os.tmpdir(),'gate-kit-')),folder=path.join(stage,'MVP9th'),files={};
 try{
  async function copy(relative=''){
   await fs.mkdir(path.join(folder,relative),{recursive:true});
   for(const item of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
    if(['node_modules','__pycache__','test-results','.DS_Store','.git','kit-manifest.json','native'].includes(item.name)||item.name.startsWith('~$'))continue;
    const name=relative?relative+'/'+item.name:item.name;
    if(item.isDirectory())await copy(name);
    else if(item.isFile()){const bytes=await fs.readFile(path.join(root,name));await fs.writeFile(path.join(folder,name),bytes);files[name]=sha(bytes)}
    else throw Error('Unsupported kit entry: '+name);
   }
  }
  await copy();
  const manifest={schemaVersion:1,kitVersion:VERSION,createdAt:new Date().toISOString(),apps,masterSha256:master.receipt.sha256,files};
  const bytes=JSON.stringify(manifest,null,2)+'\n';await fs.writeFile(path.join(folder,'kit-manifest.json'),bytes);
  await zipFolder(folder,destination);
  await fs.writeFile(path.join(root,'kit-manifest.json'),bytes);
  console.log(JSON.stringify({zip:destination,files:Object.keys(files).length,apps}));
 }finally{await fs.rm(stage,{recursive:true,force:true})}
}catch(error){console.error(error.message);process.exitCode=1}
