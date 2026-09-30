import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {accentColor} from './presentation.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const json=async file=>JSON.parse(await fs.readFile(file,'utf8'));
function appName(name){if(!/^[a-z0-9][a-z0-9-]{0,99}$/.test(name))throw new Error('Invalid app folder');return name}
const workspace=name=>path.join(ROOT,'integrations',appName(name));
const appFolder=name=>path.join(ROOT,'apps',appName(name));
function validRelative(file){if(typeof file!=='string'||!file||file.startsWith('/')||/[\\:\x00-\x1f]/.test(file)||file.split('/').some(v=>!v||v==='.'||v==='..'))throw new Error('Invalid entry path');}

export async function requireNameReview(name) {
  const recipe=await json(path.join(workspace(name),'recipe.json')),config=await json(path.join(appFolder(name),'gate.config.json')),review=recipe.nameReview;
  const entry=config.entry??'index.html';validRelative(entry);
  if(!review||review.revision!==recipe.revision||review.displayName!==config.displayName||review.accentColor!==accentColor(config.accentColor)||review.entrySha256!==sha(await fs.readFile(path.join(appFolder(name),entry))))throw new Error('アプリ名が未確認、またはHTML更新後の再確認が必要です。identify --title で最終HTMLの名前を確定してください。');
}
export async function testToolsDigest() {
  const files=['scripts/browser-harness.mjs','scripts/integration-smoke.test.mjs','scripts/integrate.mjs','scripts/integration-receipt.mjs','scripts/package.mjs'];
  return sha(Buffer.concat(await Promise.all(files.map(file=>fs.readFile(path.join(ROOT,file))))));
}
export async function verifyBrowserReceipt(name,identity) {
  await requireNameReview(name);
  const dir=workspace(name),recipe=await json(path.join(dir,'recipe.json')),r=await json(path.join(dir,'browser-receipt.json'));
  const {REQUIRED_CHECKS}=await import('./browser-harness.mjs');
  if(r.status!=='passed'||r.requirementsVersion!==1||r.recipeRevision!==recipe.revision||r.engineDigest!==identity.engine.digest||r.appDigest!==identity.app.digest||r.testHash!==sha(await fs.readFile(path.join(dir,'acceptance.test.mjs')))||r.toolsDigest!==await testToolsDigest()||REQUIRED_CHECKS.some(key=>!r.checks?.some(c=>c.key===key&&c.passed===true)))throw new Error('ブラウザ試験が未完了、または変更後の再検証が必要です。');
  return {recipe,receipt:r,identity};
}
