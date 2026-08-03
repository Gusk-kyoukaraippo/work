# QQgun

Gunma Isesaki Transport Autosaver Chrome extension.

## 使い方

1. Chrome で `chrome://extensions/` を開く。
2. 右上の「デベロッパー モード」をオンにする。
3. 「パッケージ化されていない拡張機能を読み込む」を押す。
4. このフォルダ `/Users/tama2025mini/work/QQgun` を選ぶ。
5. `https://www.med.pref.gunma.jp/member/ec_transport_result_monitor...` のページを開く。

ページ表示後、約3秒後に自動で伊勢崎エリアのデータ保存を開始します。一度保存した後は、24時間経過するまで再保存しません。

ページを開いたままの場合は約1時間ごとに再保存できる時間になったか確認します。

保存先は Chrome のダウンロードフォルダ内の `gunma-isesaki/` です。

## 別PCで使う場合

この `QQgun` フォルダごと別PCへコピーして、別PCの Chrome で同じ手順で読み込んでください。

この拡張機能はローカルサーバーではなく Chrome 拡張機能なので、実際にページを開いて保存処理を動かすPC側の Chrome に読み込む必要があります。
