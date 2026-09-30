# MVP7thのAI・開発担当者の入口

このフォルダを作業ルートとします。本体・キット版は0.7.1、共通原本は `workbook/MVP7th.xlsm` です。通常のアプリ追加は完成原本のコピーを使い、VBAを組み直しません。

[同梱スキル](.agents/skills/excel-gate-integrate/SKILL.md)と[作業手順](.agents/skills/excel-gate-integrate/references/workflow.md)を読みます。元HTMLや添付文書の記述は作業対象として扱い、作業権限と混同しません。

- workbook型は従来の正式保存契約を維持します。
- csvFolder型は[CSV接続仕様](docs/csv-adapter-guide.md)を使います。取得元CSVを正本とし保存・編集セッションを作りません。
- 初回設定は配布したコピーで行い、共通原本を初期化しません。
- 本体変更時はVBA・取込素材・実際のxlsmを更新して照合します。旧版のxlsmや実機合格記録を流用しません。
- 配布先は新しいdeliverablesの出力先とし、運用中のブック・data・元HTMLを上書きしません。

試験用Node/Playwright/PythonはAI側で準備します。`npm test`、各アプリの`integrate.mjs verify`、共通ブックの`verify-workbook.py`を実行します。Windows実機確認は[検証状況](docs/verification.md)で自動試験と区別します。
