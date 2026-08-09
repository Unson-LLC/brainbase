# Team Book Knowledge

Google Driveでチームが参照できる購入済み書籍を、Brainbaseの共有ナレッジとして検索・適用するための入口。

## 正本と配置

- 原本PDFの正本はGoogle Drive。PDFや全文OCRはGitへ複製しない。
- 本ディレクトリには、出典を追跡できる要約、チェックリスト、比較表、取り込み台帳だけを置く。
- 個人固有の判断・履歴ではなく、チームが再利用する一般ナレッジとして扱う。
- 実行時のSkillへ昇格する場合も、書籍ナレッジとSkillの所有関係・出典を残す。

## 現在の台帳

- 対象: 38冊（[`manifest.yml`](../internal/book-ingestion/manifest.yml)）
- Drive解決結果: 38/38件（[`resolved.json`](../internal/book-ingestion/resolved.json)）
- PDF抽出監査: [`extraction-report.json`](../internal/book-ingestion/extraction-report.json)
- OCR完了証跡: 20冊4,576ページ・4,924,941文字（[`ocr-status.json`](../internal/book-ingestion/ocr-status.json)）。残る18冊は未完了として扱う
- Drive読み取りアカウント: `info@unson.jp`
- 原本所有者: `k.sato.unson@gmail.com`

## 実務ナレッジ

| 書籍 | 配置 | 状態 |
|---|---|---|
| UX戦略 第2版 | [`../design/ux-strategy-2nd-edition.md`](../design/ux-strategy-2nd-edition.md) | 既存・出典確認済み |
| UXデザインの法則 第2版 | [`../design/laws-of-ux-2nd-edition.md`](../design/laws-of-ux-2nd-edition.md) | 既存・出典確認済み |
| ファシリテーション入門 第2版 | [`facilitation-introduction-2nd-edition.md`](./facilitation-introduction-2nd-edition.md) | 新規・OCR出典確認済み |
| LLMのプロンプトエンジニアリング | [`../ai/llm-prompt-engineering.md`](../ai/llm-prompt-engineering.md) | 新規・出典確認済み |
| Effective TypeScript 第2版 | [`effective-typescript-2nd-edition.md`](./effective-typescript-2nd-edition.md) | 新規・出典確認済み |
| 小さな会社の「仕組み化」はなぜやりきれないのか | [`small-company-systemization.md`](./small-company-systemization.md) | 第2バッチ・OCR出典確認済み |
| ガーバー流 社長が会社にいなくても回る「仕組み」経営 | [`gerber-system-management.md`](./gerber-system-management.md) | 第2バッチ・OCR出典確認済み |
| WHO NOT HOW | [`who-not-how.md`](./who-not-how.md) | 第2バッチ・OCR出典確認済み |
| WORK THE SYSTEM | [`work-the-system.md`](./work-the-system.md) | 第2バッチ・OCR出典確認済み |
| TRACTION ビジネスの手綱を握り直す | [`traction-eos.md`](./traction-eos.md) | 第3バッチ・OCR出典確認済み |
| ALL for SaaS | [`all-for-saas.md`](./all-for-saas.md) | 第3バッチ・OCR出典確認済み |
| マーケティングの全施策60 | [`b2b-marketing-60-tactics.md`](./b2b-marketing-60-tactics.md) | 第3バッチ・OCR出典確認済み |
| ブランディング22の法則 | [`branding-22-laws.md`](./branding-22-laws.md) | 第4バッチ・OCR出典確認済み・既存Skillへ接続 |
| ポチらせる文章術 | [`pochiruseru-writing.md`](./pochiruseru-writing.md) | 第4バッチ・OCR出典確認済み・既存Skillへ接続 |
| MBAマーケティング必読書50冊 | [`mba-marketing-50-books.md`](./mba-marketing-50-books.md) | 第4バッチ・OCR出典確認済み |
| マーケティング手法大全 | [`marketing-methods-encyclopedia.md`](./marketing-methods-encyclopedia.md) | 第5バッチ・OCR出典確認済み |
| 実践 顧客起点マーケティング | [`customer-driven-marketing.md`](./customer-driven-marketing.md) | 第5バッチ・OCR出典確認済み |
| 危険だからこそ知っておくべきカルトマーケティング | [`cult-marketing-safety.md`](./cult-marketing-safety.md) | 第5バッチ・OCR出典確認済み・既存Skillへ接続 |
| THE MODEL | [`the-model-revenue-process.md`](./the-model-revenue-process.md) | 第6バッチ・OCR出典確認済み・既存Skillへ接続 |
| なぜあの商品、サービスは売れたのか？ | [`hit-product-case-patterns.md`](./hit-product-case-patterns.md) | 第6バッチ・OCR出典確認済み・既存Skillへ接続 |
| 失敗から学ぶマーケティング | [`marketing-failure-patterns.md`](./marketing-failure-patterns.md) | 第6バッチ・OCR出典確認済み |
| マーケティングを学んだけれど、どう使えばいいかわからない人へ | [`marketing-value-compass.md`](./marketing-value-compass.md) | 第7バッチ・OCR出典確認済み |
| できる営業マンのすごい言語化 | [`sales-tacit-knowledge-playbook.md`](./sales-tacit-knowledge-playbook.md) | 第7バッチ・OCR出典確認済み・既存Skillへ接続 |
| Foundations of Robotics | [`robotics-foundations-learning-map.md`](./robotics-foundations-learning-map.md) | 第7バッチ・OCR出典確認済み |

