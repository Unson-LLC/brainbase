---
name: brainbase-livekit-agentsの応答速度はmetrics-collectedをログ出力すると段階別
description: LiveKit Agentsの応答速度はmetrics_collectedをログ出力すると段階別に測れる
---

# brainbase-livekit-agentsの応答速度はmetrics-collectedをログ出力すると段階別

## Trigger
- Use when this pattern appears: LiveKit Agentsの応答速度はmetrics_collectedをログ出力すると段階別に測れる

## Steps
- from livekit.agents import MetricsCollectedEvent, metrics
- @session.on("metrics_collected")
- def _on_metrics(ev: MetricsCollectedEvent) -> None:
- metrics.log_metrics(ev.metrics)
- 確認例:
- lk agent logs --log-type=run | grep -i metrics
- Console UI下部のMetricsタブでAverage End-To-End Latencyも確認する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/livekit-agentsの応答速度はmetrics-collectedをログ出力すると段階別

## Source
- Promoted from explicit_learn / success