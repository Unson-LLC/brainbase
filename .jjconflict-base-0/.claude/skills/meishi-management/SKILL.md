---
name: meishi-management
description: "Brainbaseの名刺（meishi）OCRとContacts管理の運用ガイド。/meishi コマンド、scanned_YYYY-MM.csv、備考タグ付け、重複判定ルール、Mistral OCRトラブル対応、Contacts/Leads連携など、名刺管理フローの質問が出た時に使う。"
---

# Meishi Management

## Overview
名刺はContacts（ネットワーク資産）として管理する。Mistral OCRで構造化し、月次CSVへ追記、必要に応じて備考へタグ付けしてBrainbaseの連携フローに組み込む。

## Canonical workflow
1) **取り込み**: `_download/名刺/` にPDF/画像を置く
2) **OCR**: `/meishi ocr`（必要なら `/meishi todo` で未処理確認）
3) **確認**: `/meishi verify`（列数=15、ソース重複チェック）
4) **タグ付け**: `備考` に出会いタグや文脈を追記
5) **活用**: Contacts → セグメント → Leads（CRM）へ

## Quick commands
- `/meishi todo [N]`: 未処理ファイルを先頭N件表示（重複・プレースホルダ除外済み）
- `/meishi ocr [PATH]`: 名刺一括OCR。省略時は `_download/名刺`
- `/meishi verify`: CSV列数/重複を検証
- `/meishi resume`: 前回途中のメモ表示（固定）

## Data artifacts (SSOT)
- 入力: `/Users/ksato/workspace/_download/名刺/`
- 実体スクリプト: `_codex/common/ops/scripts/meishi.sh`, `_codex/common/ops/scripts/scan_meishi.py`
- 出力: `_codex/common/meta/contacts/data/scanned_YYYY-MM.csv`（月次追記）
- Contacts運用: `_codex/common/meta/contacts/README.md`

## Dedup & skip rules
- **重複判定**: `scanned_*.csv` 全月横断で `ソースファイル` を参照（既存は再OCRしない）
- **スキップ対象**:
  - `*_001/*_002/*_003`（拡張子問わず）
  - `(会社名)_*` プレースホルダ
- **注意**: ファイル名変更は重複判定に影響（再OCRの原因）

## Tagging policy (備考)
- `備考` にタグを追記。既存文があれば改行で追記
- 推奨形式: `出会い: <イベント名 or URL>`
  - 例: `出会い: aid.connpass.com/event/378818/`

## Troubleshooting
- **401 Unauthorized**: Mistralの課金/請求停止が原因になりやすい。Billing解消後に再実行
- **API Key**: `/Users/ksato/workspace/.env` の `MISTRAL_API_KEY` を参照（環境変数があれば上書きしない）
- **mistralai 未導入**: `.venv` に `mistralai` をインストール

## References
- 詳細な「名刺管理ストーリー」とBrainbase統合は `references/meishi-story.md` を読む
