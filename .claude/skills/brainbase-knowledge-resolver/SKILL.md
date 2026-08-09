---
name: brainbase-knowledge-resolver
description: Brainbaseでナレッジを探す前に、Graph・owning repo・team Drive・personal KG・workspaceのどれが正規ソースかを決める入口。
---

# Brainbase knowledge resolver

1. Read `docs/brainbase-capabilities/capabilities/knowledge.resolve.yml`.
2. Call the Brainbase MCP tool `brainbase_knowledge_resolve` with structured intent, audience, content type, and project context.
3. The routing receipt is not a search. Do not emit a `📚 Brainbase検索:` or `📚 Brainbase取得:` line for `brainbase_knowledge_resolve` itself.
4. Follow the returned retrieval capability and preserve `searched_scope`, `not_searched`, and `absence_confirmed` in the evidence receipt.
5. After an actual Brainbase MCP retrieval succeeds, reproduce its tool-generated `📚 Brainbase検索:` or `📚 Brainbase取得:` line exactly once in the next user-facing assistant message. Each real repeated tool call produces another line; reusing already-returned evidence does not.
6. For owning-repo or team-Drive retrieval, create the same one-line trace only from the downstream receipt after the read succeeds. Name the real source, bounded query/target, and outcome. A no-result read says `該当なし（不在確定ではない）`; a failed read produces no success line.
7. Follow `docs/brainbase-capabilities/runbooks/knowledge-resolve.md` when the route is unconfirmed.

This Skill only routes the agent. Do not duplicate routing rules here or infer absence from a single search result.
