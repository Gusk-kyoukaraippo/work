# MVP4th JPR Gyaru Call

Just Press Record が iCloud Drive に保存した新しい録音ファイルを Mac 上の常駐 Python で検知し、`ffprobe` で音声として読めることを確認してからコピーします。そのコピーを `whisper.cpp` で文字起こしし、LM Studio でギャル語に変換してから、Twilio Calls API で自分の iPhone に読み上げます。

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
LM Studio でギャル語に変換
  ↓
Twilio で発信
  ↓
電話に出たらギャル語で読み上げ
```

## Setup

```bash
cd /Users/tama2025mini/work/smartglass/mvp4_gyaru_call
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

`.env` に監視フォルダ、whisper.cpp、LM Studio の設定を入れます。Twilio の値は `../.env` に置いたままで読めます。

```env
WATCH_DIR=/Users/tama2025mini/Library/Mobile Documents/iCloud~com~openplanetsoftware~just-press-record/Documents
WHISPER_BACKEND=whisper_cpp
WHISPER_CPP_BIN=/Users/tama2025mini/work/tools/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL_PATH=/Users/tama2025mini/work/tools/whisper.cpp/models/ggml-large-v3-turbo-q8_0.bin
LMSTUDIO_BASE_URL=http://localhost:1234
LMSTUDIO_MODEL=openai/gpt-oss-20b
```

環境変数の優先順位は `シェルで指定した環境変数 > mvp4_gyaru_call/.env > ../.env` です。

## LM Studio Model

このMVPは起動時に `LMSTUDIO_BASE_URL/v1/models` を確認します。今回このMacで確認できた生成モデルは以下です。

```text
openai/gpt-oss-20b
```

`LMSTUDIO_MODEL` が空の場合は、`/v1/models` の結果から `embedding` を含まない最初のモデルを自動選択します。指定したモデルがロードされていない場合は、起動時にエラーで止めます。

## Run

```bash
source .venv/bin/activate
python watch_jpr_gyaru_call.py
```

起動時点で既に存在する録音ファイルは `seen_recordings.json` に記録され、通知対象から外されます。これにより初回起動時に過去分をまとめて処理しないようにしています。

## Outputs

作業ファイルは `WORK_DIR` 配下に残ります。

```text
recording_copies/
  converted/      # whisper.cpp 用に変換した wav
  transcripts/    # Whisper の文字起こし txt
  gyaru_texts/    # LM Studio が変換したギャル語 txt
```

## Dry Run

Twilio に発信せず、検知、`ffprobe`、Whisper、LM Studio 変換まで確認したい場合は `.env` で以下を設定します。

```env
DRY_RUN=1
```

## Notes

Twilio 通知は `TWIML_URL` ではなく Calls API の `twiml` パラメータを使います。ギャル語に変換した本文をURLクエリに載せないためです。

通話で読み上げる文字数は `TRANSCRIPT_MAX_CHARS` で制限します。全文は `WORK_DIR/gyaru_texts/` 配下の `.txt` に残ります。
