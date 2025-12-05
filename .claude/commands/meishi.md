# 名刺OCRワークフロー /meishi

Mistral OCR を用いて `_download/名刺/` の名刺PDF/画像を一括でCSV（`_codex/common/meta/contacts/data/scanned_2025-12.csv`）へ追記するカスタムコマンド。

## サブコマンド

- `/meishi ocr [PATH]`  
  - デフォルトは `_download/名刺` を一括処理。サフィックス `_001/_002/_003` とプレースホルダ `(会社名)_*` は自動スキップ。  
  - 呼び出し先: `_codex/common/ops/scripts/meishi.sh ocr`

- `/meishi todo [N]`  
  - 未処理ファイルを先頭N件表示（デフォ10）。処理済み判定は CSV 14列目のソースファイル名で比較。  

- `/meishi verify`  
  - CSV列数が15列か、ソースファイル重複がないかをチェック。

- `/meishi resume`  
  - 直近「読み込み済み未追記」の10件リマインダを表示（バッチ15途中のリストを固定表示）。

## 実体スクリプト

- `_codex/common/ops/scripts/meishi.sh`  
  - ラッパーが呼ぶ公式フロー本体: `_codex/common/ops/scripts/scan_meishi.py`  
  - OCRモデル: `mistral-ocr-latest` / 構造化: `mistral-small-latest`  
  - スキャン日: `2025/12/04` 固定、出力CSVも固定。  

## 事前準備

- 環境変数 `MISTRAL_API_KEY` を設定（または `_codex/common/ops/.env` に記載）。  
- `.venv` に `mistralai` がインストール済みであること。  
  - 未インストール時: `python3 -m venv .venv && .venv/bin/pip install mistralai`

## 例

```
/meishi ocr               # 名刺ディレクトリを丸ごとOCR
/meishi todo 5            # 未処理を5件だけ確認
/meishi verify            # CSVの整合チェック
```
