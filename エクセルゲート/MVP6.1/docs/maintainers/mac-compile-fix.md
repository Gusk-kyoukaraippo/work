# MacでGateJsonのReDim行が構文エラーになったとき

MVP6.1の完成原本には修正を反映済みです。以下は、保守作業でコードを貼り付け直した際に問題が出た場合の対処です。通常の導入では実行しません。

2026年9月21日の組み立て中ブックを読み取ったところ、貼り付け元のバックスラッシュが、保存済みVBA内では別の文字（U+0080）に変わっていました。`GateJson` の整数除算だけでなく、JSONやパスの文字列でも同じ変化がありました。

再発を避けるため、文字列は `Chr$(92)` で必要な文字を作り、整数除算は `CLng(Fix(...))` で同じ結果を求めるコードに修正しました。Windows取り込み用ソースとMac貼り付け用ファイルも更新済みです。

## 既に貼り付けた人が行うこと

**次の五つの既存モジュールで、コード欄の全文を更新してください。** 一行だけ直しても、文字列に入った誤った文字が残ります。

| VBEで開くモジュール | 最新の貼り付け用ファイル |
| --- | --- |
| GateConfig | [GateConfig.txt](../../workbook/mac-manual/GateConfig.txt) |
| GateDeployment | [GateDeployment.txt](../../workbook/mac-manual/GateDeployment.txt) |
| GateJson | [GateJson.txt](../../workbook/mac-manual/GateJson.txt) |
| GateMain | [GateMain.txt](../../workbook/mac-manual/GateMain.txt) |
| GateStorage | [GateStorage.txt](../../workbook/mac-manual/GateStorage.txt) |

1. 最新の `.txt` をテキストエディットで開き直し、本文を **⌘A → ⌘C** でコピーします。以前から開いていたテキストではなく、ディスクにある更新後のファイルを使います。
2. VBEの `VBAProject (MVP6th.xlsm)` で、対応する既存モジュールをダブルクリックします。
3. **コード欄をクリックしてから ⌘A → ⌘V** で全文を置き換えます。モジュールを追加する必要はありません。
4. 五つの差し替えが終わったら、「デバッグ」→「VBAProjectのコンパイル」を行います。
5. エラーがなければ保存し、[手作業手順の「6. ボタンを作る」](build-workbook-mac.md#6-コードを確認し初回設定ボタンを作る) から続けます。

`GatePanel`・`GateRecovery`・`ThisWorkbook` は今回の差し替え対象ではありません。

問題になった行は、更新後には次のようになります。

```vb
ReDim parts(0 To CLng(Fix(Len(jsonText) / PART_SIZE)) + 2)
```

AIは編集中のブックを変更していません。修正後のMac版Excelでのコンパイル結果は、貼り替え後に確認します。別のエラーが出た場合は、メッセージと強調された行をAIへ伝えてください。
