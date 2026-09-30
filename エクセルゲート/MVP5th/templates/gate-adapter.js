/* EXCEL_GATE_ADAPTER_TODO
 * Replace these bodies with the app's own operations, then remove this marker.
 * If the data is in a closure, move connect() into that scope instead.
 * Stop browser persistence/restoration while ExcelGate.isLinked is true.
 */
ExcelGate.connect({
  // ready: the promise covering ALL asynchronous app initialization,
  load: function (payload, info) {
    // info.hasPayload === false means first use. Do not replace saved empty data.
    throw new Error('アプリの読み込み接続を実装してください。');
  },
  exportData: function () {
    // Commit current forms, or throw to keep unconfirmed input on screen.
    // Return business JSON only; do not download or add session metadata here.
    throw new Error('アプリの書き出し接続を実装してください。');
  },
  setReadOnly: function (readOnly) {
    // Block every mutation path, including import, drag/drop and external APIs.
    throw new Error('アプリの閲覧制御を実装してください。');
  }
}).catch(function (error) { console.error(error); });
