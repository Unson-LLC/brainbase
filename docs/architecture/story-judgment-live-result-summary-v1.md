---
story_id: story-judgment-live-result-summary-v1
title: Judgment live result summary architecture
status: accepted
updated_at: 2026-08-29
---

# Architecture: Judgment live result summary

## 境界

PostToolUse Hostは、query/targetを従来どおりtool inputから生成する。tool response本文は表示へ転載せず、Brainbase retrieval auditの既知の終端語だけを分類して、Host自身の定型文へ変換する。

```text
tool input ──> Host生成query_excerpt
tool response ──> bounded outcome classifier ──> no_result | result | unknown
query_excerpt + outcome ──> Host生成display_line
```

## 安全契約

- `該当なし（不在確定ではない）` と `結果を取得` は、Brainbase tool responseの最終content blockにある固定3行のretrieval audit envelopeだけから認識する。
- 応答中のquery、件数、識別子、本文は保存displayへ転載しない。
- 既知終端がない場合は従来の構造化count、または「正常応答を確認」へfail closedする。
- route、write、failure、episode lifecycleには分岐を追加しない。

## 検証

単体テストで0件、結果取得、偽の件数・queryを固定し、live-session E2Eで実MCP応答と保存eventの意味一致を検証する。
