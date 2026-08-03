# MVP2nd：JSON内蔵型セーブ管理

MVP2ndは、マクロ付きExcelを入口にしてHTMLで業務データを編集し、JSONをExcelへ取り込んで正式保存する試作実装です。MVP1との互換処理はありません。

利用者に見えるシートは、保護された `操作パネル` 1枚だけです。業務データは表へ変換せず、JSONのpayloadをそのままExcel内へ分割保存するため、オブジェクト、配列、入れ子、文字列、数値、真偽値、null、未知項目を共通VBAで扱えます。

## 実装済みの内容

- 操作パネルの5操作
  - `閲覧する`
  - `編集する`
  - `セーブデータをExcelに保存する`
  - `これまでの保存を見る`
  - `終了する`
- 赤・黄・緑の保存状態と、最新版・1つ前の保存カード
- HTML起動時の利用者名入力（毎回空欄、1～50文字、制御文字不可）
- 作業を続ける保存と、作業を終える保存の分離
- ダウンロードフォルダからの自動検出とファイル選択への切り替え
- 同じデータの二重取り込み防止、保存の枝分かれ検出
- Excel内JSONの20,000文字分割、文字数・CRC32検証
- acceptedへの原本保存、rejected、pending、sessionの各保管場所
- `PREPARED` を使った二段階確定と、確定途中からの再開
- 1分タイマーとJUST Calc向けの自動無効化
- 閉じる前の保存確認。PCへダウンロードしただけのデータは次回起動時に自動回復しない
- 読み取り専用時の閲覧専用表示と、編集・保存ボタンのグレーアウト
- 成功履歴だけを表示する読み取り専用HTML。過去版復元はなし

## フォルダ構成

```text
MVP2nd/
├─ README.md
├─ html/
│  ├─ app.template.html
│  ├─ history.template.html
│  ├─ mvp2-core.js
│  └─ json/
│     ├─ accepted/YYYY-MM/
│     ├─ rejected/YYYY-MM/
│     ├─ .pending/
│     └─ .sessions/
├─ vba/
│  ├─ Mvp2Config.bas
│  ├─ Mvp2Json.bas
│  ├─ Mvp2Storage.bas
│  ├─ Mvp2Panel.bas
│  ├─ Mvp2Main.bas
│  ├─ ThisWorkbook.txt
│  └─ utf8/              ← レビュー・修正用のUTF-8版
├─ workbook/
│  ├─ MVP2nd-operation-panel-template.xlsx
│  └─ MVP2nd-operation-panel-preview.png
├─ docs/
└─ tests/
```

月別の `accepted` と `rejected` は、最初の保存時にVBAが作成します。

## `.xlsm` の組み立て（Mac）

このフォルダには、見た目を確認できる `.xlsx` 原本と、インポート可能なVBAソースを分けて収録しています。VBAプロジェクトのバイナリはExcelまたはJUST Calc自身が作る必要があるため、初回だけ次の手順で `.xlsm` に組み立てます。

1. Mac版Excelで `workbook/MVP2nd-operation-panel-template.xlsx` を開く。
2. `MVP2nd` フォルダ直下へ、Excelマクロ有効ブック `MVP2nd.xlsm` として保存する。`html` フォルダと `.xlsm` の相対位置を変えない。
3. VBAエディターを開き、次の順で標準モジュールをインポートする。
   - `vba/Mvp2Config.bas`
   - `vba/Mvp2Json.bas`
   - `vba/Mvp2Storage.bas`
   - `vba/Mvp2Panel.bas`
   - `vba/Mvp2Main.bas`
4. `ThisWorkbook` のコード画面へ `vba/ThisWorkbook.txt` の内容を貼り付ける。
5. VBAの `InitializeMvp2` を1回実行する。
6. 保存して閉じ、再度開いてマクロを有効化する。
7. Macでの組み立てが終わったら、`.xlsm` 単体ではなく `MVP2nd` フォルダ一式をWindows PCまたは共有サーバーへコピーする。
8. Windows版Excelで開き、マクロを有効化して実機受け入れテストを行う。Windows側で `.bas` を再インポートする必要はない。

`vba` 直下の `.bas` は、Mac版ExcelのVBAエディターへ直接インポートするためCP932（Windows-31J）で保存しています。`vba/utf8` はコードレビューと修正用です。VBAへは `utf8` フォルダのファイルではなく、必ず `vba` 直下のファイルをインポートしてください。

Macは `.xlsm` の組み立てと初期化に使用します。HTML起動、ダウンロードフォルダ検出、JSON取り込みなどの本運用はWindowsで確認してください。

詳しい手順は [vba-install.md](docs/vba-install.md) を参照してください。

## 通常の利用フロー

1. 利用者が `.xlsm` を開く。
2. `編集する` を押す。
3. HTMLで利用者名を入力し、業務データを編集する。
4. 必要なら `作業中のデータをPCに保存して、編集を続ける` を使う。この時点でExcelへの取り込みは任意。
5. 作業を終えるときは `作業を終えて、Excelへ渡すデータを作る` を押す。
6. Excelへ戻り、`セーブデータをExcelに保存する` を押す。
7. 緑の `保存は完了しています` を確認する。

共有サーバー上のブックが読み取り専用で開かれた場合は、操作パネルに閲覧専用の案内が表示されます。`編集する` と `セーブデータをExcelに保存する` はグレー表示になり、`閲覧する`、`これまでの保存を見る`、`終了する` だけを利用できます。

Excelを閉じた後も残るのは、手順6が成功した内容だけです。PCへダウンロードしただけのJSONや、前回のExcelから開いたままのHTMLは、次回のExcelでは保存に使えません。

## JSONの扱い

HTMLが出力する共通外枠は `formatVersion: 2` です。VBAは外枠を検証しますが、payloadを表へ展開したり、項目順を並べ替えたりしません。Excel内では文字列外の空白だけを除去し、元のJSON原本はacceptedへバイト単位で保存します。

現在のHTMLは、異なるJSON構造を確認するための汎用JSON編集欄です。実際の業務画面へ置き換える場合も、共通外枠と保存処理を維持すればVBA側は変更不要です。詳細は [adapter-guide.md](docs/adapter-guide.md) を参照してください。

## 自動テスト

Node.js 18以降で次を実行します。

```bash
node --test tests/*.test.js
```

テストは、名前、JSON外枠、親子関係、ファイル名、sessionStorageの保存範囲、HTML文言、再ダウンロード、終了警告、VBA公開マクロ、タイマー、二段階確定、分割保存契約を確認します。

## 実機確認が必要な項目

VBAソースはExcel/Windows/JUST Calcの実機で最終確認してください。特に `Application.OnTime`、`Workbook_BeforeClose`、保護シート上の図形ボタン、Known Folder、`FileDialog`、共有サーバー切断中のファイル操作は製品差・環境差があります。

確認手順は [acceptance-test.md](docs/acceptance-test.md) にまとめています。

## 現時点の制約

- `.xlsm` へのVBAインポートは初回だけ手作業です。
- 汎用HTMLはJSONを直接編集する技術検証画面です。業務利用時は、対象データに合わせた入力画面へ差し替えます。
- ブラウザはダウンロードの完了を確実に通知できないため、HTMLは「ダウンロードを開始しました」と表示します。
- 過去版の閲覧一覧はありますが、利用者向け復元機能はありません。
- rejectedとacceptedからの復旧は管理担当の作業です。
