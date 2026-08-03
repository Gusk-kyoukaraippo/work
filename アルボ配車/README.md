# ALBO 配車支援

このフォルダでは、実際に作成した時系列に沿ってMVPを分けています。各版はそれぞれの`index.html`をダブルクリックし、`file://`で単体起動できます。

## 各MVPの位置づけ

| 版 | 役割 | 配車の作り方 | 起動ファイル |
|---|---|---|---|
| MVP 1st | 利用者住所を伊勢崎市の概略地図へ表示 | 配車は作らない | [起動](MVP1st/index.html) |
| MVP 2nd | 地図上の利用者を車両別に手動でつなぐ | 担当者が手動作成 | [起動](MVP2nd/index.html) |
| MVP 3rd | 正確な道路地図で住所位置を確認し、車両・車いす・ミラー条件を守る候補を最大5案生成 | 住所位置を確認・補正した後、アルゴリズムが候補作成 | [起動](MVP3rd/index.html) |
| MVP 3.5 | A/Bの既存訪問先から両ルートを再作成し、任意のC訪問先をA/Bへ自動配分 | A/B固定＋任意のC自動配分 | [起動](MVP3.5/index.html) |

MVP 3rdは従来版のまま保存し、訪問日程調整はMVP 3.5へ分離しています。

MVP 3rdでは、CSVの住所をデジタル庁ABRの地番・枝番、住居表示街区、町字・丁目の順で照合し、詳細道路地図に表示します。入力住所、照合住所、未一致部分、座標情報元は別々に確認でき、地図クリックで座標を補正できます。模擬データ2は27人全員に座標があり、うち8人はABR地番代表点、1人はABR街区代表点です。安全な駐車位置は今回の対象外です。

MVP 3.5では、A.csvとB.csvの所属を固定したまま道路距離に基づいて両方の訪問順を再作成します。C.csvは任意で、入力された場合だけ各住所をA/Bへ自動配分します。

## フォルダ構成

```text
アルボ配車/
├── README.md
├── MVP1st/
│   ├── index.html
│   ├── README.md
│   └── archive/
├── MVP2nd/
│   ├── index.html
│   ├── README.md
│   └── post_visit_strategy.md
├── MVP3rd/
│   ├── index.html
│   ├── README.md
│   ├── requirements.md
│   └── algorithm_concept.md
├── MVP3.5/
│   ├── index.html
│   ├── README.md
│   ├── requirements.md
│   └── visit-samples/
├── src/                 # MVP 3rd・MVP 3.5の編集元
├── scripts/             # データ・HTML生成とテスト
├── data/                # 共通住所データとMVP 3rd道路データ
├── assets/              # 概略地図画像
├── sample-data/         # 過去版の確認用CSV
└── docs/                # 初期構想などの履歴資料
```

## 名前が混在していた理由

初期の[構想メモ](docs/initial_project_memo.md)では、機能を次のように番号付けしていました。

1. 地図への打点
2. 属性による色分け
3. 手動ルートの可視化
4. ルート自動出力

実際の開発では「属性の色分け」より先に「手動ルート作成」を実装したため、構想上のMVP番号と成果物の呼称がずれていました。

今後は混同を避けるため、構想上の機能番号ではなく、上表の実際の成果物をMVP 1st・2nd・3rdと呼びます。

## 開発時の注意

- 各MVPフォルダの`index.html`は完成版です。
- MVP 3rdを修正するときは、`src/`を編集して`node scripts/build-mvp-third-html.mjs`で再生成します。
- `MVP3rd/index.html`を直接編集すると、次回ビルドで上書きされます。
- MVP 3.5を修正するときは、`src/mvp-three-five-*`と`src/mvp_three_five.template.html`を編集し、`node scripts/build-mvp-three-five-html.mjs`で再生成します。
- `MVP3.5/index.html`を直接編集すると、次回ビルドで上書きされます。
- 住所・道路データの出典と注意事項は[data/README.md](data/README.md)を参照してください。
