/* File-origin bridge: source + per-launch token + per-document challenge + MessagePort. */
(function (win) {
  'use strict';
  const match = /^#excel-gate-direct=([a-f0-9]{32,128})$/.exec(win.location.hash);
  if (!match || win.parent === win) return;
  const token = match[1], bytes = new Uint8Array(32);
  win.crypto.getRandomValues(bytes);
  const challenge = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  let port, settled = false, expired = false, finished = false, resolveShown;
  const shown = new Promise(resolve => { resolveShown = resolve; });
  function send(type, extra) { if (port) port.postMessage({ type, token, challenge, ...extra }); }
  win.ExcelGateDirect = {
    async ready() { if (!finished) { finished = true; send('ready'); } await shown; },
    state(phase) { send('state', { phase }); },
    error(message) { send('application-error', { message: String(message) }); }
  };
  win.__EXCEL_GATE_DIRECT_PENDING__ = new Promise((resolve, reject) => {
    const timer = win.setTimeout(() => { expired = true; cleanup(); port?.close(); reject(new Error('ブックの起動情報を受け取れませんでした。ブックから開き直してください。')); }, 15000);
    function cleanup() { win.clearTimeout(timer); win.removeEventListener('message', receive); }
    function receive(event) {
      const m = event.data;
      if (expired || port || event.source !== win.parent || !m || m.type !== 'excel-gate-port' || m.token !== token || m.challenge !== challenge || event.ports.length !== 1) return;
      port = event.ports[0];
      port.onmessage = e => {
        const data = e.data;
        if (expired || !data || data.token !== token || data.challenge !== challenge) return;
        if (data.type === 'context' && !settled) {
          settled = true; cleanup();
          win.__EXCEL_GATE_CONTEXT__ = data.context;
          resolve(data.context);
        } else if (data.type === 'shown' && settled) resolveShown();
      };
      port.start(); send('port-ready');
    }
    win.addEventListener('message', receive);
    win.parent.postMessage({ type: 'excel-gate-hello', token, challenge }, '*');
  });
})(window);
