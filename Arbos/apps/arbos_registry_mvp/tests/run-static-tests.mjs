import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const htmlPath = path.join(root, "arbos-registry.html");
const samplePath = path.join(root, "arbos-registry-sample.json");
const builderPath = path.join(root, "build_initial_registry_json.py");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${passed + failed} - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok ${passed + failed} - ${name}`);
    console.error(`  ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function unique(values, label) {
  const seen = new Set();
  for (const value of values) {
    assert(value, `${label}に空値があります`);
    assert(!seen.has(value), `${label}が重複しています: ${value}`);
    seen.add(value);
  }
  return seen;
}

const html = fs.readFileSync(htmlPath, "utf8");
const sample = JSON.parse(fs.readFileSync(samplePath, "utf8"));
const builder = fs.readFileSync(builderPath, "utf8");
const scriptMatches = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
const inlineScript = scriptMatches.map(match => match[1]).join("\n");
const eventBindingMarker = inlineScript.indexOf('$("userForm").addEventListener');
const coreContext = { console, structuredClone, Date, Intl, Set, Map, Object, Array, String, Number, Math };
vm.createContext(coreContext);
if (eventBindingMarker > 0) {
  const coreScript = `${inlineScript.slice(0, eventBindingMarker)}\nglobalThis.__core = { normalizeData, validateData, createEmptyData, esc, fmtDate, dateKey };`;
  new vm.Script(coreScript, { filename: "arbos-registry-core.js" }).runInContext(coreContext);
}

test("単一HTMLとサンプルJSONが存在する", () => {
  assert(fs.existsSync(htmlPath), "HTMLがありません");
  assert(fs.existsSync(samplePath), "サンプルJSONがありません");
  assert(html.startsWith("<!doctype html>"), "HTML5 doctypeではありません");
});

test("HTML埋込JavaScriptが構文解析できる", () => {
  assert(scriptMatches.length === 1, `scriptブロックは1つである必要があります: ${scriptMatches.length}`);
  new vm.Script(inlineScript, { filename: "arbos-registry-inline.js" });
});

test("外部リソースと外部通信へ依存しない", () => {
  const forbidden = [
    /https?:\/\//i,
    /<script[^>]+src\s*=/i,
    /<link[^>]+href\s*=/i,
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /WebSocket/,
    /EventSource/,
    /navigator\.sendBeacon/,
    /<img\b/i
  ];
  for (const pattern of forbidden) assert(!pattern.test(html), `禁止パターンを検出: ${pattern}`);
});

test("禁止されたブラウザ保存APIを使わない", () => {
  const forbidden = [
    /\bindexedDB\b/,
    /showOpenFilePicker/,
    /showSaveFilePicker/,
    /showDirectoryPicker/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /serviceWorker/,
    /\bcaches\./
  ];
  for (const pattern of forbidden) assert(!pattern.test(html), `禁止APIを検出: ${pattern}`);
});

test("JSON読込と書出しはFileReaderとBlobを使う", () => {
  assert(/new FileReader\s*\(/.test(inlineScript), "FileReaderがありません");
  assert(/new Blob\s*\(/.test(inlineScript), "Blobがありません");
  assert(/download\s*=/.test(inlineScript), "download属性による書出しがありません");
  assert(/type="file"/.test(html), "file inputがありません");
});

test("CSPで外部接続・オブジェクト・base URIを禁止する", () => {
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/i)?.[1] || "";
  assert(csp.includes("connect-src 'none'"), "connect-src 'none' がありません");
  assert(csp.includes("object-src 'none'"), "object-src 'none' がありません");
  assert(csp.includes("base-uri 'none'"), "base-uri 'none' がありません");
});

test("静的DOM IDが重複していない", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  unique(ids, "DOM ID");
});

test("JavaScriptから参照する静的DOM IDが存在する", () => {
  const declared = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]));
  const referenced = new Set([...inlineScript.matchAll(/\$\("([^"]+)"\)/g)].map(match => match[1]));
  for (const id of referenced) assert(declared.has(id), `未宣言DOM IDを参照しています: ${id}`);
});

