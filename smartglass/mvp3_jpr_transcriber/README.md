# MVP3rd JPR Transcriber

Just Press Record が iCloud Drive に保存した新しい録音ファイルを Mac 上の常駐 Python で検知し、`ffprobe` で音声として読めることを確認してからコピーし、Mac の whisper.cpp で文字起こしします。文字起こしが成功したら、Twilio Calls API で自分の iPhone に内容を読み上げ通知します。

## Flow

```text
新規録音ファイルを検知
  ↓
ffprobe で読めるか確認
  ↓
duration が取れるか確認
  ↓
音声ストリームが読めるか確認
  ↓
作業フォルダへ即コピー
  ↓
whisper.cpp が直接読めない形式は wav へ変換
  ↓
コピーした音声を whisper.cpp large 相当で文字起こし
  ↓
Twilio で文字起こし内容を電話通知
```

## Setup

```bash
cd /Users/tama2025mini/work/smartglass/mvp3_jpr_transcriber
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

`.env` に監視フォルダと whisper.cpp 設定を入れます。Twilio の値は `../.env` に置いたままで読めます。

```env
WATCH_DIR=/Users/tama2025mini/Library/Mobile Documents/iCloud~com~openplanetsoftware~just-press-record/Documents
WHISPER_BACKEND=whisper_cpp
WHISPER_CPP_BIN=/Users/tama2025mini/work/tools/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL_PATH=/Users/tama2025mini/work/tools/whisper.cpp/models/ggml-large-v3-turbo-q8_0.bin
```

環境変数の優先順位は `シェルで指定した環境変数 > mvp3_jpr_transcriber/.env > ../.env` です。

## Whisper.cpp On Mac

このMVPは既定で `whisper.cpp` を使います。`WHISPER_CPP_BIN` で whisper.cpp のCLI実行ファイルを指定します。

whisper.cpp CLI が直接読める形式は `flac`, `mp3`, `ogg`, `wav` です。Just Press Record の `.m4a` は `ffprobe` で検査した後、コピーしたファイルを `ffmpeg` で16kHz mono wavに変換してから whisper.cpp に渡します。

このMacでは以下の組み合わせで動作確認済みです。

```env
WHISPER_BACKEND=whisper_cpp
WHISPER_CPP_BIN=/Users/tama2025mini/work/tools/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL_PATH=/Users/tama2025mini/work/tools/whisper.cpp/models/ggml-large-v3-turbo-q8_0.bin
```

large 相当として `large-v3` または `large-v3-turbo` 系の ggml/gguf モデルを指定してください。

古い whisper.cpp ビルドで実行ファイル名が `main` の場合は、絶対パスで指定してください。

```env
WHISPER_CPP_BIN=/Users/your-user/src/whisper.cpp/build/bin/main
```

コマンドやモデル配置が特殊な場合は `WHISPER_COMMAND` で明示できます。

```env
WHISPER_COMMAND=whisper-cli -m {model_path} -f {audio} -l {language} -otxt -of {output_base}
```

Python の `whisper` CLI に一時的に戻したい場合は、以下のようにできます。

```env
WHISPER_BACKEND=auto
WHISPER_MODEL=large-v3
```

## Verified Command

短いテスト音声で以下の動作を確認済みです。

```bash
/Users/tama2025mini/work/tools/whisper.cpp/build/bin/whisper-cli \
  -m /Users/tama2025mini/work/tools/whisper.cpp/models/ggml-large-v3-turbo-q8_0.bin \
  -f /Users/tama2025mini/work/smartglass/mvp3_jpr_transcriber/recording_copies/whisper_test.wav \
  -l ja \
  -otxt \
  -of /Users/tama2025mini/work/smartglass/mvp3_jpr_transcriber/recording_copies/transcripts/whisper_test \
  -nt
```

出力された文字起こし:

```text
これはテストです。
```

## Run

```bash
source .venv/bin/activate
python watch_jpr_transcribe.py
```

起動時点で既に存在する録音ファイルは `seen_recordings.json` に記録され、通知対象から外されます。これにより初回起動時に過去分をまとめて処理しないようにしています。

## Dry Run

Twilio に発信せず、検知、`ffprobe`、Whisper 文字起こしまで確認したい場合は `.env` で以下を設定します。

```env
DRY_RUN=1
```

## Notes

Twilio 通知は `TWIML_URL` ではなく Calls API の `twiml` パラメータを使います。長い文字起こしをURLクエリに載せないためです。

通話で読み上げる文字数は `TRANSCRIPT_MAX_CHARS` で制限します。全文は `WORK_DIR/transcripts/` 配下の `.txt` に残ります。
