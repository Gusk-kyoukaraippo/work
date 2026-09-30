# 共通ブックの原本

`MVP9th.xlsm` はMVP9th（内部版0.9.0）のマクロ原本です。通常の組み込みでは、AIが `MVP9th.build.json` と実ファイル・VBAソースの一致を確認し、専用生成処理で名前・表示を設定したブックをアプリの配布一式へ入れます。

ここにある原本では「初回設定」を押しません。業務データのない「操作パネル」一枚の状態を保ち、配布先へ置いたコピーで初回設定します。CSVフォルダ閲覧型の読込先は、そのコピーの初回設定で登録します。

原本には `GateSources` を含む10個の標準モジュールと `ThisWorkbook` のイベントを組み込みます。この版でアプリ名の取得・表示に関するVBAを変更しているため、以前のブックや照合記録はそのまま流用できません。

`MVP9th-template.xlsx` と `mac-manual` は、本体を修正・再作成するときの保守素材です。通常の導入には使いません。Mac版ExcelのVBEへ10個の本文とイベントを貼り付ける方法もありますが、保存後の埋め込みコード照合が必須です。[保守担当者向け手順](../docs/maintainers/README.md)

照合記録はWindows・JUST Calc・共有フォルダ・Edgeの動作保証ではありません。実施済みと未実施の範囲は [確認状況](../docs/verification.md) を参照してください。

原本の変更時はネイティブExcelで組み立て、verify-workbook.pyで埋め込みVBAを照合します。通常の配布時はpersonalize-workbook.pyで表示用XMLだけを変更し、VBAバイト列を保持します。原本と配布ブックのファイル全体のハッシュは異なります。masterSha256・workbookSha256・vbaProjectSha256・changedMembersをworkbook-generation.jsonで確認します。
