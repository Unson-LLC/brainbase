# Meishi management story (Brainbase)

## Why
- 名刺は「Contacts（ネットワーク資産）」として蓄積し、事業開発・採用・協業の起点にする
- Leads/CRMは事業別。Contactsは横断でSSOTとして保持する

## End-to-end flow
1) **Input**: 名刺PDF/画像を `_download/名刺/` に投入
2) **OCR**: `_codex/common/ops/scripts/scan_meishi.py` が Mistral OCR → 構造化（Mistral small）
3) **Store**: `_codex/common/meta/contacts/data/scanned_YYYY-MM.csv` に追記
4) **Tag**: `備考` にイベントや出会いの文脈を追記
5) **Use**: セグメント判定 → Leads基準でCRMへ（Contacts/Leadsの分離）

## Data artifacts
- **Raw (名刺OCR)**: `scanned_YYYY-MM.csv`（月次）
- **Raw (Eight)**: `eight_YYYY-MM.csv`（Eightエクスポート）
- **Optional**: `enriched.csv`（タグ付け済みの統合ビューとして使う場合のみ）

## CSV schema (15 columns)
`会社名, 部署名, 役職, 氏名, e-mail, 郵便番号, 住所, TEL会社, TEL直通, 携帯電話, Fax, URL, スキャン日, ソースファイル, 備考`

## Dedup & skip rules
- ソースファイル名で全月CSV横断の重複判定
- `_001/_002/_003` は重複扱いでスキップ
- `(会社名)_*` のプレースホルダはスキップ

## Tagging conventions
- `備考` を使ってタグを残す（既存文があれば改行で追記）
- 例: `出会い: aid.connpass.com/event/378818/`
- 目的: 後から「どこで出会ったか」を検索できる状態にする

## Ops notes
- API Key: `/Users/ksato/workspace/.env` の `MISTRAL_API_KEY`
- 401 Unauthorized は Billing 停止が原因のことが多い
- `/meishi todo` → `/meishi ocr` → `/meishi verify` の順で進める