test("主要4画面とJSON操作を備える", () => {
  for (const id of [
    "followupPanel", "registryPanel", "detailPanel", "dataPanel",
    "jsonFileInput", "jsonSaveBtn", "userDialog", "eventDialog",
    "taskDialog", "recordDialog", "sourceDialog"
  ]) assert(html.includes(`id="${id}"`), `主要DOMがありません: ${id}`);
});

test("サンプルJSONがschema v1の必須配列を備える", () => {
  assert(sample.schemaVersion === 1, "schemaVersionが1ではありません");
  assert(sample.appId === "arbos-user-registry", "appIdが不一致です");
  for (const key of ["users", "serviceCatalog", "serviceRelations", "serviceEvents", "followupTasks", "coordinationRecords", "sourceFreshness", "changeLogs"])
    assert(Array.isArray(sample[key]), `${key}が配列ではありません`);
});

test("サンプルJSONを実装本体の正規化・検証へ通せる", () => {
  assert(coreContext.__core, "コア関数を抽出できません");
  const normalized = coreContext.__core.normalizeData(structuredClone(sample));
  assert(normalized.users.length === sample.users.length, "利用者件数が変わりました");
  assert(normalized.serviceEvents.length === sample.serviceEvents.length, "イベント件数が変わりました");
  assert(normalized.users[0].patientId === sample.users[0].patientId, "患者IDが変わりました");
});

test("患者ID・内部ID・各レコードIDが一意", () => {
  unique(sample.users.map(item => item.userId), "userId");
  unique(sample.users.map(item => item.patientId), "patientId");
  unique(sample.serviceRelations.map(item => item.relationId), "relationId");
  unique(sample.serviceEvents.map(item => item.eventId), "eventId");
  unique(sample.followupTasks.map(item => item.taskId), "taskId");
  unique(sample.coordinationRecords.map(item => item.recordId), "recordId");
});

