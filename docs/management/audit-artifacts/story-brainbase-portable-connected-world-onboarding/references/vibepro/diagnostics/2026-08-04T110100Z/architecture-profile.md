# 構造プロファイル

| 項目 | 内容 |
|------|------|
| Run ID | 2026-08-04T110100Z |
| 種別 | unknown |
| 描画方式 | - |
| パッケージ管理 | npm |
| 言語 | javascript, typescript |
| API route | なし |
| DB | なし |
| 認証 | なし |
| 配信 | - |

## View

| View | 判定 |
|------|------|
| Structure | - |
| Runtime | 0 entrypoints |
| Data | - |
| Security | 0 auth boundaries, 0 secret files |
| Deployment | - |
| Quality | vitest, .github/workflows/npm-publish.yml |

## 適用チェック

- secrets
- xss
- dependency-graph
- code-quality

## 根拠

- package_json: package.json @unson/brainbase-mcp
