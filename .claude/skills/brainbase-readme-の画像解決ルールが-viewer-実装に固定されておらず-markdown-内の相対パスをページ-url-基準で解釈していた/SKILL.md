---
name: brainbase-readme-の画像解決ルールが-viewer-実装に固定されておらず-markdown-内の相対パスをページ-url-基準で解釈していた
description: README の画像解決ルールが viewer 実装に固定されておらず、Markdown 内の相対パスをページ URL 基準で解釈していた。
---

# brainbase-readme-の画像解決ルールが-viewer-実装に固定されておらず-markdown-内の相対パスをページ-url-基準で解釈していた

## Trigger
- Use when this pattern appears: README の画像解決ルールが viewer 実装に固定されておらず、Markdown 内の相対パスをページ URL 基準で解釈していた。

## Steps
- Markdown renderer で相対画像パスを README のディレクトリ基準で解決する
- repo 内画像は session file asset route に変換する
- 外部画像 URL は placeholder を返す
- 読み込み失敗時は 404 のままにせず viewer 内 placeholder にフォールバックする

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/readme-の画像解決ルールが-viewer-実装に固定されておらず-markdown-内の相対パスをページ-url-基準で解釈していた

## Source
- Promoted from review / failure