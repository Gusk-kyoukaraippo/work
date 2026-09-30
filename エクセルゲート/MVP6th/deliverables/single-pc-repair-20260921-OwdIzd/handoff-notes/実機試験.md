# 検証の分類と記録

組み込み者には業務操作と実機確認だけを案内します。この文書のファイル編集・記録・コマンドはAIが担当します。実際に観測した結果と本人が報告した結果を区別し、未確認を合格にしません。

## 1. 共通本体（共通版と対象環境ごと）

完成xlsmと共通JSに対し、初回設定、途中保存、二台排他・交代、保存種別の不一致、未着・重複・別作業・分岐、通信断、再起動復旧、終了失敗、他ブックを変更しないことを確認します。

`verification/engine-report.example.json` に実測の版・二台の識別名・結果をAIが記入し、evidence.mjsで記録します。同じ本体・対象版の記録をアプリ追加時に再利用できます。

## 2. アプリ（適合済みHTMLごと）

既存画面と業務JSON、データ往復、初回・保存済み空データ、遅延復元、未確定入力、非同期読込、外部更新、閲覧と検索、終了後の更新禁止を確認します。

まずintegrate.mjs verifyでブラウザ試験を行います。これはWindows／JUST Calc実測とは別です。実機結果は `verification/app-report.example.json` を元に記録します。本体とアプリの対象版・ファイルが一致して合格した後だけ「配布可能」になります。

## 3. 導入先（配置後）

初回設定、保存・再読込、閲覧と検索、二台排他と交代を確認します。実際の共有場所と両PCのWindows／JUST Calc／Edgeの版を記録します。

`verification/site-report.example.json` を元に、AIが利用中フォルダへ確認記録だけを追加します。配布原本の識別情報で照合するため、初期化や保存で変わる運用ブックのハッシュを固定値として使いません。

## AIによる記録

```sh
node scripts/evidence.mjs record engine <appName> --report=/path/observed.json
node scripts/evidence.mjs record app <appName> --report=/path/observed.json
node scripts/evidence.mjs record site <appName> --report=/path/observed.json --deployment=/path/deployment
node scripts/evidence.mjs status --deployment=/path/deployment --site=<siteId>
```

報告には試験者・日時・実測か本人報告か・実際の版・PC・操作結果を含めます。照合情報はツールが付けます。組み込み者にハッシュやJSONを転記させません。両PCの対象版は同一であることを確認し、異なる版の結果を一つの版へ丸めません。

本体変更は本体・アプリ・導入先、アプリ変更はアプリ・導入先の再確認が必要です。説明書だけの変更は動作確認を失効させません。共有場所の移動や対象ソフトウェアの版変更は旧結果を自動適用しません。

## 障害試験

本体開発者は `GATE_TESTING=True` の別試験ブックと `tests/windows/GateFailureTests.bas` で保存・終了失敗を注入し、さらに実際の通信断・再起動を確認します。試験コードを含まない共通原本で通常動作も確認します。注入試験やMacのブラウザ試験をWindows実測の代わりにしません。

複数PCでは実際に同じ版を使った場合だけhomogeneousTargetsをtrueにします。site報告は試験した共有先のUNCをshareLocationに記録し、現在の配布フォルダと対応させます。Macで本人のWindows実測結果を転記する場合はuser-reportedとし、AIがUNCを直接確認したとは表示しません。
