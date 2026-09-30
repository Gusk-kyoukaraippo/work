# MVP8th 検証記録

共通原本、HTMLの名前に合わせたブック生成処理、2アプリの配布フォルダとZIPを作成しました。本体・共通JavaScript・配布設定は **0.8.0** です。配布物は **実機検証用（candidate）** で、Windows・JUST Calc・Edgeでの業務利用の受け入れは未確認です。

## 自動試験

| 対象 | 結果 | 記録 |
| --- | --- | --- |
| 共通処理・生成・保存型／CSV型の回帰 | 97件成功、失敗0、スキップ0 | [実行ログ](../verification/regression.log) |
| 地ケア | 13件成功 | [ブラウザ記録](../integrations/community-care/browser-receipt.json) |
| 引継ぎメモ | 10件成功 | [ブラウザ記録](../integrations/handoff-notes/browser-receipt.json) |

地ケアはUTF-8／Shift_JIS、日本語ファイル名、複数月、不足・空・未対応CSV、元HTMLとの集計値比較、閲覧制御を確認しました。引継ぎメモは入力・検索・JSON往復・非同期取込・閲覧・終了後の変更禁止を確認しました。ブラウザ試験はMac Chromeのfile://と模擬起動情報によるものです。

同梱例以外の「物品貸出ノート」を通常のprepare→接続→identify→生成の工程で試験しました。HTMLタイトルと画面見出しの不一致、HTML改名後の新しい名前・案内・ブック、アプリID維持、ユーザー指定名の優先、HTML変更後の名前確認の失効を確認しています。Windows禁止文字・予約名・長い日本語名も試験しています。[試験コード](../tests/presentation.test.js)

生成ブックの見出しは数式ではなく文字列として保存されます。許可したXML以外の全ZIP部品、VBAバイナリ、未初期化状態、ブック内のボタン参照、任意色、分割した名前定数を検査しています。

## Excelでの実測

**macOS 26.5／Microsoft Excel 16.111.2** で実施しました。

- VBEで6個の変更モジュールを更新し、VBAProjectのコンパイル、GateShowSetupPanel実行、保存・終了を確認しました。
- 保存した共通原本から8標準モジュールとThisWorkbookを抽出し、UTF-8ソースおよびCP932配布ソースとの一致を確認しました。共通原本は「操作パネル」一枚で、業務データは未初期化です。[原本の照合記録](../workbook/MVP8th.build.json)
- 生成した「設備点検日誌.xlsm」をマクロ無効で開き、保存済みのアプリ名と「DX推進委員会 Excelゲート」を確認しました。修復通知はありませんでした。
- マクロ有効で再度開き、操作パネルの再描画後も名前が残ることを確認しました。
- 長い日本語名に `/ "記録" <確認>` を付けた別の生成物を開きました。ファイル名は短縮・置換され、画面では元の名前が折り返して表示され、初回設定ボタンと重ならないことを確認しました。

初回の生成試験でXMLのdefinedNames要素の位置が原因の読込エラーを検出しました。functionGroupsより後、calcPrより前に配置するよう修正し、上記2例を再生成して正常に開くことを確認しました。この順序を回帰試験にも追加しています。[実測記録](../verification/native-assembly-observation.json)

## 配布物と保持確認

- 共通原本：[MVP8th.xlsm](../workbook/MVP8th.xlsm)
- 地ケア：[配布ZIP](../deliverables/community-care.zip) ／ ブック名「地ケア・病床機能指標モニター.xlsm」
- 引継ぎメモ：[配布ZIP](../deliverables/handoff-notes.zip) ／ ブック名「引継ぎメモ.xlsm」
- MVP8th一式ZIPは、このフォルダ全体を対象に `node scripts/package-kit.mjs` で作成します。同梱のkit-manifest.jsonが収録ファイルを示します。

2アプリとも、設定・ブック名・保存済みの表示・導入案内が一致し、VBAは共通原本と同一、ZIPは配布フォルダの内容と一致しました。[配布検査](../verification/distribution-check.json)

MVP7thの280ファイルと元の地ケアHTMLは未変更です。両アプリのIDも維持しています。[保持確認](../verification/preservation-check.json)

## 未確認の項目

Windows・JUST Calc・Edgeでの初回設定、CSV取得、閲覧、正式保存、終了、実際の共有先の接続・権限・排他、複数PCでの動作は未実測です。Macでの表示確認やブラウザ試験を、その代わりの合格記録にはしていません。

職場では新しい検証場所と検証用データで [実機確認手順](acceptance-test.md) を実施し、使用PC・ソフトの版・実際の結果を記録してください。旧版の実測記録はverification/inherited-MVP7thに参照用として分離しています。
