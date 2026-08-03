# 伊勢崎市の住所・道路データ

## 道路ネットワーク

### ファイル

- `isesaki-road-network.json`: 再生成・検証用のJSON版
- `isesaki-road-network.js`: ブラウザへ直接読み込む場合のJavaScript版
- `../scripts/build-isesaki-road-network.mjs`: OpenStreetMapから再取得するスクリプト

### 収録範囲と件数

- 範囲: 伊勢崎市と市境周辺約2km
- 道路地点: 216,933
- 道路線: 51,465
- 有向辺: 478,964
- 道路種別: motorway、trunk、primary、secondary、tertiary、unclassified、residential、living_street、service、track、roadと各link

主要幹線道路だけでなく、住宅道路、構内・接続道路、農道等も含めています。歩道、階段、自転車道など、車両経路に使わない種別は除外しています。一方通行、未舗装、橋、トンネル、通行制限のフラグを保持します。

### 出典とライセンス

- © OpenStreetMap contributors
- Open Database License（ODbL）1.0
- https://www.openstreetmap.org/copyright

単体HTMLの地図上にも常時帰属表示を出します。再配布する場合も帰属表示とODbLの条件を維持してください。

### 注意

道路データは取得時点の静的スナップショットです。リアルタイム通行止め、時間帯規制、右左折禁止、車幅・高さ、私道の実運用を完全には保証しません。安全な駐車位置は今回のデータモデルの対象外です。配車候補の比較用として使用し、最終経路は現場で確認してください。

## 住所位置データベース

各MVPで利用者住所を概略位置へ変換するための静的データです。MVP 1st・2ndの完成HTMLには必要部分が埋め込まれており、MVP 3rdのビルド時にもこのデータを利用します。

### MVP 3rd用ABR住所データ

- `isesaki-abr-address-points.json`
  - デジタル庁アドレス・ベース・レジストリの伊勢崎市（LGコード `102041`）を、単体HTML埋め込み用に圧縮したJSONです。
  - 地番・枝番文字 288,962件、座標付き地番 71,895件、住居表示街区 200件、町字・丁目代表点 134件を収録します。
  - 建物名・棟・部屋番号と、伊勢崎市の住居番号データは収録しません。
- `../scripts/build-isesaki-abr-address-points.mjs`
  - 公式CSV ZIPをビルド時に取得し、上記JSONを再生成します。

再生成:

```sh
node scripts/build-isesaki-abr-address-points.mjs
```

出典: [デジタル庁 アドレス・ベース・レジストリ](https://www.digital.go.jp/policies/base_registry_address)。町字の文字情報以外の街区・住居・地番等は、公式の説明どおり試験公開データとして扱います。

地番・街区座標は住所照合用の代表点であり、個別建物、玄関、安全な駐車位置を表しません。

### 従来住所データ

## ファイル

- `isesaki-address-db-lite.js`
  - 軽量版データ。町域レベルのみを収録し、番地は `1-300, 甲乙丙` を町域座標からの擬似オフセットで解決します。
  - 町域の地図座標が `0,0` など未設定の場合は、周辺の既知町域から概略位置を補完します。
  - HTML側の初期読み込み用。

- `isesaki-address-db.js`
  - ブラウザでそのまま読み込むための JavaScript 版です。
  - `window.ISESAKI_ADDRESS_DB` にデータを格納します。
- `isesaki-address-db.json`
  - 同じ内容の JSON 版です。
  - 将来の再生成や検証用です。

## データ粒度

町・番地（番地キー）レベルを中心に扱います。

現時点の反映件数:

- 町域: 123（再構成時に自動取得）
- 番地: 500（町ごとに上限、`MAX_LOT`で調整可能）

番地は、`国土地理院 AddressSearch` で各町の番地をスキャンしています。  
`1〜SPARSE_SCAN_START` は「従来通り」連続未検出で打ち切り、`SPARSE_SCAN_START+1` 以降は
`町名<番号>番地` での簡易スキャンに切り替えて高番地の拾い漏れを減らします。

環境変数:
- `MAX_LOT`: 町あたりの最大番地
- `CONSECUTIVE_MISS_LIMIT`: 連続未検出で打ち切る回数
- `SPARSE_SCAN_START`: ここを境に軽量スキャンへ切り替え（デフォルト 250）

軽量版は以下で再生成:

- `node scripts/build-isesaki-address-db-lite.mjs`

軽量版のメンテナンス方針:

- 町名が存在するのに地図座標が未設定のものは、未対応住所に落とさず、周辺町域から概略補完する。
- 補完した町域は `mapSource` に `estimated-nearby:町名/町名/町名` を残す。
- 番地オフセットは、軽量化前DBの `gsi-estimated` と同じ計算式に寄せる。
- 送迎ルート検討用の概略位置として扱い、玄関位置や正確な番地位置とは見なさない。

取得できた番地は API 直取得、見つからない番地は町域座標からの推定値を使います。

実行時点で取得できた件数は住所の登録状況により変動します。見つからない番地は町域代表点から推定します。

例:

- `群馬県伊勢崎市連取町`
- `群馬県伊勢崎市赤堀今井町1番地`
- `群馬県伊勢崎市田部井町2番地`

番地そのものの正確な座標ではありません。番地が見つからない場合は、HTML 側で町域代表点から推定オフセットして表示します。

## 主な項目

```json
{
  "name": "赤堀今井町1番地",
  "fullAddress": "群馬県伊勢崎市赤堀今井町1番地",
  "level": "lot",
  "lat": 36.375959,
  "lng": 139.210273,
  "map": {
    "x": 242,
    "y": 125,
    "xRatio": 0.541387,
    "yRatio": 0.252016
  }
}
```

`lat` / `lng` が本体データです。`map.x` / `map.y` は現在の概略地図画像 `assets/isesaki-kuwamap-overview.png` 上で使うための仮投影座標です。

## 出典

- Geolonia 住所データ
  - https://geolonia.github.io/japanese-addresses/
  - MIT License
  - 国土交通省の大字・町丁目レベル位置参照情報をベースにした住所データです。

## 注意

このデータは送迎順を検討するための概略位置把握を目的にしています。家屋・玄関・正確な番地位置を示すものではありません。
