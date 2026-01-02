# PubMed Neurology IF Map (MVP)

PubMedのE-utilitiesを使って、指定年における脳神経内科（neurology）関連論文の大学別件数を集計し、SQLiteに保存した結果を日本地図で可視化します。暫定実装としてIFは1.0固定で、総IFは論文数と一致します。

## セットアップ

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

仮想環境

## バッチ実行

```bash
python3 -m batch.run --start-year 2000 --end-year 2025
```

API keyがある場合:

```bash
python3 -m batch.run --start-year 2000 --end-year 2025 --api-key YOUR_KEY
```

再計算したい場合:

```bash
python3 -m batch.run --start-year 2000 --end-year 2025 --force
```

## UI起動

```bash
python3 -m streamlit run app/streamlit_app.py
```

## 構成

- `batch/run.py`: 年×大学×診療科でE-utilitiesを叩き、SQLiteへ保存
- `batch/pubmed_client.py`: ESearchのcount取得、リトライ/スロットリング対応
- `batch/query_builder.py`: 所属・年フィルタのクエリ生成
- `batch/storage.py`: SQLiteアクセス
- `app/streamlit_app.py`: 地図表示（全国＋東京圏インセット）
- `config/universities.yaml`: 大学マスタ
- `config/departments.yaml`: 診療科マスタ

## 診療科検索方式（方針B: Affiliation + MeSH併用）

PubMed検索で以下を併用して診療科を判定します。

### Affiliation検索（[AD]）

所属に診療科名が含まれる論文を取得します。

### MeSH検索（[MH]）

PubMed標準の医学主題見出しで分類された論文を取得します。

### 検索式の構造

```
(大学条件) AND ((Affiliation条件) OR (MeSH条件)) AND (年条件)
```

この方式により、Affiliationだけでは漏れる論文も取得でき、検索精度が向上します。

## 既知の制約

- affiliation検索は表記ゆれやノイズの影響を受けるため、取りこぼし/過剰カウントがあり得ます。
- MeSHターム付与は最新論文では未完了の場合があります。
- 診療科の境界が曖昧な論文は複数の診療科でカウントされる可能性があります。
- IFは暫定的に1.0固定です。将来、IF辞書や診療科マスタ拡張を行う前提です。
- UIはSQLiteの集計結果のみを参照し、スライダー操作時にPubMedへアクセスしません。
