---
name: brainbase-realtime音声エージェントでは長いsystem-promptがターンごとの応答遅延要因にな
description: Realtime音声エージェントでは長いSystem promptがターンごとの応答遅延要因になる
---

# brainbase-realtime音声エージェントでは長いsystem-promptがターンごとの応答遅延要因にな

## Trigger
- Use when this pattern appears: Realtime音声エージェントでは長いSystem promptがターンごとの応答遅延要因になる

## Steps
- 1. SYSTEM_INSTRUCTIONSの文字数を計測する
- 2. 厳守ルール、口調、tool利用原則だけを残す
- 3. 料金・空室・FAQなど可変情報はtool結果を読む設計にする
- 4. import確認後にdeployし、Metricsで短縮効果を確認する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/realtime音声エージェントでは長いsystem-promptがターンごとの応答遅延要因にな

## Source
- Promoted from explicit_learn / success