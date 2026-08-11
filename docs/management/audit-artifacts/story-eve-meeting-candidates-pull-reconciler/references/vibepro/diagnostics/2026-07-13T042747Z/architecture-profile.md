# 構造プロファイル

| 項目 | 内容 |
|------|------|
| Run ID | 2026-07-13T042747Z |
| 種別 | web_app |
| 描画方式 | react |
| パッケージ管理 | npm |
| 言語 | javascript, python, typescript |
| API route | なし |
| DB | postgres |
| 認証 | なし |
| 配信 | - |

## View

| View | 判定 |
|------|------|
| Structure | web_app, react |
| Runtime | 0 entrypoints |
| Data | postgres |
| Security | 0 auth boundaries, 3 secret files |
| Deployment | - |
| Quality | vitest, playwright, .github/workflows/daily-snapshot.yml, .github/workflows/daily-story-alerts.yml, .github/workflows/security-check.yml, .github/workflows/vibepro-graph-ssot.yml, .github/workflows/vibepro-graphify-impact.yml, .github/workflows/vibepro-score-run.yml, .github/workflows/weekly-story-progress.yml |

## 適用チェック

- secrets
- xss
- dependency-graph
- component-style
- code-quality
- database-access

## 根拠

- package_json: package.json brainbase-ui
