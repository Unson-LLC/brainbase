# Spec: Meeting Pack Owner Context Candidates

## Contract

Meeting Review Package ingestは、Graph SSOT Playbookで取得したproject scoped graph contextをTask owner resolverへ渡す。resolverは以下の順で候補を構成する。

1. Review Packageに既存 `selected_owner_id` がある場合、people SSOT検索とGraph context personの両方でID検証する。
2. `owner_hint` を `@`、敬称、空白を正規化して検索queryにする。
3. `listGraphEntities(entityType=person, query=...)` の結果を取得する。
4. `graph_ssot_context.entities.person` または配列型entities内のpersonを正規化する。
5. 3と4をperson idで重複排除して候補化する。
6. Project scoped people検索が空の場合だけ、同じqueryでglobal People SSOT検索を行う。
7. 完全一致、またはproject context付き高信頼候補の場合だけ `selected_owner_id` を付与する。

## Must Not

- Graph contextに存在しない人物を自動でpeople SSOTへ登録しない。
- `Speaker 1` などの話者ラベルをperson候補にしない。
- Graph contextを議事録本文の発話事実として使わない。
- 複数候補で第一候補を決めきれない場合に `selected_owner_id` を付与しない。

## Runtime Evidence

- `workflow_runs.metadata.graph_context.graph_ssot_context.entities.person`
- `workflow_outputs.payload[].owner_candidates`
- `workflow_outputs.payload[].owner_resolution`

## Test Evidence

- `tests/e2e/story-meeting-pack-graph-ssot-playbook-contract.spec.ts`
- Scenario: search API returns no people, but Graph context contains `佐藤圭吾` with alias `キング`; Task candidate `owner_hint=@キング` resolves to `selected_owner_id`.
- Scenario: project scoped people search returns no records, but global People SSOT has an exact known person; resolver can use that person as an owner candidate.
