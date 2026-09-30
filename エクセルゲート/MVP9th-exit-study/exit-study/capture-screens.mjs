import fs from 'node:fs/promises';
import path from 'node:path';
import {pbkdf2Sync,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createHarness} from '../scripts/browser-harness.mjs';

const out=path.resolve(process.argv[2]);
const images=path.join(out,'画面');
await fs.mkdir(images,{recursive:false});
const salt='1234567890abcdef1234567890abcdef';
const seed={version:2,revision:0,items:[
  {id:'item-pt',name:'歩行器',number:'PT-001',category:'PT',location:'リハ室',isActive:true},
  {id:'item-ot',name:'訓練用具',number:'OT-001',category:'OT',location:'棚A',isActive:true}],
  loans:[],extensionRequests:[],staff:[{id:'0123',name:'比較用 職員',active:true}],lenders:[],checkers:[],
  adminAuth:{algorithm:'PBKDF2',iterations:150000,salt,hash:pbkdf2Sync('admin',Buffer.from(salt,'hex'),150000,32,'sha256').toString('hex')}};
const records=[];
for(const [profile,prefix] of [['A_通常UI','A'],['B_OnTime','B'],['C_VBA待機','C']]){
  process.env.EXCEL_GATE_STAGE=path.join(out,profile);
  const h=await createHarness();
  try{
    const p=await h.open({payload:seed,beforeLoad:page=>page.clock.install()});
    await p.setViewportSize({width:1200,height:800});
    await p.locator('[name="staffId"]').fill('0123');
    await p.locator('form[data-form="login"] [type="submit"]').click();
    await p.locator('.shell').waitFor();
    await p.evaluate(()=>Promise.all([...document.querySelectorAll('img')].map(i=>i.decode())));
    const shot=async state=>{
      const file=prefix+'-'+state+'.png';
      const geometry=await p.evaluate(()=>{
        const shadow=document.querySelector('excel-gate-panel').shadowRoot,dialog=shadow.querySelector('dialog');
        const dock=dialog.open?dialog:shadow.querySelector('footer');
        const bounds=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
        return {dock:bounds(dock),primarySlot:bounds(dock.querySelector('.next-actions')),businessViewport:bounds(document.querySelector('excel-gate-workspace'))};
      });
      await p.gateParent.screenshot({path:path.join(images,file)});
      records.push({profile,state,file:'画面/'+file,geometry,receiptWriter:'simulated for UI preview',vbaRuntimeExecuted:false});
    };
    await shot('editing');
    await p.locator('excel-gate-panel #finish').click();
    await p.locator('excel-gate-panel #name').fill('比較用 職員');
    await shot('name');
    const output=await h.output(p,'complete');
    await shot('after');
    if(prefix!=='A'){
      await p.gateParent.clock.runFor(31000);
      if(await p.locator('excel-gate-panel #modal-title').textContent()!=='準備を続けています')throw new Error('Slow guidance did not appear');
      await shot('slow');
      const {databaseId,sessionId,dataType,schemaVersion,baseRevision,saveDataId,exportSequence}=output;
      const receipt={state:'ready',token:p.gateHandoff.token,databaseId,sessionId,dataType,schemaVersion,baseRevision,saveDataId,exportSequence};
      await fs.writeFile(p.gateHandoff.path,'window.__EXCEL_GATE_HANDOFF__='+JSON.stringify(receipt)+';');
      await p.gateParent.clock.runFor(2000);
      await p.locator('excel-gate-panel #close').waitFor({state:'visible'});
      await shot('ready');
    }
    if(p.gateErrors.length)throw new Error(p.gateErrors.join('\n'));
    await p.close();
  }finally{await h.close()}
}
const excelSource=path.join(path.dirname(fileURLToPath(import.meta.url)),'excel-ready-r4.png');
const excelImage=await fs.readFile(excelSource);
await fs.writeFile(path.join(images,'Excel-保存準備.png'),excelImage);
await fs.writeFile(path.join(out,'preview-record.json'),JSON.stringify({schemaVersion:1,method:'automated browser UI preview',platform:process.platform,records,
  workbookPreview:{file:'画面/Excel-保存準備.png',sha256:createHash('sha256').update(excelImage).digest('hex'),method:'Mac Excel native VBA panel, cached test config and injected state',receiverExecuted:false,settingsRuntimeValidated:false}},null,2)+'\n');
console.log(`${records.length} UI screenshots generated; receipt writer simulated.`);
