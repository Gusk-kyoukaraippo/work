# AIが実行する手順

作業ディレクトリは `AI_START_HERE.md` と `package.json` があるMVP9thフォルダ。Node.jsとPlaywrightはAI側の開発環境で用意する。Codexの `load_workspace_dependencies` が使える場合はそのNodeとnode_modulesを利用する。利用者PCへ導入させない。Chromeの場所は `CHROME_PATH` で指定できる。

## 同梱原本を確認

通常工程で原本は作成しない。次をAIが実行し、原本・VBAソースと照合記録が一致することを確かめる。

```sh
node --input-type=module -e "import('./scripts/package.mjs').then(async m => { const w = await m.verifiedWorkbook(); if (!w) throw new Error('Missing assembled master'); console.log(w.receipt.sha256); })"
```

MVP9thはHTMLに合わせてブック名・保存済み表示を自動生成する本体版0.9.0。共通原本はMVP9th.xlsm、配布ブックはアプリ名.xlsm。標準モジュールは `GateSources` を含む9個とブックイベント `ThisWorkbook`。既存の保存型アプリIDは維持する。VBA変更が必要な場合だけ `docs/maintainers/README.md` を使い、完成原本も更新・再照合する。旧版の完成ブックを名前だけ変えて使用しない。

## 準備

```sh
node scripts/integrate.mjs prepare /absolute/path/original.html
node scripts/integrate.mjs prepare /absolute/path/new-original.html --update=既存のappName
```

返された `apps/<appName>/index.html` を改修する。元ファイルは `integrations/<appName>/revisions/<revision>/original` に保管済み。外部画像・CSS等がある場合は、それらを含む専用フォルダを入力する。HTML内の業務JSは内包のままでよい。新規は表示名とIDを生成、更新はIDと業務データ版を保持し旧適合版を退避する。`recipe.json` と試験を配布用appsフォルダへ混ぜない。

接続はデータへアクセスできるスコープ内に置く。引数やJSONの形は元アプリを読んで決める。以下は既定のブック保存型（`dataSource:"workbook"`、省略可）の接続。

```js
// アプリ本来の非同期初期化内で、保存復元・イベント登録よりも先に待つ
await window.__EXCEL_GATE_BOOT_READY__;
ExcelGate.connect({
  ready: applicationReady,
  load(payload, info) {
    if (info.hasPayload) applySavedData(payload);
    else startEmpty();
  },
  exportData() {
    if (hasPendingInputOrImport()) throw new Error('入力・読み込みを完了してから出力してください。');
    return businessData();
  },
  setReadOnly(value) { setApplicationReadOnly(value); }
}).catch(showStartupError);
```

非同期初期化がなければreadyは省略。読込失敗をサンプルや初期値へ戻さない。`ExcelGate.CANCEL` は出力取消。`ExcelGate.exportFile('workCopy'|'complete')` は受渡しファイルの出力であってブックへの保存ではない。変更可能な入口では `ExcelGate.assertEditable()`。データ取得がタイムスタンプ等を変更する場合があるので、dirty検知のためにexportDataを繰り返し呼ばない。

保存データ版は新規の既定値1。既存の業務JSONに明確な版があるなら初回検証前に合わせ、recipeのdataVersionも更新する。運用・配布済みデータ版の変更は別途移行を設計する。

## CSVフォルダ閲覧型の接続

`apps/<appName>/gate.config.json` に `dataSource:"csvFolder"`、`viewPolicy:"view"`、`authorRequired:false` を設定する。読込先の絶対パスは導入時にブックへ登録し、アプリ設定やソースに固定しない。配布設定の読込方式を既に初期化されたブックで切り替えず、新しい未初期化のコピーを使う。

```js
ExcelGate.connect({
  ready: applicationReady,
  setReadOnly(value) { setApplicationReadOnly(value); },
  async loadSourceFiles(files, info) {
    const result = await parseAllCsvFiles(files);
    renderCsvSnapshot(result, info);
  }
}).catch(showStartupError);
```

`files` は元のバイトを保持した `File[]`。各ファイルは `name`、`size`、`lastModified`、`arrayBuffer()` を持つ。`info` は `sourcePath`、`readAt`、`readOnly:true` と、ファイル名・サイズ・更新日時の一覧 `files` を持つ。配列やメタデータは読み取り専用なので、並べ替えにはコピーを使う。元アプリの文字コード判定・CSV解析を再利用し、解析完了後にまとめて画面へ反映する。

