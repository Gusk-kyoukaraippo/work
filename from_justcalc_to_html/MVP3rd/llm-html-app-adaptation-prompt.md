# JSON入出力HTMLアプリをMVP3rd Excelへ対応させるLLM依頼文

この文書を、対象のHTMLアプリ一式、MVP3rdフォルダ一式、入出力JSONのサンプルと一緒にLLMへ渡してください。

事前に次の3か所を対象アプリに合わせて置き換えます。

- **【アプリ名】**
- **【dataType】**：英数字とハイフンによる固定ID。例：`material-check`
- **【schemaVersion】**：初版は原則 `1`

---

## LLMへの依頼

添付したHTMLアプリを、添付したMVP3rdのExcel連携方式へ対応させてください。

### 目的

このHTMLアプリは、JSONを読み込み、画面で編集し、JSONとして出力するアプリです。

これを「1つのHTMLアプリに対して専用Excelを1つ用意する」構成に変更してください。複数アプリを選択するランチャーやアプリ登録機能は不要です。このExcelは、添付したHTMLアプリ専用として動作させます。

- アプリ名：**【アプリ名】**
- dataType：**【dataType】**
- schemaVersion：**【schemaVersion】**

### 基本方針

既存HTMLアプリの画面、入力項目、計算、JSON構造、業務上の検証処理は、可能な限り維持してください。

Excel／VBAは、次の共通機能を担当します。

- HTMLの起動
- 閲覧モードと編集モードの指定
- 保存者名、セッション、データ版の管理
- HTMLが出力した一時保存JSONの取り込み
- Excel内への正式保存
- 保存履歴
- 二重保存と保存の枝分かれ防止
- 読み取り専用制御
- CRC32、文字数、JSON構文の検証

HTMLアプリは、次の業務機能を担当します。

- Excelから渡されたpayloadの画面表示
- 利用者による入力と編集
- 必須項目、数値範囲、日付、重複などの業務検証
- 画面内容からpayloadを作成
- 共通形式の一時保存JSONをダウンロード

### 変更してはいけない範囲

次のMVP3rd共通仕様は維持してください。

- `formatVersion` は `2`
- `mvp2-core.js` の共通処理
- Excel内の `_APP_DATA`、`_APP_META`、`_APP_HISTORY`
- `accepted`、`rejected`、`.pending`、`.sessions` の保存方式
- `workCopy` と `complete` の区別
- `saveDataId`、`parentSaveDataId`、`exportSequence` による保存のつながり
- `databaseId`、`sessionId`、`dataType`、`schemaVersion`、`baseRevision` の一致確認
- 読み取り専用画面から保存できない仕様
- 一時保存JSONをExcelへ正式保存する二段階の操作
- `PREPARED` を使用した正式保存処理
- 同じJSONの二重取り込み防止

共通VBAや保存契約を不必要に作り直さないでください。

### HTMLへのコンテキスト受け渡し

HTMLには、次の記述を残してください。

```html
<script type="application/json" id="app-context">__APP_CONTEXT_JSON__</script>
<script src="mvp2-core.js"></script>
```

ExcelからHTMLへ、次の値が渡されます。

- `mode`
- `readOnly`
- `sessionId`
- `databaseId`
- `dataType`
- `schemaVersion`
- `baseRevision`
- `payload`

HTML起動時は、`app-context` の `payload` を既存アプリの入力データとして読み込んでください。

既存アプリがJSONファイルを読み込む処理を持っている場合は、その読込処理を再利用し、`context.payload` も同じデータ反映処理へ渡してください。

`payload` は業務データ本体です。`formatVersion` などの共通管理項目を、業務画面のデータへ混ぜないでください。

保存済みpayloadがある場合は、アプリの初期値やサンプルデータで上書きしないでください。保存データが空の場合だけ、必要に応じてアプリの初期データを使用してください。

### 業務アプリ側の共通インターフェース

