---
story_id: story-qwen3-knowledge-bedrock
title: Qwen3でナレッジ登録候補を生成する
status: active
---

# Qwen3でナレッジ登録候補を生成する

Brainbase利用者として、ナレッジ登録候補とプレビューをAmazon Bedrock上のQwen3で生成したい。これにより、Mana runtimeやAnthropic固有APIに処理を委ねず、Brainbaseのbackendだけで安価に候補を確認できる。

## 受け入れ条件

- ナレッジAIを有効化すると、標準モデル `qwen.qwen3-235b-a22b-2507-v1:0` をBedrock Converse APIで呼び出す。
- Qwen3の応答から既存の厳格なproposal/preview契約を検証する。
- Anthropicまたは別モデルへのフォールバックを行わない。
- Bedrock失敗、空応答、JSON不正、契約不正は既存の失敗境界を保ち、成功として扱わない。
- 明示的に無効化されている場合はBedrockを呼び出さない。
