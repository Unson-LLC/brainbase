---
name: brainbase-livekit-realtime音声品質はvad-turn-detection-noise-ca
description: LiveKit Realtime音声品質はVAD/turn_detection/noise cancellationを一括変更すると原因切り分け不能になる
---

# brainbase-livekit-realtime音声品質はvad-turn-detection-noise-ca

## Trigger
- Use when this pattern appears: LiveKit Realtime音声品質はVAD/turn_detection/noise cancellationを一括変更すると原因切り分け不能になる

## Steps
- 1. 既知の良好エージェントの構成を確認する
- 2. xAI Realtimeではまずpluginデフォルトのturn_detectionで試す
- 3. silero VAD有無、min_silence_duration、BVC/BVCTelephonyを1項目ずつ変更する
- 4. 変更ごとにConsoleで音声認識品質とEnd-To-End Latencyを確認する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- specs/livekit-realtime音声品質はvad-turn-detection-noise-ca

## Source
- Promoted from explicit_learn / success