# 設計レビューと修正版

## 確定要件

- index.html を file:// で直接開く完全オフラインのスキャンPDF OCR
- PDF、画像、結果、辞書、パスワードを送信・永続化しない
- 日本語・英語モデルを配布物へ同梱する
- 補正辞書はJSONファイルを毎回手動選択する
- デスクトップのマウスだけを対象とし、タッチ・ペン操作は不要
- 文書は最大でも概ね5ページ
- 現在ページで一つの矩形を選択し、OCR結果へ追記してから次の矩形を選ぶ
- 同一ページを複数回選択でき、結果はページ順ではなくOCR操作順に保持する
- 選択外を暗くし、実際に読み取る範囲を視覚的に明確にする

## レビューで判明した問題と修正

### 1. 一括ページ処理が最終操作要件と不一致

旧実装はページ範囲を入力し、ページ番号をキーにした Map へ一ページ一結果を保存していました。
この構造では同一ページの二つ目の矩形が一つ目を上書きし、ページ2からページ1へ戻るような操作順も
失われます。

修正版はページ範囲入力を廃止し、前後ボタンとページ選択だけにしました。結果は sequence を持つ配列で
追記し、出力時も操作順を唯一の順序とします。一つのactive rectangleだけを正規化座標
{x, y, width, height}（左上原点、各値0〜1）で保持します。

### 2. 矩形の視認性と座標ずれ

PDFプレビューの上に選択boxを重ね、box外側を大きな半透明shadowで暗くしました。マウスの
mousedown / mousemove / mouseup だけを使用し、タッチ・ペン用イベントは持ちません。

座標はCSS表示サイズのpixelではなく正規化値で保持します。ウィンドウ幅やブラウザ倍率が変わっても
割合で再描画でき、OCR時は同じ割合を高解像度ページへ変換できます。逆方向ドラッグ、ページ外への移動、
canvas外でのmouse up、極小矩形も処理しています。

### 3. サンプル字体がOCR評価に不適切

旧サンプルは5×7のブロックglyphをPDF矩形命令で組み立てていました。同梱モデルの品質ではなく、
学習字体とかけ離れた入力が主因で、smoke結果は期待 LOCAL OCR TEST 12345 に対して
LLLHL_LLE_ TEST 12245、信頼度68%でした。

修正版はブラウザcanvasへ通常の日本語・英語フォントで描き、JPEG化してPDF画像XObjectへ埋め込みます。
テキスト層を使わないため、実際に画像OCRを通ることも維持しています。

品質smokeも「非空なら成功」から、通常フォント由来の固定画像で代表語・数字・信頼度80%以上を必須とする
回帰試験へ変更しました。固定モデルでの現在値は LOCAL OCR SAMPLE 12345、95%です。

### 4. OCR入力解像度が低い（軽量版の基準）

旧設定1.5 / 2 / 2.5はPDFの72dpi換算で108 / 144 / 180dpiでした。標準144dpiの画像を渡しながら
OCRへ300dpiと固定申告していた点も不整合でした。

軽量版は軽量180dpi、標準300dpi、高精細最大360dpiです。表示用previewを切るのではなく、OCR時に
PDFページを別canvasへ再描画し、正規化矩形をpixelへ変換して切り抜きます。実際に使えたscaleから
round(scale × 72) を求め、Tesseractの user_defined_dpi へ渡します。

ページ描画は最大1,200万画素・一辺10,000pxに制限し、失敗時だけ一度75%へ下げます。
PDF自体は128 MB・20ページ、埋込画像は2,500万画素までとし、ページoptionを作る前に検査します。
表示previewにも250万画素・一辺4,096px・高さ1,600pxの上限があります。

### 5. 画像補正が原稿を悪化させても戻せない（軽量版の基準）

旧実装は原画像を破壊的にグレースケール・コントラスト伸長して一回だけ認識していました。きれいな原稿や
色文字では、補正が逆効果でも補正版しか結果に残りません。

軽量版は原画像を最初に認識します。比較設定がONなら、別canvasへ複製して穏やかなグレースケール・
2〜98 percentileのコントラスト補正を行い、二回目を認識します。非空、信頼度、有意味文字数、
不正文字数を点数化して良い候補を採用し、同点は原画像を優先します。切り抜きには16〜32pxの白余白を
追加し、矩形端の文字分割を安定させます。

矩形本文向けの既定PSMは6、一行用に7を追加し、自動回転は小領域で不安定なため既定OFFとしました。

### 6. 反復操作でOCR workerの起動が重い

一矩形ごとにworkerと言語モデルを初期化すると、反復操作の待ち時間が大きくなります。同じPDF・同じ
言語ではworkerを再利用し、PDFまたは言語の変更、worker失敗、中止、文書破棄時だけterminateします。
原画像と補正版の二回認識にも同じworkerを使います。

### 7. 中止と非同期競合

各OCR操作にrun identity、AbortController、PDF render task、worker resourcesを持たせています。
中止時は現在のrenderをcancelし、起動途中を含むworkerをterminateし、待機中Promiseもキャンセル競合で
解除します。現在の矩形は残し、追加済み結果は変更しません。古いcallbackはrun tokenで拒否します。

ページpreviewにも独立tokenを持ち、ページを素早く切り替えたときに古いrenderが新しいページへ
上書きしないようにしています。

