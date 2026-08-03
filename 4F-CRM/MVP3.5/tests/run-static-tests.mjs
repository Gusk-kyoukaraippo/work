#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MVP_DIR = path.resolve(HERE, '..');
const HTML_PATH = path.join(MVP_DIR, 'bed-control.html');

let failures = 0;
let passes = 0;

function check(name, work) {
  try {
    work();
    passes += 1;
    console.log(`ok ${passes + failures} - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok ${passes + failures} - ${name}`);
    console.error(`  ${error.message}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function attrValues(source, attribute) {
  const pattern = new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, 'gis');
  return [...source.matchAll(pattern)].map(match => match[2]);
}

function assertFunctions(source, names, groupName) {
  const missing = names.filter(name => {
    const declarations = [
      new RegExp(`\\bfunction\\s+${name}\\s*\\(`),
      new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)`)
    ];
    return !declarations.some(pattern => pattern.test(source));
  });
  expect(!missing.length, `${groupName}の関数がありません: ${missing.join(', ')}`);
}

function assertArray(object, property, context) {
  expect(Array.isArray(object[property]), `${context}.${property} は配列である必要があります`);
}

function assertUniqueIds(items, keys, context) {
  const values = items.map(item => keys.map(key => item?.[key]).find(value => value !== undefined && value !== null && value !== ''));
  const missingAt = values.findIndex(value => value === undefined);
  expect(missingAt < 0, `${context}[${missingAt}] にID (${keys.join(' / ')}) がありません`);
  const duplicates = duplicateValues(values);
  expect(!duplicates.length, `${context} のIDが重複しています: ${duplicates.join(', ')}`);
  return new Set(values);
}

function assertPatientReferences(items, patientIds, context) {
  const missing = [];
  items.forEach((item, index) => {
    if (!item?.patientId || !patientIds.has(item.patientId)) missing.push(`${index}:${item?.patientId ?? '(なし)'}`);
  });
  expect(!missing.length, `${context} に不明な patientId があります: ${missing.slice(0, 8).join(', ')}`);
}

function validDateTime(value) {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(new Date(value).getTime());
}

expect(fs.existsSync(HTML_PATH), `HTMLが見つかりません: ${HTML_PATH}`);
const html = fs.readFileSync(HTML_PATH, 'utf8');
const scriptMatches = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
const scripts = scriptMatches.map(match => match[1]);
const javascript = scripts.join('\n');
const markup = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
const staticIds = attrValues(markup, 'id');
// innerHTML のテンプレートで後から生成されるIDも、参照整合性の対象に含める。
const declaredIds = new Set(attrValues(html, 'id'));

check('HTML埋込JavaScriptが構文解析できる', () => {
  expect(scripts.length > 0, 'インラインscriptがありません');
  scripts.forEach((source, index) => new vm.Script(source, { filename: `bed-control.inline-${index + 1}.js` }));
});

