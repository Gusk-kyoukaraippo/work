# MVP5th JPR LLM Router Call

Just Press Record が iCloud Drive に保存した新しい録音ファイルを Mac 上の常駐 Python で検知し、文字起こし後に LM Studio へルーティング判断をさせます。

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
  ├─ 時間通知なら Twilio ワンギリ
  └─ それ以外なら MVP4th と同様にギャル語変換して電話読み上げ
```

## Setup

```bash
cd /Users/tama2025mini/work/smartglass/mvp5_llm_router_call
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

`.env` に監視フォルダ、whisper.cpp、LM Studio の設定を入れます。Twilio の値は `../.env` に置いたままで読めます。

```env
WATCH_DIR=/Users/tama2025mini/Library/Mobile Documents/iCloud~com~openplanetsoftware~just-press-record/Documents
WHISPER_BACKEND=whisper_cpp
WHISPER_CPP_BIN=/Users/tama2025mini/work/tools/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL_PATH=/Users/tama2025mini/work/tools/whisper.cpp/models/ggml-large-v3-turbo-q8_0.bin
LMSTUDIO_BASE_URL=http://localhost:1234
LMSTUDIO_MODEL=openai/gpt-oss-20b
RING_ONLY_TIMEOUT_SECONDS=5
```

環境変数の優先順位は `シェルで指定した環境変数 > mvp5_llm_router_call/.env > ../.env` です。

## Routing

LM Studio の分類結果が `time_notification` の場合は、Twilio Calls API に `timeout=RING_ONLY_TIMEOUT_SECONDS` と即時 `<Hangup/>` の TwiML を渡します。相手が出なければ短時間だけ鳴って切れ、出た場合もすぐ切れます。

それ以外の `gyaru_call` は MVP4th と同じく、LM Studio でギャル語へ変換してから電話応答後に読み上げます。

分類プロンプトは `.env` の `CLASSIFICATION_SYSTEM_PROMPT` と `CLASSIFICATION_USER_PROMPT` で調整できます。

## Run

```bash
source .venv/bin/activate
python watch_jpr_llm_router_call.py
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

Twilio に発信せず、検知、`ffprobe`、Whisper、LM Studio 分類、必要時のギャル語変換まで確認したい場合は `.env` で以下を設定します。

```env
DRY_RUN=1
```
