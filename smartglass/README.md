# Smartglass MVPs

Just Press Record と通知連携の実験をMVPごとに分けて管理します。Twilio 電話通知版と Pushover 通知版は独立して起動できます。

## Directory Layout

```text
smartglass/
  mvp1_fastapi_twilio/
    app.py
    requirements.txt
    .env.example
    README.md
  mvp2_jpr_watchdog/
    watch_jpr.py
    requirements.txt
    .env.example
    README.md
  mvp3_jpr_transcriber/
    watch_jpr_transcribe.py
    requirements.txt
    .env.example
    README.md
  mvp4_gyaru_call/
    watch_jpr_gyaru_call.py
    requirements.txt
    .env.example
    README.md
  mvp5_llm_router_call/
    watch_jpr_llm_router_call.py
    requirements.txt
    .env.example
    README.md
  mvp6_llm_router_pushover/
    watch_jpr_llm_router_pushover.py
    requirements.txt
    .env.example
    README.md
```

## MVP1st: FastAPI Twilio Notifier

Apple Watch ShortcutやcurlからHTTP POSTして、自分のiPhoneにTwilioで電話します。

```bash
cd /Users/tama2025mini/work/smartglass/mvp1_fastapi_twilio
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app:app --host 0.0.0.0 --port 8000
```

このMVPは `/twiml` も提供します。MVP2ndの `TWIML_URL` に、ngrokやCloudflare Tunnelで公開した `/twiml?message=...` URLを設定できます。

## MVP2nd: JPR iCloud Watchdog

Just Press RecordがiCloud Driveに新しい録音フォルダを作ったことをMac上の常駐Pythonで検知し、自分のiPhoneにTwilioで電話します。

```bash
cd /Users/tama2025mini/work/smartglass/mvp2_jpr_watchdog
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python watch_jpr.py
```

初回の検知確認だけなら、MVP2ndの `.env` で `DRY_RUN=1` にしてTwilio発信を止められます。

## Recommended Operation

MVP1stとMVP2ndは依存が違うため、それぞれのディレクトリで別 `.venv` を使います。

環境変数の優先順位は `シェルで指定した環境変数 > 各MVPディレクトリの .env > ルート直下の .env` です。

MVP2ndから音声通知まで通す場合は、先にMVP1stを起動して `/twiml` を公開し、その公開URLをMVP2ndの `TWIML_URL` に設定してください。

## MVP3rd: JPR Transcriber

Just Press Record の新しい録音ファイルを検知し、`ffprobe` で duration と音声ストリームを確認してから作業フォルダへコピーし、Mac の whisper.cpp large 相当モデルで文字起こしします。文字起こしが成功したら、Twilio で内容を電話通知します。

```bash
cd /Users/tama2025mini/work/smartglass/mvp3_jpr_transcriber
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python watch_jpr_transcribe.py
```

whisper.cpp を使うため、`.env` で `WHISPER_MODEL_PATH` に `large-v3` または `large-v3-turbo` 系の ggml/gguf モデルを指定してください。

## MVP4th: JPR Gyaru Call

MVP3rd の処理に LM Studio 変換を追加し、録音検知、`ffprobe` 確認、コピー、`whisper.cpp` 文字起こし、LM Studio でギャル語変換、Twilio 発信、電話応答後のギャル語読み上げまでを1本で実行します。

```bash
cd /Users/tama2025mini/work/smartglass/mvp4_gyaru_call
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python watch_jpr_gyaru_call.py
```

LM Studio は `http://localhost:1234/v1/models` を起動時に確認します。このMacでは `openai/gpt-oss-20b` を確認済みなので、`LMSTUDIO_MODEL=openai/gpt-oss-20b` を既定例にしています。

## MVP5th: JPR LLM Router Call

MVP4th の処理に LM Studio のルーティング判定を追加します。文字起こし後、内容が時間通知なら Twilio で短く鳴らして切り、それ以外なら MVP4th と同様にギャル語変換して電話で読み上げます。

```bash
cd /Users/tama2025mini/work/smartglass/mvp5_llm_router_call
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python watch_jpr_llm_router_call.py
```

分類結果は `WORK_DIR/classifications/` に JSON で保存されます。ワンギリの鳴動時間は `RING_ONLY_TIMEOUT_SECONDS` で調整できます。

## MVP6th: JPR LLM Router Pushover

MVP5th の Twilio 電話通知を Pushover 通知へ置き換えます。文字起こし後の LM Studio 分類結果が `time_notification` なら短文通知、`gyaru_call` ならギャル語変換した本文を通知し、それぞれ `.env` の Pushover `sound` 設定を使い分けます。

```bash
cd /Users/tama2025mini/work/smartglass/mvp6_llm_router_pushover
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python watch_jpr_llm_router_pushover.py
```

分類結果は `WORK_DIR/classifications/` に JSON で保存されます。Pushover の音は `PUSHOVER_SOUND_TIME_NOTIFICATION` と `PUSHOVER_SOUND_GYARU_CALL` で調整できます。
