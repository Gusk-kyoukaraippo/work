import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EVIDENCE_SCHEMA = 'excel-gate-evidence/v1';
// Bump the affected requirement version when its acceptance contract changes,
// even when the application/runtime bytes themselves remain unchanged.
export const REQUIREMENTS_VERSIONS = Object.freeze({ engine: 1, app: 1, site: 1 });
export const CHECKS = Object.freeze({
  engine: ['setup', 'midSave', 'twoPcLock', 'handoff', 'wrongKind', 'missingDuplicateForeignBranch', 'networkFailure', 'restartRecovery', 'closeFailure', 'otherWorkbookUnchanged'],
  app: ['roundTrip', 'firstRun', 'emptyData', 'delayedRestore', 'pendingInput', 'asyncRead', 'externalUpdate', 'readOnly', 'finalFreeze', 'businessScreen', 'viewSearch'],
  site: ['setup', 'roundTrip', 'readOnly', 'twoPcLock', 'handoff']
});
export const CSV_REQUIREMENTS_VERSIONS = Object.freeze({ engine: 2, app: 1, site: 2 });
export const CSV_CHECKS = Object.freeze({
  engine: ['setup', 'csvFolderSetup', 'localFolderSetup', 'directChildrenOnly', 'binaryEncoding', 'changedDuringRead', 'permissionFailure', 'networkFailure', 'sourceLimits', 'readOnlyWorkbook', 'twoPcReadOnly', 'refresh', 'otherWorkbookUnchanged'],
  app: ['firstRun', 'emptyData', 'asyncRead', 'readOnly', 'businessScreen', 'viewSearch', 'csvEncoding', 'missingCsv', 'unsupportedCsv', 'noDemoFallback', 'refresh', 'noBrowserStorage', 'aggregationMatchesOriginal'],
  site: ['setup', 'csvFolderSetup', 'readOnlyWorkbook', 'twoPcReadOnly', 'refresh', 'permissionFailure', 'networkFailure']
});
function dataSourceOf(identity) {
  const value = identity.dataSource ?? 'workbook';
  if (!['workbook', 'csvFolder'].includes(value)) throw new Error('Unknown evidence dataSource');
  return value;
}
function sameDataSource(receipt, dataSource) {
  // A legacy workbook receipt can never license the new CSV source mode.
  return (receipt.dataSource ?? 'workbook') === dataSource;
}
function checksFor(dataSource) { return dataSource === 'csvFolder' ? CSV_CHECKS : CHECKS; }
const targetKeys = ['windowsVersion', 'justCalcVersion', 'edgeVersion'];
const present = value => typeof value === 'string' && Boolean(value.trim()) && !/^(?:pending|unknown|未確認|未実施|未定|n\/a)$/i.test(value.trim());
export function validateTarget(target) {
  if (target?.os !== 'Windows' || targetKeys.some(key => !present(target[key]))) throw new Error('Exact Windows / JUST Calc / Edge target versions are required');
  return { os: 'Windows', ...Object.fromEntries(targetKeys.map(key => [key, target[key].trim()])) };
}
export function targetsMatch(left, right) {
  try { left = validateTarget(left); right = validateTarget(right); } catch { return false; }
  return ['os', ...targetKeys].every(key => left[key] === right[key]);
}
export function normalizeShareLocation(value) {
  if (typeof value !== 'string') throw new Error('The tested Windows shareLocation must be a UNC path');
  let location = value.trim().replaceAll('/', '\\').replace(/^\\\\\?\\UNC\\/i, '\\\\');
  if (!/^\\\\[^\\]+\\[^\\]+(?:\\.*)?$/.test(location) || /[:"<>|?*\x00-\x1f]/.test(location)) throw new Error('The tested Windows shareLocation must be a UNC path');
  location = path.win32.normalize(location).replace(/\\$/, '');
  if (!/^\\\\[^\\]+\\[^\\]+/.test(location)) throw new Error('The tested Windows shareLocation must identify a server and share');
  return location.normalize('NFC').toLowerCase();
}
// Match the native CSV setting grammar, without resolving a drive on the recorder's PC.
// Drive paths refer to each reader's own filesystem or drive mapping.
export function normalizeCsvSourcePath(value) {
  const invalid = () => { throw new Error('CSV source path must be an absolute drive or UNC folder path'); };
  if (typeof value !== 'string') return invalid();
  let location = value.replace(/^ +| +$/g, '');
  if (location.length >= 2 && location.startsWith('"') && location.endsWith('"')) location = location.slice(1, -1).replace(/^ +| +$/g, '');
  location = location.replaceAll('/', '\\');
  const unc = location.startsWith('\\\\');
  if (!unc && !/^[a-z]:\\/i.test(location)) return invalid();
  const rootLength = unc ? 2 : 3;
  while (location.length > rootLength && location.endsWith('\\')) location = location.slice(0, -1);
  const parts = location.slice(rootLength).split('\\');
  if (unc && (location.length <= 2 || parts.length < 2)) return invalid();
  if (!unc && location.length === 3) return location.toLowerCase();
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /[:*?"<>|\x00-\x1f]/.test(part))) return invalid();
  return location.normalize('NFC').toLowerCase();
}
export function normalizeDeploymentLocation(location) {
  if (!location || !present(location.platform) || typeof location.path !== 'string') throw new Error('Canonical deployment filesystem location is required');
  if (location.platform === 'win32') {
    let directory = location.path.replaceAll('/', '\\').replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
    if (!path.win32.isAbsolute(directory)) throw new Error('Canonical deployment path must be absolute');
    directory = path.win32.normalize(directory).replace(/\\$/, '').normalize('NFC').toLowerCase();
    return { platform: 'win32', path: directory };
  }
  if (!path.posix.isAbsolute(location.path)) throw new Error('Canonical deployment path must be absolute');
  return { platform: location.platform, path: path.posix.normalize(location.path).normalize('NFC') };
}
export async function canonicalDeploymentLocation(deploymentDir) {
  return normalizeDeploymentLocation({ platform: process.platform, path: await fs.realpath(deploymentDir) });
}
function sameDeploymentLocation(left, right) {
  try {
    left = normalizeDeploymentLocation(left); right = normalizeDeploymentLocation(right);
    return left.platform === right.platform && left.path === right.path;
  } catch { return false; }
}
function homogeneousProblem(report) {
  if (report.pcIds.length > 1 && report.homogeneousTargets !== true) return 'explicit confirmation that all listed PCs use the target software versions is required';
  if (report.pcTargets && (Object.keys(report.pcTargets).length !== report.pcIds.length || report.pcIds.some(id => !targetsMatch(report.pcTargets[id], report.target)))) return 'per-PC software versions differ from the tested target';
  return null;
}
export async function readTarget(file = path.join(root, 'verification/target-platform.json')) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export const readTargetPlatform = readTarget;
export async function readReceipts(directory = path.join(root, 'verification/receipts')) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const receipts = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const receipt = JSON.parse(await fs.readFile(path.join(directory, entry.name), 'utf8'));
    if (receipt.schema === EVIDENCE_SCHEMA) receipts.push(receipt);
  }
  return receipts;
}
function receiptProblem(receipt, kind, identity, target, siteId, deploymentLocation, requirementsVersions, csvSourcePath) {
  if (!receipt || receipt.schema !== EVIDENCE_SCHEMA || receipt.kind !== kind) return 'missing';
  const dataSource = dataSourceOf(identity);
  if (!sameDataSource(receipt, dataSource)) return 'data source mode differs';
  if (receipt.requirementsVersion !== requirementsVersions[kind]) return 'acceptance requirements version changed';
  if (receipt.status !== 'passed') return 'checks have not passed';
  if (!present(receipt.tester) || !present(receipt.notes) || !Number.isFinite(Date.parse(receipt.testedAt)) || !['observed', 'user-reported'].includes(receipt.method) || receipt.environment !== 'target-platform') return 'actual target-platform test details are incomplete';
  if (!targetsMatch(receipt.target, target)) return 'target software versions differ or are unspecified';
  if (!Array.isArray(receipt.pcIds) || receipt.pcIds.some(id => !present(id)) || new Set(receipt.pcIds.map(id => id.trim().toLowerCase())).size < (kind === 'app' ? 1 : 2)) return 'PC identifiers are incomplete';
  const pcProblem = homogeneousProblem(receipt);
  if (pcProblem) return pcProblem;
  if (!identity.engine.assembled || receipt.engineDigest !== identity.engine.digest || receipt.masterWorkbookSha256 !== identity.engine.workbookSha256) return 'common engine or master workbook changed';
  if (kind !== 'engine' && (receipt.appDigest !== identity.app.digest || receipt.appId !== identity.appId)) return 'application changed';
  if (kind === 'site' && (!present(siteId) || receipt.siteId !== siteId)) return 'deployment site differs';
  if (kind === 'site') {
    if (!sameDeploymentLocation(receipt.deploymentLocation, deploymentLocation)) return 'canonical deployment filesystem location differs';
    try { normalizeShareLocation(receipt.shareLocation); } catch { return 'tested UNC share location is missing'; }
    if (receipt.deploymentLocation.platform !== 'win32' && receipt.method !== 'user-reported') return 'a non-Windows recorder must identify site results as user-reported';
    if (receipt.deploymentLocation.platform === 'win32' && receipt.deploymentLocation.path.startsWith('\\\\') && normalizeShareLocation(receipt.shareLocation) !== normalizeShareLocation(receipt.deploymentLocation.path)) return 'tested UNC share differs from the accessed deployment';
    if (dataSource === 'csvFolder') {
      let testedSource, currentSource;
      try { testedSource = normalizeCsvSourcePath(receipt.csvSourcePath); } catch { return 'tested CSV source path is missing'; }
      try { currentSource = normalizeCsvSourcePath(csvSourcePath); } catch { return 'current CSV source path is required'; }
      if (testedSource !== currentSource) return 'CSV source path differs from the tested source';
    }
  }
  for (const key of checksFor(dataSource)[kind]) if (receipt.checks?.[key] !== true) return 'check has not passed: ' + key;
  return null;
}
export function assessAcceptance({ identity, receipts = [], target, siteId, deploymentLocation, csvSourcePath, requirementsVersions }) {
  const reasons = [];
  const selected = {};
  if (!identity?.engine || !identity?.app) throw new Error('An engine and application identity are required');
  const dataSource = dataSourceOf(identity);
  requirementsVersions ??= dataSource === 'csvFolder' ? CSV_REQUIREMENTS_VERSIONS : REQUIREMENTS_VERSIONS;
  if (!identity.engine.assembled) reasons.push('source-verified common master workbook is not assembled');
  try { validateTarget(target); } catch (error) { reasons.push(error.message); }
  for (const kind of ['engine', 'app', ...(siteId ? ['site'] : [])]) {
    const candidates = receipts.filter(receipt => receipt.kind === kind);
    // The latest report for these exact bytes/platform/site supersedes earlier reports,
    // including a new failure. A past passing run cannot hide a regression.
    const related = candidates.filter(receipt => receipt.engineDigest === identity.engine.digest &&
      sameDataSource(receipt, dataSource) &&
      (kind === 'engine' || (receipt.appDigest === identity.app.digest && receipt.appId === identity.appId)) &&
      targetsMatch(receipt.target, target) && (kind !== 'site' || receipt.siteId === siteId));
    related.sort((a, b) => String(b.recordedAt ?? b.testedAt).localeCompare(String(a.recordedAt ?? a.testedAt)) || String(b.id).localeCompare(String(a.id)));
    const receipt = related[0];
    const problem = receiptProblem(receipt, kind, identity, target, siteId, deploymentLocation, requirementsVersions, csvSourcePath);
    if (problem) reasons.push(kind + ': ' + (candidates.length && !receipt ? 'no current evidence for these files and software versions' : problem));
    else selected[kind] = receipt;
  }
  const distributionReady = Boolean(identity.engine.assembled && selected.engine && selected.app);
  return { distributionReady, releaseReady: distributionReady, siteReady: Boolean(distributionReady && siteId && selected.site), reasons, receipts: selected };
}
export function createReceipt({ kind, identity, report, deploymentLocation, now = new Date().toISOString() }) {
  if (!CHECKS[kind]) throw new Error('Evidence kind must be engine, app, or site');
  if (!identity?.engine?.assembled || !identity.engine.workbookSha256) throw new Error('Target-platform evidence needs a source-verified assembled master workbook');
  const dataSource = dataSourceOf(identity);
  const requiredChecks = checksFor(dataSource)[kind];
  const requirementsVersions = dataSource === 'csvFolder' ? CSV_REQUIREMENTS_VERSIONS : REQUIREMENTS_VERSIONS;
  if ((dataSource === 'csvFolder' || report?.dataSource !== undefined) && report?.dataSource !== dataSource) throw new Error('Actual report dataSource must match the tested application mode');
  const target = validateTarget(report?.target);
  if (!Number.isFinite(Date.parse(report.testedAt)) || !present(report.tester) || !present(report.notes) || !['observed', 'user-reported'].includes(report.method) || report.environment !== 'target-platform') throw new Error('Record actual observed or user-reported target-platform execution, including tester, testedAt, method, environment and notes');
  const pcIds = report.pcIds?.map(id => typeof id === 'string' ? id.trim() : id);
  if (!Array.isArray(pcIds) || pcIds.some(id => !present(id)) || new Set(pcIds.map(id => id.toLowerCase())).size < (kind === 'app' ? 1 : 2)) throw new Error('Actual PC identifiers are required (two distinct PCs for engine/site checks)');
  const pcProblem = homogeneousProblem({ ...report, pcIds });
  if (pcProblem) throw new Error(pcProblem);
  if (kind === 'site' && !present(report.siteId)) throw new Error('A stable deployment siteId is required');
  let shareLocation;
  let csvSourcePath;
  let shareLocationVerified = false;
  if (kind === 'site') {
    deploymentLocation = normalizeDeploymentLocation(deploymentLocation);
    shareLocation = normalizeShareLocation(report.shareLocation);
    if (dataSource === 'csvFolder') csvSourcePath = normalizeCsvSourcePath(report.csvSourcePath);
    if (deploymentLocation.platform !== 'win32' && report.method !== 'user-reported') throw new Error('Site results recorded outside Windows must use method=user-reported');
    if (deploymentLocation.platform === 'win32' && deploymentLocation.path.startsWith('\\\\')) {
      if (shareLocation !== normalizeShareLocation(deploymentLocation.path)) throw new Error('Reported UNC shareLocation differs from the actual deployment path');
      shareLocationVerified = true;
    }
  }
  if (!report.checks || Object.values(report.checks).some(value => typeof value !== 'boolean')) throw new Error('Reported checks must be true or false');
  const checks = Object.fromEntries(requiredChecks.map(key => [key, report.checks[key] === true]));
  const receipt = {
    schema: EVIDENCE_SCHEMA, id: crypto.randomUUID(), kind, dataSource, requirementsVersion: requirementsVersions[kind],
    status: requiredChecks.every(key => checks[key]) ? 'passed' : 'failed',
    testedAt: new Date(report.testedAt).toISOString(), recordedAt: now,
    tester: report.tester.trim(), method: report.method, environment: report.environment,
    notes: report.notes.trim(), target, pcIds, homogeneousTargets: report.homogeneousTargets === true, checks,
    engineDigest: identity.engine.digest, masterWorkbookSha256: identity.engine.workbookSha256,
    engineFiles: identity.engine.files
  };
  if (report.pcTargets) receipt.pcTargets = Object.fromEntries(pcIds.map(id => [id, validateTarget(report.pcTargets[id])]));
  if (kind !== 'engine') Object.assign(receipt, { appId: identity.appId, appDigest: identity.app.digest, appFiles: identity.app.files });
  if (kind === 'site') Object.assign(receipt, { siteId: report.siteId.trim(), deploymentLocation, shareLocation, shareLocationVerified });
  if (csvSourcePath) receipt.csvSourcePath = csvSourcePath;
  return receipt;
}
async function readDeployment(deploymentDir) {
  const { validRelative, sha256 } = await import('./package.mjs');
  const directory = path.resolve(deploymentDir);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'release-manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 2 || manifest.mode !== 'release' || manifest.distributionReady !== true || !manifest.immutableFiles || !manifest.identity?.engine?.assembled) throw new Error('Only a released, verified deployment can be commissioned');
  const entries = Object.entries(manifest.immutableFiles);
  if (!entries.length || !manifest.immutableFiles['gate.config.json'] || !manifest.immutableFiles['runtime/excel-gate.js']) throw new Error('Deployment immutable file manifest is incomplete');
  for (const [relative, expected] of entries) {
    validRelative(relative);
    if (!relative.startsWith('runtime/') && !relative.startsWith('shared/') && !['gate.config.json', 'runtime-files.txt'].includes(relative)) throw new Error('Invalid immutable deployment file: ' + relative);
    if (sha256(await fs.readFile(path.join(directory, relative))) !== expected) throw new Error('Deployment files changed; current evidence no longer applies: ' + relative);
  }
  // Initialization/saves legitimately change workbook bytes. The immutable master
  // identity is in the manifest; do not compare it with the live workbook hash.
  const workbookFile=manifest.workbookFileName ?? 'MVP9th.xlsm';
  validRelative(workbookFile);
  if(workbookFile.includes('/')||!workbookFile.endsWith('.xlsm'))throw new Error('Invalid deployment workbook filename');
  if (!(await fs.stat(path.join(directory, workbookFile))).isFile()) throw new Error('Deployment workbook is missing');
  return { directory, deploymentLocation: await canonicalDeploymentLocation(directory), manifest, receipts: await readReceipts(path.join(directory, 'verification')) };
}
export async function assessDeployment(deploymentDir, { target, siteId, csvSourcePath } = {}) {
  const { manifest, receipts, deploymentLocation } = await readDeployment(deploymentDir);
  const result = assessAcceptance({ identity: manifest.identity, receipts, target: target ?? manifest.target, siteId, deploymentLocation, csvSourcePath });
  return { ...result, identity: manifest.identity, target: target ?? manifest.target, deploymentLocation, shareLocationVerified: result.receipts.site?.shareLocationVerified ?? false };
}
export async function recordEvidence({ kind, appName, report, evidenceDir = path.join(root, 'verification/receipts'), deploymentDir, csvSourcePath }) {
  let identity;
  let deployment;
  if (kind === 'site') {
    if (!deploymentDir) throw new Error('Site evidence requires the existing deployment directory');
    deployment = await readDeployment(deploymentDir);
    identity = deployment.manifest.identity;
    const acceptance = assessAcceptance({ identity, receipts: deployment.receipts, target: report.target });
    if (!acceptance.distributionReady) throw new Error('Deployment engine/app evidence does not match: ' + acceptance.reasons.join('; '));
  } else {
    const { computeIdentity } = await import('./package.mjs');
    identity = await computeIdentity(appName);
  }
  const receipt = createReceipt({ kind, identity, report, deploymentLocation: deployment?.deploymentLocation });
  // Receipts are append-only and outside app source folders and operational data.
  const filename = kind + '-' + receipt.id + '.json';
  const bytes = JSON.stringify(receipt, null, 2) + '\n';
  await fs.mkdir(evidenceDir, { recursive: true });
  const file = path.join(path.resolve(evidenceDir), filename);
  await fs.writeFile(file, bytes, { flag: 'wx' });
  if (deployment) {
    const directory = path.join(deployment.directory, 'verification');
    await fs.mkdir(directory, { recursive: true });
    const deployedFile = path.join(directory, filename);
    if (deployedFile !== file) await fs.writeFile(deployedFile, bytes, { flag: 'wx' });
  }
  return { file, receipt, ...(deployment ? { acceptance: await assessDeployment(deployment.directory, { target: report.target, siteId: report.siteId, csvSourcePath }) } : {}) };
}
async function main() {
  const args = process.argv.slice(2);
  const flag = name => args.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
  const positional = args.filter(arg => !arg.startsWith('--'));
  if (positional[0] === 'record') {
    if (!flag('report')) throw new Error('Usage: evidence.mjs record engine|app|site APP --report=actual-results.json [--deployment=DIR] [--csv-source=PATH] [--evidence-dir=DIR]');
    const report = JSON.parse(await fs.readFile(flag('report'), 'utf8'));
    console.log(JSON.stringify(await recordEvidence({ kind: positional[1], appName: positional[2], report, deploymentDir: flag('deployment'), evidenceDir: flag('evidence-dir'), csvSourcePath: flag('csv-source') }), null, 2));
  } else if (positional[0] === 'status' && flag('deployment')) {
    console.log(JSON.stringify(await assessDeployment(flag('deployment'), { siteId: flag('site'), csvSourcePath: flag('csv-source'), target: flag('target') ? await readTarget(flag('target')) : undefined }), null, 2));
  } else if (positional[0] === 'status' && positional[1]) {
    const { computeIdentity } = await import('./package.mjs');
    console.log(JSON.stringify(assessAcceptance({ identity: await computeIdentity(positional[1]), receipts: await readReceipts(flag('evidence-dir')), target: await readTarget(flag('target')) }), null, 2));
  } else throw new Error('Usage: evidence.mjs record KIND APP --report=FILE | status APP | status --deployment=DIR --site=SITE [--csv-source=PATH]');
}
// package.mjs imports this module; do not hold its evaluation open while the CLI
// dynamically imports package.mjs to assess the deployed bytes.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