既存コードへ、次に相当する処理を明確に設けてください。関数名は既存構成に合わせて調整して構いません。

```javascript
function writePayloadToBusinessScreen(payload) {
  // Excelから渡されたpayloadを既存アプリの画面へ反映する
}

function validateBusinessScreen() {
  // 必須項目、型、数値範囲、日付、重複などを検証する
  // 問題がある場合は利用者に分かる日本語で表示する
}

function readPayloadFromBusinessScreen() {
  // 現在の画面内容を、既存アプリ本来のJSON構造で返す
}
```

JSONのキー名、配列、入れ子、数値、文字列、真偽値、`null` の意味を勝手に変更しないでください。

構造変更が必要な場合は、変更理由と旧形式からの変換方法を示し、`schemaVersion` を上げてください。

### 閲覧モード

`context.mode` が `view`、または `context.readOnly` が `true` の場合は、閲覧専用にしてください。

閲覧モードでは次を守ってください。

- 保存者名を入力させない
- 入力欄を編集できない状態にする
- 追加、削除、保存、ダウンロード操作を表示しない
- Excelに保存されているpayloadを表示するだけにする
- 閲覧しただけでExcelやデータを変更しない

### 編集モード

編集モードでは、保存者名を毎回空欄から入力させてください。

保存者名は次の条件です。

- 前後の空白を除去
- 1文字以上50文字以下
- 制御文字を禁止
- ブラウザへ保存しない

保存前に業務画面の検証を行い、問題がある場合はJSONを出力しないでください。

### 一時保存JSONの作成

既存アプリが出力していた業務JSONは、`payload` として扱ってください。

Excel連携用の保存では、独自に外枠を作らず、`MVP2Core.createEnvelope()` を使用してください。

概念的には次の処理にしてください。

```javascript
const payload = readPayloadFromBusinessScreen();

validateBusinessScreen();

const envelope = MVP2Core.createEnvelope(
  context,
  state,
  authorName,
  saveKind,
  payload,
  new Date()
);

const fileName = MVP2Core.makeFileName(envelope);
const jsonText = JSON.stringify(envelope, null, 2) + "\n";
```

`saveKind` は次のどちらかです。

- `workCopy`：作業途中の一時保存。保存後も同じ画面で編集を続ける。
- `complete`：作業終了用の一時保存。保存後は編集画面を閉じ、Excelへ戻る案内を表示する。

`MVP2Core` が生成する次の項目を維持してください。

- `formatVersion`
- `saveDataId`
- `parentSaveDataId`
- `sessionId`
- `databaseId`
- `dataType`
- `schemaVersion`
- `baseRevision`
- `exportSequence`
- `authorName`
- `exportedAt`
- `saveKind`
- `readOnly`
- `payload`

Excelから渡された `databaseId`、`sessionId`、`dataType`、`schemaVersion`、`baseRevision` を変更しないでください。

`exportSequence` は保存ごとに1ずつ増やし、`parentSaveDataId` には直前の `saveDataId` を設定してください。

「もう一度ダウンロードする」では、新しいJSONを生成せず、直前と完全に同じファイル名、`saveDataId`、本文を再利用してください。

### アプリ固有設定

この専用Excelでは、次の値を設定してください。

- 表示名：**【アプリ名】**
- dataType：**【dataType】**
- schemaVersion：**【schemaVersion】**

`databaseId` はExcelの初期化時に生成し、コードへ固定値を書かないでください。

`dataType` は、このHTMLアプリ専用の固定識別子として使用してください。

payloadの必須項目や意味を変更した場合だけ `schemaVersion` を上げてください。同じ `schemaVersion` のまま、既存項目の意味を変更しないでください。

### ファイルとアセット

最終構成は、原則として次の形にしてください。

```text
【アプリ名】/
├─ 【アプリ名】.xlsm
├─ html/
│  ├─ app.template.html
│  ├─ mvp2-core.js
│  └─ assets/
├─ vba/
└─ docs/
```

