# 共通ブックの保守

MVP9thでは **内部版0.9.0のマクロ入り共通原本** を使います。新しいHTMLを組み込む際は、AIが [MVP9th.xlsm](../../workbook/MVP9th.xlsm) から専用生成処理でアプリ名・保存済み表示を設定して配布一式へ入れます。

この手順は、VBAを修正したとき、または原本を復元・再作成する必要があるときだけ使います。運用中のブックや保存データに対しては実行しません。

## 更新する順序

相対パスはMVP9thフォルダを基準にします。

1. 更新前の原本と照合記録を保全します。
2. `vba/utf8` と必要に応じて `vba/ThisWorkbook.txt` を修正します。
3. AIが `python scripts/encode-vba.py` と `python scripts/prepare-mac-manual.py` を実行し、取込用・Mac貼り付け用素材をそろえます。
4. 開発用Excelで原本のコピーへ、`GateSources` を含む9個の標準モジュールと `ThisWorkbook` のイベントを反映し、VBEの「デバッグ」からプロジェクト全体をコンパイルします。Macで操作する場合は [Mac手順](build-workbook-mac.md) を使います。
5. 未初期化の「操作パネル」一枚、`GateShowSetupPanel` による初回設定ボタンを確認し、マクロ有効ブックとして保存します。原本で `InitializeGate` は実行しません。
6. Pythonと `oletools` を使って `python scripts/verify-workbook.py` を実行します。埋め込みコード、余分なモジュール、初期化状態、ボタン割当を検査し、合格したブックに照合記録を発行します。
7. 共通回帰試験とアプリ試験を実行し、[対象環境での検収](target-tests.md) も更新します。

## 原本を新規に組み立てる場合

Macでは、同梱の `workbook/MVP9th-template.xlsx` と `workbook/mac-manual` を使えます。Windows版ExcelとPowerShell、およびVBAプロジェクトへのプログラムアクセスが既に許可された開発環境では `scripts/assemble-workbook.ps1` が利用できます。スクリプトは9個のモジュールを名前順に読み込み、イベントと初回設定ボタンを組み込み、保存したコードを再照合します。どちらも通常の導入担当者がアプリ追加のたびに行う作業ではありません。

プログラムからVBAプロジェクトへアクセスできない環境では、セキュリティ設定を変更せず、Mac版ExcelのVBEを使う [UIでの組み込み手順](build-workbook-mac.md) を利用できます。UI組み込み中に貼り付け素材を再生成せず、対象ブック・モジュール名・全文の一致を確認します。ソースを追加修正した場合は、素材をそろえ直して該当モジュールを置き換え、保存後に再照合します。

テンプレート自体を作り直す場合に限り、`scripts/build-workbook.mjs` がNode.jsと `@oai/artifact-tool` を使用します。これは準備済みのxlsmを使う工程には不要です。

`MVP9th.build.json` は実ファイルとソースの照合記録です。Windows版JUST CalcでのCSV読込・読取専用起動・共有先接続、従来型の保存・復旧・二台排他の合格記録とは別です。Macでの構文確認や原本の組み立ては、Windows COMを使うCSV読込の実行結果には数えません。拡張子の変更や、照合情報の手編集で完成ブックに見せかけないでください。

原本の変更時はネイティブExcelで組み立て、verify-workbook.pyで埋め込みVBAを照合します。通常の配布時はpersonalize-workbook.pyで表示用XMLだけを変更し、VBAバイト列を保持します。原本と配布ブックのファイル全体のハッシュは異なります。masterSha256・workbookSha256・vbaProjectSha256・changedMembersをworkbook-generation.jsonで確認します。
