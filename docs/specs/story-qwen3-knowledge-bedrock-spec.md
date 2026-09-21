---
spec_id: SPEC-qwen3-knowledge-bedrock
title: Qwen3 Knowledge Bedrock Adapter Spec
status: active
story_id: story-qwen3-knowledge-bedrock
implementation_files:
  - server/services/knowledge-bedrock-adapter.js
  - server/bootstrap/knowledge-bedrock.js
test_files:
  - tests/unit/knowledge-bedrock-adapter.test.js
  - tests/server/bootstrap/knowledge-bedrock.test.js
---

# Qwen3 Knowledge Bedrock Adapter Spec

## 契約

1. AdapterはAWS SDKの `ConverseCommand` を一度だけ送信する。
2. requestはsystem prompt、JSON化した利用者入力、`maxTokens`をConverseの共通形式で渡す。
3. responseは `output.message.content` 内のtextを一つ取得し、JSONとして解釈する。
4. 解釈後は既存の `validateCaptureProposal` または `validatePreviewAnswer` を必ず通す。
5. response欠損、複数または空のtext、JSON不正、検証不合格時にraw textへフォールバックしない。
6. ナレッジAIが有効でmodel ID未指定の場合は `qwen.qwen3-235b-a22b-2507-v1:0` を使う。
7. model IDの切替、再呼び出し、Anthropic payloadは実装しない。

## 検証

- capture proposalのConverse requestとresponseをunit testで固定する。
- previewの許可済み参照だけが残る既存契約を維持する。
- malformed responseがfail closedになることを確認する。
- bootstrapの有効・無効とQwen3標準model IDを確認する。
