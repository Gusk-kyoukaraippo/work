# アプリ接続契約と実際の改修

初めて組み込む方は、先に [はじめての組み込みと使い方](../はじめての組み込みと使い方.md) を読んでください。準備するファイルから、入力・正式保存・終了まで順番に説明しています。

## 最小のデータ接点

共通部品は、起動情報 → `excel-gate-core.js` → `excel-gate.js` → 業務スクリプトの順で読み込みます。配布スクリプトが、入口HTMLの `EXCEL_GATE_START` / `EXCEL_GATE_END` で囲まれた部分だけを置き換えます。任意の業務コードを自動変換しません。

```js
ExcelGate.connect({
  ready: appReadyPromise, // 非同期初期化があれば、その全体の完了を渡す
  load(payload, { hasPayload, readOnly }) {
    if (hasPayload) applyExistingData(payload);
    else startEmptyProject();
  },
  exportData() {
    if (hasUnconfirmedInput()) throw new Error('入力を確定してから出力してください。');
    return getExistingBusinessJson();
  },
  setReadOnly(value) { setBusinessReadOnly(value); }
}).catch(showLoadFailure);
```

`load`・`exportData`・`setReadOnly` はPromiseを返せます。閲覧では先に `setReadOnly(true)` の完了を待ち、次に `ready`、`load` を待って操作を許可します。失敗は共通の停止画面を表示します。`load` は成功時に返り値不要、失敗は例外か `false`、キャンセルは `ExcelGate.CANCEL` です。`exportData` の `false` や `null` は有効な業務JSONであり、キャンセルには専用定数を使います。

`hasPayload:false` だけが初回です。保存済み `{}`、`[]`、`null` を初回へ読み替えません。アプリが受け付けない保存データは停止し、サンプルへ戻しません。`initialData(factory)` も提供していますが、既存の非同期復元を止める責任はアプリにあります。

JSONへ変換できない値、循環参照、非有限数、疎配列、深すぎる入れ子、10MiBを超える受け渡しは拒否します。取得・検証・ダウンロード開始に失敗した場合、出力番号・親IDを進めません。共通の再出力は同じ内容・ID・出力時刻のファイルを再ダウンロードします。

共通UIは `excel-gate-panel` のShadow DOMへ作り、起動待ち・読込エラー・終了出力後は共通のモーダルで操作を止めます。アプリの `main` やヘッダーを探して置き換えません。出力済みでもExcelへの正式保存完了とは表示しません。

## 設定

`gate.config.json` で `displayName`、`appId`、`dataVersion`、`entry`、`files`、`runtimeVersion`、`viewPolicy`、`authorRequired` を指定します。二つの配布版は `viewPolicy:"view"`、`authorRequired:true` です。閲覧を提供しない別アプリには `block` を指定でき、VBA変更は不要です。

`files` は必要なHTML・JS・CSS・画像等を明示する相対パスの一覧です。共通側が階層を保って一時フォルダへコピーします。絶対パス、親フォルダ参照、Windows上で衝突するファイル名を拒否します。入口より前の業務scriptと明示的CSPのある入口はビルド時に拒否し、個別検証を要します。JSモジュールのfetchやサーバーを必要とするアプリ、外部CDNの利用可否は自動解決しません。

`apps/*/index.html` は開発用に単独起動できます。進捗ボードの単独起動では元のlocalStorage処理が残ります。配布物の `runtime/index.html` を直接開くと停止します。必ず共有ブックから起動してください。

## 二つの実アプリの変更

差分の全量は [進捗ボード](diffs/progress-board.patch)、[改善ワークフロー](diffs/workflow-studio.patch) です。行数だけで改修負担が小さいとは判断しません。特にワークフロー元HTMLは一行に複数関数を持つため、変更行数が意味上の改修量より大きく見えます。

| アプリ | 基本接続・初期化・保存 | 閲覧を選んだことによる追加変更 |
| --- | --- | --- |
| 進捗ボード | IIFE内へconnectを追加。`loadState` の選択箇所で連携時のlocalStorage復元を止める。`saveState` は連携時に永続化せず、保存済み表示を変更。既存 `normalizeState` とstateを利用。`exportData` ボタンを共通出力へ接続。編集中／削除確認ダイアログが開いていれば出力を中止 | `gateReadOnly` と `assertEditable` を追加。新規・編集・確定・削除・JSON読込とWebMCP更新を防止。変更ボタンを無効化。フィルター・詳細表示・ガイドは維持 |
| 改善ワークフロー | 既存 `normalizeProject` → `startProject` と `createProjectPackage` を再利用。`saveJSON` を共通出力へ接続。未確定drawer・新規プロジェクト・印刷調整は確定／キャンセルを要求。`updateDirty` と終了警告を共通保存の意味へ接続 | エディター・新規確定・ファイル読込／ドロップ・印刷設定適用・人物削除・WebMCP更新を防止。文書移動・参照・ズームを維持。別アプリへのダッシュボード移動は、そのアプリのブックから始めるため非表示 |

両者とも業務JSONの構造・各業務画面・計算の意味は維持しています。共通管理情報（セッション、順番、親ID、保存者、受け渡しファイル名）は業務JSON内へ加えていません。保存UIのHTML/CSSもアプリ内へ移植していません。二つ目を接続するための共通VBAのアプリ固有変更はありません。

閲覧制御はアプリ固有の変更経路を確認する必要があります。`assertEditable` はそのための業務側のガードです。ブラウザAPIを一律に差し替える構成ではありません。更新経路を増やしたアプリでは、同じガードと閲覧試験の追加が必要です。

## 差分の計測値

| アプリ | 元の行数 | 追加行 | 削除行 |
| --- | ---: | ---: | ---: |
| 進捗ボード | 1,028 | 37 | 2 |
| 改善ワークフロー | 294 | 42 | 11 |

初期化・保存・閲覧制御を含む全差分です。元ファイルと改修版のSHA-256は `integration-metrics.json` に記録しています。
