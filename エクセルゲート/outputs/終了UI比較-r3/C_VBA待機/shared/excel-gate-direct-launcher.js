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
  function matchesReceipt(receipt, expected) {
    return !!receipt && receipt.state === 'ready' &&
      ['token','databaseId','sessionId','dataType','schemaVersion','baseRevision','saveDataId','exportSequence'].every(key => receipt[key] === expected[key]);
  }
  function start(config, options = {}) {
    const win = options.window || root, doc = win.document, status = doc.getElementById('launch-status'), frame = doc.getElementById('app-frame');
    let port, challenge, sent = false, ready = false, failed = false, loads = 0, phase = 'loading';
    const token = config.token;
    const handoff = config.handoff;
    let expected, pollTimer, polling = false, stopped = false;
    function send(type, extra) { port?.postMessage({ type, token, challenge, ...extra }); }
    function stopPolling() { stopped = true; win.clearTimeout(pollTimer); }
    function poll() {
      if (stopped || failed || polling || !expected) return;
      polling = true;
      // A classic local script works on file:// without fetch permissions or a server.
      // VBA publishes it by renaming a fully written temporary file.
      const script = doc.createElement('script');
      let settled = false;
      delete win.__EXCEL_GATE_HANDOFF__;
      function next() {
        if (settled) return;
        settled = true;
        polling = false; script.remove();
        if (!stopped) pollTimer = win.setTimeout(poll, options.pollMs || 1000);
      }
      const loadTimeout = win.setTimeout(next, 5000);
      function finished() { win.clearTimeout(loadTimeout); next(); }
      script.onload = () => {
        if (settled || stopped) return;
        const receipt = win.__EXCEL_GATE_HANDOFF__;
        if (matchesReceipt(receipt, expected)) {
          phase = 'handoff-ready'; stopPolling(); send('handoff-receipt', { receipt });
        }
        finished();
      };
      script.onerror = finished;
      script.src = fileUrl(handoff.path) + '?poll=' + Date.now();
      doc.head.appendChild(script);
    }
    if (typeof config.context?.displayName === 'string') doc.title = config.context.displayName + ' - Excelゲート';
    function fail(message) {
      failed = true; phase = 'error'; stopPolling(); win.clearTimeout(timer); win.removeEventListener('message', receive); port?.close();
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
          port.postMessage({ type: 'context', token, challenge, context: config.context });
          config.context = null;
        } else if (sent && m.type === 'ready' && !ready) {
          ready = true; win.clearTimeout(timer); frame.hidden = false; status.hidden = true;
          frame.removeAttribute('aria-busy'); port.postMessage({ type: 'shown', token, challenge });
        } else if (sent && m.type === 'state' && ['loading','editing','view','exporting','exported','error'].includes(m.phase)) {
          if (phase !== 'handoff-ready') phase = m.phase === 'exported' && handoff ? 'handoff-waiting' : m.phase;
        } else if (sent && ready && m.type === 'handoff-begin' && handoff &&
                   typeof m.saveDataId === 'string' && m.saveDataId.length >= 8 && Number.isInteger(m.exportSequence) && m.exportSequence > 0) {
          expected = { token, databaseId: handoff.databaseId, sessionId: handoff.sessionId,
            dataType: handoff.dataType, schemaVersion: handoff.schemaVersion, baseRevision: handoff.baseRevision,
            saveDataId: m.saveDataId, exportSequence: m.exportSequence };
          phase = 'handoff-waiting'; stopped = false; win.clearTimeout(pollTimer); poll();
        } else if (sent && ready && m.type === 'close-work-tab' && ['handoff-ready','view','error'].includes(phase)) {
          // The child iframe cannot close the top-level tab itself.
          win.close();
        } else if (sent && m.type === 'application-error') {
          phase = 'error'; stopPolling(); win.clearTimeout(timer); frame.hidden = false;
          status.textContent = '起動を停止しました。' + String(m.message || ''); status.hidden = false;
        }
      };
      port.start();
      frame.contentWindow.postMessage({ type: 'excel-gate-port', token, challenge }, '*', [channel.port2]);
      win.removeEventListener('message', receive);
    }
    frame.addEventListener('load', () => { if (++loads > 1) fail('画面が移動または再読込されました。'); });
    win.addEventListener('message', receive);
    win.addEventListener('beforeunload', event => { if (['editing','exporting','handoff-waiting'].includes(phase)) { event.preventDefault(); event.returnValue = ''; } });
    win.addEventListener('pagehide', stopPolling);
    try { frame.src = fileUrl(config.entryPath) + '#excel-gate-direct=' + token; }
    catch (error) { fail(error.message); }
    return { stop: fail };
  }
  const api = { start, fileUrl, matchesReceipt };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExcelGateDirectLauncher = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
