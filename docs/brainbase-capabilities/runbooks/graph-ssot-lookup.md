# Graph SSOT Lookup

1. Identify the entity type: `person`, `org`, `customer`, `partner`, `project`, `app`, `brand`, `frame`, `philosophy`, `glossary_term`, `decision`, `story`, `raci_assignment`, or `contact`.
2. Prefer the brainbase MCP Graph tools when available.
3. If using HTTP directly:

```bash
curl -s -H "Authorization: Bearer $(cat ~/.brainbase/tokens.json | jq -r .access_token)" \
  "https://bb.unson.jp/api/info/graph/entities?type=<type>&limit=500" | jq
```

4. Check aliases and returned record payloads, not only the query text.
5. For Graph operations, load Philosophy Context:

```bash
curl -s -H "Authorization: Bearer $(cat ~/.brainbase/tokens.json | jq -r .access_token)" \
  "https://bb.unson.jp/api/info/context?project=brainbase&types=project&includePhilosophy=true&scope=graph" \
  | jq '.philosophy_context.prompt_block'
```
