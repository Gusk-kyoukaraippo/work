# 保守担当者向け：対象環境での試験と記録

組み込み者には業務操作と実機確認だけを案内します。この文書のファイル編集・記録・コマンドはAIが担当します。実際に観測した結果と本人が報告した結果を区別し、未確認を合格にしません。

## 1. ブック保存型の試験

既存のブック保存型では次の三段階を使います。設定で `dataSource` を省略したアプリもブック保存型です。

### 共通本体（共通版と対象環境ごと）

完成xlsmと共通JSに対し、初回設定、途中保存、二台排他・交代、保存種別の不一致、未着・重複・別作業・分岐、通信断、再起動復旧、終了失敗、他ブックを変更しないことを確認します。

`verification/engine-report.example.json` に実測の版・二台の識別名・結果をAIが記入し、evidence.mjsで記録します。同じ本体・対象版の記録をアプリ追加時に再利用できます。

### アプリ（適合済みHTMLごと）

既存画面と業務JSON、データ往復、初回・保存済み空データ、遅延復元、未確定入力、非同期読込、外部更新、閲覧と検索、終了後の更新禁止を確認します。

まずintegrate.mjs verifyでブラウザ試験を行います。これはWindows／JUST Calc実測とは別です。実機結果は `verification/app-report.example.json` を元に記録します。本体とアプリの対象版・ファイルが一致して合格した後だけ「配布可能」になります。

### 導入先（配置後）

初回設定、保存・再読込、閲覧と検索、二台排他と交代を確認します。実際の共有場所と両PCのWindows／JUST Calc／Edgeの版を記録します。

`verification/site-report.example.json` を元に、AIが利用中フォルダへ確認記録だけを追加します。配布原本の識別情報で照合するため、初期化や保存で変わる運用ブックのハッシュを固定値として使いません。

## 2. CSVフォルダ閲覧型の試験

`dataSource: "csvFolder"` のアプリは、CSV取得と閲覧に対応する専用の項目を使います。報告にも `dataSource: "csvFolder"` を残します。ブック保存型の本体記録を流用してCSV機能の合格にすることはできません。同じ本体・対象ソフトウェア・読込方式なら、本体記録を別のCSVアプリへ再利用できます。

初めに `integrate.mjs verify` でブラウザ試験を実行し、その後に下記を実際のWindows／JUST Calc／Edgeで確認します。ブラウザの起動情報差し込み試験は、共有フォルダ取得やJUST Calcマクロ実行の実測には数えません。

### 共通本体：csv-engine-report.example.json

| キー | 合格を記録できる実測結果 |
|---|---|
| `setup` | 配布コピーで初回設定し、登録内容がブックの再起動後も残る。 |
| `csvFolderSetup` | UNCを登録・管理画面から変更でき、日常起動でフォルダ選択を要求しない。 |
| `localFolderSetup` | ローカル絶対パス・割り当て済みドライブ・引用符付きコピー・末尾区切りを登録しCSVを読める。相対パスと存在しない場所を停止する。 |
| `directChildrenOnly` | 登録フォルダ直下のCSVだけを取得し、サブフォルダのCSVや他形式を取得しない。 |
| `binaryEncoding` | UTF-8／BOM付きUTF-8／Shift_JISの日本語CSVがバイトを変えずに届く。 |
| `changedDuringRead` | 読込中のCSVの追加・削除・更新を検出して停止し、部分的な集計を開かない。 |
| `permissionFailure` | 読取権限不足を原因付きで表示して停止する。 |
| `networkFailure` | 共有先への接続失敗を原因付きで表示し、過去の画面・デモへ代替しない。 |
| `sourceLimits` | 最大1,000件・合計50MiBを守り、超過時に停止する。 |
| `readOnlyWorkbook` | 読み取り専用で開いたブックからCSV表示ができ、保存や編集セッションを要求しない。 |
| `twoPcReadOnly` | 異なる二台から同じ共有CSVを閲覧でき、不要な排他やフォルダ選択が発生しない。 |
| `refresh` | 元CSVを更新し、ブックの「最新CSVで開く」で新しい値と読込日時が表示される。 |
| `otherWorkbookUnchanged` | 元CSV・業務データ・他の開いているブックを変更しない。 |

### アプリ：csv-app-report.example.json

