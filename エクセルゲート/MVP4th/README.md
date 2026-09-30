# Excelゲート MVP4th

設計書 `../docs/excel-gate-practical-design.md` に沿って、保存画面・JSONの管理情報・起動・正式保存・復旧を共通化したMVPです。対象は **Windows 10 / JUST Calc / Microsoft Edge**、他者が編集中の利用者には**正式保存済みデータの閲覧**を提供します。MVP1〜3は変更していません。

## 使い始める

**初めての方はこちら：[はじめての組み込みと使い方](はじめての組み込みと使い方.md)**。HTMLの準備から、実際の入力・正式保存・終了まで順番に説明しています。

配布ZIP：[進捗ボード](releases/MVP4th-progress-board.zip) / [改善ワークフロー](releases/MVP4th-workflow-studio.zip)。テンプレート・VBA・HTML・導入と復旧の手順を含みます。

1. `dist/progress-board`（進捗ボード）または `dist/workflow-studio`（改善ワークフロー）を、フォルダごと共有場所へ配置します。
2. 同梱の `MVP4th-template.xlsx` に共通VBAを組み込み、`MVP4th.xlsm` として保存します。[導入手順](docs/install.md) に七つのモジュールとブックイベントの組み込み方法を記載しています。
3. [導入手順](docs/install.md) と [実機受け入れ試験](docs/acceptance-test.md) に沿って、JUST Calcで初期化・編集・正式保存・再起動と、二台での排他を確認します。

**マクロ組み込み・実機検収前のMVPです。** この環境で確認したのは、Mac上のChromeによる二つのHTMLアプリのデータ往復・閲覧制御、JSの異常系、VBAの静的契約です。Windows / JUST Calc / Edge、共有フォルダでの二台排他、実際の保存障害からの復旧、対象環境でのVBAコンパイル・実行は未確認です。JUST Calcの版による互換性を保証するものではありません。Mac版Excelで組み込みを試行しましたが、最終修正時に操作ツールがタイムアウトしたため、古いソースを持つ試行ブックは配布から除外しています。

## 構成

| 場所 | 内容 |
| --- | --- |
| `shared` | 保存者名・保存操作・終了案内・再出力を持つ共通JS、使い方、ログ画面 |
| `vba` | 全アプリ共通の7モジュールとブックイベント。直下はCP932、`utf8` は編集元 |
| `apps` | 二つの既存業務アプリとアプリ別の設定 |
| `reference` / `docs/diffs` | 組み込み前の実アプリと、初期化・保存・閲覧制御を含む差分 |
| `workbook/MVP4th-template.xlsx` | 共通マクロを組み込むシートテンプレート |
| `scripts` / `tests` | 再現可能な配布作成、ソース検証、自動テスト、実機の障害試験用マクロ |

[接続契約・改修箇所](docs/adapter-guide.md)、[復旧手順](docs/recovery.md)、[検証記録](docs/verification.md) を参照してください。

## 開発・再配布

Node.js、Python 3を使用します。ブラウザ試験はPlaywrightとChromeまたはChromium版Edgeが必要です。配布先の利用者にはNode.js・Python・Webサーバーは不要です。

```sh
python3 scripts/adapt-references.py
python3 scripts/encode-vba.py
node --test tests/*.test.js
node scripts/package.mjs /path/to/new-output
```

既存出力先への上書きは拒否します。新しい出力先を指定し、利用中の `.xlsm` と `data` をビルドで置き換えないでください。組み込み済みの未初期化共通原本を `workbook/MVP4th.xlsm` として用意できたら、oletoolsを使う `scripts/verify-workbook.py` で照合し、再ビルドすると同梱できます。ソースと原本が一致しない場合は配布を拒否します。原本がない場合は `workbookAssembly: import-required` と記録します。

この作業環境ではPlaywright 1.62.1を使用しました。別の開発環境では対応するPlaywrightを準備し、`CHROME_PATH` にブラウザ実行ファイルを指定します。Excelテンプレートの再生成スクリプトにはCodex付属の `@oai/artifact-tool` が必要です。
