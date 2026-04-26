---
name: brainbase-slack検索で所在が特定できない法務・契約相談は-検索範囲を明示してdmドラフトに退避する
description: Slack検索で所在が特定できない法務・契約相談は、検索範囲を明示してDMドラフトに退避する
---

# brainbase-slack検索で所在が特定できない法務・契約相談は-検索範囲を明示してdmドラフトに退避する

## Trigger
- Use when this pattern appears: Slack検索で所在が特定できない法務・契約相談は、検索範囲を明示してDMドラフトに退避する

## Steps
- 1. 人名、契約名、主要キーワード、channel searchを複数パターンで検索する
- 2. 見つからなければ「現在のワークスペースでは未発見」と限定して表現する
- 3. 関係者DMにドラフトを作る場合は、DM宛であることと本来のスレッドではない可能性を明記する
- 4. 本文はスレッドへ転記しやすいよう、背景・相談事項・期限の構成で独立させる

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/slack検索で所在が特定できない法務・契約相談は-検索範囲を明示してdmドラフトに退避する

## Source
- Promoted from explicit_learn / success