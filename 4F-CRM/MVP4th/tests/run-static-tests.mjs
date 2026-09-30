#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MVP_DIR = path.resolve(HERE, '..');
const HTML_PATH = path.join(MVP_DIR, 'bed-control.html');
const JSON_PATH = path.join(MVP_DIR, 'bed-control-2026-06-01_to_2026-08-31.json');

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

const html = fs.readFileSync(HTML_PATH, 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
const javascript = scripts.join('\n');
const markup = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

check('HTML埋込JavaScriptが構文解析できる', () => {
  expect(scripts.length === 1, `インラインscript数が想定外です: ${scripts.length}`);
  scripts.forEach((source, index) => new vm.Script(source, { filename: `bed-control.inline-${index + 1}.js` }));
});

check('外部スクリプト・外部通信へ依存しない', () => {
  expect(!/<script\b[^>]*\bsrc\s*=/i.test(html), '外部script参照があります');
  expect(!/<link\b[^>]*\bhref\s*=\s*(["'])https?:\/\//i.test(html), '外部stylesheet参照があります');
  const used = ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'EventSource('].filter(token => javascript.includes(token));
  expect(!used.length, `外部通信APIを使用しています: ${used.join(', ')}`);
});

check('Edge 92より新しいAPIへ依存しない', () => {
  const unsupported = [
    ['structuredClone', /\bstructuredClone\s*\(/],
    ['Array.prototype.at', /\.at\s*\(/],
    ['Object.groupBy', /\bObject\.groupBy\b/],
    ['String.prototype.replaceAll', /\.replaceAll\s*\(/],
    ['Promise.any', /\bPromise\.any\s*\(/]
  ].filter(([, pattern]) => pattern.test(javascript)).map(([name]) => name);
  expect(!unsupported.length, `未対応APIを使用しています: ${unsupported.join(', ')}`);
  expect(/const\s+cloneData\s*=\s*value\s*=>\s*JSON\.parse\(JSON\.stringify\(value\)\)/.test(javascript), 'Edge 92互換のデータ複製処理がありません');
});

check('静的DOM IDが重複していない', () => {
  const duplicates = duplicateValues(attrValues(markup, 'id'));
  expect(!duplicates.length, `重複ID: ${duplicates.join(', ')}`);
});

check('JavaScriptから参照する固定DOM IDが宣言されている', () => {
  const declared = new Set(attrValues(html, 'id'));
  const referenced = [...new Set([
    ...[...javascript.matchAll(/\$\(\s*(["'])([^"']+)\1\s*\)/g)].map(match => match[2]),
    ...[...javascript.matchAll(/getElementById\(\s*(["'])([^"']+)\1\s*\)/g)].map(match => match[2])
  ])];
  const missing = referenced.filter(id => !declared.has(id));
  expect(!missing.length, `未宣言のDOM ID参照: ${missing.join(', ')}`);
});

check('Edge 92対応版のアプリバージョンである', () => {
  expect(/const\s+APP_VERSION\s*=\s*['"]0\.7\.10-mvp4-edge92['"]/.test(javascript), 'APP_VERSIONがEdge 92対応版ではありません');
});

check('サンプルJSONの主要参照が整合している', () => {
  const sample = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const patientIds = new Set(sample.patients.map(patient => patient.patientId));
  const admissionIds = new Set(sample.admissions.map(admission => admission.admissionId));
  const bedIds = new Set(sample.beds.map(bed => bed.bedId));
  expect(!duplicateValues(sample.patients.map(patient => patient.patientId)).length, 'patientIdが重複しています');
  expect(!duplicateValues(sample.admissions.map(admission => admission.admissionId)).length, 'admissionIdが重複しています');
  expect(!duplicateValues(sample.assignments.map(assignment => assignment.assignmentId)).length, 'assignmentIdが重複しています');
  expect(sample.admissions.every(admission => patientIds.has(admission.patientId)), '不明なpatientIdを持つ入院があります');
  expect(sample.assignments.every(assignment => admissionIds.has(assignment.admissionId)), '不明なadmissionIdを持つ病床割当があります');
  expect(sample.assignments.every(assignment => bedIds.has(assignment.bedId)), '不明なbedIdを持つ病床割当があります');
});

console.log(`1..${passes + failures}`);
if (failures) process.exitCode = 1;
