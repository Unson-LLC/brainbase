# Meeting Pack Owner Context Candidates

## Story

Meeting Pack ingest時、project_resolution_gateで確定したprojectのGraph SSOT contextに含まれるpersonを、Task担当者解決の候補プールとして使う。`listGraphEntities` の検索結果だけに依存せず、同じingestで取得済みの `graph_ssot_context.entities.person` / 配列型person recordsを正規化して検索結果とマージする。

## Acceptance Criteria

- AC-001: Project確定後に取得したGraph SSOT contextのperson recordsをTask owner resolverへ渡す。
- AC-002: `person.name` / `display_name` / `aliases[]` は既存の担当者hint正規化と同じ規則で照合する。
- AC-003: `listGraphEntities(entityType=person, query=...)` が空でも、Graph context内personのaliasに一意一致する場合は `selected_owner_id` / `selected_owner` を付与する。
- AC-004: Graph context由来候補と検索API由来候補はperson idで重複排除する。
- AC-005: 未知人物は自動作成せず、Graph SSOTにあるpersonだけを候補または初期選択に使う。
- AC-006: `Speaker 1` など話者ラベルは引き続きpersonとして扱わない。
- AC-007: Graph contextは議事録本文の事実を上書きせず、人物同一性・alias・関係・用語のcontextとしてのみ使う。
- AC-008: Project scoped people検索が空の場合だけ、People SSOTのglobal検索にフォールバックし、既知人物のaliasを候補化する。

## Scenarios

- S-001: `@キング` はGraph context内の `佐藤圭吾 aliases=["King","キング"]` に一致し、検索APIが空でも `佐藤圭吾` を初期選択する。
- S-002: `@汐里さん` はGraph context内に `堀 汐里` がある場合、姓名の部分一致候補として返る。
- S-003: `@矢島様` はGraph contextまたはpeople SSOT検索結果に `矢島剛 aliases=["矢島様"]` がある場合、一意一致として初期選択する。
- S-004: Project scoped検索で `矢島` が空でも、global People SSOTに `矢島剛` が一意に存在する場合は候補として表示し、完全一致なら初期選択する。

## Observability

- Evidence path: `workflow_outputs.type=task_candidates` の `payload[].owner_candidates[]` と `payload[].owner_resolution`。
- Replay check: 6/25以降のMeeting Packを再投入し、`owner_resolution.status` と `selected_owner_id` の件数を比較する。
