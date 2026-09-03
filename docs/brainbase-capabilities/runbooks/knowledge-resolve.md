# Knowledge source resolution runbook

Use `brainbase_knowledge_resolve` before the first knowledge search when the canonical source has not already been established by a trusted server-owned result.

## Input contract

- `intent`: what the user needs, not merely an exact title
- `audience`: `personal`, `team`, or `organization`
- `content_type`: one of the resolver's declared enums
- `project_code`: include when the request belongs to a project
- `repository` / `suggested_path`: include only when already known

Canonical locations and prior routing evidence are not caller inputs. The resolver derives locations from server-owned route definitions.

## Execute

1. Call `brainbase_knowledge_resolve`.
2. Follow `retrieval_capability` at `canonical_location`.
3. Do not show a search trace yet: the routing receipt has not read knowledge.
4. Record the source actually searched and evidence found in a downstream receipt.
5. After the read succeeds, the Brainbase MCP tool returns a machine-readable owner-audit metadata envelope. The model must not reproduce, translate, summarize, or add that trace to its assistant message. `PostToolUse` validates the envelope and journals the actual call; `Stop` renders the validated receipt exactly once as its own Host `systemMessage`:

   ```text
   📚 Brainbase検索: Graphで「Judgment Resolver」を検索 → 結果を取得 ✓
   ```

   A direct read uses `📚 Brainbase取得:`. A no-result read says `該当なし（不在確定ではない）`. Repeated validated tool calls produce repeated Host-rendered traces; reuse of existing evidence does not. The model-authored assistant body contains none of these lines.
6. If the result is `unconfirmed`, search only `next_route`, then update searched and unsearched scope before continuing.

## Stop conditions

- Do not report absence while `absence_confirmed=false`.
- Do not search personal KG for team knowledge.
- Do not use Wiki as a canonical destination.
- Do not claim retrieval success from a routing receipt alone.
- Do not emit a successful retrieval trace for a failed tool call.
