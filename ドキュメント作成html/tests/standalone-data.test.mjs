import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

function loadScript(file, prepare, globals = {}) {
  const html = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  new vm.Script(source, { filename: file });
  const context = vm.createContext({ crypto: webcrypto, structuredClone, console, localStorage: { getItem: () => null }, ...globals });
  vm.runInContext(prepare(source), context);
  return context.api;
}

const sheets = loadScript('WAKENAZE.html', source =>
  source.split('  // Events')[0] + '\nglobalThis.api = { createProject, normalizeProject };');
const board = loadScript('プロジェクト進捗ボード.html', source =>
  source.replace('      setup();', '      globalThis.api = { initialState, normalizeState, normalizeStageRecords, mergeStageRecords, stageRecordComplete, progressValidationError, currentStageSummary, projectLinks, safeHref, STAGES };'));
const plain = value => JSON.parse(JSON.stringify(value));

function filledProject() {
  const project = plain(sheets.createProject('受付業務の改善'));
  project.documents.improvement1.fields.problem = '同じ内容を二度入力している';
  project.documents.improvement1.fields.tentativeAction = '入力項目を整理する';
  project.documents.improvement2.fields.solution = '転記を減らす';
  project.documents.stakeholders.people.push({ id: 'person-1', name: '担当者A', importance: '高', influence: '高', interest: '高', engagement: '相談する', values: [{ id: 'value-1', text: '入力時間の短縮' }] });
  project.printSettings.improvement1.globalScale = 90;
  project.printSettings.improvement1.fieldScales.problem = 110;
  return project;
}

