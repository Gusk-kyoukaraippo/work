# MVP1st FastAPI Twilio Notifier

Apple WatchのショートカットなどからPOSTして、Twilio Voice APIで自分のiPhoneに電話をかける最小APIです。

MVP2ndの `TWIML_URL` から再利用できる `/twiml` もこのサーバーが提供します。

## Setup

```bash
cd /Users/tama2025mini/work/smartglass/mvp1_fastapi_twilio
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

`.env` にTwilio Consoleの値と、自分の電話番号を入れてください。

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_NUMBER=+1xxxxxxxxxx
MY_PHONE_NUMBER=+819012345678
WATCH_SECRET=replace-with-a-long-random-secret
PUBLIC_BASE_URL=https://xxxx-xxxx-xxxx.ngrok-free.app
```

環境変数の優先順位は `シェルで指定した環境変数 > mvp1_fastapi_twilio/.env > ../.env` です。

## Run

```bash
source .venv/bin/activate
uvicorn app:app --host 0.0.0.0 --port 8000
```

開発中は別ターミナルでngrokなどを起動します。

```bash
ngrok http 8000
```

`PUBLIC_BASE_URL` にはngrokが出した `https://...ngrok-free.app` を設定します。

## Test

```bash
curl http://localhost:8000/health
```

```bash
curl "http://localhost:8000/twiml?message=テスト"
```

```bash
curl -X POST http://localhost:8000/watch-button \
  -H "Content-Type: application/json" \
  -d '{"token":"replace-with-a-long-random-secret","message":"処理が完了しました"}'
```

ワン切り通知だけにしたい場合は `mode` を `ring` にします。

```bash
curl -X POST http://localhost:8000/watch-button \
  -H "Content-Type: application/json" \
  -d '{"token":"replace-with-a-long-random-secret","mode":"ring"}'
```

## Apple Watch Shortcut

ショートカットアプリで以下のPOSTを作ります。

- URL: `https://xxxx.ngrok-free.app/watch-button`
- Method: `POST`
- Header: `Content-Type: application/json`
- Body:

```json
{
  "token": "replace-with-a-long-random-secret",
  "message": "処理が完了しました"
}
```