test("患者IDは文字列として保持する", () => {
  for (const user of sample.users) assert(typeof user.patientId === "string", `患者IDが文字列ではありません: ${user.patientId}`);
  assert(inlineScript.includes("patientId: clean(item.patientId)"), "患者IDを文字列正規化する処理がありません");
  assert(!/Number\s*\(\s*item\.patientId/.test(inlineScript), "患者IDを数値化しています");
});

test("先頭ゼロ患者IDと同姓同名別IDを保持する", () => {
  const candidate = structuredClone(sample);
  candidate.users[0].patientId = "00123";
  candidate.users[1].displayName = candidate.users[0].displayName;
  const normalized = coreContext.__core.normalizeData(candidate);
  assert(normalized.users[0].patientId === "00123", "先頭ゼロが失われました");
  assert(normalized.users.length === 2, "同姓同名利用者が統合されました");
});

test("重複患者ID・孤児参照・新しすぎるschemaを拒否する", () => {
  const duplicate = structuredClone(sample);
  duplicate.users[1].patientId = duplicate.users[0].patientId;
  assertThrows(() => coreContext.__core.normalizeData(duplicate), "重複患者IDを許可しました");
  const orphan = structuredClone(sample);
  orphan.serviceEvents[0].userId = "missing-user";
  assertThrows(() => coreContext.__core.normalizeData(orphan), "孤児参照を許可しました");
  const future = structuredClone(sample);
  future.schemaVersion = 999;
  assertThrows(() => coreContext.__core.normalizeData(future), "新しすぎるschemaを許可しました");
});

test("必須配列の欠落または配列以外の値を拒否する", () => {
  const requiredArrays = ["users", "serviceCatalog", "serviceRelations", "serviceEvents", "followupTasks", "coordinationRecords", "sourceFreshness", "changeLogs"];
  for (const key of requiredArrays) {
    const missing = structuredClone(sample);
    delete missing[key];
    assertThrows(() => coreContext.__core.normalizeData(missing), `${key}の欠落を許可しました`);

    const malformed = structuredClone(sample);
    malformed[key] = {};
    assertThrows(() => coreContext.__core.normalizeData(malformed), `${key}の非配列値を許可しました`);
  }
});

test("revisionとpreviousRevisionの不正値を拒否する", () => {
  for (const revision of [1.5, "1", Number.NaN, -1]) {
    const candidate = structuredClone(sample);
    candidate.revision = revision;
    assertThrows(() => coreContext.__core.normalizeData(candidate), `不正なrevisionを許可しました: ${String(revision)}`);
  }
  for (const previousRevision of [0.5, "0", Number.NaN, -1, sample.revision + 1]) {
    const candidate = structuredClone(sample);
    candidate.previousRevision = previousRevision;
    assertThrows(() => coreContext.__core.normalizeData(candidate), `不正なpreviousRevisionを許可しました: ${String(previousRevision)}`);
  }
});

test("datasetIdと患者IDの型を厳格に検証する", () => {
  const missingDataset = structuredClone(sample);
  delete missingDataset.datasetId;
  assertThrows(() => coreContext.__core.normalizeData(missingDataset), "datasetIdの欠落を許可しました");
  const numericPatientId = structuredClone(sample);
  numericPatientId.users[0].patientId = 123;
  assertThrows(() => coreContext.__core.normalizeData(numericPatientId), "数値型の患者IDを許可しました");
});

test("同一利用者・同一サービスの利用関係重複を拒否する", () => {
  const candidate = structuredClone(sample);
  candidate.serviceRelations.push({
    ...candidate.serviceRelations[0],
    relationId: "duplicate-relation-id"
  });
  assertThrows(() => coreContext.__core.normalizeData(candidate), "利用者・サービスの組み合わせ重複を許可しました");
});

test("対応記録と関連フォローの利用者不一致を拒否する", () => {
  const candidate = structuredClone(sample);
  candidate.coordinationRecords[0].userId = candidate.users[1].userId;
  assertThrows(() => coreContext.__core.normalizeData(candidate), "対応記録と関連フォローの利用者不一致を許可しました");
});

test("アーカイブ利用者の未完了フォローを拒否する", () => {
  const candidate = structuredClone(sample);
  const task = candidate.followupTasks.find(item => !["booked", "declined", "excluded", "done"].includes(item.status));
  const user = candidate.users.find(item => item.userId === task.userId);
  user.status = "archived";
  assertThrows(() => coreContext.__core.normalizeData(candidate), "アーカイブ利用者の未完了フォローを許可しました");
});

test("定義外の列挙値を暗黙変換せず拒否する", () => {
  const enumCases = [
    ["users", 0, "status"],
    ["users", 0, "threeFloorFit"],
    ["serviceRelations", 0, "status"],
    ["serviceEvents", 0, "status"],
    ["followupTasks", 0, "category"],
    ["followupTasks", 0, "status"],
    ["followupTasks", 0, "priority"],
    ["coordinationRecords", 0, "kind"],
    ["coordinationRecords", 0, "result"],
    ["sourceFreshness", 0, "linkageStatus"]
  ];
  for (const [collection, index, key] of enumCases) {
    const candidate = structuredClone(sample);
    candidate[collection][index][key] = "__invalid_enum__";
    assertThrows(() => coreContext.__core.normalizeData(candidate), `${collection}[${index}].${key}の定義外値を許可しました`);
  }
});

test("不正日付と終了日が開始日より前のイベントを拒否する", () => {
  const invalidDates = ["2026-02-30", "2026-2-3", "not-a-date", "<img src=x>"];
  for (const value of invalidDates) {
    const candidate = structuredClone(sample);
    candidate.serviceEvents[0].startDate = value;
    assertThrows(() => coreContext.__core.normalizeData(candidate), `不正な開始日を許可しました: ${value}`);
  }

  const reversed = structuredClone(sample);
  reversed.serviceEvents[0].startDate = "2026-07-10";
  reversed.serviceEvents[0].endDate = "2026-07-09";
  assertThrows(() => coreContext.__core.normalizeData(reversed), "終了日が開始日より前のイベントを許可しました");

  const invalidOptional = structuredClone(sample);
  invalidOptional.followupTasks[0].dueDate = "2026-04-31";
  assertThrows(() => coreContext.__core.normalizeData(invalidOptional), "不正なフォロー期限を許可しました");
});

test("利用者入力をHTMLとして解釈しないエスケープ処理を備える", () => {
  const malicious = '<img src=x onerror="alert(1)">';
  const escaped = coreContext.__core.esc(malicious);
  assert(!escaped.includes("<img"), "imgタグがエスケープされていません");
  assert(escaped.includes("&lt;img"), "期待するHTMLエスケープではありません");
});

test("日付表示は固定形式で、異常値をHTMLとして出力しない", () => {
  assert(coreContext.__core.fmtDate("2026-07-09") === "2026/07/09", "正常日付の表示形式が不正です");
  const malicious = coreContext.__core.fmtDate('<img src=x onerror="alert(1)">');
  assert(!malicious.includes("<"), "日付表示からHTMLタグを出力しています");
  assert(!malicious.includes("undefined"), "異常な日付を壊れた形式で出力しています");
});

test("正規化済みデータをJSON書出し相当に変換して再読込できる", () => {
  const before = coreContext.__core.normalizeData(structuredClone(sample));
  const exported = structuredClone(before);
  exported.previousRevision = before.revision;
  exported.revision = before.revision + 1;
  exported.savedAt = "2026-07-19T12:34:56+09:00";
  exported.savedBy = "テスト担当";
  const reloaded = coreContext.__core.normalizeData(JSON.parse(JSON.stringify(exported)));
  assert(reloaded.revision === before.revision + 1, "再読込後のrevisionが一致しません");
  assert(reloaded.previousRevision === before.revision, "再読込後のpreviousRevisionが一致しません");
  assert(reloaded.savedBy === "テスト担当", "再読込後の保存担当が一致しません");
  for (const key of ["users", "serviceRelations", "serviceEvents", "followupTasks", "coordinationRecords"])
    assert(reloaded[key].length === before[key].length, `再読込で${key}の件数が変わりました`);
  assert(reloaded.users[0].patientId === before.users[0].patientId, "再読込で患者IDが変わりました");
});

test("サンプルJSONの患者・サービス・フォロー参照が整合する", () => {
  const userIds = new Set(sample.users.map(item => item.userId));
  const serviceIds = new Set(sample.serviceCatalog.map(item => item.serviceId));
  const taskIds = new Set(sample.followupTasks.map(item => item.taskId));
  for (const row of [...sample.serviceRelations, ...sample.serviceEvents, ...sample.followupTasks, ...sample.coordinationRecords])
    assert(userIds.has(row.userId), `存在しないuserId参照: ${row.userId}`);
  for (const row of [...sample.serviceRelations, ...sample.serviceEvents])
    assert(serviceIds.has(row.serviceId), `存在しないserviceId参照: ${row.serviceId}`);
  for (const row of sample.coordinationRecords)
    assert(!row.taskId || taskIds.has(row.taskId), `存在しないtaskId参照: ${row.taskId}`);
});

test("実績・予定の区分と主要3サービスを保持する", () => {
  const statuses = new Set(sample.serviceEvents.map(item => item.status));
  assert(statuses.has("actual"), "実績イベントがありません");
  assert(statuses.has("planned"), "予定イベントがありません");
  const services = new Set(sample.serviceCatalog.map(item => item.serviceId));
  for (const service of ["long", "short", "day"]) assert(services.has(service), `${service}サービスがありません`);
});

test("未保存警告、リビジョン、保存前検証を備える", () => {
  assert(/beforeunload/.test(inlineScript), "未保存終了警告がありません");
  assert(/previousRevision/.test(inlineScript), "前リビジョン管理がありません");
  assert(/validateData\(data\)/.test(inlineScript), "保存前検証がありません");
  const saveStart = inlineScript.indexOf("function saveJson()");
  const loadStart = inlineScript.indexOf("async function loadJsonFile", saveStart);
  const saveBody = inlineScript.slice(saveStart, loadStart);
  const validateAt = saveBody.indexOf("validateData(data)");
  const revisionAt = saveBody.indexOf("data.previousRevision");
  const blobAt = saveBody.indexOf("new Blob");
  assert(saveStart >= 0 && loadStart > saveStart, "saveJson本体を特定できません");
  assert(validateAt >= 0 && validateAt < revisionAt, "リビジョン更新より前に保存前検証していません");
  assert(revisionAt >= 0 && revisionAt < blobAt, "リビジョン更新後にJSONを書き出していません");
});

test("書出し直後を未検証扱いにし、読込元名と書出し名を分離する", () => {
  const saveStart = inlineScript.indexOf("function saveJson()");
  const loadStart = inlineScript.indexOf("async function loadJsonFile", saveStart);
  const readStart = inlineScript.indexOf("function readFileAsText", loadStart);
  const saveBody = inlineScript.slice(saveStart, loadStart);
  const loadBody = inlineScript.slice(loadStart, readStart);
  assert(saveBody.includes("lastExportFileName = link.download"), "書出し候補名を保持していません");
  assert(saveBody.includes("exportPendingVerification = true"), "書出し直後を未検証にしていません");
  assert(!saveBody.includes("sourceFileName = link.download"), "未検証ファイルを読込元扱いしています");
  assert(loadBody.includes("text !== lastExportPayload"), "再読込内容を最後の書出し候補と照合していません");
  assert(loadBody.includes("sourceFileName = file.name"), "再読込後の読込元名を保持していません");
  assert(loadBody.includes("exportPendingVerification = false"), "再読込後も未検証状態が残ります");
  assert(/beforeunload[\s\S]*exportPendingVerification/.test(inlineScript), "未検証のまま終了する警告がありません");
});

test("undo全量履歴に世代数と総バイト上限がある", () => {
  assert(/UNDO_MAX_STEPS\s*=\s*10/.test(inlineScript), "undo世代上限がありません");
  assert(/UNDO_MAX_BYTES\s*=\s*24\s*\*\s*1024\s*\*\s*1024/.test(inlineScript), "undo総バイト上限がありません");
  assert(inlineScript.includes("undoBytes + bytes > UNDO_MAX_BYTES"), "undo総量による削減処理がありません");
});

test("未完了フォロー付きアーカイブを拒否し、最新フロアを日付順に導出する", () => {
  const userFormStart = inlineScript.indexOf('$("userForm").addEventListener');
  const relationFormStart = inlineScript.indexOf('$("relationForm").addEventListener', userFormStart);
  const userFormBody = inlineScript.slice(userFormStart, relationFormStart);
  assert(userFormBody.includes("if (openCount) return toast"), "未完了フォロー付きアーカイブを拒否していません");
  assert(inlineScript.includes("syncLatestFloorFromEvents"), "最新フロア導出処理がありません");
  assert(inlineScript.includes("b.startDate.localeCompare(a.startDate)"), "実績日降順で最新フロアを選んでいません");
});

test("初期JSONビルダーは排他的な新規作成だけを行う", () => {
  assert(/args\.output\.exists\(\)/.test(builder), "既存出力の事前拒否がありません");
  assert(/args\.output\.open\("x"/.test(builder), "排他的な新規ファイル作成を使っていません");
  assert(!/args\.output\.write_text\(/.test(builder), "既存ファイルを上書き可能なwrite_textを使っています");
});

function assertThrows(fn, message) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  assert(threw, message);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