test('新規WAKENAZEデータは専用形式で、連携情報を持たない', () => {
  const result = plain(sheets.createProject('新しい案件'));
  assert.equal(result.app, 'improvement-workflow-studio');
  assert.equal(result.schemaVersion, 2);
  assert.deepEqual(Object.keys(result.project).sort(), ['createdAt', 'id', 'name', 'updatedAt']);
  assert.match(result.project.id, /^DX-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
  assert.deepEqual(Object.keys(result).sort(), ['app', 'documents', 'printSettings', 'project', 'schemaVersion']);
});

test('専用JSONの往復でシート・人物・印刷設定・プロジェクト情報を維持する', () => {
  const original = filledProject();
  assert.deepEqual(plain(sheets.normalizeProject(plain(original))), original);
});

test('WAKENAZEは共通JSON・旧形式・未対応バージョンを受け付けない', () => {
  const original = filledProject();
  for (const raw of [
    { app: 'dx-project-package', schemaVersion: 1, project: original.project, sheets: { documents: original.documents, printSettings: original.printSettings } },
    { ...original, app: 'dx-document-studio', schemaVersion: 1 },
    { ...original, schemaVersion: 1 },
    { ...original, schemaVersion: 99 },
    null
  ]) assert.throws(() => sheets.normalizeProject(raw), /JSON形式/);
});

test('専用JSONでも不正なシート・人物データを拒否する', () => {
  for (const documents of [null, {}, { improvement1: {} }, { ...filledProject().documents, stakeholders: null }]) {
    assert.throws(() => sheets.normalizeProject({ ...filledProject(), documents }));
  }
});

test('進捗ボードの専用バックアップは進捗・資料を維持して往復できる', () => {
  const original = plain(board.initialState());
  assert.equal(original.schemaVersion, 3);
  assert.equal(Object.hasOwn(original, 'workflowVersion'), false);
  const project = original.projects[0];
  project.completedSubsteps = { 3: [0] };
  project.documents = [{ id: 'doc-1', stage: 2, name: 'わけなぜシート', url: './資料.xlsx' }];
  assert.deepEqual(plain(board.normalizeState(plain(original))), original);
  assert.equal(Object.hasOwn(project, 'sheets'), false);
  assert.equal(Object.hasOwn(project, 'progressUpdatedAt'), false);
});

test('進捗ボードは旧バージョン・未対応バージョンを拒否する', () => {
  for (const schemaVersion of [undefined, 1, 2, 99]) {
    assert.throws(() => board.normalizeState({ ...plain(board.initialState()), schemaVersion }));
  }
});

test('進捗ボードは共通JSONとWAKENAZE専用JSONを受け付けない', () => {
  assert.throws(() => board.normalizeState({ app: 'dx-project-package', schemaVersion: 1, project: filledProject().project }));
  assert.throws(() => board.normalizeState(filledProject()));
});

function recordedProject(stage = 8) {
  return {
    ...plain(board.initialState()).projects[0], stage,
    stageRecords: {
      security: { date: '2026-10-01', reviewer: '確認担当', version: 'MVP v1.0', result: 'passed', summary: '指摘への対応と最終確認を完了', url: './チェック結果.pdf' },
      deployment: { date: '2026-10-01', owner: '実装担当', appUrl: 'https://example.com/app.html', indexUrl: 'https://example.com/DXindex.html', verified: true, indexRegistered: true, note: '利用担当へ引き継ぎ済み' }
    },
    documents: [{ id: 'mvp', stage: 5, name: 'MVP', url: './app.html' }]
  };
}

test('6・7の完了記録と段階別リンクをバックアップ・読込で維持する', () => {
  const original = { ...plain(board.initialState()), projects: [recordedProject()] };
  assert.deepEqual(plain(board.normalizeState(JSON.parse(JSON.stringify(original)))), original);
  assert.equal(board.stageRecordComplete(original.projects[0], 6), true);
  assert.equal(board.stageRecordComplete(original.projects[0], 7), true);
  assert.deepEqual(plain(board.projectLinks(original.projects[0])).map(link => link.stage), [5, 6, 7, 7]);
});

test('後半段階は保存した番号のまま読み込み、読み替えを行わない', () => {
  const original = { ...plain(board.initialState()), projects: [6, 7, 8].map(stage => recordedProject(stage)) };
  const result = plain(board.normalizeState(original));
  assert.deepEqual(result.projects.map(project => project.stage), [6, 7, 8]);
  assert.deepEqual(result, original);
});

test('自動保存は新しい保存キーだけを読み、以前の保存領域を参照しない', () => {
  const keys = [];
  const api = loadScript('プロジェクト進捗ボード.html', source => source.replace('      setup();', '      globalThis.api = { state };'),
    { localStorage: { getItem: key => { keys.push(key); return null; } } });
  assert.deepEqual(keys, ['kaizen-project-progress-board.v3']);
  assert.equal(api.state.schemaVersion, 3);
});

test('7には6のクリア、8には実装とDX index登録の記録が必要', () => {
  const project = recordedProject(6);
  project.stageRecords = plain(board.normalizeStageRecords());
  assert.equal(board.progressValidationError(project), '');
  project.stage = 7;
  assert.match(board.progressValidationError(project), /6の.*クリア記録/);
  project.stageRecords.security = recordedProject().stageRecords.security;
  assert.equal(board.progressValidationError(project), '');
  project.stage = 8;
  assert.match(board.progressValidationError(project), /7の.*完了記録/);
  project.stageRecords.deployment = recordedProject().stageRecords.deployment;
  assert.equal(board.progressValidationError(project), '');
  project.stageRecords.deployment.indexRegistered = false;
  assert.match(board.progressValidationError(project), /7の.*完了記録/);
});

test('要修正、対象バージョンの欠落、無効な日付をクリア扱いしない', () => {
  for (const fields of [{ result: 'needs_changes' }, { version: '' }, { summary: '' }, { date: '2026-02-31' }]) {
    const project = recordedProject();
    Object.assign(project.stageRecords.security, fields);
    assert.equal(board.stageRecordComplete(project, 6), false);
    assert.notEqual(board.progressValidationError(project), '');
  }
  const project = recordedProject();
  project.stageRecords.deployment.indexUrl = '';
  assert.equal(board.stageRecordComplete(project, 7), false);
  assert.match(board.progressValidationError(project), /DX indexのリンク/);
});

test('登録済み案件の編集でも、現在段階に必要な6・7の記録を要求する', () => {
  const project = { ...recordedProject(7), stageRecords: plain(board.normalizeStageRecords()) };
  assert.match(board.progressValidationError({ ...project, note: 'メモを更新' }), /6の.*クリア記録/);
  project.stage = 8;
  project.stageRecords.security = recordedProject().stageRecords.security;
  assert.match(board.progressValidationError({ ...project, note: 'メモを更新' }), /7の.*完了記録/);
  project.stageRecords.deployment = recordedProject().stageRecords.deployment;
  assert.equal(board.progressValidationError({ ...project, note: 'メモを更新' }), '');
});

test('読込でも段階に必要な記録を検証し、不足した一覧を復元しない', () => {
  const data = { ...plain(board.initialState()), projects: [{ ...recordedProject(7), stageRecords: plain(board.normalizeStageRecords()) }] };
  assert.throws(() => board.normalizeState(data), /6の.*クリア記録/);
  data.projects[0].stage = 8;
  data.projects[0].stageRecords.security = recordedProject().stageRecords.security;
  assert.throws(() => board.normalizeState(data), /7の.*完了記録/);
});

test('記録の部分更新で既存の確認情報を消さない', () => {
  const records = recordedProject().stageRecords;
  const result = plain(board.mergeStageRecords(records, { deployment: { note: '引き継ぎ先を変更' } }));
  assert.deepEqual(result.security, records.security);
  assert.deepEqual(result.deployment, { ...records.deployment, note: '引き継ぎ先を変更' });
});

test('作成物リンクは実行用URLを拒否し、ローカル・共有フォルダを開ける形にする', () => {
  assert.equal(board.safeHref('javascript:alert(1)'), '');
  assert.equal(board.safeHref('java\tscript:alert(1)'), '');
  assert.equal(board.safeHref('data:text/html,test'), '');
  assert.equal(board.safeHref('./MVP.html'), './MVP.html');
  assert.equal(board.safeHref('C:\\miharaDB\\app.html'), 'file:///C:/miharaDB/app.html');
  assert.equal(board.safeHref('\\\\server\\miharaDB\\app.html'), 'file://server/miharaDB/app.html');
});

test('WebMCPの段階更新も完了記録を要求し、失敗時は案件を変更しない', () => {
  const tools = new Map();
  const api = loadScript('プロジェクト進捗ボード.html', source => source.replace('      setup();',
    '      render = () => {}; saveState = () => {}; registerWebMCP(); globalThis.api = { state };'),
  { document: { modelContext: { registerTool: tool => tools.set(tool.name, tool) } } });
  const create = tools.get('create_kaizen_project').execute;
  const update = tools.get('update_kaizen_project_stage').execute;
  const beforeCreate = plain(api.state);
  assert.throws(() => create({ name: '記録のない案件', leader: '担当', stage: 7 }), /6の.*クリア記録/);
  assert.deepEqual(plain(api.state), beforeCreate);
  const project = create({ name: '段階を進める案件', leader: '担当', stage: 6 });
  const beforeUpdate = plain(api.state);
  assert.throws(() => update({ id: project.id, stage: 7 }), /6の.*クリア記録/);
  assert.deepEqual(plain(api.state), beforeUpdate);
  const records = recordedProject().stageRecords;
  assert.equal(update({ id: project.id, stage: 7, stageRecords: { security: records.security } }).stage, 7);
  const beforeDeployment = plain(api.state);
  assert.throws(() => update({ id: project.id, stage: 8, stageRecords: { deployment: { ...records.deployment, indexUrl: '' } } }), /DX indexのリンク/);
  assert.deepEqual(plain(api.state), beforeDeployment);
  assert.equal(update({ id: project.id, stage: 8, stageRecords: { deployment: records.deployment } }).stage, 8);
  update({ id: project.id, stage: 8, stageRecords: { deployment: { note: '引き継ぎを更新' } } });
  const saved = plain(api.state).projects.find(item => item.id === project.id);
  assert.deepEqual(saved.stageRecords.security, records.security);
  assert.deepEqual(saved.stageRecords.deployment, { ...records.deployment, note: '引き継ぎを更新' });
});
