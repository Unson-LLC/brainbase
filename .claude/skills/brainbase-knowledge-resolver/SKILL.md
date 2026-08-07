---
name: brainbase-knowledge-resolver
description: Brainbaseでナレッジを探す前に、Graph・owning repo・team Drive・personal KG・workspaceのどれが正規ソースかを決める入口。
---

# Brainbase knowledge resolver

1. Read `docs/brainbase-capabilities/capabilities/knowledge.resolve.yml`.
2. Call the Brainbase MCP tool `brainbase_knowledge_resolve` with structured intent, audience, content type, and project context.
3. Follow the returned retrieval capability and preserve `searched_scope`, `not_searched`, and `absence_confirmed` in the evidence receipt.
4. Follow `docs/brainbase-capabilities/runbooks/knowledge-resolve.md` when the route is unconfirmed.

This Skill only routes the agent. Do not duplicate routing rules here or infer absence from a single search result.
