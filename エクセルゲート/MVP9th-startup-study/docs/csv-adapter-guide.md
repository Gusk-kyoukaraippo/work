# CSVフォルダ閲覧型の接続

アプリの `gate.config.json` に `dataSource: "csvFolder"`, `viewPolicy: "view"`, `authorRequired: false`, `runtimeVersion: "0.8.0"` を指定します。省略時は従来のworkbook型です。読込先の絶対パスは配布設定へ埋めず、初回設定したブックの管理情報 `csvSourcePath` に保持します。

```js
ExcelGate.connect({
  ready: applicationReady,
  setReadOnly(value) { disableBusinessMutation(value); },
  async loadSourceFiles(files, info) {
    // files: File[]。name, size, lastModified, arrayBuffer()が利用できる。
    // info: sourcePath, readAt, files（元のファイル情報）, readOnly:true。
    await replaceFromCsv(files, info);
  }
}).catch(showStartupError);
```

CSV型は `load` / `exportData` を要求せず、`exportFile` は常に拒否します。検索、対象月・区分切替は閲覧操作として残します。初期化時のデータ反映はsetReadOnlyの影響で止めないでください。

VBAは一時起動先の `excel-gate-source.js` へ `window.__EXCEL_GATE_SOURCE__` を生成します。形式は `{sourcePath, readAt, files:[{name,size,lastModified,base64}]}`。日時はPCのローカルISO形式で、UTCを意味するZは付けません。読込バイト数・ファイル名・Base64は共通JSで検査し、全件検査後にアプリへ渡します。CSV上限は1,000件・元バイト合計50MiB。従来の正式保存JSONの10MiB上限とは別です。

起動順序はboot → source → core →共通JS→業務JSです。CSVを保存用payloadへ混ぜず、localStorage/IndexedDBへ保存しません。CSVはExcelのセルとして開かず、生バイトのまま受け渡します。原CSVの解析と業務上の不足表示はアプリが担当します。

ブックは取得前後の一覧・サイズ・更新時刻の変化で中止します。複数ファイルの出力全体をトランザクションとして固定する仕組みではありません。出力完了後のCSVを取り込む運用で試験します。
