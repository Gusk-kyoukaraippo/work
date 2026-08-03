# 業務HTMLへの差し替えガイド

VBAはpayloadの形を固定しません。業務HTML側は、画面に合った入力部品からJavaScript値を作り、共通外枠の `payload` へ渡します。

## 維持するもの

- `mvp2-core.js`
- VBAが埋め込む `app-context`
- `formatVersion: 2` の共通外枠
- `sessionId`、`databaseId`、`dataType`、`schemaVersion`、`baseRevision`
- `exportSequence` と `parentSaveDataId` の更新
- `workCopy` と `complete` の区別
- 毎回空欄からの利用者名入力とVBA側の再検証
- 直前のJSONを同じ内容で再ダウンロードする処理
- 編集後だけの `beforeunload` 警告

## 差し替えるもの

現在の `textarea` と、次の2処理を業務画面へ置き換えます。

```js
function readPayloadFromBusinessScreen() {
  return {
    // 画面の入力値から作った任意のJSON値
  };
}

function writePayloadToBusinessScreen(payload) {
  // Excelから受け取ったpayloadを画面へ反映
}
```

保存時は `MVP2Core.createEnvelope(...)` のpayload引数へ `readPayloadFromBusinessScreen()` の戻り値を渡します。

## schemaVersion

payloadの意味や必須項目を変える場合は `schemaVersion` を上げます。同じschemaVersionのまま項目の意味を変えないでください。VBAはブックのschemaVersionと一致しないJSONを拒否します。

## dataType

異なる業務画面を同じ保存基盤で使う場合は、業務ごとに固定したdataTypeを設定します。別業務のJSONを誤って取り込まないための識別子です。

## 画面側の検証

HTMLでは、入力必須、数値範囲、日付、行の重複など業務ルールを検証してからJSONを作ります。VBAは共通外枠、Excelとの対応、保存順、サイズ、JSON構文を検証しますが、業務固有の意味までは判断しません。

## 大きさと深さ

- UTF-8ファイル：10MiB以下
- JSON文字数：10,485,760文字以下
- 入れ子：64階層以下

画像や添付ファイルをBase64でpayloadへ直接入れる用途は、上限とExcelファイル肥大化のため推奨しません。
