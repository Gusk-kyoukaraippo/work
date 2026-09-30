# 共通ブックの保守

MVP6.1には **マクロ入りの共通原本が同梱済み** です。新しいHTMLを組み込む際は、AIが [MVP6th.xlsm](../../workbook/MVP6th.xlsm) のコピーを配布一式へ入れます。

この手順は、VBAを修正したとき、または原本を復元・再作成する必要があるときだけ使います。運用中のブックや保存データに対しては実行しません。

## 更新する順序

相対パスはMVP6.1フォルダを基準にします。

1. 更新前の原本と照合記録を保全します。
2. `vba/utf8` と必要に応じて `vba/ThisWorkbook.txt` を修正します。
3. AIが `python scripts/encode-vba.py` と `python scripts/prepare-mac-manual.py` を実行し、取込用・Mac貼り付け用素材をそろえます。
4. 開発用Excelで原本のコピーへ更新を反映してコンパイルします。Macで操作する場合は [Mac手順](build-workbook-mac.md) を使います。
5. 未初期化の「操作パネル」一枚、`GateShowSetupPanel` による初回設定ボタンを確認し、マクロ有効ブックとして保存します。原本で `InitializeGate` は実行しません。
6. Pythonと `oletools` を使って `python scripts/verify-workbook.py` を実行します。埋め込みコード、余分なモジュール、初期化状態、ボタン割当を検査し、合格したブックに照合記録を発行します。
7. 共通回帰試験とアプリ試験を実行し、[対象環境での検収](target-tests.md) も更新します。

## 原本を新規に組み立てる場合

Macでは、同梱の `workbook/MVP6th-template.xlsx` と `workbook/mac-manual` を使えます。Windows版ExcelとPowerShellが使える開発環境では `scripts/assemble-workbook.ps1` が利用できます。どちらも通常の導入担当者がアプリ追加のたびに行う作業ではありません。

テンプレート自体を作り直す場合に限り、`scripts/build-workbook.mjs` がNode.jsと `@oai/artifact-tool` を使用します。これは準備済みのxlsmを使う工程には不要です。

`MVP6th.build.json` は実ファイルとソースの照合記録です。Windows版JUST Calcでの保存・復旧・二台排他の合格記録とは別です。拡張子の変更や、照合情報の手編集で完成ブックに見せかけないでください。