### 8. 辞書の責務と安全性

OCRモデル jpn/eng.traineddata はアプリに同梱し、利用者の業務用補正辞書だけを毎回JSONで選びます。
辞書は最長一致・非連鎖のliteral置換で、正規表現は許可しません。5 MB、5,000件、from 合計
100,000文字、補正後文字数の上限を設けています。後から辞書を読み込む・外す操作は全resultへ適用し、
全文を手編集済みなら再生成前に確認します。

### 9. file:// と完全オフライン

PDF.js本体・worker、Tesseract.js本体・worker、LSTM core、日本語・英語モデルをすべて vendor へ
固定しています。Tesseract workerソースとsingle-file coreを同じBlobへ連結し、言語モデルをbyte列で
直接渡すため、file:// workerからの追加fetchや別Blob importScripts に依存しません。

PDF.js側はfile://制約により画面内fake workerを使います。そのため悪性・異常PDFのCPU処理を完全には
別threadへ隔離できませんが、128 MB・20ページ・埋込画像2,500万画素・preview/canvas上限と、
ロード中にも使えるPDF取外し操作で影響を抑えます。

CSPの connect-src none、メイン画面の通信API遮断、worker内のfetch / XHR / importScripts /
WebSocket / EventSource / 子worker遮断を重ねています。モデルcacheも無効です。

### 10. 精度を上げても単一HTMLを維持する

軽量版に加え、同じ画面・保存形式のまま処理量だけを段階的に増やす三つの版を用意しました。

- 画像強化版は選択ROIだけをPDF.jsへ直接高DPI描画し、PDF座標で2.5ptの外側余白を確保します。
  小角度のdeskew、原画像・コントラスト・Adaptive Otsu・Sauvola、最大2種のPSMを組み合わせます。
- 高精度モデル版は公式`tessdata_best`の非整数化floatモデルへ置き換え、横書き用の`eng`と
  `jpn`を同梱します。候補の信頼度だけでなく文字列一致度を評価し、最大8条件を比較します。
- 最大精度版はROIを最大40メガ画素・約600dpiまで許容し、4画像条件×3 PSMの最大12候補を比較します。
  候補間の一致が十分な場合は、文字単位の合議結果を使用します。

傾き回転後のcanvasも版ごとの画素・一辺上限へ収めます。コントラスト補正は原画像系の認識を
終えた最後に同じcanvasへ適用し、40メガ画素で不要な複製canvasを同時保持しません。候補文字列が
800文字を超える場合は先頭・中央・末尾を抽出して一致度を計算し、二次時間の文字列整列が画面を
長時間占有することを避けます。文字単位の合議は全文が上限内の場合だけ適用します。

高精度版のモデルbundleは約36.6 MiBですが、生成HTMLの中へ直接埋め込みます。どの版も
`file://`で一ファイルだけを開く構成、CSP、通信遮断、モデルbyte列のworker直接渡しを維持します。
高精度化は処理時間とメモリを増やすため、範囲・DPI・候補数は版ごとに上限を分けています。

## 状態モデル

~~~text
booting ─┬─> idle ─> loadingPdf ─> ready
         │                           │
         │                           ├─> preview page ─> select one region
         │                           │                         │
         │                           │                         v
         │                           └<────────────── running region OCR
         │                                                     │
         │                                                     └─> cancelling ─> ready
         └─> unsupported
~~~

成功時はresult配列へ追加して矩形を消し、次の選択待ちへ戻ります。文字なし・失敗時は矩形を残して
調整しやすくします。結果状態はapp全体のmodeへ混在させず、各resultの
success / warning / failed から集計します。

## 結果データ

各resultは次を保持します。

~~~text
sequence, pageNumber, normalized region
status, rawText, corrected text, confidence
selected variant/pass, planned/attempted/success/failed pass counts, agreement, per-candidate settings/text
render mode/scale, actual DPI, crop pixels, source margin, deskew result
dictionary replacements and errors
language, quality, layout, compare/rotate settings
duration and error code
~~~

TXTは文字を検出できたresultだけをsequence見出し付きで操作順に並べます。文字なし・失敗の診断は
JSONだけへ残すため、範囲調整後の成功結果へ診断文が混ざりません。JSON version 3は使用した
アプリ版、座標系normalized-top-left、候補群、手編集後の combinedText、combinedTextEdited も保存します。
同じPDFを読み込んだ後にversion 3を再選択すると、純粋関数で形式・上限・元PDF・全resultを検証してから
履歴全体を一括復元します。途中まで状態を書き換えないため、不正JSONや利用者による取消時も現在の結果を
保持します。辞書の置換規則は履歴へ含めないので、以後のOCRへ使う辞書は改めて選択します。

## 依存資産

- PDF.js 3.11.174
- Tesseract.js 7.0.0
- tesseract.js-core 7.0.0（LSTM single-file core）
- @tesseract.js-data/jpn 1.0.0（4.0.0_best_int）
- @tesseract.js-data/eng 1.0.0（4.0.0_best_int）
- tesseract-ocr/tessdata_best の横書き用 eng / jpn（高精度・最大精度版、固定commit）

すべて開発時に固定資産として取得し、`vendor/MANIFEST.json` または
`vendor-precision/MANIFEST.json` のSHA-256と照合します。配布物の実行時にネットワークアクセスは
ありません。
