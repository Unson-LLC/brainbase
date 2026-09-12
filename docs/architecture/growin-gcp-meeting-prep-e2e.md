# Growin GCP会議準備E2E

## 境界

Google Workspace認証、Growin専用MCP、Growin専用Graphを一つのテナント境界として扱う。雲孫環境の認証情報、接続先、データへフォールバックしない。

## 最小構成

Claude Code → Google Workspace認証境界 → Growin MCP → Growin Graph API / PostgreSQL → 監査ログ

## 失敗時の扱い

- 認証設定が不足している場合は起動または接続を拒否する。
- テナントが不明・曖昧な場合は拒否する。
- Graphが利用不能な場合は空結果ではなく利用不能として返す。
- 雲孫環境への代替接続は行わない。
