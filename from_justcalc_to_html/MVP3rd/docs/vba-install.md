# VBA導入手順（Macで組み立て、Windowsで実行）

## 1. 配置

`MVP3rd` フォルダ全体を共有サーバーへコピーします。`.xlsm` は必ず `html` フォルダと同じ階層へ置きます。

```text
MVP3rd/
├─ MVP3rd.xlsm
├─ html/
├─ vba/
└─ ...
```

## 2. Mac版Excelでマクロ有効ブックを作る

1. `workbook/MVP3rd-operation-panel-template.xlsx` を開きます。
2. `名前を付けて保存` を選びます。
3. ファイル形式を `Excel マクロ有効ブック（*.xlsm）` にします。
4. `MVP3rd/MVP3rd.xlsm` として保存します。

## 3. 標準モジュールを入れる

Mac版Excelの `ツール > マクロ > Visual Basic Editor` または開発タブからVBAエディターを開きます。プロジェクトの対象ブックを選び、`ファイル > ファイルのインポート` から次を入れます。

1. `Mvp2Config.bas`
2. `Mvp2Json.bas`
3. `Mvp2Storage.bas`
4. `Mvp2Panel.bas`
5. `Mvp2Main.bas`

インポートするのは `vba` 直下のファイルです。これらは文字化けを避けるためCP932（Windows-31J）で保存しています。`vba/utf8` にある同名ファイルはレビュー・修正用のため、VBAへ直接インポートしないでください。

すでにUTF-8版をインポートして日本語が文字化けしている場合は、文字化けした5モジュールをVBAプロジェクトから削除し、`vba` 直下のCP932版をインポートし直してください。削除時に表示されるエクスポート確認は、元ファイルが残っているため不要です。

参照設定の追加は不要です。Dictionary、ADODB.Stream、Shellは実行時バインディングです。

## 4. ThisWorkbookイベントを入れる

VBAプロジェクトの `Microsoft Excel Objects > ThisWorkbook` を開き、`vba/ThisWorkbook.txt` の内容を貼り付けます。

## 5. コンパイルと初期化

1. VBAエディターで `デバッグ > VBAProjectのコンパイル` を実行します。
2. Excelへ戻り、マクロ一覧から `InitializeMvp2` を実行します。
3. 操作パネル以外のシートが見えないことを確認します。
4. 保存してExcelを閉じます。
5. 再度開き、マクロを有効化します。

初期化を再実行するとExcel内のJSONと履歴を消す確認が出ます。本番データが入った後は実行しないでください。

## 6. 最初の確認

- `編集する` で、名前入力モーダルが空欄で開く。
- JSONを変更し、`作業終了用に一時保存して終了` で一時保存ファイルを作れる。
- `一時保存ファイルをExcelに正式保存する` でダウンロードフォルダのJSONを見つける。
- 正式保存成功後、緑表示と最新版カードが更新される。
- 閉じて開き直しても、保存したpayloadが `閲覧する` で再現される。
- `ログチェック（管理者向け）` を開くと `管理者向け 保存ログチェック` と通常利用者は操作不要である旨が表示される。

## 7. Windowsへ移す

Macで `.xlsm` を保存した後、`MVP3rd.xlsm` だけをコピーせず、`html`、`vba`、`docs` を含む `MVP3rd` フォルダ一式をWindows PCまたは共有サーバーへコピーします。実行時に `.xlsm` は同じ階層の `html/app.template.html` などを相対パスで読み込みます。

Windows側では `.bas` の再インポートは不要です。完成した `.xlsm` を開いてマクロを有効化し、受け入れテストを実施します。

Mac上では組み立てと `InitializeMvp2` までに留め、HTML起動、JSON出力・取り込み、ダウンロードフォルダ検出はWindowsで確認してください。これらは `ADODB.Stream`、`WScript.Shell`、`Shell.Application` などWindows側の機能を使用します。

## JUST Calcでの確認

JUST Calcのマクロ編集・インポート方法に合わせて同じモジュールを登録します。`Application.OnTime` が利用できない場合、VBAは自動更新を無効化します。起動時、再アクティブ化時、各ボタン操作時、終了時の更新は継続します。

図形ボタンの `OnAction` が動かない場合は、同じ5マクロをJUST Calcのボタン割り当て機能で手動割り当てしてください。利用者向けマクロ名はREADMEに記載した5個だけです。
