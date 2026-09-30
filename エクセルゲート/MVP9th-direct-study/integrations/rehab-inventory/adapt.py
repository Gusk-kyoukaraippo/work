from pathlib import Path
import json
root=Path(__file__).resolve().parents[2]
p=root/'apps/rehab-inventory/index.html'
s=p.read_text()
def replace(a,b,count=1):
 global s
 assert s.count(a)==count,(a[:100],s.count(a),count)
 s=s.replace(a,b)
replace("const STORE = 'rehab_inventory_v2';", """const STORE = 'rehab_inventory_v2';
const gateLinked = Boolean(window.ExcelGate?.isLinked);
let gateReadOnly = gateLinked, importing = false;
const mutationActions = new Set(['setup','extension','new-item','edit-item','new-staff','edit-staff','bulk-staff','edit-loan','delete-item','confirm-delete','approve','reject','import','password']);
function assertMutation(){if(gateLinked)ExcelGate.assertEditable();}
function applyGateControls(){
 if(!gateLinked)return;
 for(const el of document.querySelectorAll('[data-action]')){
  if(mutationActions.has(el.dataset.action))el.disabled=gateReadOnly;
  if(el.dataset.action==='export')el.hidden=true;
 }
 for(const form of document.querySelectorAll('form[data-form]')){
  if(!['login','admin-login','admin-auth'].includes(form.dataset.form)){
   for(const input of form.querySelectorAll('input,textarea,select,button[type="submit"]'))if(gateReadOnly)input.disabled=true;
  }
 }
 const file=document.querySelector('#backup-file');if(file)file.disabled=gateReadOnly;
}
""")
replace("function load(){\n try{", "function load(){\n if(gateLinked)return;\n try{")
replace("async function commit(change,{adminOnly=false,setup=false}={}){\n const work=()=>{\n  const raw=localStorage.getItem(STORE),next=raw?validate(JSON.parse(raw)):structuredClone(data);", """async function commit(change,{adminOnly=false,setup=false}={}){
 assertMutation();
 const work=()=>{
  assertMutation();
  const raw=gateLinked?null:localStorage.getItem(STORE),next=raw?validate(JSON.parse(raw)):structuredClone(data);""")
replace("try{localStorage.setItem(STORE,JSON.stringify(next));}catch(err)", "try{if(!gateLinked)localStorage.setItem(STORE,JSON.stringify(next));}catch(err)")
replace("if(navigator.locks?.request) await navigator.locks.request('rehab-inventory-write',work);else work();", "if(!gateLinked && navigator.locks?.request) await navigator.locks.request('rehab-inventory-write',work);else work();")
replace("if(!dlg.open)dlg.showModal();const first=dlg.querySelector('[autofocus]');if(first)first.focus();", "applyGateControls();if(!dlg.open)dlg.showModal();const first=dlg.querySelector('[autofocus]:not(:disabled)');if(first)first.focus();")
replace("const app=$('#app');if(!session){app.innerHTML=authPage();return;}", "const app=$('#app');if(!session){app.innerHTML=authPage();applyGateControls();return;}")
replace("</main></div></div>`;\n}", "</main></div></div>`;\n applyGateControls();\n}")
replace("<div class=\"local-status\">このブラウザに保存</div>", "<div class=\"local-status\">${gateLinked?(gateReadOnly?'ブックの保存内容を閲覧中':'確定保存はブックで行います'):'このブラウザに保存'}</div>")
replace("データはこのブラウザに保存されます。端末間では自動共有されません。定期的にバックアップを保存してください。", "${gateLinked?'画面下の「入力を終える」で保存用ファイルを出力し、ブックに戻って「保存して終了」を押してください。ブラウザ内には保存しません。':'データはこのブラウザに保存されます。端末間では自動共有されません。定期的にバックアップを保存してください。'}")
replace("const values=Object.fromEntries(new FormData(form));const action=form.dataset.form,context={...modalContext};", "const values=Object.fromEntries(new FormData(form));const action=form.dataset.form,context={...modalContext};\n if(!['login','admin-login','admin-auth'].includes(action))assertMutation();")
replace("const raw=localStorage.getItem(STORE);if(raw)data=validate(JSON.parse(raw));", "const raw=gateLinked?null:localStorage.getItem(STORE);if(raw)data=validate(JSON.parse(raw));",2)
replace("if(!data.adminAuth){const salt=hex(crypto.getRandomValues(new Uint8Array(16)));const next=structuredClone(data);next.adminAuth={algorithm:'PBKDF2',iterations:150000,salt,hash:await passwordHash('admin',salt)};localStorage.setItem(STORE,JSON.stringify(next));data=next;}", """if(!data.adminAuth && !(gateLinked && gateReadOnly)){
   assertMutation();
   const salt=hex(crypto.getRandomValues(new Uint8Array(16)));
   const auth={algorithm:'PBKDF2',iterations:150000,salt,hash:await passwordHash('admin',salt)};
   assertMutation();
   const next=structuredClone(data);next.adminAuth=auth;
   if(!gateLinked)localStorage.setItem(STORE,JSON.stringify(next));data=next;
  }""")