check('外部スクリプト・外部通信へ依存しない', () => {
  expect(!/<script\b[^>]*\bsrc\s*=/i.test(html), '外部script参照があります');
  expect(!/<link\b[^>]*\bhref\s*=\s*(["'])https?:\/\//i.test(html), '外部stylesheet参照があります');
  const networkApis = ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'EventSource('];
  const used = networkApis.filter(token => javascript.includes(token));
  expect(!used.length, `外部通信APIを使用しています: ${used.join(', ')}`);
});

check('静的DOM IDが重複していない', () => {
  const duplicates = duplicateValues(staticIds);
  expect(!duplicates.length, `重複ID: ${duplicates.join(', ')}`);
});

check('JavaScriptから参照するDOM IDが宣言されている', () => {
  const referenced = uniqueValues([
    ...[...javascript.matchAll(/\$\(\s*(["'])([^"']+)\1\s*\)/g)].map(match => match[2]),
    ...[...javascript.matchAll(/getElementById\(\s*(["'])([^"']+)\1\s*\)/g)].map(match => match[2])
  ]);
  const missing = referenced.filter(id => !declaredIds.has(id));
  expect(!missing.length, `未宣言のDOM ID参照: ${missing.join(', ')}`);
});

check('label・タブの参照先が存在する', () => {
  const references = [
    ...attrValues(markup, 'for'),
    ...attrValues(markup, 'aria-controls'),
    ...attrValues(markup, 'aria-labelledby'),
    ...attrValues(markup, 'data-close')
  ].flatMap(value => value.trim().split(/\s+/)).filter(Boolean);
  const missing = uniqueValues(references).filter(id => !staticIds.includes(id));
  expect(!missing.length, `DOM参照先がありません: ${missing.join(', ')}`);
});

check('MVP3の主要画面・操作DOMを維持している', () => {
  const required = [
    'boardTab', 'consultationTab', 'boardPanel', 'consultationPanel',
    'boardToolbar', 'summary', 'board', 'boardScroll',
    'pendingCard', 'pendingList', 'regularCard', 'regularList',
    'newAdmissionBtn', 'temporarySaveBtn', 'temporaryLoadBtn', 'jsonLoadBtn', 'jsonFileInput', 'undoBtn',
    'admissionDialog', 'admissionForm', 'transferDialog', 'transferForm', 'dayDialog',
    'consultationForm', 'consultResultsCard', 'consultResults',
    'roomTransferExamplesDialog', 'consultRegistrationDialog', 'consultRegistrationForm'
  ];
  const missing = required.filter(id => !staticIds.includes(id));
  expect(!missing.length, `MVP3のDOM IDが欠落しています: ${missing.join(', ')}`);
});

check('難病患者台帳の主要DOMを備えている', () => {
  const required = [
    'registryTab', 'registryPanel', 'registrySearch',
    'registryDiseaseFilter', 'registryUsageFilter', 'registryAdmissionPatternFilter', 'registrySuitabilityFilter',
    'registryRows', 'registryResultMeta', 'registryPrevPage', 'registryNextPage',
    'registryPatientDialog', 'registryPatientDetail', 'registryToConsultationBtn'
  ];
  const missing = required.filter(id => !staticIds.includes(id));
  expect(!missing.length, `台帳のDOM IDが欠落しています: ${missing.join(', ')}`);
});

check('キーボード操作が3タブを対象にしている', () => {
  const anchor = "document.querySelector('.mode-tabs').addEventListener('keydown'";
  const start = javascript.indexOf(anchor);
  expect(start >= 0, 'タブのkeydownハンドラーがありません');
  const handler = javascript.slice(start, start + 1200);
  expect(handler.includes('registry'), '左右キーのタブ移動がboard/consultationの2択のままです');
});

check('MVP3の主要ロジック関数を維持している', () => {
  assertFunctions(javascript, [
    'activateTab', 'normalizeData', 'saveWorkingData', 'loadJsonFile', 'commit', 'undo',
    'validationFor', 'renderAll', 'renderBoard', 'renderPending', 'renderRegular',
    'saveAdmission', 'placeAdmission', 'saveTransfer',
    'renderConsultationSetup', 'performConsultationSearch', 'saveConsultRegistration'
  ], 'MVP3');
});

check('難病患者台帳の主要ロジック関数を備えている', () => {
  assertFunctions(javascript, ['renderRegistry', 'openRegistryPatient', 'jumpFromRegistryToConsultation'], '台帳');
});

check('外来のみ患者を台帳から新規登録できる入口を備えている', () => {
  const requiredIds = ['registryNewPatientBtn', 'registryNewPatientDialog', 'registryNewPatientForm'];
  const missingIds = requiredIds.filter(id => !staticIds.includes(id));
  expect(!missingIds.length, `台帳患者追加のDOM IDが欠落しています: ${missingIds.join(', ')}`);
  assertFunctions(javascript, ['openNewRegistryPatient', 'saveNewRegistryPatient'], '台帳患者追加');
});

check('台帳から日程調整へ進む際に性別未確認を空欄へ戻す', () => {
  const match = javascript.match(/function\s+jumpFromRegistryToConsultation\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*function\s+/);
  expect(match, 'jumpFromRegistryToConsultation の実装範囲を取得できません');
  const source = match[1];
  expect(/\$\(\s*['"]consultSex['"]\s*\)\.value\s*=\s*validSex\(\s*patient\.sex\s*\)\s*\?\s*patient\.sex\s*:\s*['"]{2}/.test(source),
    '性別が男性・女性以外のとき consultSex を空文字へ戻す実装がありません');
});

check('空床候補を本日外来実績・疾患確認済み・病棟適応ありに限定する', () => {
  expect(/todayOutpatientCompleted\s*=\s*events\.some\(event=>event\.serviceId===['"]outpatient['"]&&event\.status===['"]completed['"]/.test(javascript),
    '本日の外来「実績」を判定する todayOutpatientCompleted がありません');
  const vacancyGuard = /if\(registryVacancyMode\)\s*\{([\s\S]*?)\n\s*\}/.exec(javascript)?.[1] || '';
  const missing = [
    ['本日外来実績', /view\.todayOutpatientCompleted/],
    ['疾患確認済み', /view\.diseaseState\s*!==\s*['"]confirmed['"]/],
    ['病棟適応あり', /view\.profile\.wardSuitability\s*!==\s*['"]eligible['"]/]
  ].filter(([, pattern]) => !pattern.test(vacancyGuard)).map(([label]) => label);
  expect(!missing.length, `空床候補の必須条件がありません: ${missing.join(', ')}`);
});

check('動的な疾患・サービス編集欄にaria-labelがある', () => {
  const controls = [
    'data-disease-category', 'data-disease-original', 'data-disease-status',
    'data-service-id', 'data-service-status', 'data-service-organization',
    'data-service-frequency', 'data-service-department'
  ];
  const missing = controls.filter(attribute => !new RegExp(`${attribute}\\b[^>]*\\baria-label\\s*=`, 'i').test(javascript));
  expect(!missing.length, `aria-labelのない動的編集欄: ${missing.join(', ')}`);
  const removeLabels = [...javascript.matchAll(/data-remove-row\b[^>]*\baria-label\s*=\s*(["'])(.*?)\1/g)].map(match => match[2]);
  expect(removeLabels.some(label => label.includes('疾患')) && removeLabels.some(label => label.includes('サービス')),
    '疾患・サービス行の削除ボタンに用途別aria-labelがありません');
});

check('schema v5と新規コレクションをHTML側で初期化する', () => {
  expect(/\bschemaVersion\s*:\s*5\b/.test(javascript), 'initialData に schemaVersion: 5 がありません');
  const arrays = [
    'patientDiseases', 'serviceCatalog', 'patientServiceRelations',
    'serviceEvents', 'admissionProfiles', 'coordinationRecords'
  ];
  const missing = arrays.filter(name => !new RegExp(`\\b${name}\\s*:`).test(javascript));
  expect(!missing.length, `HTML側のv5コレクション初期化がありません: ${missing.join(', ')}`);
});

check('院内8疾患区分を表示可能である', () => {
  const categories = [
    'パーキンソン病', '多系統萎縮症', '進行性核上性麻痺', '脊髄小脳変性症',
    '筋萎縮性側索硬化症', 'CJD', 'その他（神経）', 'その他（神経以外）'
  ];
  const missing = categories.filter(category => !html.includes(category));
  expect(!missing.length, `疾患区分がありません: ${missing.join(', ')}`);
});

const jsonFiles = fs.readdirSync(MVP_DIR)
  .filter(name => /^bed-control.*\.json$/i.test(name))
  .sort()
  .map(name => path.join(MVP_DIR, name));

check('検証対象のサンプルJSONが存在する', () => {
  expect(jsonFiles.length > 0, 'bed-control*.json がありません');
});

for (const jsonPath of jsonFiles) {
  const fileName = path.basename(jsonPath);
  let sample;

  check(`${fileName}: JSONとして読み込める`, () => {
    sample = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(sample && typeof sample === 'object' && !Array.isArray(sample), 'ルートがオブジェクトではありません');
  });

  if (!sample) continue;

  check(`${fileName}: schema v5の必須配列を備えている`, () => {
    expect(sample.schemaVersion === 5, `schemaVersion は5である必要があります（実値: ${sample.schemaVersion}）`);
    [
      'patients', 'admissions', 'assignments',
      'patientDiseases', 'serviceCatalog', 'patientServiceRelations',
      'serviceEvents', 'admissionProfiles', 'coordinationRecords'
    ].forEach(property => assertArray(sample, property, fileName));
  });

  check(`${fileName}: 患者・入院・病床割当のIDと参照が整合する`, () => {
    const patientIds = assertUniqueIds(sample.patients, ['patientId'], 'patients');
    const admissionIds = assertUniqueIds(sample.admissions, ['admissionId'], 'admissions');
    assertUniqueIds(sample.assignments, ['assignmentId'], 'assignments');
    assertPatientReferences(sample.admissions, patientIds, 'admissions');

    const badAssignments = [];
    sample.assignments.forEach((assignment, index) => {
      if (!admissionIds.has(assignment.admissionId)) badAssignments.push(`${index}:admissionId=${assignment.admissionId ?? '(なし)'}`);
      if (assignment.bedId && Array.isArray(sample.beds) && !sample.beds.some(bed => bed.bedId === assignment.bedId)) {
        badAssignments.push(`${index}:bedId=${assignment.bedId}`);
      }
      if (!validDateTime(assignment.fromAt) || !validDateTime(assignment.toAt) || new Date(assignment.fromAt) >= new Date(assignment.toAt)) {
        badAssignments.push(`${index}:期間不正`);
      }
    });
    expect(!badAssignments.length, `病床割当の不整合: ${badAssignments.slice(0, 10).join(', ')}`);
  });

  check(`${fileName}: CPが空欄・重複になっていない`, () => {
    const cps = sample.patients.map(patient => String(patient.cp ?? '').trim());
    const emptyCount = cps.filter(cp => !cp).length;
    const duplicates = duplicateValues(cps.filter(Boolean));
    expect(emptyCount === 0, `CP空欄が${emptyCount}件あります`);
    expect(!duplicates.length, `CPが重複しています: ${duplicates.slice(0, 10).join(', ')}`);
  });

  check(`${fileName}: 入院期間が妥当である`, () => {
    const invalid = [];
    sample.admissions.forEach((admission, index) => {
      if (!validDateTime(admission.plannedAdmissionAt) || !validDateTime(admission.plannedDischargeAt) ||
          new Date(admission.plannedAdmissionAt) >= new Date(admission.plannedDischargeAt)) invalid.push(index);
    });
    expect(!invalid.length, `入院期間が不正な行: ${invalid.slice(0, 10).join(', ')}`);
  });

  check(`${fileName}: 台帳コレクションの患者参照が整合する`, () => {
    const patientIds = new Set(sample.patients.map(patient => patient.patientId));
    ['patientDiseases', 'patientServiceRelations', 'serviceEvents', 'admissionProfiles', 'coordinationRecords']
      .forEach(property => assertPatientReferences(sample[property], patientIds, property));
  });

  check(`${fileName}: 台帳コレクション内のIDが一意である`, () => {
    const definitions = [
      ['patientDiseases', ['patientDiseaseId', 'diseaseRecordId']],
      ['serviceCatalog', ['serviceId', 'serviceTypeId']],
      ['patientServiceRelations', ['relationId', 'patientServiceRelationId']],
      ['serviceEvents', ['eventId', 'serviceEventId']],
      ['admissionProfiles', ['profileId', 'admissionProfileId']],
      ['coordinationRecords', ['recordId', 'coordinationRecordId']]
    ];
    definitions.forEach(([property, keys]) => {
      if (sample[property].length) assertUniqueIds(sample[property], keys, property);
    });
  });

  check(`${fileName}: サービス関係のカタログ参照が整合する`, () => {
    const serviceIds = new Set(sample.serviceCatalog.map(service => service.serviceId ?? service.serviceTypeId).filter(Boolean));
    expect(serviceIds.size === sample.serviceCatalog.length, 'serviceCatalog のIDが空欄または重複しています');
    const invalid = [];
    for (const [property, items] of [['patientServiceRelations', sample.patientServiceRelations], ['serviceEvents', sample.serviceEvents]]) {
      items.forEach((item, index) => {
        const serviceId = item.serviceId ?? item.serviceTypeId;
        if (!serviceId || !serviceIds.has(serviceId)) invalid.push(`${property}[${index}]=${serviceId ?? '(なし)'}`);
      });
    }
    expect(!invalid.length, `不明なサービス参照: ${invalid.slice(0, 10).join(', ')}`);
  });

  check(`${fileName}: 現行4利用形態と将来拡張用サービスを保持する`, () => {
    const labels = new Set(sample.serviceCatalog.map(service => service.label));
    const required = ['外来診察', '外来リハ', '入院', 'デイサービス', 'ショートステイ'];
    const missing = required.filter(label => !labels.has(label));
    expect(!missing.length, `serviceCatalog にありません: ${missing.join(', ')}`);
  });

  check(`${fileName}: 任意の入院調整参照が存在する入院だけを指す`, () => {
    const admissionIds = new Set(sample.admissions.map(admission => admission.admissionId));
    const invalid = sample.coordinationRecords
      .map((record, index) => ({ index, admissionId: record.admissionId }))
      .filter(item => item.admissionId && !admissionIds.has(item.admissionId));
    expect(!invalid.length, `coordinationRecords の不明な admissionId: ${invalid.slice(0, 10).map(item => `${item.index}:${item.admissionId}`).join(', ')}`);
  });
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
