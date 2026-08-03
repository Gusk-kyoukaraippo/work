# MVP6th JPR LLM Router Pushover

Just Press Record が iCloud Drive に保存した新しい録音ファイルを Mac 上の常駐 Python で検知し、文字起こし後に LM Studio へルーティング判断をさせます。通知は Twilio 電話ではなく Pushover へ送信し、LLM の分類結果ごとに Pushover の `sound` を変えます。

## Flow

```text
新規録音ファイルを検知
  ↓
ffprobe で読めるか確認
  ↓
作業フォルダへコピー
  ↓
whisper.cpp が直接読めない形式は wav へ変換
  ↓
コピーした音声を whisper.cpp で文字起こし
  ↓
LM Studio で内容を分類
  ├─ 時間通知なら Pushover に短文通知
  └─ それ以外ならギャル語変換して Pushover に本文通知
```

## Setup

```bash
cd /Users/tama2025mini/work/smartglass/mvp6_llm_router_pushover
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

`.env` に Pushover、監視フォルダ、whisper.cpp、LM Studio の設定を入れます。Pushover はアプリトークンとユーザーキーが必要です。

```env
PUSHOVER_APP_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
PUSHOVER_USER_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
PUSHOVER_SOUND_TIME_NOTIFICATION=pushover
PUSHOVER_SOUND_GYARU_CALL=magic
WATCH_DIR=/Users/tama2025mini/Library/Mobile Documents/iCloud~com~openplanetsoftware~just-press-record/Documents
WHISPER_BACKEND=whisper_cpp
WHISPER_CPP_BIN=/Users/tama2025mini/work/tools/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL_PATH=/Users/tama2025mini/work/tools/whisper.cpp/models/ggml-large-v3-turbo-q8_0.bin
LMSTUDIO_BASE_URL=http://localhost:1234
LMSTUDIO_MODEL=openai/gpt-oss-20b
```

環境変数の優先順位は `シェルで指定した環境変数 > mvp6_llm_router_pushover/.env > ../.env` です。

## Routing

LM Studio の分類結果が `time_notification` の場合は、`PUSHOVER_SOUND_TIME_NOTIFICATION` の音で Pushover 通知します。

それ以外の `gyaru_call` は、LM Studio でギャル語へ変換してから `PUSHOVER_SOUND_GYARU_CALL` の音で Pushover 通知します。未知の分類に備えた既定音は `PUSHOVER_SOUND_DEFAULT` です。

分類プロンプトは `.env` の `CLASSIFICATION_SYSTEM_PROMPT` と `CLASSIFICATION_USER_PROMPT` で調整できます。

## Run

```bash
source .venv/bin/activate
python watch_jpr_llm_router_pushover.py
```

起動時点で既に存在する録音ファイルは `seen_recordings.json` に記録され、通知対象から外されます。これにより初回起動時に過去分をまとめて処理しないようにしています。

## Outputs

作業ファイルは `WORK_DIR` 配下に残ります。

```text
recording_copies/
  converted/        # whisper.cpp 用に変換した wav
  transcripts/      # Whisper の文字起こし txt
  classifications/  # LM Studio の分類結果 json
  gyaru_texts/      # LM Studio が変換したギャル語 txt
```

## Dry Run

Pushover に送信せず、検知、`ffprobe`、Whisper、LM Studio 分類、必要時のギャル語変換まで確認したい場合は `.env` で以下を設定します。

```env
DRY_RUN=1
```
