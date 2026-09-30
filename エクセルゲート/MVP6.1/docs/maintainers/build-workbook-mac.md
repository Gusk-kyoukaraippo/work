# Mac版Excelで共通ブックを更新・再作成する

**MVP6.1の通常導入では不要な、保守担当者向け手順です。** 同梱の完成xlsmを使える場合はそのコピーを利用してください。VBAを変更した場合や再作成が必要な場合だけ、以下を実行します。

これは、アプリごとに使い回す共通ブックを一度作る手順です。作るのは、マクロと「初回設定」ボタンが入った、業務データのない原本です。**原本では「初回設定」を押しません。**

現在の完成原本と照合記録はworkbookにあります。更新前の原本を保全し、コピーまたは開発用テンプレートを使って作業してください。Windows向けの保存処理はMacだけでは検収できません。

## 1. 必要なファイルを開ける状態にする

使うものは次の三つです。

| 用意するもの | 場所・使い方 |
| --- | --- |
| Mac版Microsoft Excel | VBAを編集できるデスクトップ版を使います |
| [MVP6th-template.xlsx](../../workbook/MVP6th-template.xlsx) | 元になるブック。既に作成済みなので、作り直す必要はありません |
| [貼り付け用コードのフォルダ](../../workbook/mac-manual/) | 7個の標準モジュール用 `.txt` と、`ThisWorkbook.txt` を使います |

以下のファイルの場所は、すべて `MVP6.1` フォルダを基準にしています。Finderでプロジェクトを開き、`workbook` の中にテンプレートと `mac-manual` フォルダがあることを確認してください。

貼り付け用ファイルは、元のVBAからAIが生成したUTF-8のテキストです。コード欄へ貼れない属性行を除いてあります。コードの内容を自分で書き換える必要はありません。ソースを更新した後は、AIに貼り付け用ファイルの更新を依頼してください。

## 2. テンプレートを `.xlsm` として別名保存する

1. `workbook/MVP6th-template.xlsx` をMac版Excelで開きます。
2. シートが **「操作パネル」一枚**であることを確認します。シート名は変更しません。
3. Excelの **「ファイル」→「名前を付けて保存」**を開きます。版によっては「別名で保存」と表示されます。
4. ファイル形式で **「Excel マクロ有効ブック（.xlsm）」**を選び、`workbook` フォルダへ **`MVP6th.xlsm`** の名前で保存します。
5. Excelのタイトルで、今開いているブックが `MVP6th.xlsm` になったことを確認します。

