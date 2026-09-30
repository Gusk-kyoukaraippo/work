# MVP9thのAI・開発担当者の入口

本体・共通JavaScript・配布設定は **0.9.0**。このフォルダを作業ルートにし、[同梱スキル](.agents/skills/excel-gate-integrate/SKILL.md) と [作業手順](.agents/skills/excel-gate-integrate/references/workflow.md) を読んでください。過去の版は不要です。

主目的は、任意のHTMLから、そのアプリに合う名前と保存済み表示を持つブックを生成することです。同梱例はリハビリ物品管理・引継ぎメモ・地ケアの3つです。

1. 元HTMLを保管して `prepare`。更新では既存のアプリ名（フォルダ識別子）を `--update` に指定します。
2. 保存型の直接読込では、業務初期化より前に `await window.__EXCEL_GATE_BOOT_READY__` を入れます。
3. 元の業務画面・データ形式を保って接続処理を実装し、アプリ固有の受け入れ試験を用意します。
4. **最終HTMLの画面見出し・タイトル・用途を読み、名前を判断します。** タイトルと見出しの不一致は単純な自動選択で決めず、実際のアプリの用途を確認します。ユーザーの明示名が最優先です。
5. `identify APP --title='確定した名前'` で共通設定と確認記録を更新します。ユーザー指定なら `--name-source=user`、任意の色は `--accent='#1769AA'`。HTML変更後は毎回やり直します。
6. `verify APP` → `package APP`。配布ツールは外部AI APIを呼びません。名前の判断をするのはこの手順を実施するAIです。

例（AIが実行）:

```sh
node scripts/integrate.mjs prepare /path/to/original.html --name=my-app
# 接続処理・業務試験を実装した後
node scripts/integrate.mjs identify my-app --title='物品管理ノート'
node scripts/integrate.mjs verify my-app
node scripts/integrate.mjs package my-app
```

生成元は照合済み `workbook/MVP9th.xlsm`。配布時は表示セル・スタイル・ブック内定数・ボタン参照だけを専用処理で更新し、VBAを同一のまま保持します。通常のアプリ追加でVBAを再編集・再組み立てしません。生成ブック名と照合結果は `release-manifest.json` と `workbook-generation.json` に記録します。

Windows禁止文字はファイル名だけ置換し、長いファイル名は識別用ハッシュを添えて短縮します。画面名は保持します。名前は256文字以内、色は省略可能です。生成先が存在する場合は上書きを拒否します。

更新でも `appId` と `dataVersion` を維持します。運用中のブック・dataへ重ねて配置しません。初回設定済みの業務データの移行は別の検証が必要です。

日常の利用者にコード・VBA・JSONの編集、ファイルの改名を依頼しません。完成一式と使い方を渡し、Windows・JUST Calc・Edge・共有先・複数PCの未実測項目は未確認と明記します。

## 通常版の梱包

利用者が採用した版を通常版として整える場合は `node scripts/integrate.mjs package APP --mode=operational --output=新しい出力先`。完成ブックと現在ソースのブラウザ合格記録が必須です。計測UIは含みません。全実機検収のreleaseとは別で、未実施を合格にしません。確認状況を同梱し、運用データには上書きしません。[MVP9thの確認状況](docs/operational-status.md)