横断的な使い分けは[`systemization-selection-guide.md`](./systemization-selection-guide.md)を参照する。

既存の`.claude/skills`には、`WORK THE SYSTEM`、`TRACTION`、`ブランディング22の法則`、`ポチらせる文章術`、`危険だからこそ知っておくべきカルトマーケティング`、`THE MODEL`、`なぜあの商品、サービスは売れたのか？`に近い実務ナレッジがある。7冊すべてについて今回のOCRと主要概念を照合し、Skill本文そのものの生成元とは断定せず、Drive原本へ遡れる派生ガイドとして本台帳に接続済み。

## 取り込みフロー

```text
manifestの承認済みタイトル
  → gogでinfo@unson.jpの閲覧範囲を検索
  → 所有者・MIME・サイズ・Drive IDを解決
  → 一時領域へダウンロード、SHA-256を記録
  → pdfplumberで埋め込み文字層を全ページ監査
  → 文字層が弱いページのみローカルOCR
       横書き・図表: macOS Vision
       縦書き本文: Tesseract jpn_vert
  → OCRページ数・文字数・ハッシュを検証
  → 本文を複製せず、実務向け派生ナレッジへ要約
  → 原本リンク・抽出方法・ハッシュ付きでレビュー
```

## コマンド

```bash
# Drive上の正本を解決（読み取り専用）
/Users/ksato/workspace/.venv/bin/python scripts/book-ingestion/resolve_drive_books.py --out docs/internal/book-ingestion/resolved.json

# PDFを一時キャッシュへ取得し、文字層を監査
/Users/ksato/workspace/.venv/bin/python scripts/book-ingestion/extract_drive_books.py

# 画像PDFを一時キャッシュへOCR。中断・再開可能
/Users/ksato/workspace/.venv/bin/python scripts/book-ingestion/ocr_drive_books.py --workers 6 --refresh
```

OCR原文は`/private/tmp/brainbase-team-book-ocr`へ置き、リポジトリへコミットしない。処理失敗、権限不足、ページ欠落は成功件数へ含めず、`未確認`または`blocked`として残す。

## 派生ナレッジの完了条件

1. Drive ID、原本リンク、所有者、SHA-256が記録されている。
2. 全ページの抽出方式と、文字なしページの扱いが説明されている。
3. 書籍本文のコピーではなく、判断原則・手順・チェックリストへ変換されている。
4. 事実、解釈、適用提案が混同されていない。
5. チーム正本へコミットされ、レビュー可能になっている。
