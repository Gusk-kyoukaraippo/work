# MVP2nd JPR iCloud Watchdog

Just Press Record が iCloud Drive に新しい録音フォルダを作ったことを Mac 上の常駐 Python で検知し、Twilio Calls API で自分の iPhone に電話通知します。

MVP2nd では録音ファイルの中身は読みません。まずは「Apple Watch からの録音が Mac 側に到達した」ことだけを通知します。

## Setup

```bash
cd /Users/tama2025mini/work/smartglass/mvp2_jpr_watchdog
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

`.env` に Twilio の値と監視フォルダを設定します。

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_NUMBER=+1xxxxxxxxxx
MY_PHONE_NUMBER=+819012345678
WATCH_DIR=/Users/your-user/Library/Mobile Documents/xxxxxxxx/Documents
TWIML_URL=https://xxxx.ngrok-free.app/twiml?message=新しい録音を検知しました
```

`TWIML_URL` は Twilio が通話応答時に読む TwiML URL です。`../mvp1_fastapi_twilio` の `/twiml` を公開している場合は、そのURLを使えます。
日本語の `message` はスクリプト側でURLエンコードしてからTwilioへ渡します。

環境変数の優先順位は `シェルで指定した環境変数 > mvp2_jpr_watchdog/.env > ../.env` です。

## Find The JPR iCloud Folder

候補を探します。

```bash
find "$HOME/Library/Mobile Documents" -iname "*Just*" -o -iname "*Press*" -o -iname "*Record*"
```

見つからない場合は広めに探します。

```bash
find "$HOME/Library/Mobile Documents" -type d | grep -i "record"
```

最終的には Apple Watch / Just Press Record で録音を 1 つ作り、Finder で保存先を確認して、そのディレクトリを `WATCH_DIR` に入れるのが確実です。

## Run

```bash
source .venv/bin/activate
python watch_jpr.py
```

起動時点で既に存在するフォルダは `seen_folders.json` に記録され、通知対象から外されます。これにより初回起動時に過去分で大量発信されることを避けます。

Just Press Record は日付フォルダの中に `23-57-45.m4a` のような録音ファイルを追加することがあります。そのため、このwatchdogは新規フォルダだけでなく `.m4a` などの録音ファイル作成も検知します。

## Dry Run

Twilio に発信せず、watchdog の検知だけ確認したい場合は `.env` で以下を設定します。

```env
DRY_RUN=1
```

その状態で `WATCH_DIR` 配下にテスト用フォルダを作ると、検知ログだけが出ます。

## Expected Flow

```text
Apple Watch / Just Press Record
  ↓
iCloud Drive に新しい録音フォルダが作られる
  ↓
Mac mini の Python watchdog が検知
  ↓
Twilio で自分の iPhone に電話
  ↓
「新しい録音を検知しました」と通知
```

## Completion Criteria

```text
1. watch_jpr.py を Mac mini で起動
2. Apple Watch で JPR 録音
3. iCloud 上に新規フォルダ作成
4. Python が検知ログを出す
5. Twilio から iPhone に電話が来る
```

## Notes

この MVP は新規フォルダ作成を検知した時点で通知します。録音ファイルのアップロード完了までは待ちません。

次の段階では、新規フォルダ検知後に音声ファイルを探し、ファイルサイズが安定してから Whisper / ローカル LLM / Codex 処理へ進める構成にできます。
