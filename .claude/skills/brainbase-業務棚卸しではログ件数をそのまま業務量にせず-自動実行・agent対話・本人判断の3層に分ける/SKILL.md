---
name: brainbase-業務棚卸しではログ件数をそのまま業務量にせず-自動実行・agent対話・本人判断の3層に分ける
description: 業務棚卸しではログ件数をそのまま業務量にせず、自動実行・agent対話・本人判断の3層に分ける
---

# brainbase-業務棚卸しではログ件数をそのまま業務量にせず-自動実行・agent対話・本人判断の3層に分ける

## Trigger
- Use when this pattern appears: 業務棚卸しではログ件数をそのまま業務量にせず、自動実行・agent対話・本人判断の3層に分ける

## Steps
- 1. ログをプロジェクト/実行主体で集計する
- 2. 自動運行、agent対話駆動、本人の抽象・戦略判断に分類する
- 3. 各カテゴリに「自分がやる」「agent委譲」「人に振る」を付ける
- 4. 握り癖は「コマンドレベルまで指示している領域」として別抽出する
- 5. セッション探索や記憶分散は個別作業ではなく仕組み化対象として扱う

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/業務棚卸しではログ件数をそのまま業務量にせず-自動実行・agent対話・本人判断の3層に分ける

## Source
- Promoted from explicit_learn / success