# Bundled Brainbase MCP

`brainbase-unson` に同梱する Brainbase MCP サーバー。

## 正本

- Repository: `https://github.com/Unson-LLC/brainbase-unson`
- Path: `mcp/brainbase`

## 同梱ポリシー

- 実行本体は `lib/`（`dist/` をリネームして配置）
- 実行時は `scripts/register-brainbase-mcp.mjs` 経由で `claude mcp add` する
- データソースは Graph API 固定（`BRAINBASE_ENTITY_SOURCE=graphapi`）
- 外部リポジトリへの実行時依存は持たない

## 更新手順（メンテナー向け）

`lib/` 配下をこのリポジトリ内で更新し、`scripts/register-brainbase-mcp.mjs` の動作確認を行う。

```bash
npm run mcp:add:brainbase -- --quiet
npm run mcp:get:brainbase
```
