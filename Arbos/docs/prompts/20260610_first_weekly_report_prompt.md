以下をそのままCodexに貼ればよいと思います。
先頭の `AS_OF_DATE` だけ、実際にレポート基準日を変えたい場合は変更してください。

````text
あなたは、老健アルボースの入所率改善・現場負担軽減DXのためのデータ分析エンジニアです。
このリポジトリ `/Users/tama2025mini/work/Arbos` にある実データを使って、まずは「週1回の人力レポート運用」に耐えるMVPを作ってください。

重要：
- いきなりCRMやWebアプリを作らないでください。
- 最初の目的は「週次で、今週重点的にフォローすべき既存利用者リストを出すこと」です。
- 現場の負担軽減が主目的なので、現場に新しい入力作業を増やさない設計にしてください。
- 既存ファイルを破壊・上書きしないでください。新しいスクリプトと新しい出力フォルダを作ってください。
- 個人情報を外部送信しないでください。外部ネットワークアクセスは不要です。
- 実データのスキーマは必ず自分で確認し、列名を決め打ちしすぎないでください。
- 不明点があっても作業を止めず、妥当な仮定を置いて進め、仮定と注意点をレポートに明記してください。

# レポート基準日

AS_OF_DATE = 2026-06-10

ただし、入所者日次データや予定表データの最大日付がAS_OF_DATEより古い場合は、以下を必ず実施してください。

1. データ鮮度を確認する。
2. resident系データの最大日付、day_service系データの最大日付、schedule系データの最大日付をレポート冒頭に表示する。
3. AS_OF_DATE時点の判定に不確実性がある場合は、`data_freshness_warning` として明記する。
4. 退所日が確定していないエピソードを、安易に「退所後xx日」と扱わないこと。

# 既存データ

主に以下を使ってください。

- `/Users/tama2025mini/work/Arbos/data/db/arbos_analysis.sqlite3`
  - day_service_usage
  - resident_episodes
  - resident_users
  - resident_daily_stays
  - 分析ビューが存在する可能性あり

- `/Users/tama2025mini/work/Arbos/data/db/arbos_episodes.sqlite3`
  - users
  - episodes
  - daily_residents
  - floor_schedule_events
  - contact_alerts
  - long_overdue_followups
  - excluded_users

- 予定表CSV
  - `/Users/tama2025mini/work/Arbos/data/processed/*schedule_events*.csv`

- 既存成果物
  - `/Users/tama2025mini/work/Arbos/reports/outputs/utilization_strategy_20260609/arbos_utilization_strategy_summary.md`
  - `/Users/tama2025mini/work/Arbos/reports/outputs/utilization_strategy_20260609/arbos_utilization_strategy_report.html`
  - `/Users/tama2025mini/work/Arbos/reports/outputs/utilization_strategy_20260609/arbos_utilization_strategy_metrics.json`

まず既存のDBスキーマ、ビュー、既存スクリプト、既存レポートの構成を確認してください。
そのうえで、既存の設計思想に合わせて実装してください。

# 背景・経営課題

対象指標は「ショート + ロング / 100床」です。
定員は100床で、内訳は以下です。

- 2F: 54床
- 3F: 36床
- ユニット: 10床

現時点の分析では、2026年4-5月のショート + ロング入所率は95.0%です。
98%を目標にすると、61日間で180床日不足しています。
1日あたり約3床分の追加稼働が必要です。

前年同期間比較では以下です。

| 期間 | ロング床日 | ショート床日 | 合計床日 | 入所率 |
|---|---:|---:|---:|---:|
| 2025年4-5月 | 5,169 | 763 | 5,932 | 97.2% |
| 2026年4-5月 | 5,200 | 598 | 5,798 | 95.0% |
| 差分 | +31 | -165 | -134 | -2.2pt |

つまり、入所率低下の主因はロング不足ではなく、ショート床日の減少です。
経営層向けには「ショート床日を前年水準に戻すことで、98%目標に必要な180床日の大半を埋められる」というメッセージを出したいです。

同時に、現場は疲弊しているため、「もっと営業しろ」ではなく、
「誰に声をかけるべきかを探す作業を減らすDX」として見せたいです。

