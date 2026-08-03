# PP-OCRv6 small single-file offline PoC

> 実験資料です。現時点では最終構成での認識成功・日本語精度を確認できておらず、
> ScanScribeの配布版には含めません。通常利用にはルートにある4種類の`ScanScribe-*.html`を
> 使用してください。

`@paddleocr/paddleocr-js@0.4.2` の公式Worker、ONNX Runtime Web 1.22.0、
PP-OCRv6 small検出・認識モデルを一つのHTMLへ固定し、`file://` で動かす検証です。

既存アプリのファイルは参照用fixtureを除いて変更しません。生成物もスクリプトもこのフォルダ内です。

## Build

```sh
npm run build
```

ビルド時だけ公式配布元へ接続し、全4資産のSHA-256を照合します。生成後の `index.html` は
通信せず、隣接ファイルも参照しません。

`index.html` は約78 MiBの再生成可能な実験生成物なので、Gitの対象外です。検証または手動確認の
前に、このフォルダで `npm run build` を実行してください。

## Experimental verification

```sh
npm run verify
```

このコマンドはChromeをheadlessで起動して`file://.../index.html`を開く試験用ですが、現構成では
成功未確認です。手動では`index.html`をChromeで直接開けますが、結果を本番品質とは扱わないでください。

## Architecture note

公式SDKのmain-thread adapterは `file:` を明示的に拒否します。またChromeは `file:` が作った
opaqueなBlob URLをトップレベルmodule workerとして起動することを拒否します。そのため、固定された
公式Worker bundleのSHAを検証後、11箇所の `import.meta.url` を `self.location.href` へ置換して
classic Blob workerとして起動し、同SDKの公開ソースに定義されたtransport protocolへ
直接 `init` / `predict` を送ります。モデルtarとORT WASMはBase64から分割デコードしてBlob URL化し、
Worker内の `fetch` は `blob:` だけ許可します。

同梱OpenCV.jsのembindが `new Function(...)` を使うため、CSPには `unsafe-eval` が必要です。
外部通信は `connect-src blob:` とWorker内のprotocol検査で別途遮断します。

これは固定版PoCであり、SDKの内部transportへ依存します。SDK更新時にはWorkerファイル名、transport、
ORT WASM名・初期化方法を再検証してください。
