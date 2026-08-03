# JUST Calc 連携 HTML アプリ 最小実装

共有されたChatGPT会話の結論を、動作確認に使える最小構成へ落とし込んだサンプルです。

この構成では、`.xlsm` だけを正式データとして扱います。HTMLはその時点のデータを表示・編集する一時画面、JSONは `.xlsm` とHTMLの間を往復する一時ファイルです。HTMLやJSONを独立したデータベースとして運用しません。

> このリポジトリではHTMLの構文とDOM動作を自動テスト済みですが、JUST Calc本体はこの開発環境にないため、マクロは対象バージョンと社内環境で実機確認が必要です。JUST Calc 6はExcelマクロの実行に対応し、多数のAPI互換を案内していますが、完全互換ではありません。特に `ThisWorkbook.ReadOnly`、`Application.GetOpenFilename`、`ADODB.Stream`、`WScript.Shell` を確認してください。

## 成果物

- [`vba/HtmlAppBridge.bas`](vba/HtmlAppBridge.bas): 標準モジュールへそのまま貼り付けるマクロ一式
- [`html/app.template.html`](html/app.template.html): そのまま配置できるHTMLテンプレート。単体で開くとデモデータで動作
- [`docs/acceptance-test.md`](docs/acceptance-test.md): JUST Calc実機で行う受入テスト
- [`tests/html-smoke.test.js`](tests/html-smoke.test.js): 追加パッケージ不要のHTMLスモークテスト

## 最終構成

```text
社内システム
  └─ .xlsmの排他制御（編集可能／読み取り専用を決定）
       └─ JUST Calcマクロ
            ├─ ブックのデータをJSON化
            ├─ 一時HTMLへJSONを埋め込んでブラウザ起動
            └─ HTMLが出力したJSONを検証してブックへ反映
                 └─ HTML
                      ├─ 編集モード
                      └─ 閲覧モード
```

役割分担は次のとおりです。

| 要素 | 役割 | 正式データを保持するか |
|---|---|---:|
| 社内システム | ファイル保管と排他制御 | － |
| `.xlsm` | 業務データ、管理情報、マクロ | はい |
| 一時HTML | 表示、入力、編集 | いいえ |
| 一時JSON | HTMLからJUST Calcへの受け渡し | いいえ |

## ファイル配置

ブックとHTMLを次の位置関係で配置します。

```text
業務フォルダー\
├─ 業務データ.xlsm
└─ html\
   └─ app.template.html
```

HTML起動時には、次のような一時ファイルが利用者の `%TEMP%` 配下に生成されます。

```text
%TEMP%\justcalc-html-app\app-session-yyyymmdd-hhnnss-xxxxxx.html
```

## 導入手順

### 1. ブックを用意する

対象ブックをマクロ有効形式の `.xlsm` で保存します。初回検証は必ず本番ファイルのコピーで行ってください。

### 2. HTMLを配置する

このリポジトリの `html` フォルダーを、`.xlsm` と同じフォルダーへコピーします。

### 3. マクロを貼り付ける

JUST Calcのマクロエディターで標準モジュールを1つ作り、[`vba/HtmlAppBridge.bas`](vba/HtmlAppBridge.bas) の全内容を貼り付けます。追加の参照設定は不要です。

### 4. 初期化する

次のマクロを1回だけ実行します。

```vb
InitializeHtmlAppSample
```

初期化によって、存在しない場合に限り次のシートとサンプル値が作成されます。

```text
業務データ
  1行目: id | name | department | note
  2行目: サンプルデータ

_APP_META（非表示）
  A1/B1: databaseId    / 自動生成ID
  A2/B2: schemaVersion / 1
  A3/B3: revision      / 0
  A4/B4: updatedAt     / 初期化日時
  A5/B5: updatedBy     / Windowsユーザー名
```

すでに `業務データ` シートの1行目にヘッダーがある場合、初期化マクロはその内容を上書きしません。

### 5. ボタンを割り当てる

最初のシートなど、利用者が操作しやすい場所へボタンを置き、次のマクロを割り当てます。

| ボタン表示 | 割り当てるマクロ |
|---|---|
| HTMLアプリを開く | `OpenHtmlApp` |
| JSONを取り込む | `ImportHtmlJson` |
| 状態を表示 | `ShowHtmlAppStatus`（PC間比較用の診断情報を表示） |
| APP_METAを表示 | `ShowAppMetaSheet`（任意） |

## 利用手順

### Macで作成し、Windows／JUST Calcで実行する場合

