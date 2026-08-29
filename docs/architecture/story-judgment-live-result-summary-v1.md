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
tool response ──> validated final envelope classifier ──> search|retrieve + no_result|result | unknown
query_excerpt + operation + outcome ──> Host生成event_kind / display_line
```

## 安全契約

- `検索`／`取得`、`該当なし（不在確定ではない）`、`結果を取得` は、Brainbase tool responseの最終content blockにある固定3行のretrieval audit envelopeだけから一体で認識する。
- 固定envelopeを認識できた場合は、そのoperationをevent kindへ採用する。これにより`resolve_entity`とquery付き`list_extension_entities`を含むMCP正本の全retrieval targetをproducer契約と一致させる。
- 応答中のquery、件数、識別子、本文は保存displayへ転載しない。
- 固定envelopeを認識できない場合だけ、従来のtool名によるevent kind、構造化count、または「正常応答を確認」へfail closedする。
- route、write、failure、episode lifecycleには分岐を追加しない。

## Stop Hookとアプリ後段メタデータの境界

- `answer_digest`はStop Hookが実際に受け取った最終回答を結合する。
- Codex transcriptには、Stop Hook確定後にアプリが末尾へ`<oai-mem-citation>...</oai-mem-citation>`を付与した最終回答が保存される場合がある。
- live E2Eは監査行を含むtranscript本文を先に検証し、末尾にある完全なmemory citation blockだけを除外してHook可視本文を復元する。途中の同名文字列や不完全blockは除外しない。
- Host runtime、保存済みepisode、memory citation本文は変更しない。

## 検証

単体テストでMCP正本の9 retrieval target、動的operation、0件、結果取得、偽の件数・queryを固定し、live-session E2Eで実MCP応答と保存eventの意味一致、およびアプリ後段メタデータを除いたHook可視本文とreceiptの結合を検証する。
