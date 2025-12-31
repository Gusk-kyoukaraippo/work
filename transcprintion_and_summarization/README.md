# Just Press Record -> Notion pipeline

iCloud内に保存されたJust Press Recordの録音（.m4a）をwatchdogで検知し、
whisper.cppで文字起こし → LM Studioで誤字補正 → Notionに保存します。

## セットアップ（macOS / Terminal）

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

音声処理に `ffmpeg` が必要です。

```bash
brew install ffmpeg
```

whisper.cpp をMetal対応でビルドし、`large-v3-turbo (q8_0)` モデルを用意してください。

```bash
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
WHISPER_METAL=1 make -j
mkdir -p models
./models/download-ggml-model.sh large-v3-turbo-q8_0
```

## 設定

`config.example.yaml` を `config.yaml` にコピーして編集してください。

- `watch.root_dir` にiCloudのJust Press Record保存先を指定
- `transcription.whisper_cpp.bin_path` に `whisper.cpp/build/bin/whisper-cli` のパス
- `transcription.whisper_cpp.model_path` に `ggml-large-v3-turbo-q8_0.bin` のパス
- `notion.database_id` にデータベースIDを設定
- `notion.token` にNotionインテグレーショントークンを設定（例: `ntn_...`）
- `notion.properties.*` はNotion側のプロパティ名に合わせて修正

`notion.token` が未設定のときは、環境変数 `NOTION_TOKEN` を参照します。

## 実行

```bash
python main.py --config config.yaml
```

## 補足

- 録音ファイル作成を検知したら即処理を開始します。
- ファイルサイズが一定になるまで数回ポーリングして安定判定します。
- 処理済みファイルは `.data/processed.sqlite` に保存され再処理を防ぎます。
