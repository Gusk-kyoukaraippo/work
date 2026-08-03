# ScanScribe Image

Windows Snipping Toolで四角く切り取ったスクリーンショットを、そのまま文字起こしする
完全オフライン版です。配布用の `ScanScribe-Image.html` はOCRエンジン、WASM、
日本語・英語モデル、画面コードをすべて内包し、`file://` で直接開けます。
既定配布は高精度モデル版です。

## 使い方

1. `ScanScribe-Image.html` をMicrosoft EdgeまたはGoogle Chromeで開きます。
2. Windowsで `Win + Shift + S` を押し、読みたい箇所を四角く切り取ります。
3. HTML画面へ戻り、入力欄付近で `Ctrl + V` を押します。
4. 既定では貼り付け後にOCRが自動で始まります。結果を確認し、必要なら修正します。
5. 続けて別の範囲を切り取り、`Ctrl + V` を押すと結果の末尾へ追加されます。

クリップボードを直接読むボタンはブラウザ権限によって使えない場合があります。
その場合も、ユーザー操作による `Ctrl + V` の貼り付け経路は利用できます。
保存済み画像の選択とドラッグ＆ドロップにも対応しています。

## 対応画像と上限

- PNG（Snipping Toolの推奨形式）
- JPEG
- 静止画WebP
- 1枚40MB以下
- 一辺12,000px以下
- 2,000万画素以下

SVG、GIF、HEIC、TIFF、アニメーションWebPには対応していません。MIMEタイプや
拡張子だけに頼らず、PNG/JPEG/WebPのシグネチャとヘッダー寸法をデコード前に確認します。
透明画像は白背景へ合成し、OCRは縮小プレビューではなく保持した原寸画像から実行します。

## オフラインとデータの扱い

- `connect-src 'none'` のCSPと実行時ガードで通信APIを遮断します。
- OCR workerもネットワーク、動的スクリプト、子workerを利用できません。
- 画像、ファイル名、認識結果、辞書を送信しません。
- Local Storage、Session Storage、IndexedDB、File System Access APIを使いません。
- データはページを閉じると消えます。必要な結果はTXTまたはJSONで保存してください。

## 開発・検査

Node.js 20以降で、`image-ocr` フォルダから実行します。

```sh
npm test
```

個別に実行する場合:

```sh
npm run check:static
npm run test:shared
npm run smoke:precision
npm run build
npm run check:single
```

`npm run build` が配布用の `ScanScribe-Image.html` を生成します。生成版には外部の
script/style参照がなく、埋め込んだ各script/styleのSHA-256だけをCSPで許可します。
開発用ソースとビルド処理は隣の `PDF-OCR_開発用` にある共有core、テスト、
`vendor`、`vendor-precision`を参照します。配布用の生成HTMLだけは単独で動作します。

## Windows実機での最終確認

ブラウザ自動テストではOSのSnipping Toolが作るクリップボード形式を完全には再現できません。
配布前にWindowsで次を1回確認してください。

```text
Win + Shift + S → 矩形を切り取る → HTMLへ戻る → Ctrl + V → OCR結果を確認
```
