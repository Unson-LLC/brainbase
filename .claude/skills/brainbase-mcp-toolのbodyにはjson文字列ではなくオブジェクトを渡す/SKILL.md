---
name: brainbase-mcp-toolのbodyにはjson文字列ではなくオブジェクトを渡す
description: MCP toolのbodyにはJSON文字列ではなくオブジェクトを渡す
---

# brainbase-mcp-toolのbodyにはjson文字列ではなくオブジェクトを渡す

## Trigger
- Use when this pattern appears: MCP toolのbodyにはJSON文字列ではなくオブジェクトを渡す

## Steps
- NG: { "body": "{\"company_id\":11589192,...}" }
- OK: { "body": { "company_id": 11589192, "lines": [...] } }
- エラー例: Expected object, received string

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- specs/mcp-toolのbodyにはjson文字列ではなくオブジェクトを渡す

## Source
- Promoted from explicit_learn / success