| キー | 合格を記録できる実測結果 |
|---|---|
| `firstRun` | 初回起動でも登録CSVを表示でき、ブック保存データを要求しない。 |
| `emptyData` | 空フォルダを「データなし」と表示する。 |
| `asyncRead` | 非同期の解析・描画が完了してから閲覧可能になり、失敗時は停止する。 |
| `readOnly` | 保存者名・保存操作がなく、直接の出力呼び出しも拒否される。 |
| `businessScreen` | 元の主要画面と業務上の表示が保持される。 |
| `viewSearch` | 対象月の切替・検索・絞込などの閲覧操作が使える。 |
| `csvEncoding` | 実際に用いるUTF-8／Shift_JISのCSVで文字化けや値の変化がない。 |
| `missingCsv` | 不足する月・病床区分・指標を「データなし」と表示する。 |
| `unsupportedCsv` | 未対応のCSVをファイル名付きで識別できる。 |
| `noDemoFallback` | 欠落・不正なデータをデモ値や過去値で補わない。 |
| `refresh` | 起動し直すとCSV更新が反映される。表示中の自動更新は行わない。 |
| `noBrowserStorage` | 連携時にlocalStorage／IndexedDB等を復元・保存せず、再起動でも過去値を使わない。 |
| `aggregationMatchesOriginal` | 同じ正常CSVを用いた元HTMLと集計値が一致する。 |

### 導入先：csv-site-report.example.json

配置後の実際の共有先で `setup`、`csvFolderSetup`、`readOnlyWorkbook`、`twoPcReadOnly`、`refresh`、`permissionFailure`、`networkFailure` を再確認します。内容は上の共通本体表と同じです。`shareLocation` は配布フォルダのUNC、`csvSourcePath` は試験したCSV読込先の絶対パス（ローカル・割り当て済みドライブ・UNC）です。二つの場所が異なる場合も、それぞれ実際の場所を記録します。

CSVの導入先合格を判定する際は、現在ブックに登録されている読込先を管理画面で確認し、`--csv-source` に渡します。記録済み `csvSourcePath` と一致する必要があり、未指定・無効な形式・異なる読込先では `siteReady: false` になります。ツールは現在の設定をブックから自動取得しません。設定変更後は新しい読込先で導入先試験を行います。

## 3. AIによる記録

```sh
node scripts/evidence.mjs record engine <appName> --report=/path/observed.json
node scripts/evidence.mjs record app <appName> --report=/path/observed.json
node scripts/evidence.mjs record site <appName> --report=/path/observed.json --deployment=/path/deployment
node scripts/evidence.mjs status --deployment=/path/deployment --site=<siteId>
```

CSV型では専用の報告ファイルを使います。`APP` は対象アプリのフォルダ名です。UNCはシェルで変形しないように引用します。

```sh
node scripts/evidence.mjs record engine APP --report=/path/csv-engine-results.json
node scripts/evidence.mjs record app APP --report=/path/csv-app-results.json
node scripts/evidence.mjs record site APP --report=/path/csv-site-results.json --deployment=/path/deployment --csv-source='\\\\server\\share\\CSV'
node scripts/evidence.mjs status --deployment=/path/deployment --site=SITE --csv-source='\\\\server\\share\\CSV'
```

報告テンプレートの `false` は未合格です。未実施の項目を一括で `true` に変更しません。未記入の版・担当者・日時・PCは受理されません。共通本体と導入先の記録には実際の二台、アプリ記録には少なくとも一台が必要です。テンプレートは `verification/csv-engine-report.example.json`、`verification/csv-app-report.example.json`、`verification/csv-site-report.example.json` にあります。

報告には試験者・日時・実測か本人報告か・実際の版・PC・操作結果を含めます。照合情報はツールが付けます。組み込み者にハッシュやJSONを転記させません。両PCの対象版は同一であることを確認し、異なる版の結果を一つの版へ丸めません。

本体変更は本体・アプリ・導入先、アプリ変更はアプリ・導入先の再確認が必要です。説明書だけの変更は動作確認を失効させません。共有場所の移動や対象ソフトウェアの版変更は旧結果を自動適用しません。同じ対象に新しい失敗の報告があれば、以前の合格で覆い隠しません。

## 障害試験

本体開発者は `GATE_TESTING=True` の別試験ブックと `tests/windows/GateFailureTests.bas` で保存・終了失敗を注入し、さらに実際の通信断・再起動を確認します。試験コードを含まない共通原本で通常動作も確認します。注入試験やMacのブラウザ試験をWindows実測の代わりにしません。

複数PCでは実際に同じ版を使った場合だけhomogeneousTargetsをtrueにします。site報告は試験した共有先のUNCをshareLocationに記録し、現在の配布フォルダと対応させます。Macで本人のWindows実測結果を転記する場合はuser-reportedとし、AIがUNCを直接確認したとは表示しません。
