# 原本だけからの独立組み込み試行

対象はプロジェクト直下の `original.html`（引継ぎメモ）。既存の適合コードを参照せず、この隔離プロジェクトのスキルとツールだけを使って prepare → 適合 → verify → package を実行した。

結果は **HTML適合・ブラウザ試験完了、開発用ZIP作成済み**。完成したマクロブックがなく、Windows／JUST Calc／Edge実機の検収は未実施。業務利用者へ配布できる状態ではない。

## 成果物

- 適合HTML: `apps/app-d5f35dde/index.html`
- アプリID: `app-a0ff7d31-ced5-46df-b369-0e60586a5496`、データ版: 1
- 原本保管: `integrations/app-d5f35dde/revisions/2026-09-20T17-47-31-769Z-b6c553/original/index.html`
- 固有試験: `integrations/app-d5f35dde/acceptance.test.mjs`
- 合格記録: `integrations/app-d5f35dde/browser-receipt.json`
- 合格ログ: `integrations/app-d5f35dde/browser-2026-09-20T17-51-42-620Z-1f7969.log`
- 画面確認: `integrations/app-d5f35dde/adapted-screen.png`
- 配布フォルダ: `deliverables/2026-09-20T17-53-05-129Z-cdcf8d/app-d5f35dde`
- ZIP: `deliverables/2026-09-20T17-53-05-129Z-cdcf8d/app-d5f35dde.zip`

原本と保存コピーのバイト一致、recipe記載のSHA-256一致を確認した。原本SHA-256は `2b3162eeb254246e1a22a9b3a0fa13d5d94d32f8373be6087985a0fbd6410c73`。配布manifestの11ファイルのハッシュ、ZIPのCRCと24エントリー、配布フォルダとの全ファイル一致も確認した。ZIPへ試験・recipe・原本を混入していない。

## 実装と試験

接続は元の即時実行関数内に実装した。40ms後の初期化をreadyに含め、連携時のlocalStorage復元・保存を止めた。最初の起動だけ原本と同じサンプルを表示し、保存された `[]` と `null` を保持する。業務JSONはid/textだけに再構築せず、追加プロパティも保持する。

未確定のメモとJSON読込中の出力を拒否し、入力を保持する。JSON読込後の反映直前にも編集権限を確認する。UIの追加・編集・確定・読込と外部API `NoteActions.add` にガードを付け、閲覧中も検索できる。既存JSON保存ボタンを連携時に非表示とし、ブラウザ側を「保存済み」と表示しない。

macOS、Node v24.19.0、インストール済みChromeを用いたfile://実行で、10件合格、失敗0件。共通smoke 2件に加え、必須8項目すべてに実操作と期待値の比較がある。

1. 原本と適合版の追加・編集・検索・JSON取込・書出し結果を比較。
2. 代表JSONと追加メタデータを出力し、再起動後に一致。
3. 初回・空配列・nullを区別し、不正オブジェクトは起動停止。
4. 未確定入力の出力・取込を拒否し、確定／キャンセル後に正しく出力。
5. 閲覧時のUIと外部API、プログラム経由の取込を拒否。検索は動作。
6. 古いlocalStorageを注入しても正式payloadを保持し、連携時の保存アクセスが読取0・書込0。
7. 初期化前API、遅延したFile.text、読込中の出力・追加、await後に権限を失った場合を検査。
8. 完了出力後のAPI、プログラム経由のクリック・取込を拒否。

画面画像も確認した。ゲートの保存案内と元アプリの検索・編集・取込が表示され、重複したJSON保存ボタンはない。

## 試行で見つかった問題と修正

ツール本体のprepare／verify／package／ZIP作成には、このケースで実行不良を認めなかった。

最初のverifyは自作試験の2点で失敗した。Playwrightのbrowser.newPageで作られた専用contextへもう1ページを追加しようとした点をbrowser.newPageへ直し、Shadow DOM内外の同名 `#status` が重複したselectorを `body > #status` に限定した。失敗ログを残し、修正後に全試験を再実行して合格した。

同梱案内には、スキルの役割分担と食い違う旧手順が残っていた。

- docs/install.md は組み込み者へコード編集・コマンド入力を求め、存在しないdocs/adapter-guide.mdを案内していた。
- docs/acceptance-test.md は存在しないtarget-acceptance.example.jsonを案内し、ハッシュ転記を要求していた。
- 同ファイルの障害注入節が、この隔離プロジェクトに含まれない試験マクロを前提としていた。

隔離プロジェクト内の2文書を修正し、コード・コマンド・記録はAI、業務確認と実機操作は導入者、共通試験ブック準備は開発担当者と明確化した。修正文書を含めてpackageを実行した。

## 利用者の操作と残作業

この試行では、利用者にコード編集・コマンド実行・設定JSON作成・VBA操作・照合情報転記を依頼していない。すべてAIが実施した。利用者による実機操作も発生していない。人の組み込み作業時間は未測定で、時間短縮率は算出していない。ログの4.43秒は最終ブラウザ試験の実行時間であり、組み込み全体の工数ではない。

現在は完成xlsmがないため、導入者が実施できる初回設定はない。まずExcelゲート本体の提供側で、検証済み共通マクロブックと共通エンジンの実機試験を完了する必要がある。

実機検証用パッケージを受け取った後、導入者が行う操作は次のとおり。

1. 新しい検証用共有フォルダへ一式を配置し、完成ブックの「初回設定」を押す。
2. メモを追加・編集し、「入力を終える」→ブックの「保存して終了」。開き直して内容を確認する。
3. 「途中保存の準備」→「保存して続ける」で継続できること、未確定メモでは出力が止まることを確認する。
4. 二台で同時に開き、片方だけが編集できること、もう片方は検索しながら閲覧できること、終了後に交代できることを確認する。
5. 使用PC・Windows／JUST Calc／Edgeの版と、実際に起きた結果をAIへ伝える。AIが記録と照合を行う。

これらの成功はまだ主張しない。manifestは `mode:development`、`workbookAssembly:not-assembled`、`targetPlatformValidation:pending`、`distributionReady:false`、`siteReady:false` のままである。