replace("downloadBackup({...data,exportedAt:new Date().toISOString()},`rehab_before_restore_${today()}.json`);", "if(!gateLinked)downloadBackup({...data,exportedAt:new Date().toISOString()},`rehab_before_restore_${today()}.json`);")
replace("event.preventDefault();if(busy)return;", "event.preventDefault();if(busy||importing)return;")
replace("buttons.forEach(b=>{b.disabled=form.dataset.form==='return'&&!form.querySelector('[name=\"cleaned\"]').checked;});", "buttons.forEach(b=>{b.disabled=form.dataset.form==='return'&&!form.querySelector('[name=\"cleaned\"]').checked;});applyGateControls();")
replace("if(busy)return;\n try{", "if(busy||importing)return;\n try{\n  if(mutationActions.has(action))assertMutation();")
replace("if(action==='export'){downloadBackup", "if(action==='export'){if(gateLinked)throw Error('画面下のExcelゲートから保存用ファイルを出力してください。');downloadBackup")
replace("if(input.name==='cleaned'&&input.form?.dataset.form==='return')input.form.querySelector('[type=\"submit\"]').disabled=!input.checked;", "if(input.name==='cleaned'&&input.form?.dataset.form==='return')input.form.querySelector('[type=\"submit\"]').disabled=gateReadOnly||!input.checked;")
replace("const file=event.target.files?.[0];if(!file)return;\n try{\n  requireAdmin();", """const file=event.target.files?.[0];if(!file)return;
 if(busy||importing||$('#modal').open){notify('入力・読み込みを完了してから復元してください。');return;}
 try{
  assertMutation();requireAdmin();importing=true;""")
replace("const raw=JSON.parse(await file.text());requireAdmin();const imported=validate(raw);", "const raw=JSON.parse(await file.text());assertMutation();requireAdmin();const imported=validate(raw);")
replace("現在のデータを、このバックアップの内容に置き換えます。復元前のデータも自動でダウンロードします。", "${gateLinked?'画面のデータを、このバックアップの内容に置き換えます。ブックへの確定保存は「入力を終える」の後に行います。':'現在のデータを、このバックアップの内容に置き換えます。復元前のデータも自動でダウンロードします。'}")
replace("}catch(error){notify(error instanceof SyntaxError?'JSON形式のバックアップを選んでください。':error.message);}\n});", "}catch(error){notify(error instanceof SyntaxError?'JSON形式のバックアップを選んでください。':error.message);}\n finally{importing=false;event.target.value='';}\n});")
replace("window.addEventListener('storage',event=>{\n", "window.addEventListener('storage',event=>{\n if(gateLinked)return;\n")
# Keep the business notifications distinct from formal workbook save.
for old,new in [('初期設定を保存しました。登録した職員IDでログインしてください。','初期設定を反映しました。登録した職員IDでログインしてください。'),('物品を保存しました。','物品を反映しました。'),('職員情報を保存しました。','職員情報を反映しました。')]:
 replace("notify('"+old+"')", "notify(gateLinked?'"+new+"':'"+old+"')")
replace("load();render();\n})();", """if(gateLinked){
 ExcelGate.connect({
  load(payload,info){
   // A saved invalid payload is an error; only absence starts an empty database.
   data=info.hasPayload?validate(payload):emptyData();
   gateReadOnly=info.readOnly;hasLegacy=false;fatal='';session=null;admin=false;adminProof=null;
   closeModal(false);render();
  },
  exportData(){
   if(busy||importing)throw Error('処理・読み込みを完了してから出力してください。');
   if($('#modal').open||pendingImport)throw Error('開いている入力画面を確定またはキャンセルしてから出力してください。');
   if(fatal)throw Error(fatal);
   return structuredClone(data);
  },
  setReadOnly(value){gateReadOnly=Boolean(value);applyGateControls();}
 }).catch(error=>{fatal=error.message;session=null;admin=false;render();});
}else{load();render();}
})();""")
replace("<!-- EXCEL_GATE_ADAPTER_TODO: AI implements inline connection in the business data scope. -->\n", "")
p.write_text(s)
for q in [root/'apps/rehab-inventory/gate.config.json',root/'integrations/rehab-inventory/recipe.json']:
 value=json.loads(q.read_text());value['dataVersion']=2;q.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
print('Adapted',p,'business dataVersion=2; original preserved.')
