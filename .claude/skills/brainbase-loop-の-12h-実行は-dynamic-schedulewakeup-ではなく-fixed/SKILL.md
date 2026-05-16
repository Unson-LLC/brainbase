---
name: brainbase-loop-の-12h-実行は-dynamic-schedulewakeup-ではなく-fixed
description: /loop の 12h 実行は dynamic ScheduleWakeup ではなく fixed-interval CronCreate を使う
---

# brainbase-loop-の-12h-実行は-dynamic-schedulewakeup-ではなく-fixed

## Trigger
- Use when this pattern appears: /loop の 12h 実行は dynamic ScheduleWakeup ではなく fixed-interval CronCreate を使う

## Steps
- fixed interval: `/loop 12h <prompt>` → CronCreate cron=`0 */12 * * *` 相当
- dynamic mode: interval なし → ScheduleWakeup fallback、最大 3600s
- 誤って dynamic chain を作った場合は、次回発火時に ScheduleWakeup を呼ばず終端し、CronCreate job を公式 chain にする

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/loop-の-12h-実行は-dynamic-schedulewakeup-ではなく-fixed

## Source
- Promoted from explicit_learn / success