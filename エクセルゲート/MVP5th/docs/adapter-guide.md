# 導入担当者向け — HTMLアプリの編集とExcelゲートへの適合

HTML作成者は、JavaScriptをすべてHTML内に組み込んだアプリを通常どおり作り、そのHTMLを導入担当者へ渡します。Excelゲート専用の接続を作成者側で組み込む必要はありません。
導入担当者は1人です。同じ人が、受け取ったHTMLのコピーの編集、Excelゲートへの適合、検証、配布準備、共有場所への配置、初回設定まで一貫して行います。

既存画面と業務JSONを維持し、読み込み・書き出し・閲覧制御を接続します。既存のブラウザ保存や未確定入力の扱いも、導入担当者がアプリごとに調整します。
HTMLの内部変数を自動解析して接続する機能ではありません。

## ひな型を作る

導入担当者の作業PCにNode.jsとMVP5thの開発用一式を用意し、MVP5thフォルダで実行します。利用者のPCにNode.jsは不要です。

```sh
node scripts/init-app.mjs /path/to/source.html my-app my-business-app "業務アプリ"
```

`apps/my-app/index.html` にコピーし、接続ひな型を作ります。元の業務JavaScriptはHTML内に残り、別ファイルへ分割する必要はありません。元ファイルと既存の出力先は上書きしません。画像・CSSに外部ファイルがある場合だけ、同じ位置関係で作業フォルダへコピーします。

導入担当者はHTML内のJavaScriptを確認し、既存の保存や画面更新を調整します。現在のツールが追加生成する `gate-adapter.js` はExcelゲート接続用のひな型です。そのTODOをアプリの処理で置き換えます。HTML内のクロージャでデータを保持している場合は、そのスコープ内に接続を移し、不要になったひな型と読み込みを削除します。

```js
ExcelGate.connect({
  ready: appReadyPromise, // 非同期復元があれば、その完了までを含める
  load(payload, info) {
    if (info.hasPayload) applyData(payload);
    else startEmpty();
  },
  exportData() {
    if (hasUnconfirmedInput()) throw new Error('入力を確定してください。');
    return getBusinessData();
  },
  setReadOnly(value) { setBusinessReadOnly(value); }
}).catch(showError);
```

各関数はPromiseも返せます。`hasPayload:false` だけが初回で、保存済みの空オブジェクト・配列・nullと区別します。
読込失敗でサンプルへ戻しません。`exportData` のキャンセルは `ExcelGate.CANCEL` を返します。
途中保存は `ExcelGate.exportFile('workCopy')`、終了準備は `ExcelGate.exportFile('complete')` です。呼び出し成功はダウンロード開始であり、ブックへの保存成功ではありません。

## アプリ側で確認すること

- 連携中のlocalStorage等からの復元・自動保存を停止し、正式データと競合させない。
- 画面の未確定入力を落とさない。取得できなければ、理由を示して出力を止める。
- 閲覧では追加・編集・削除・ファイル読込・外部更新APIを止め、検索・表示切替は残す。
- 保存者名・保存ボタン・出力管理は共通側を使う。既存の保存ボタンは連携中に隠すか共通APIへ接続する。

## 設定とビルド

導入担当者が管理する設定は `displayName`、変更しない `appId`、業務JSONの `dataVersion`、入口の `entry` です。
必要ファイルは専用アプリフォルダから自動収集します。業務データ・開発用ファイルをそこへ置きません。隠しファイルは収集せず、シンボリックリンクは拒否します。
共通部品の版とファイル一覧はビルド側が生成します。標準設定は閲覧あり・保存者名必須です。

```sh
node scripts/package.mjs --mode=development ./dev-output my-app
node scripts/package.mjs --mode=candidate ./candidate-output my-app
node scripts/package.mjs ./release-output my-app
```

developmentはHTML検証用、candidateは完成ブックを含む実機検証用、指定なしは検収済み配布です。
未完成の接続ひな型はビルドで拒否します。すでに存在する出力先への上書きも拒否します。
通常配布には、ソース照合済みのブックと、その配布内容に一致する実機検収記録が必要です。

共通の完成ブックはExcelゲート本体の提供物として用意する方針です。導入担当者は、それを適合させたHTMLと組み合わせて実機検証・配布準備を行い、同じ人が[共有場所への配置と初回設定](install.md)へ進みます。別の導入担当者への引き継ぎはありません。

対応範囲はfile://で動作するアプリです。サーバー必須・ES moduleの読み込み制約・独自CSP・外部CDNは自動解決しません。
