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
3. Record the source actually searched and evidence found in a downstream receipt.
4. If the result is `unconfirmed`, search only `next_route`, then update searched and unsearched scope before continuing.

## Stop conditions

- Do not report absence while `absence_confirmed=false`.
- Do not search personal KG for team knowledge.
- Do not use Wiki as a canonical destination.
- Do not claim retrieval success from a routing receipt alone.
