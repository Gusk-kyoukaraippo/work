# Windows / JUST Calc / Edge 実機試験

空の検証用配布フォルダを共有場所へ置き、二台のPCで実施します。業務正本では実施しません。
試験者、日時、Windows・JUST Calc・Edgeの版、PCの識別名、共有方式を記録します。
候補パッケージの `release-manifest.json` のハッシュを記録に添付します。

| 記録キー | 操作と合格条件 |
| --- | --- |
| setup | 完成xlsmを配置し、VBA編集やコマンド入力なしで画面の「初回設定」が完了する |
| roundTrip | 両アプリで編集→入力を終える→保存して終了。通常時のファイル選択・取り込み確認なし。完了通知は一度。再起動してデータ一致 |
| midSave | 途中保存の準備→保存して続ける。ブックとセッションを維持。同じ名前・同じEdgeで続け、最後に終了保存できる |
| readOnly | 他者の編集中に保存済みデータを閲覧できる。追加・削除・読込・外部更新は不可、検索・文書移動は可能 |
| twoPcLock | 同じ共有正本を二台で開き、正式更新できるのは一台だけ |
| handoff | 終了保存後にブックが閉じ、次のPCが編集できる |
| wrongKind | 途中用を終了ボタン、終了用を継続ボタンで保存しようとすると、案内して停止。PREPAREDの再開でも一致が必須 |
| missingDuplicateForeignBranch | 未着・重複・別ブック・別セッション・タブ複製分岐・途中ファイル欠落を試し、古い内容を誤保存しない。同一再出力は一回だけ取り込む |
| networkFailure | pending作成・PREPARED保存・原本公開・最終保存で通信断。未完了表示、元データと再開情報を保持。同じボタンで一度だけ確定 |
| restartRecovery | PREPARED途中でプロセス異常終了し、再起動から復旧。古い編集画面からの保存を拒否 |
| closeFailure | 保存後の終了失敗を注入。保存済みと表示し、再操作は閉じる処理だけ。履歴・revisionが増えない |
| otherWorkbookUnchanged | 別の未保存ブックを同時に開き、ゲートの終了で他のブックやアプリを終了・保存しない |

ダウンロード先を変更した場合・未確定フォーム・空データ・マクロ無効・初回設定中断も確認します。
ファイル選択が必要なのは未着や保存先変更時だけです。通常利用PCはWindowsのダウンロード先とEdgeの保存先を合わせます。

## 障害注入

開発者が `GateDeployment.bas` の `GATE_TESTING` をTrueにした別の試験ブックを作り、`tests/windows/GateFailureTests.bas` を取り込みます。
本体と違うテストブックで実行します。`GateRunFailureTests` は保存失敗・再試行を、`GateRunSaveKindTests` は保存方法の一致を確認します。
別の新しい空の試験ブックで `GateRunImporterTests` を実行し、取り込みの保存方法判定・重複拒否・PREPARED再開・終了再試行時の重複防止を確認します。
終了失敗は `gGateTestFailStage = "close"` にして終了保存を実行し、完了通知後の失敗と再試行を確認します。
注入試験は実際の通信断・二台排他・再起動試験の代わりにはなりません。

## 検収記録

`verification/target-acceptance.example.json` を `target-acceptance.json` としてコピーし、実測した情報と合否だけを書きます。
`appHashes` には各候補パッケージの `hashes` をアプリIDごとに転記します。
未確認はfalseのままとし、全項目の合格・完成ブックと配布ファイルの一致後だけ `status` をpassedにします。
試験用マクロを含まない完成ブックで、通常動作をもう一度確認します。
