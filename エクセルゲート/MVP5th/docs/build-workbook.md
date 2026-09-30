# 完成ブックを作る（Excelゲート本体の開発担当者）

この作業は共通のマクロ組み込み済みブックを用意するため、本体の開発PCで行います。導入担当者はこのブックを使い、別途[HTMLアプリの編集・適合](adapter-guide.md)とアプリごとの検証・配布準備を行います。

## Windows版Excelを使うビルド

1. `scripts/build-workbook.mjs` で `workbook/MVP5th-template.xlsx` を作成します。Node.jsと `@oai/artifact-tool` を使用します。
2. `python3 scripts/encode-vba.py` でUTF-8編集元とCP932取り込み用ソースを同期します。
3. マクロプロジェクトへのアクセスが認められた開発PCで、PowerShellから `./scripts/assemble-workbook.ps1` を実行します。
4. スクリプトが新しいExcelインスタンスで7モジュールとブックイベントを組み込み、初回設定ボタンを作成し、保存・再読込後のソース一致を確認します。
5. `node scripts/package.mjs --mode=candidate ./candidate-output` で実機試験用の配布物を作ります。

スクリプトはマクロのセキュリティ設定を変更しません。VBAプロジェクトへアクセスできない開発PCでは、組織の管理者にビルド方法を確認します。
開いている業務ブックには接続しません。作成する原本は未初期化で、共有場所や業務データを登録しません。
既存の生成原本は日時付きで保管してから更新します。

## Mac版Excel等で組み立てた原本

共通7モジュールとThisWorkbookを組み込み、`GateShowSetupPanel` を実行して **MVP5th.xlsm** として保存します。`InitializeGate` は実行しません。
原本を閉じて `python scripts/verify-workbook.py` で埋め込みソース・初回設定ボタンを照合します。この検証にはoletoolsが必要です。
原本の構造検証やMac上の実行は、Windows／JUST Calcの検収とは別です。

## 通常配布

実機試験の結果を `verification/target-acceptance.json` に記録してから、`node scripts/package.mjs ./release-output` を実行します。
完成原本・ソース・配布ファイル・実機試験のハッシュが一致しなければ配布を拒否します。
ソースや配布内容を変更した場合は、原本の再作成と該当する実機試験が必要です。

開発用テンプレートには動くマクロはありません。`.xlsx` の拡張子を変更して完成品として扱わないでください。