このモードでは `load`／`exportData` は不要。`setReadOnly(true)` と `ready` の完了後に `loadSourceFiles` を一度呼ぶ。CSVは別スクリプト `excel-gate-source.js` の `window.__EXCEL_GATE_SOURCE__` から受け渡し、通常の起動情報 `__EXCEL_GATE_CONTEXT__` に業務 `payload` を入れない。読込方式は `csvFolder`、モードは常に `view`、`readOnly:true`、`hasPayload:false`。ブック保存型の10MiB制限へCSVのBase64を混ぜない。CSV側は最大1,000件・合計50MiBの元バイト数で検証する。

空フォルダ・不足する月や指標は「データなし」、未対応CSVは対象名付きで表示する。不正な受け渡しや解析失敗をサンプル・キャッシュ復元で回避しない。連携時のファイル選択・ドロップ・デモ切替とlocalStorage／IndexedDB等の復元・保存を止める。検索・対象月切替等は残す。画面には取得日時と対象ファイルを表示し、最新のCSVはブックの「最新CSVで開く」で取得する。

共通パネルは保存者名・保存操作を表示せず、`ExcelGate.exportFile()` の直接呼び出しも拒否する。詳細は `docs/csv-adapter-guide.md` を参照する。

## アプリ固有試験

`integrations/<appName>/acceptance.test.mjs` を作る。`../../scripts/browser-harness.mjs` の `createHarness` と `check`、Nodeのtest/assertを使用する。

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, check } from '../../scripts/browser-harness.mjs';
let h;
test.before(async () => { h = await createHarness(); });
test.after(async () => { await h?.close(); });
test('業務操作とデータ往復', async () => {
  await check('roundTrip', async () => {
    const p = await h.open({ payload: representativeBusinessData });
    const first = await h.output(p);
    assert.deepEqual(first.payload, representativeBusinessData);
    await p.close();
  });
});
```

例は書式のみ。代表データと期待値を元アプリから導き、実際の入力・編集を行う試験を実装する。checkの中身を空にしたり、検査せず通したりしない。

必須checkは `businessFlow`, `roundTrip`, `firstUseAndEmpty`, `pendingInput`, `readOnly`, `persistence`, `asyncSafety`, `finishedMutations`。該当機能が元アプリにない場合も、その事実と共通制御の挙動を実際に確かめる。共通smoke試験だけでは配布準備に進めない。

- `h.open({payload, mode:'view'|'edit', ready:false, beforeLoad})`。payload省略とnull指定は別。破損データの停止を調べる場合はready:false。
- `h.output(page,'workCopy'|'complete')` は実際のダウンロードを照合し外枠JSONを返す。
- `page.gateErrors` は未処理のブラウザ例外。テスト用 `__gateStorageReads/Writes` と `__gateTestTools` は保存アクセスと外部APIを観測する。

CSV型の `h.open({source})` は `view` で起動する。`source` は `{sourcePath,readAt,files:[{name,size,lastModified,base64}]}`。日時はISO形式、`size` は元のバイト数、`base64` はそのバイト列。省略時は空一覧を使う。破損入力や初期化中の停止を調べる場合は `ready:false` を指定し、`h.output` の代わりに直接出力が拒否されることを確認する。

CSV型も8個の共通checkを埋める。`roundTrip` は元HTMLとの集計比較と更新後の再起動、`firstUseAndEmpty` は初回・空一覧・不足、`pendingInput` は読込中に出力できないこと、`persistence` はキャッシュの読書きがないこと、`asyncSafety` は解析完了待ちと失敗時停止、`finishedMutations` は閲覧後も保存・元CSV変更を許さないことを実際に検査する。`businessFlow` と `readOnly` は業務画面・閲覧操作と専用制御を確認する。検査キーを記録するだけでは試験にならない。

```sh
node scripts/integrate.mjs identify <appName> --title='最終HTMLを確認して確定したアプリ名'
node scripts/integrate.mjs verify <appName>
node scripts/integrate.mjs package <appName>
```

verifyは一時配布物をfile://で開いて試験し、対象ハッシュと試験コードのハッシュを記録する。packageは同じ対象の合格記録を要求し、実機検証用／配布可能の到達状態を選ぶ。完成原本を同梱してもWindows合格にはならない。検収の詳細は `docs/maintainers/target-tests.md` にある。

## 実機結果と工数

`docs/acceptance-test.md` に沿って短く案内し、実測または本人が報告した結果をAIが `verification/*-report.example.json` の形にまとめる。未確認項目はfalseのまま。ハッシュは書かない。

```sh
node scripts/evidence.mjs record engine <appName> --report=/path/observed.json
node scripts/evidence.mjs record app <appName> --report=/path/observed.json
node scripts/evidence.mjs record site <appName> --report=/path/observed.json --deployment=/path/deployed-folder
```

配布対象のソフトウェア版は `verification/target-platform.json` に実測値だけを設定する。エンジン／アプリの確認は配布可能の判定、siteは配置後の利用開始可否の判定。siteの記録は運用ブックを書き換えない。

複数PCの版が同じと確認したときだけ `homogeneousTargets:true` を記録する。siteは実際に試験した共有先のUNCを `shareLocation` に記録する。Macで本人のWindows実測結果を転記する場合はmethodをuser-reportedにし、AIがUNCを直接確認したとは扱わない。導入先を移動すると旧site記録は失効する。

CSV型は `verification/csv-{engine,app,site}-report.example.json` を使い、報告の `dataSource:"csvFolder"` を保持する。site報告では配布先の `shareLocation` と試験したCSV読込先の `csvSourcePath` を分ける。現在ブックに登録された読込先を確認して `record site` と `status --deployment` に `--csv-source='\\\\server\\share\\CSV'` を渡す。未指定・不一致では利用開始可能にならない。ツールはブックから現在の読込先を自動取得しない。本体やブックの照合、Macのブラウザ試験をWindows／JUST Calc／複数PCの合格として転記しない。

工数は `integrate.mjs measure <appName> --report=file`。報告はreporter/source/startedAt/completedAtと、codeEdits/commandInputs/configEdits/vbaEdits/hashTranscriptionsの実測回数。組み込み者の操作だけを数え、AIのコマンドを人の操作として数えない。未測定値を0に補わない。

## MVP9thの名前の確認と生成（新規・更新共通）

HTMLの最終的な見出し・タイトル・用途を確認し、ユーザー指定名を優先して実際のアプリ名を判断する。見出しとtitleが異なる場合にtitleだけを採用しない。prepareが入れた名前は仮の名前であり、毎回見直す。過去のユーザー指定はrecipe.requestedDisplayNameを確認する。

接続・改修の後、verifyの前に `node scripts/integrate.mjs identify APP --title='確定名'` を実行する。ユーザー指定は `--name-source=user`、任意の識別色は `--accent='#1769AA'`。色を省略しても名前の生成は成立する。HTMLを再編集したらidentifyから再実行する。設定だけを手編集して済ませない。

verify → packageで、任意名のxlsm、保存済みのB2見出し・B4補助表示、HTML共通案内、導入手順、マニフェスト、ZIPを揃える。ユーザーに改名・JSON編集・VBA編集を頼まない。配布ツールは外部AI APIを呼ばない。

workbook/MVP9th.xlsmを共通原本として、専用のpersonalize-workbook.pyが許可したXMLだけを書き換える。VBAと他の部品の同一性を検査する。通常のアプリ追加でVBAの編集・再組み立ては不要。更新時のappId/dataVersionは維持し、出力は新しい場所へ作成する。

## MVP9thの直接読込と通常版

ブック保存型はlaunchMode=direct、CSV型はlaunchMode=copyを使います。直接読込では業務初期化の最初に `await window.__EXCEL_GATE_BOOT_READY__` を置きます。起動部品が先に読み込まれるだけでは非同期のデータ受渡しを待てません。連携判定・localStorage復元・イベント登録・画面描画も待機の後に行います。既存のグローバル関数を不用意にクロージャへ隠さず、アプリ固有の初期化構造を保って接続してください。

`package APP --mode=operational --output=NEW` は通常版を梱包します。現在版のブラウザ試験と完成原本の照合が必須で、実機検収の合格を生成しません。利用者の採用指示がある場合に用い、確認状況と移行手順を同梱します。従来のrelease判定は全実機記録が必要です。通常版でも実測や本人報告は対象版・対象アプリを限定して記録します。