Excelと `html` フォルダの相対位置を変えないでください。

既存HTMLアプリが外部のCSS、JavaScript、画像、JSONなどを使用している場合は、CDNやWebサーバーへ依存せず、ローカルファイルとして同梱してください。

可能であれば、CSSとアプリ固有JavaScriptは `app.template.html` へまとめてください。

別ファイルとして残す必要がある場合は、VBAが一時実行フォルダへ必要なアセットをコピーするよう調整してください。現在の処理が `mvp2-core.js` だけをコピーしている点に注意してください。

### ブラウザ互換性

このHTMLは、Windowsのローカルファイルとして既定ブラウザから起動します。

次を前提に実装してください。

- `file:` 形式で動作する
- Webサーバーを必要としない
- APIサーバーやCDNを前提にしない
- オプショナルチェーン `?.` を使わない
- `replaceChildren` を使わない
- 複数要素を渡す `append` を使わない
- 要素の `remove` を使わず `removeChild` を使用する
- `sessionStorage` が使用できない場合でも、開いている画面内では保存処理を継続できる
- 編集画面の再読み込みを前提にしない

既存アプリが新しいブラウザ機能を使用している場合は、対象環境で動く実装へ置き換えてください。

### データ上限

次の上限を維持してください。

- UTF-8ファイルは10MiB以下
- JSONは10,485,760文字以下
- JSONの入れ子は64階層以下

画像や添付ファイルをBase64にしてpayloadへ直接保存しないでください。

### Excel操作パネル

利用者に見えるExcelシートは「操作パネル」だけにしてください。

操作パネルには次の操作を残してください。

- 閲覧する
- 編集する
- 一時保存ファイルをExcelに正式保存する
- ログチェック（管理者向け）
- 終了する

タイトルや説明文には **【アプリ名】** を表示して構いませんが、操作の意味と順序は変更しないでください。

古い「セーブデータ」という用語は使わず、「一時保存」「正式保存」に統一してください。

### 確認項目

調整後、最低限次を確認してください。

1. Excelの「閲覧する」から保存済みpayloadを閲覧できる
2. 閲覧画面では編集・保存できない
3. Excelの「編集する」からHTMLを起動できる
4. Excelのpayloadが既存アプリの画面へ正しく反映される
5. 画面で編集した内容が同じJSON構造のpayloadになる
6. `workCopy` の一時保存後も編集を続けられる
7. `complete` の一時保存後はExcelへ戻る案内だけになる
8. ExcelがダウンロードフォルダからJSONを検出できる
9. 一時保存JSONをExcelへ正式保存できる
10. Excelを閉じて開き直しても、保存した内容を再現できる
11. 同じJSONを再度取り込んでもrevisionが増えない
12. 別Excel、別session、別dataType、別schemaVersionのJSONを拒否する
13. 読み取り専用Excelでは編集と正式保存を拒否する
14. 既存のMVP3rd自動テストがすべて通る
15. このHTMLアプリ用の読込・保存テストを追加する

### 提出物

作業後、次を提示してください。

- 変更したファイルの一覧
- 既存HTMLアプリのJSONとpayloadの対応関係
- 設定したdataTypeとschemaVersion
- 既存アプリから維持した機能
- 変更または廃止した機能と理由
- 追加したテスト
- 自動テスト結果
- Windows／Excel／JUST Calcで実機確認が必要な項目
- 残っている制約

既存の業務仕様が判断できない部分は、勝手に項目や意味を変更せず、仮定として明示してください。

---

## LLMへ一緒に渡すファイル

- 対象HTMLアプリ一式
- MVP3rdフォルダ一式
- 正常な入出力JSONのサンプル
- 空データまたは初期データのJSON
- 配列や入れ子を含むJSON
- 可能であれば入力エラーになるJSON
- アプリ固有の業務ルールや操作説明
