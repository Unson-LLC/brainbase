# Bundled Brainbase MCP

`brainbase-unson` に同梱する Brainbase MCP サーバー。

## 正本

- Repository: `https://github.com/Unson-LLC/unson-mcp-servers`
- Path: `mcp-servers/brainbase`

## 同梱ポリシー

- 実行本体は `lib/`（`dist/` をリネームして配置）
- 実行時は `scripts/register-brainbase-mcp.mjs` 経由で `claude mcp add` する
- データソースは Graph API 固定（`BRAINBASE_ENTITY_SOURCE=graphapi`）

## 更新手順（メンテナー向け）

```bash
rsync -a --delete /Users/ksato/workspace/unson-mcp-servers/mcp-servers/brainbase/dist/ mcp/brainbase/lib/
cp /Users/ksato/workspace/unson-mcp-servers/mcp-servers/brainbase/README.md mcp/brainbase/UPSTREAM_README.md
cp /Users/ksato/workspace/unson-mcp-servers/mcp-servers/brainbase/CHANGELOG.md mcp/brainbase/UPSTREAM_CHANGELOG.md
cp /Users/ksato/workspace/unson-mcp-servers/mcp-servers/brainbase/package.json mcp/brainbase/upstream.package.json
```
