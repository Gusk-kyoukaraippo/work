import crypto from 'node:crypto';

export const DEFAULT_ACCENT = '#1769AA';
export const WORKBOOK_CREDIT = 'DX推進委員会 Excelゲート';
export function displayName(value) {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f]/.test(value) || [...value].length > 256) throw new Error('アプリ名は空欄・制御文字を含まない256文字以内で指定してください。');
  return value.trim().normalize('NFC');
}
export function accentColor(value = DEFAULT_ACCENT) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('accentColor must be #RRGGBB');
  return value.toUpperCase();
}
export function workbookFileName(value) {
  const name = displayName(value);
  let stem = name.replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/g, '');
  if (!stem || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) stem = '_' + (stem || 'アプリ');
  // Leave room for paths; retain a stable suffix when shortening would collide.
  if (stem.length > 100) {
    let prefix = '';
    for (const c of stem) { if (prefix.length+c.length>85) break; prefix+=c; }
    stem = prefix + '-' + crypto.createHash('sha256').update(name).digest('hex').slice(0,10);
  }
  return stem + '.xlsm';
}
export function presentation(config) {
  const name = displayName(config.displayName);
  return { displayName: name, accentColor: accentColor(config.accentColor), workbookFileName: workbookFileName(name), workbookCredit: WORKBOOK_CREDIT };
}

export function markdownText(value) { return value.replace(/[\\`*_[\]<>]/g, c => "\\" + c); }
