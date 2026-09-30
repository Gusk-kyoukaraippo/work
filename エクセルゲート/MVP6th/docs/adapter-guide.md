# AI向け：HTMLの適合と配布準備

組み込み者向けの入口は「このHTMLをExcelゲートに組み込んで」という依頼です。この文書の技術作業はAIが行います。

プロジェクトの `.agents/skills/excel-gate-integrate/SKILL.md` と `references/workflow.md` に、準備・適合・試験・配布・実機結果記録の契約をまとめています。

```sh
node scripts/integrate.mjs prepare /path/original.html
node scripts/integrate.mjs verify <appName>
node scripts/integrate.mjs package <appName>
```

prepareは原本を保管してコピーと起動ブロックを作ります。任意HTMLの意味を自動変換するツールではありません。AIがコピーを解析し、データのあるスコープ内に接続を実装します。未完成マーカーのままではビルドを拒否します。

`ExcelGate.connect({load, exportData, setReadOnly, ready})` は従来の契約を維持します。`ExcelGate.assertEditable()` をユーザー操作・外部API・非同期完了の変更直前に接続します。正式データ読込へ編集ガードをかけず、初回と保存済み空値を区別します。既存のブラウザ復元・自動保存を連携中に停止し、未確定入力や取込中の出力を止めます。検索・表示切替は残します。

各アプリの `integrations/<appName>/acceptance.test.mjs` は共通ハーネスを使い、必須8項目の実際の画面・データ挙動を検証します。verifyはfile://の一時配布物で試験し、対象とテストコードを照合情報へ結び付けます。packageは一致する合格記録がないと進みません。

同じアプリの更新は `prepare /path/new.html --update=<appName>`。IDとデータ版を保持し、旧適合版と試験記録を退避します。運用中のブックやdataを更新するコマンドではありません。

共通本体の回帰試験は `npm test`。両参照アプリの受け入れ試験は `npm run verify:apps`。旧 `init-app.mjs` は低水準の互換ひな型、`package.mjs` は内部配布処理として残し、通常のAIワークフローはintegrate.mjsを使います。

Node.js/PlaywrightはAIの開発環境で用意します。Codexのworkspace dependenciesからnode_modulesを接続できます。`CHROME_PATH` で対象ブラウザ実行ファイルを指定します。利用者PCへの追加開発ソフトは不要です。