同名の原本が既にある場合は上書きせず、先にAIへ状況を伝えてください。テンプレートの `.xlsx` は残します。ファイル名の末尾だけを変更しても、マクロ有効ブックにはなりません。[Microsoftのファイル形式の説明](https://support.microsoft.com/en-us/excel/copy-a-macro-module-to-another-workbook)

この段階では、まだコードは入っていません。シートに見えている「初回設定」の文字も、動くボタンかどうかの確認にはなりません。

## 3. VBAの編集画面を開く

1. Excelの **「開発」タブ→「Visual Basic」**を選びます。「開発」がない場合は、**「Excel」→「設定／環境設定」→「リボンとツールバー」**で、メインタブの「開発」を有効にします。[MicrosoftのMac版手順](https://support.microsoft.com/en-us/excel/use-the-developer-tab-to-create-or-delete-a-macro-in-excel-for-mac)
2. 別ウィンドウで開く **Visual Basic Editor（VBE）** の左側で、`VBAProject (MVP6th.xlsm)` を選びます。
3. 左側の一覧が見えなければ、VBEの **「表示」→「プロジェクト エクスプローラー」**を選びます。

以降は `MVP6th.xlsm` の中を編集します。他のブックや `PERSONAL.XLSB` が一覧にあっても選びません。

## 4. 七つの標準モジュールを作り、コードを貼る

「標準モジュール」は、マクロのコードを入れる場所です。次の表の **一行につき一つ**作ります。

| モジュール名 | 全文をコピーするファイル |
| --- | --- |
| `GateConfig` | [GateConfig.txt](../../workbook/mac-manual/GateConfig.txt) |
| `GateDeployment` | [GateDeployment.txt](../../workbook/mac-manual/GateDeployment.txt) |
| `GateJson` | [GateJson.txt](../../workbook/mac-manual/GateJson.txt) |
| `GateMain` | [GateMain.txt](../../workbook/mac-manual/GateMain.txt) |
| `GatePanel` | [GatePanel.txt](../../workbook/mac-manual/GatePanel.txt) |
| `GateRecovery` | [GateRecovery.txt](../../workbook/mac-manual/GateRecovery.txt) |
| `GateStorage` | [GateStorage.txt](../../workbook/mac-manual/GateStorage.txt) |

まず `GateConfig` で、次の操作を行います。

1. VBEで `VBAProject (MVP6th.xlsm)` を選び、**「挿入」→「標準モジュール」**を押します。`Module1` などが追加されます。
2. 追加したモジュールを選び、**「表示」→「プロパティ ウィンドウ」**を開きます。`(Name)` または「オブジェクト名」の値を **`GateConfig`** に変えます。プロジェクト全体の名前は変更しません。
3. Finderで `mac-manual/GateConfig.txt` を右クリックし、**「このアプリケーションで開く」→「テキストエディット」**で開きます。日本語が読めることを確認します。
4. テキストエディットの本文を **⌘A → ⌘C** で全文コピーします。
5. VBEの `GateConfig` をダブルクリックしてコード欄を開き、**コード欄の中をクリックしてから ⌘A → ⌘V** で置き換えます。最初から `Option Explicit` が入っている場合も、欄全体を置き換えます。
6. 残りの六つも同じ操作で作り、表の名前とファイルを一対一で対応させます。

七つとも先頭が `Option Explicit` になり、日本語のメッセージが文字化けしていないことを確認します。全部のコードを一つのモジュールにまとめたり、`.txt` のファイル名をモジュール名に含めたりしません。

## 5. 既存の `ThisWorkbook` にコードを貼る

`ThisWorkbook` は、ブックを開く・保存する・閉じるときの処理を受け持ちます。**既にある項目を編集します。新しい標準モジュールは作りません。**

1. VBEの `VBAProject (MVP6th.xlsm)` 内にある **「Microsoft Excel Objects」→「ThisWorkbook」**をダブルクリックします。
2. [ThisWorkbook.txt](../../workbook/mac-manual/ThisWorkbook.txt) をテキストエディットで開き、全文をコピーします。
3. `ThisWorkbook` のコード欄をクリックし、**⌘A → ⌘V** で全文を貼り付けます。
4. `Workbook_Open`、`Workbook_Activate`、`Workbook_BeforeClose`、`Workbook_BeforeSave` の四つがあることを確認します。

この時点の構成は次のとおりです。シートのコード欄は空のままにします。

```text
VBAProject (MVP6th.xlsm)
├─ Microsoft Excel Objects
│  ├─ Sheet1 (操作パネル)  ← 先頭のSheet番号は異なることがあります
│  └─ ThisWorkbook        ← 手順5のコード
└─ 標準モジュール
   ├─ GateConfig
   ├─ GateDeployment
   ├─ GateJson
   ├─ GateMain
   ├─ GatePanel
   ├─ GateRecovery
   └─ GateStorage
```

## 6. コードを確認し、「初回設定」ボタンを作る

1. VBEで **「デバッグ」→「VBAProjectのコンパイル」**を選びます。コンパイルはコードの構文などを確認する操作です。エラーが出たら、表示内容と強調された行をAIへ伝えます。エラーを消すために行を削除しないでください。
2. Excelのシート画面に戻り、**「開発」→「マクロ」**を開きます。
3. マクロの保存先を選べる場合は `MVP6th.xlsm` を選び、一覧から **`GateShowSetupPanel`** を選んで **「実行」**を押します。
4. 「操作パネル」に **「はじめに一度だけ設定します」**という案内と、**「初回設定」ボタン**が表示されたことを確認します。
5. **⌘S** で保存します。ファイル形式は `.xlsm` のままにします。

ここで実行するマクロは **`GateShowSetupPanel`** です。これはボタンを作る処理です。**`InitializeGate` の実行や、作った「初回設定」ボタンのクリックはしません。** 共有場所の登録は、配布したコピーで後から行います。

## 7. 保存したブックを開き直し、AIへ渡す

1. 作成した `MVP6th.xlsm` だけを閉じ、同じファイルを開き直します。自分で組み込んだこのブックのマクロ実行について確認が出た場合は、職場の方針に従って許可します。
2. エラーが出ず、「操作パネル」一枚と「初回設定」ボタンが表示されることを確認します。VBEでも七つの標準モジュールと `ThisWorkbook` のコードが残っていることを確かめます。
3. **初回設定を押さずにブックを閉じて**、AIへ次のように伝えます。

> Mac版Excelで、workbookフォルダにMVP6th.xlsmを作りました。初回設定は実行していません。埋め込みコードとボタンを照合し、実機検証用の配布準備を進めてください。

AIはブックに埋め込まれたコード、モジュールの過不足、ボタンへのマクロの割り当て、未初期化であることを調べます。合格した場合に `MVP6th.build.json` という照合記録を作り、HTMLと組み合わせて再試験します。**ボタンが表示されたことだけで、配布可能・利用開始可能とはしません。**

作成後のWindows／JUST Calc／Edgeでの確認にも、利用者PCへのNode.jsの追加は不要です。試験ツールの実行や結果の記録はAI環境で行い、実際のPCではブックとEdgeの操作を確認します。

## 困ったとき

| 状況 | 確認すること |
| --- | --- |
| GateJsonのReDim行で「構文エラー」 | Macへの貼り付けで一部の文字が変わった事例があります。[修正済みコードへの差し替え手順](mac-compile-fix.md) に従って、該当する五つのモジュールを更新します |
| 日本語が文字化けする | `vba` 内の `.bas` ではなく、`workbook/mac-manual` 内のUTF-8の `.txt` を開いているか確認します。解消しなければその表示をAIへ伝えます |
| `Attribute VB_Name` の行が赤くなる | 貼り付け用ではない元の `.bas` を使った可能性があります。そのモジュールのコード欄全体を、対応する `.txt` の全文で置き換えます |
| モジュール名を変えられない／名前が重複する | 既に同名のモジュールがないか確認します。作り直すために項目を増やし続けず、現在の一覧をAIへ伝えます |
| `GateShowSetupPanel` が一覧にない | 対象が `MVP6th.xlsm` か、`GatePanel` が標準モジュールにあるか、コードを最後まで貼ったか確認します |
| 「操作パネル」が見つからないエラー | テンプレートのシート名を変更していないか確認します |
| マクロが無効と表示される | 対象ブックに対する実行設定を確認します。すべてのブックのマクロを一律に許可する必要はありません |
| 初回設定を押してしまった | そのブックを原本として使わず、AIへ状況を伝えます。管理用シートを手で消して未初期化に戻そうとしないでください |

## AI・本体開発者向けの補足

利用者が行う操作は上の手順までです。以下はAI環境で実行します。

- 貼り付け用ファイルの更新：`python3 scripts/prepare-mac-manual.py`。UTF-8編集元とCP932ソースの一致を先に確認し、属性行を除いた七つの本文とブックイベントを出力します。`source-manifest.json` は貼り付け用ファイルの照合情報であり、ブックの検証記録ではありません。
- 作成後の照合：`python3 scripts/verify-workbook.py`。AI側にPythonとoletoolsを用意します。利用者へコマンド入力や照合値の転記を依頼しません。
- 原本が検証対象に加わるため、アプリのブラウザ試験を再実行してから実機検証用の一式を作成します。以降は [本体・アプリ・導入先の検証](target-tests.md) に従います。

操作説明は、Microsoftの [プロパティウィンドウ](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/properties-window) と [コンパイルの説明](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/debug-menu) も参照しています。メニュー名はExcelの版や表示言語により多少異なります。