Mac版Excelでは、VBAの貼り付け、`InitializeHtmlAppSample` の実行、ボタンへのマクロ割り当て、`.xlsm` 保存まで行います。`OpenHtmlApp` と `ImportHtmlJson` の動作確認はWindows／JUST Calc側で行ってください。このサンプルのブラウザ起動とUTF-8ファイル処理は、Windows上の `WScript.Shell` と `ADODB.Stream` を使用します。

Windowsへは `.xlsm` だけでなく、`html` フォルダーを階層ごとコピーします。

```text
任意の業務フォルダー\
├─ 業務データ.xlsm
└─ html\
   └─ app.template.html
```

Mac側で `OpenHtmlApp` が動かなくても、VBAが正しく `.xlsm` に保存されていれば問題ありません。Windowsへコピーした後、`ShowHtmlAppStatus` で表示される `template` が、Windows上の実在する `app.template.html` を指していることを確認してください。

### 編集可能で開いた場合

1. JUST Calcで「HTMLアプリを開く」を実行する。
2. HTML上で行の追加、編集、削除を行う。
3. 「変更データを出力」を押し、JSONを保存する。
4. JUST Calcへ戻り、「JSONを取り込む」を実行する。
5. 出力したJSONを選択し、確認画面で「はい」を選ぶ。
6. マクロがデータを更新し、`revision` を1増やして `.xlsm` を保存する。

HTMLで編集しただけでは正式データは更新されません。JSON取り込みと `.xlsm` の保存が完了した時点で正式データになります。

### 読み取り専用で開いた場合

1. JUST Calcで「HTMLアプリを開く」を実行する。
2. マクロが `readOnly: true` を埋め込んだHTMLを生成する。
3. HTMLは入力欄を無効化し、行追加、削除、JSON出力を非表示にする。
4. JUST Calc側の取り込みマクロも、読み取り専用ブックへの取り込みを拒否する。

`ThisWorkbook.ReadOnly` の取得に失敗した場合も、安全側へ倒して閲覧モードになります。

## データ形式

`業務データ` シートの1行目を項目名、2行目以降をレコードとして扱います。項目数は固定ではなく、1行目のヘッダーから自動取得します。空行はHTMLへ出力しません。

生成される起動データと、HTMLから出力されるJSONの基本形は次のとおりです。

```json
{
  "databaseId": "c807f248-5d1d-4ff9-941d-47df8d717a18",
  "schemaVersion": 1,
  "revision": 125,
  "readOnly": false,
  "fields": ["id", "name", "department", "note"],
  "records": [
    {
      "id": "001",
      "name": "山田 太郎",
      "department": "営業",
      "note": "サンプル"
    }
  ]
}
```

マクロは取り込み前に、最低限次の項目を検証します。

| 検証 | 拒否する条件 |
|---|---|
| ブック状態 | 現在の `.xlsm` が読み取り専用 |
| `databaseId` | 現在のブックと一致しない |
| `schemaVersion` | 現在のブックと一致しない |
| `revision` | HTML起動時からブックが更新されている |
| `readOnly` | `true` のJSON |
| レコード構造 | 現在のヘッダーに対応する項目がない |
| `id` | `id` 列がある場合に、空または重複している |
| サイズ | 10,000件、JSON 10 MB、セル32,767文字のいずれかを超える |

## 実装上の判断

### `fetch("./data.json")` を使わない

一時HTMLは `file://` で開くため、別ファイルのJSONを `fetch()` する構成はブラウザ制限の影響を受けます。本サンプルはJSONを次の要素へ直接埋め込みます。

```html
<script type="application/json" id="app-context">
  { "databaseId": "...", "records": [] }
</script>
```

業務データ中の `<`、`>`、`&` はマクロ側でUnicodeエスケープし、`</script>` による埋め込みの破壊を防いでいます。

### 値は文字列として往復する

この最小実装は、業務データのセル値をすべて文字列としてHTMLへ渡し、取り込み先も文字列書式にします。そのため、次の用途は追加実装が必要です。

- 数値、日付、真偽値を型付きで扱う
- 数式を維持する
- セル単位の表示形式を維持する
- 入力規則や選択肢をHTMLへ反映する

`業務データ` に数式を置いた場合、HTMLへ渡るのは計算結果であり、JSON取り込み後は文字列になります。数式列は編集対象シートから分離するか、取り込み対象外にしてください。

### JSONは信頼せず、JUST Calc側で再検証する

HTMLのボタン非表示は誤操作防止であり、権限制御ではありません。保存可否、ブックID、版番号、項目、件数、文字数、ID重複はマクロ側でも検証します。

