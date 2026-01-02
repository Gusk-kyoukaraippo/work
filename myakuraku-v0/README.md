# PubMed University-Year Counter

PubMedのE-utilitiesを使って、大学別・年別の論文数を集計し、CSVとグラフを出力するツールです。設定ファイルでトピック・診療科・大学・期間・IFポリシーを差し替え可能です。

## セットアップ

```bash
python3 -m venv .venu
source .venu/bin/activate
pip install -r requirements.txt
```

NCBI API key（任意）

```bash
export NCBI_API_KEY="your_api_key"
```

## 実行方法

```bash
python main.py --config config.example.yaml --output-dir out
```

オプション：
- `--start-year` / `--end-year` で期間上書き
- `--universities` で大学キーまたは名称をカンマ区切り指定（例: `kindai,osaka`）
- `--departments` で診療科キーまたは名称をカンマ区切り指定（例: `dermatology,cardiology`）
- `--no-cache` でキャッシュ無効化

## 設定の変更ポイント

- `topic.mesh_terms` / `topic.tiab_terms`: 専門項目
- `departments[*].affiliation_terms`: 診療科や部門の所属表記
- `universities[*].affiliation_aliases`: 大学の表記ゆれ
- `date_range.start_year` / `date_range.end_year`
- `pub_types.include` / `pub_types.exclude`
- `language_filter.enabled` / `language_filter.language`
- `if_policy`（IFを掛ける場合は `mode: csv`）

### IF CSV（journal,if）

`if_policy.mode: csv` の場合、`if_policy.csv_path` に指定したCSVを読み込みます。  
ヘッダは `journal,if` 固定です。マッチは **大小文字を無視** し、未一致のジャーナルは `default_if`（今回の指定は 0）で扱います。
例: `if_table.example.csv`

## 出力ファイル

`--output-dir` 配下に以下が生成されます。

- `results_by_university_year.csv`（year, department, university, paper_count, weighted_count）
- `results_pivot.csv`（year x university のピボット）
- `papers_over_time.png`
- `total_over_time.png`
- `if_by_university_year.html`（年スライダー付きの大学別IF合計バー）

## 注意点

- PubMedのaffiliation検索は表記ゆれや混入があり、取りこぼし・ノイズが発生し得ます。
- 実行時にクエリと取得日（UTC）をログ出力します。
- 取得はE-utilitiesのみで行い、retmax=0の年別Countを取得します（IF CSV有効時は該当年のPMIDからジャーナル情報も取得します）。

## 例

```bash
python main.py --config config.example.yaml --output-dir out --start-year 2018 --end-year 2022
```
