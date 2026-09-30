# AIが実行する手順

作業ディレクトリは `AI_START_HERE.md` と `package.json` があるMVP6.1フォルダ。Node.jsとPlaywrightはAI側の開発環境で用意する。Codexの `load_workspace_dependencies` が使える場合はそのNodeとnode_modulesを利用する。利用者PCへ導入させない。Chromeの場所は `CHROME_PATH` で指定できる。

## 同梱原本を確認

通常工程で原本は作成しない。次をAIが実行し、原本・VBAソースと照合記録が一致することを確かめる。

```sh
node --input-type=module -e "import('./scripts/package.mjs').then(async m => { const w = await m.verifiedWorkbook(); if (!w) throw new Error('Missing assembled master'); console.log(w.receipt.sha256); })"
```

MVP6.1は案内・素材の版。本体版0.6.0・ブック名MVP6th.xlsm・既存アプリIDは維持する。VBA変更が必要な場合だけ `docs/maintainers/README.md` を使う。

## 準備

```sh
node scripts/integrate.mjs prepare /absolute/path/original.html
node scripts/integrate.mjs prepare /absolute/path/new-original.html --update=既存のappName
```

返された `apps/<appName>/index.html` を改修する。元ファイルは `integrations/<appName>/revisions/<revision>/original` に保管済み。外部画像・CSS等がある場合は、それらを含む専用フォルダを入力する。HTML内の業務JSは内包のままでよい。新規は表示名とIDを生成、更新はIDと業務データ版を保持し旧適合版を退避する。`recipe.json` と試験を配布用appsフォルダへ混ぜない。

接続はデータへアクセスできるスコープ内に置く。引数やJSONの形は元アプリを読んで決める。

```js
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

```sh
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

工数は `integrate.mjs measure <appName> --report=file`。報告はreporter/source/startedAt/completedAtと、codeEdits/commandInputs/configEdits/vbaEdits/hashTranscriptionsの実測回数。組み込み者の操作だけを数え、AIのコマンドを人の操作として数えない。未測定値を0に補わない。