`databaseId` と `revision` は、別ブックや古い画面からの誤上書きを防ぐための値です。改ざん検知や本人認証の仕組みではありません。監査要件がある場合は、取り込み差分の記録、承認フロー、電子署名などを別途設計してください。

## カスタマイズ箇所

マクロ先頭の定数を変更すると、シート名やテンプレート位置を変更できます。

```vb
Private Const DATA_SHEET As String = "業務データ"
Private Const META_SHEET As String = "_APP_META"
Private Const TEMPLATE_FOLDER_NAME As String = "html"
Private Const TEMPLATE_FILE_NAME As String = "app.template.html"
```

テンプレートのフルパスは `ThisWorkbook.Path` を基準に組み立てます。Windowsの `\` とMacの `/` を自動判定するため、パス区切り文字を定数へ直接含めない実装です。

HTMLの列は `業務データ` のヘッダーから自動生成されます。項目ごとに日付入力、プルダウン、必須チェックなどを付ける場合は、`html/app.template.html` の `renderTable()` と `validateBeforeExport()` を変更してください。

## 制約

- HTMLから開いているJUST Calcへ直接保存しない。必ずJSONを経由する。
- HTMLを開いた後のブック更新はHTMLへ自動反映されない。最新状態はHTMLを開き直す。
- ブラウザを閉じても編集内容は自動保存されない。
- JSON取り込みは `業務データ` の2行目以降を置き換える。
- 本サンプルは最大10,000件を想定した最小実装で、大量データ向けの最適化はしていない。
- 一時HTMLは自動削除しない。Windowsの一時ファイル運用または社内ポリシーに合わせて定期削除する。
- 社内ポリシーでマクロ、ActiveX/COM、`WScript.Shell`、ブラウザダウンロードが禁止されている場合は、その制約に合わせた代替が必要。

## PCによって表示件数が異なる場合

両方のPCで `ShowHtmlAppStatus` を実行し、表示内容を比較します。特に次を確認してください。

- `workbook`: 同じ共有ファイルを指しているか。ローカルキャッシュや別コピーになっていないか。
- `dataSheet`: 両方とも `exists` か。
- `data.A2`: 2行目のIDが同じか。
- `lastRowByMacro`: マクロが認識した最終行。同じか、`-1` になっていないか。
- `usedRangeLastRow`: JUST Calcが認識する使用範囲の最終行。
- `recordsForHtml`: HTMLへ渡す予定の件数。
- `metaSheet`: 両方とも `exists` か。
- `databaseId` と `revision`: 両PCで同じか。

`業務データ` シート自体が空なら、別ファイル、ローカルコピー、同期前のファイルを開いています。シート上には行があるのに `recordsForHtml` が0または`-1`なら、そのPCのJUST Calcで最終行取得APIが正しく動いていない可能性があります。

最新版マクロは、通常の `End(xlUp)` に加えて `UsedRange` の最終行をフォールバックとして使います。JUST Calcの環境差によって `End(xlUp)` が常に1を返す場合でも、10,000件の上限内でデータ行を検出します。

`_APP_META` は `.xlsm` 内のワークシートなので、同じファイル実体を開いていれば業務データと一緒に共有されます。初期化では `業務データ!A1` の有無とは別に `_APP_META` を取得または作成します。`_APP_META` が本当に存在しない場合、現行版は空データで続行せず、起動エラーにします。

## 本番適用前に必ず確認すること

[`docs/acceptance-test.md`](docs/acceptance-test.md) を使い、対象のJUST Calcバージョン、社内システムの排他制御、既定ブラウザ、共有フォルダー権限を組み合わせてテストしてください。

ジャストシステムはJUST Calc 6について、Excelマクロ実行への対応と高いAPI互換率を案内しています。一方で、Excelとの非互換機能があり、保存時に未対応データが削除される場合も案内されています。本番ファイルのコピーと互換情報を確認してから適用してください。

- [JUST Calc 6 製品情報（マクロ実行対応）](https://www.justsystems.com/jp/products/justcalc/)
- [Microsoft Office Excelとの互換、操作性の違い](https://support.justsystems.com/faq/1032/app/servlet/qadoc?QID=058421)
- [元になった共有ChatGPT会話](https://chatgpt.com/s/t_6a555400fc788191bd9b60e1bdb938c3)

## HTMLのローカルテスト

Node.jsがある環境では、追加パッケージなしで編集モード、閲覧モード、行追加、JSON出力を確認できます。

```sh
node tests/html-smoke.test.js
```
