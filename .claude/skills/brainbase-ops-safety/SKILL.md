---
name: brainbase-ops-safety
description: brainbase運用における安全性のベストプラクティス。本番環境でのプロセス管理、デプロイ、システム操作の注意事項とgotcha集
location: managed
type: project
---

## Triggers

以下の状況で使用:
- プロセスの強制終了やクリーンアップを行うとき
- 本番環境でシステムコマンドを実行するとき
- サービスの再起動やメンテナンスを行うとき

# brainbase運用安全ガイド - 重要な注意事項とGotcha

本番環境でのシステム操作における重大な失敗を防ぐためのガイド。

## プロセス管理の注意点

### killall/pkillの使い分け - 本番サービス停止のリスク

**問題**: `killall -9 node` や `killall -9 npx` は本番サービスを含む全てのプロセスを停止する

```bash
❌ 絶対にやってはいけない例
killall -9 node      # 全てのnodeプロセスを強制終了
killall -9 npx       # 全てのnpxプロセスを強制終了

→ 本番サービス（brainbase-ui、MCP servers等）が全て停止
→ 復旧に多大な時間がかかる
```

```bash
✅ 正しい例: 特定のプロセスパターンで絞り込む
# 1. 事前に対象プロセスを確認
ps aux | grep "claude.*dangerously-skip-permissions"

# 2. 確認後、特定のパターンのみ終了
pkill -9 -f "claude.*dangerously-skip-permissions"

# 3. 必要に応じて他のパターンも
pkill -9 -f "mcp-server.*specific-pattern"
```

**原因**:
- `killall` はプロセス名のみでマッチする
- node/npxは多くのサービスで共通して使われている
- `-9` (SIGKILL) は即座に強制終了するため、復旧処理も実行されない

**ベストプラクティス**:
1. **必ず `ps aux | grep <pattern>` で対象を事前確認**
2. **`pkill -f <pattern>` でプロセスのコマンドライン全体でマッチ**
3. **本番環境では `-9` の前に通常のシグナル (SIGTERM) を試す**
4. **worktree環境で事前にテストする**

**確認方法**:
```bash
# 現在動いているnodeプロセスを確認
ps aux | grep "[n]ode" | grep -v grep

# 特定のポートでリスニングしているプロセスを確認
lsof -i :3000
netstat -an | grep LISTEN
```

---

## 今後追加予定の項目

- デプロイ時の注意事項
- データベース操作の安全性
- 環境変数の管理
- シークレット情報の取り扱い