# 今回作ってほしいもの

週次人力レポートMVPとして、以下を作ってください。

## 1. Pythonスクリプト

新規に以下を作成してください。

`/Users/tama2025mini/work/Arbos/reports/scripts/build_weekly_followup_report.py`

実行例：

```bash
cd /Users/tama2025mini/work/Arbos
python reports/scripts/build_weekly_followup_report.py --as-of 2026-06-10 --top-n 20
````

要件：

* Python標準ライブラリ、sqlite3、pandasを中心に実装する。
* jinja2等が既に使われていれば使ってもよいが、なければMarkdown文字列生成でよい。
* CSVはExcelで開きやすいように `utf-8-sig` で出力する。
* 既存ファイルは上書きしない。
* 出力先は以下のような日付つきフォルダにする。

`/Users/tama2025mini/work/Arbos/reports/outputs/weekly_followup_YYYYMMDD/`

例：

`/Users/tama2025mini/work/Arbos/reports/outputs/weekly_followup_20260610/`

## 2. 出力ファイル

最低限、以下を出力してください。

### 経営層向け・管理職向け

1. `weekly_followup_executive_summary.md`
2. `weekly_followup_executive_summary.html`
3. `weekly_followup_metrics.json`

### 現場向け

4. `weekly_priority_followup.csv`

これは「今週の重点フォローリスト」です。
現場には最大 `top-n` 件だけ渡す想定です。

### 管理者・分析担当向け

5. `all_followup_alerts.csv`
6. `short_reactivation_alerts.csv`
7. `long_conversion_candidates.csv`
8. `three_floor_targets.csv`
9. `day_to_short_trial_candidates.csv`
10. `customer_followup_master.csv`
11. `data_quality_notes.md`

可能なら、対応結果を記録するためのテンプレートも作ってください。

12. `followup_status_template.csv`

# 重要な設計思想

これは「営業管理」ではなく「現場負担軽減DX」です。
そのため、出力物には以下のメッセージを入れてください。

* 現場に新しい入力負担を増やすためのものではない。
* 既存データから「今週確認した方がよい利用者」を先に整理する。
* 現場は候補者を一から探さなくてよい。
* 最初は週1回の人力レポートとして運用し、3〜4週間検証してから自動化する。
* 現場に渡すのは全件ではなく、優先度の高い10〜20件に絞る。
* 対応結果は、可能なら選択式の最小限にする。

# 利用者マスタを作る

`customer_followup_master.csv` には、利用者単位で以下のような列を作ってください。
実データの列名に応じて調整して構いません。

必須に近い列：

* user_id
* user_name または display_name
* latest_short_start_date
* latest_short_end_date
* latest_short_floor
* days_since_latest_short_end
* short_days_total
* short_days_365
* short_episodes_total
* short_episodes_365
* latest_long_start_date
* has_long_history
* is_currently_long
* has_3f_history
* latest_floor
* day_service_days_90
* day_service_days_180
* has_day_service_history
* has_future_booking
* future_booking_date
* future_booking_type
* latest_discharge_destination
* latest_discharge_reason
* hard_exclude_flag
* hard_exclude_reason
* caution_flag
* caution_reason
* data_freshness_note

列が取れない場合は、列自体は作って `NULL` または空欄にし、`data_quality_notes.md` に理由を書いてください。

# 形態判定

実データの列を確認したうえで、以下の考え方で判定してください。

* ショート：

  * 形態、利用区分、episode_type等に「ショート」「短期」等を含むもの
* ロング：

  * 形態、利用区分、episode_type等に「ロング」「長期」「入所」等を含むもの
* デイ：

  * day_service_usageを別扱いにする

ただし、列名や値は必ず実データで確認し、値の分布をログや `data_quality_notes.md` に残してください。

# フロア判定

可能なら既存のfloor列を使ってください。
ない場合は、部屋番号や部屋名から推定してください。

* 2F
* 3F
* ユニット

フロアが取れない場合は `unknown` としてください。
推定ルールは `data_quality_notes.md` に書いてください。

# 除外ルール

アラートDXで最も大事なのは、出してはいけない人を出さないことです。
以下は原則として重点フォロー対象から除外してください。

## hard_exclude

* 死亡退所
* 逝去
* 明確な看取り終了
* 他施設入所済み
* 特養入所
* 老健入所
* グループホーム入所
* 長期入所中
* excluded_usersに入っている利用者
* 明確な利用終了
* 苦情・受入不可など、明らかに営業対象外と判断できるもの

## caution

以下は完全除外ではなく、`caution_flag` としてください。

* 転院
* 入院
* 医療的理由
* 状態不安定
* 情報不足
* 退所理由が不明

cautionの人は現場向けtop-nには原則入れず、管理者向けCSVには残してください。

# 退所後日数の扱い

退所日が確定しているショートエピソードだけを、`退所後xx日` の対象にしてください。

データ最終日に在所中だった可能性がある人については、退所済みと断定しないでください。
その場合は以下のように扱ってください。

* `latest_short_end_date` は空欄または推定値にしない。
* `days_since_latest_short_end` は空欄。
* `data_freshness_note` に「データ最終日時点で利用中の可能性あり」などを書く。
* 退所後14日/30日/45日アラートには入れない。

# アラートの種類

`all_followup_alerts.csv` には、以下のアラートを統合してください。

## A. ショート再利用アラート

目的：
即時のショート床日回復。

対象条件：

* 直近ショート退所日が確定している
* 退所後14日以上
* 次回予約なし、または次回予約が確認できないが要確認
* ロング入所中ではない
* hard_excludeではない

区分：

* `SHORT_14D`: 退所後14〜29日
* `SHORT_30D`: 退所後30〜44日
* `SHORT_45D`: 退所後45〜89日
* `SHORT_90D`: 退所後90日以上

ただし、現場向け重点リストでは、まず14〜89日を優先してください。
90日以上は掘り起こし枠なので優先度は下げてください。

推奨アクション：

* 14〜29日：次回予約・追加泊の打診
* 30〜44日：月内再利用・定期ショート提案
* 45〜89日：休眠化防止フォロー
* 90日以上：状況確認・再開可能性確認

## B. ショート15日以上・ロング未転換アラート

目的：
定期ショート化・ロング相談。

対象条件：

* 累計ショート利用日数が15日以上
* ロング転換していない
* 現在ロング入所中ではない
* hard_excludeではない
* できれば直近90日以内にショート利用あり

アラート種別：

* `LONG_CONVERSION_CANDIDATE`

推奨アクション：

* 定期ショート化の提案
* 利用継続の確認
* 家族状況・介護負担の確認
* 必要に応じてロング相談

## C. 3F空床対策アラート

目的：
3Fの空床改善。

対象条件：

* 3F利用歴あり、または直近利用フロアが3F
* 次回予約なし
* 現在ロング入所中ではない
* hard_excludeではない
* 退所後14日以上、または直近90日以内に利用歴あり

アラート種別：

* `THREE_F_TARGET`

推奨アクション：

* 3Fショート再利用提案
* 3F枠での次回予約確認
* 3Fに適合する理由を相談員に確認

## D. デイ高頻度・入所未利用アラート

目的：
将来のショート母集団形成。

対象条件：

* デイサービス利用あり
* ショートまたはロング利用歴なし
* 直近90日または180日のデイ利用頻度が高い
* hard_excludeではない

デイ高頻度の閾値は、実データ分布を確認してから決めてください。
仮には以下でよいです。

* 直近90日で8日以上
* または直近180日で16日以上
* ただし、分布を見て上位30〜40%程度になるよう調整してもよい

アラート種別：

* `DAY_TO_SHORT_TRIAL`

推奨アクション：

* 初回1泊2日ショート体験の案内
* 家族休息目的の利用提案
* ケアマネへの情報提供

# 優先スコア

各候補に `priority_score` を付けてください。
最初は説明しやすい単純ルールでよいです。

例：

* 退所後14〜45日：+4
* 退所後46〜89日：+2
* 退所後90日以上：+1
* 累計ショート15日以上：+3
* 直近365日ショート3回以上：+2
* 3F利用歴あり：+2
* 次回予約なし：+2
* ロング未転換：+1
* デイ高頻度：+1
* caution_flagあり：-3
* future_bookingあり：-5
* hard_excludeあり：除外

優先度は以下でよいです。

* A: 8点以上
* B: 5〜7点
* C: 1〜4点

ただし、実際の件数を見て、Aが多すぎる場合は上位20件程度に絞ってください。
同一利用者が複数アラートに該当する場合、現場向けリストでは1人1行に統合してください。
統合時には、`alert_types` に複数種別を入れてください。

# 見込み床日

各候補に `expected_bed_days` を仮置きしてください。
これは確約ではなく、経営層向けに床日規模を把握するための参考値です。

ルール例：

* その利用者の過去ショート1回あたり中央値が取れる場合：

  * `expected_bed_days = median_short_los`
  * ただし2〜14日の範囲にクリップ
* ショート15日以上・ロング未転換：

  * 最低5日、最大14日
* デイ高頻度・入所未利用：

  * 初回体験なので2日
* 3F再利用候補：

  * 過去中央値がなければ5日

`expected_bed_days` は必ず「仮置き」としてレポートに明記してください。

# 現場向け weekly_priority_followup.csv

現場に渡す想定のCSVです。
最大 `--top-n` 件に絞ってください。

列は多すぎないようにしてください。
以下を推奨します。

* priority
* priority_score
* user_id
* user_name
* owner_or_counselor
* latest_short_end_date
* days_since_latest_short_end
* latest_short_floor
* short_days_total
* short_episodes_365
* has_3f_history
* day_service_days_90
* has_future_booking
* alert_types
* alert_reason
* recommended_action
* expected_bed_days
* caution_flag
* followup_status
* next_action_date
* memo

`followup_status`, `next_action_date`, `memo` は空欄でよいです。
現場が後で追記できる形にしてください。

# 経営層向け weekly_followup_executive_summary.md/html

以下の構成で作ってください。

## 1. タイトル

例：

`顧客フォローDX週次レポート：ショート稼働改善と現場負担軽減`

## 2. 今週の結論

以下のメッセージを含めてください。

* 入所率改善の主戦場はロング直接獲得ではなく、ショート床日の回復である。
* 2026年4-5月の入所率95.0%に対し、98%目標には180床日不足。
* 前年同期間比ではロング床日は増えているが、ショート床日が165床日減少。
* したがって、既存ショート利用者の再利用、ショート15日以上利用者の定期化、3F向けショート再利用、デイ高頻度者の初回ショート誘導を重点化する。
* ただし、現場疲弊があるため、現場には全件ではなく「今週の重点10〜20件」に絞って提示する。

## 3. データ鮮度

以下を表示してください。

* resident系データ最大日付
* day_service系データ最大日付
* schedule系データ最大日付
* as_of_date
* 注意点

## 4. KPIサマリー

可能なら以下を表示してください。

* ショート＋ロング入所率
* 98%目標との差
* 不足床日
* ショート床日
* ロング床日
* 3F入所率
* 3F平均空床
* 今週の重点フォロー対象者数
* A/B/C優先度別件数
* アラート種別別件数
* 見込み床日合計

既存レポートやmetrics JSONから取得できるものは再利用してもよいです。
取得できないものは空欄にせず、「今回未算出」と書いてください。

## 5. 今週の重点フォロー対象の要約

個人名は経営層向けHTML/Markdownには原則出さず、件数と床日だけにしてください。
個人名は現場向けCSVに出してください。

例：

| 区分               | 件数 | 見込み床日 | 主な対応      |
| ---------------- | -: | ----: | --------- |
| ショート退所後14〜29日    |  x |     x | 次回予約・追加泊  |
| ショート退所後30〜44日    |  x |     x | 月内再利用     |
| ショート退所後45〜89日    |  x |     x | 休眠防止      |
| ショート15日以上・ロング未転換 |  x |     x | 定期化・ロング相談 |
| 3F対象             |  x |     x | 3F再利用     |
| デイ高頻度・入所未利用      |  x |     x | 初回ショート体験  |

## 6. 現場負担軽減の運用ルール

以下を入れてください。

* 現場に渡すのは上位10〜20件のみ。
* 全件アラートは管理者用。
* 対応結果は選択式で最小限。
* 見送り・対象外は一定期間スヌーズする設計にする。
* 3〜4週間は人力レポートとして検証し、使える条件だけを自動化する。

## 7. 次週に見ること

* A優先リストから予約化した件数
* 予約化した見込み床日
* 対象外の混入率
* 現場が対応可能だった件数
* 3F候補が実際に3F稼働に効いたか
* アラート条件の修正点

# followup_status_template.csv

今後の週次運用で、現場または相談員リーダーが最小限の結果を記録できるテンプレートを作ってください。

列例：

* report_date
* user_id
* user_name
* priority
* alert_types
* owner_or_counselor
* followup_status
* action_date
* next_action_date
* result
* expected_bed_days
* booked_bed_days
* snooze_until
* memo

選択肢例も `data_quality_notes.md` かレポート内に書いてください。

followup_statusの選択肢：

* 未対応
* 架電済
* ケアマネ連絡済
* 家族連絡済
* 提案済
* 予約化
* 見送り
* 対象外
* 次週再確認

snoozeルール案：

* 見送り：30日
* 対象外：90日
* 予約化：次回退所後まで非表示
* 次週再確認：7日

今回の実装では、過去のfollowup_statusがまだない場合はテンプレート作成だけでよいです。
もし既に手入力のfollowup_statusファイルが存在するなら、それを読み込んでsnoozeを反映してください。

# data_quality_notes.md

必ず以下を書いてください。

* 使用したDB・CSV
* 各テーブルの行数
* 主要テーブルの最大日付
* 利用形態の値分布
* フロア判定の値分布
* 除外者数
* caution者数
* 次回予約判定の方法
* 退所日確定の判定方法
* 既知の限界
* 今後改善すべき点

既知の想定行数は以下です。
大きく違う場合は注意書きを出してください。

* day_service_usage: 約10,193行
* resident_episodes: 約957件
* resident_users: 約245名
* resident_daily_stays: 約41,808行
* floor_schedule_events: 約1,754件

# 検証

実装後、必ずスクリプトを実行してください。

```bash
cd /Users/tama2025mini/work/Arbos
python reports/scripts/build_weekly_followup_report.py --as-of 2026-06-10 --top-n 20
```

実行後、以下を確認してください。

1. 出力フォルダが作られている。
2. 必須CSV/MD/HTML/JSONが出ている。
3. `weekly_priority_followup.csv` が最大20件に絞られている。
4. hard_excludeが現場向けリストに混ざっていない。
5. cautionが現場向けリストに大量混入していない。
6. 同一利用者が現場向けリストで重複していない。
7. 経営層向けレポートに個人名が出ていない。
8. データ鮮度警告が必要な場合に出ている。
9. 既存の2026年4-5月指標と大きく矛盾しない。
10. 実行ログか最後の出力で、生成ファイル一覧を表示している。

# 可能なら追加でやってほしいこと

余力があれば、既存の `arbos_utilization_strategy_report.html` のデザインに寄せて、HTMLを見やすくしてください。
ただし、デザインよりもCSVと集計ロジックの正確性を優先してください。

また、以下のようなREADMEを作ってください。

`/Users/tama2025mini/work/Arbos/reports/outputs/weekly_followup_YYYYMMDD/README.md`

内容：

* この週次レポートの目的
* どのCSVを誰が見るか
* 現場に渡すのはどのファイルか
* 管理者だけが見るファイルはどれか
* 翌週の運用方法
* 注意点

# 最後に報告してほしい内容

作業完了後、以下を日本語で簡潔に報告してください。

1. 作成・更新したファイル一覧
2. 実行コマンド
3. 出力フォルダ
4. 今週の重点フォロー対象者数
5. A/B/C優先度別件数
6. アラート種別別件数
7. 見込み床日合計
8. データ鮮度上の注意点
9. 実装上の仮定
10. 次に改善すべき点

# 重要な最終メッセージ

今回のMVPのゴールは、完全自動化ではありません。
ゴールは以下です。

「現場が一から候補者を探さなくても、今週声をかけるべき既存利用者が分かる状態を作ること」

この思想に沿って、実装・レポート・CSVの列設計をしてください。

```
```
