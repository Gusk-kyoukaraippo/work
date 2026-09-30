(function (root) {
  'use strict';
  function fileUrl(value) {
    if (typeof value !== 'string' || /[\x00-\x1f]/.test(value)) throw new Error('配置場所を確認できません。');
    const p = value.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(p)) return 'file:///' + p.slice(0, 2) + '/' + p.slice(3).split('/').map(encodeURIComponent).join('/');
    if (p.startsWith('//')) {
      const [host, ...parts] = p.slice(2).split('/');
      if (!/^[a-zA-Z0-9_.-]+$/.test(host) || !parts.length) throw new Error('共有場所の形式を確認できません。');
      return 'file://' + host + '/' + parts.map(encodeURIComponent).join('/');
    }
    if (p.startsWith('/')) return 'file://' + p.split('/').map(encodeURIComponent).join('/');
    throw new Error('絶対パスが必要です。');
  }
  function start(config, options = {}) {
    const win = options.window || root, doc = win.document, status = doc.getElementById('launch-status'), frame = doc.getElementById('app-frame');
    let port, challenge, sent = false, ready = false, failed = false, loads = 0, phase = 'loading';
    const token = config.token;
    if (typeof config.context?.displayName === 'string') doc.title = config.context.displayName + ' - Excelゲート';
    function fail(message) {
      failed = true; phase = 'error'; win.clearTimeout(timer); win.removeEventListener('message', receive); port?.close();
      frame.hidden = true; status.hidden = false; status.textContent = message + ' ブックから開き直してください。';
      config.context = null;
    }
    const timer = win.setTimeout(() => fail('画面の準備が完了しませんでした。'), options.timeoutMs || 15000);
    if (!/^[a-f0-9]{32,128}$/.test(token)) { fail('起動識別子が不正です。'); return; }
    function receive(event) {
      const m = event.data;
      if (failed || port || event.source !== frame.contentWindow || !m || m.type !== 'excel-gate-hello' || m.token !== token || !/^[a-f0-9]{64}$/.test(m.challenge)) return;
      challenge = m.challenge;
      const channel = new win.MessageChannel(); port = channel.port1;
      port.onmessage = event => {
        const m = event.data;
        if (failed || !m || m.token !== token || m.challenge !== challenge) return;
        if (m.type === 'port-ready' && !sent) {
          sent = true;
          // Sensitive context travels only on the acknowledged document's port.
          // A subsequent navigation cannot receive it on the same WindowProxy.
          port.postMessage({ type: 'context', token, challenge, context: config.context, timing: win.__EXCEL_GATE_TIMING__ || null });
          config.context = null;
        } else if (sent && m.type === 'ready' && !ready) {
          ready = true; win.clearTimeout(timer); frame.hidden = false; status.hidden = true;
          frame.removeAttribute('aria-busy'); port.postMessage({ type: 'shown', token, challenge });
        } else if (sent && m.type === 'state' && ['loading','editing','view','exporting','exported','error'].includes(m.phase)) {
          phase = m.phase;
        } else if (sent && m.type === 'application-error') {
          phase = 'error'; win.clearTimeout(timer); frame.hidden = false;
          status.textContent = '起動を停止しました。' + String(m.message || ''); status.hidden = false;
        }
      };
      port.start();
      frame.contentWindow.postMessage({ type: 'excel-gate-port', token, challenge }, '*', [channel.port2]);
      win.removeEventListener('message', receive);
    }
    frame.addEventListener('load', () => { if (++loads > 1) fail('画面が移動または再読込されました。'); });
    win.addEventListener('message', receive);
    win.addEventListener('beforeunload', event => { if (phase === 'editing' || phase === 'exporting') { event.preventDefault(); event.returnValue = ''; } });
    try { frame.src = fileUrl(config.entryPath) + '#excel-gate-direct=' + token; }
    catch (error) { fail(error.message); }
    return { stop: fail };
  }
  const api = { start, fileUrl };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExcelGateDirectLauncher = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
