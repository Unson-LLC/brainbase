# Brainbase UI メモリ最適化ガイド

**作成日**: 2026-01-01
**ステータス**: Active
**優先度**: Critical

---

## 📊 問題の概要

Brainbase UIでは、TMUXセッションとMCPサーバープロセスが適切にクリーンアップされず、メモリリークが発生しています。

### 現状（2026-01-01時点）

| 項目 | 数量 | 深刻度 |
|------|------|--------|
| TMUXセッション | 66個（65個がdetached） | 🔴 Critical |
| Node.jsプロセス合計 | 494個 | 🔴 Critical |
| ├─ gmail MCP | 171個 | 🔴 Critical |
| ├─ jibble MCP | 171個 | 🔴 Critical |
| ├─ brainbase MCP | 171個 | 🔴 Critical |
| └─ zep-mcp-server | 45個 | 🟡 Warning |
| 総メモリ使用量（RSS） | 418.65 MB | 🟡 Warning |
| 3日以上前のセッション | 27個 | 🔴 Critical |

---

## 🔍 根本原因

### 原因1: TMUXセッションのライフサイクル管理不在

**現状**:
- `login_script.sh`: セッション作成のみ実装
- セッション終了時のクリーンアップ処理が存在しない
- detachedセッションが無期限に残り続ける

**影響**:
- 不要なTMUXセッションが蓄積
- メモリ使用量の増加
- システムリソースの圧迫

### 原因2: MCPサーバープロセスの孤立

**現状**:
- Claude Codeの各セッションがMCPサーバーを起動
- セッション終了時にプロセスが残り続ける
- 親プロセス（TMUX）が終了してもMCPプロセスが存続

**影響**:
- 各MCPサーバーが100個以上のプロセスを持つ異常事態
- メモリリークの主要因

### 原因3: プロセス管理の欠如

**現状**:
- `dev.sh`: `server.js`プロセスのみクリーンアップ
- MCPサーバーのクリーンアップ処理が存在しない

**影響**:
- 開発サーバー再起動時にMCPプロセスは残り続ける

---

## ✅ 解決策

### 🔧 即座に実行可能な対応

#### 1. 手動クリーンアップスクリプトの実行

```bash
# 3日以上前のdetachedセッションとMCPプロセスを削除
/Users/ksato/workspace/projects/brainbase/scripts/cleanup-old-sessions.sh

# オプション: 保持期間を変更（例: 1日）
/Users/ksato/workspace/projects/brainbase/scripts/cleanup-old-sessions.sh 1
```

**実行タイミング**:
- メモリ使用量が高い時
- システムが重い時
- 定期的なメンテナンス時（推奨: 週1回）

#### 2. 自動クリーンアップの設定（推奨）

**macOS launchd Agent**（推奨方法）:

1. launchdエージェントの配置:
   ```bash
   cp /Users/ksato/workspace/projects/brainbase/config/com.brainbase.cleanup.plist \
      ~/Library/LaunchAgents/
   ```

2. エージェントの登録:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.brainbase.cleanup.plist
   ```

3. 動作確認:
   ```bash
   launchctl list | grep brainbase.cleanup
   ```

**実行スケジュール**:
- 毎日午前3時に自動実行
- 3日以上前のdetachedセッションを削除
- 孤立したMCPプロセスを終了

#### 3. 即座のメモリ解放（緊急時）

```bash
# 現在のセッション以外のすべてのdetachedセッションを削除
tmux list-sessions | grep -v attached | awk -F: '{print $1}' | \
    xargs -I {} tmux kill-session -t {}

# すべての孤立MCPプロセスを強制終了
pkill -f 'gmail/src/index.ts'
pkill -f 'jibble/src/index.ts'
pkill -f 'brainbase/src/index.ts'
pkill -f 'zep-mcp-server/src/index.ts'
```

**⚠️ 注意**: 現在使用中のClaude Codeセッションも影響を受ける可能性があります。

---

### 🏗️ 恒久的な対応（今後の実装）

#### Phase 1: セッション終了時のクリーンアップ（優先度: High）

**実装内容**:
- `login_script.sh`の拡張: セッション終了時のフック追加
- TMUXの`set-hook`機能を使用してセッション終了を検出
- セッション終了時に関連MCPプロセスを自動終了

**実装例**:
```bash
# login_script.sh に追加
tmux set-hook -t "$SESSION_NAME" session-closed \
    "run-shell '/path/to/cleanup-session.sh $SESSION_NAME'"
```

#### Phase 2: MCPサーバーのプロセスグループ管理（優先度: High）

**実装内容**:
- MCPサーバーをプロセスグループとして起動
- 親プロセス（TMUX）終了時に子プロセスも自動終了
- `setsid`や`systemd`風の管理を導入

**実装例**:
```bash
# MCPサーバー起動時
setsid claude-mcp-server &
MCP_PID=$!
trap "kill -TERM -$MCP_PID" EXIT
```

#### Phase 3: セッション保持ポリシーの明確化（優先度: Medium）

**ポリシー案**:
- **Active Session**: 現在アタッチされているセッション → 保持
- **Recent Session**: 24時間以内のdetachedセッション → 保持
- **Old Session**: 3日以上前のdetachedセッション → 自動削除
- **Orphaned Session**: 関連プロセスがないセッション → 即座に削除

#### Phase 4: モニタリング & アラート（優先度: Low）

**実装内容**:
- メモリ使用量の定期的な監視
- 閾値超過時のアラート（Slack通知等）
- ダッシュボードでの可視化

**モニタリング項目**:
- TMUXセッション数
- MCPプロセス数
- Node.jsプロセスの総メモリ使用量
- 孤立プロセス数

---

## 📈 効果測定

### Before（現状）

```
TMUXセッション: 66個
Node.jsプロセス: 494個
総メモリ使用量: 418.65 MB
```

### After（目標）

```
TMUXセッション: 5個以下（active + 直近24時間）
Node.jsプロセス: 20個以下
総メモリ使用量: 100 MB以下
```

**期待効果**:
- メモリ使用量: **-76%削減**
- プロセス数: **-96%削減**
- システムレスポンス向上

---

## 🔄 運用フロー

### 日次オペレーション

1. **自動クリーンアップ**（午前3時）
   - launchdエージェントが自動実行
   - 3日以上前のセッションを削除
   - ログファイルに記録

2. **モニタリング**（オプション）
   - メモリ使用量の確認
   - 異常検知時のアラート

### 週次オペレーション

1. **クリーンアップログの確認**
   ```bash
   tail -100 /Users/ksato/workspace/projects/brainbase/logs/cleanup-*.log
   ```

2. **手動メンテナンス**（必要に応じて）
   ```bash
   # 強制クリーンアップ（1日以上前のセッション）
   /Users/ksato/workspace/projects/brainbase/scripts/cleanup-old-sessions.sh 1
   ```

### 月次オペレーション

1. **クリーンアップ効果の測定**
   ```bash
   # セッション数の推移を確認
   tmux list-sessions | wc -l

   # プロセス数の推移を確認
   ps aux | grep node | grep -v grep | wc -l
   ```

2. **ポリシーの見直し**
   - 保持期間の調整
   - クリーンアップ頻度の最適化

---

## 📚 参考リンク

### 内部ドキュメント

- [CLAUDE.md](/Users/ksato/workspace/shared/.worktrees/session-1767277421803-brainbase/CLAUDE.md): brainbase開発標準
- [login_script.sh](/Users/ksato/workspace/projects/brainbase/login_script.sh): セッション起動スクリプト
- [dev.sh](/Users/ksato/workspace/projects/brainbase/dev.sh): 開発サーバー起動スクリプト

### 外部リソース

- [TMUX Documentation](https://github.com/tmux/tmux/wiki)
- [TMUX Hooks](https://github.com/tmux/tmux/wiki/Advanced-Use#hooks)
- [macOS launchd](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)

---

## ⚠️ トラブルシューティング

### Q: クリーンアップスクリプトが動作しない

**A**: 以下を確認してください：
1. 実行権限があるか: `ls -la /Users/ksato/workspace/projects/brainbase/scripts/cleanup-old-sessions.sh`
2. TMUXが起動しているか: `tmux list-sessions`
3. エラーログを確認: `cat /Users/ksato/workspace/projects/brainbase/logs/cleanup-*.log`

### Q: launchdエージェントが起動しない

**A**: 以下を確認してください：
1. plistファイルのパーミッション: `ls -la ~/Library/LaunchAgents/com.brainbase.cleanup.plist`
2. plistファイルの構文: `plutil -lint ~/Library/LaunchAgents/com.brainbase.cleanup.plist`
3. launchdのログ: `log show --predicate 'subsystem == "com.apple.launchd"' --last 1h`

### Q: MCPプロセスが削除されない

**A**: 手動で強制終了してください：
```bash
# 特定のMCPサーバーのみ
pkill -9 -f 'gmail/src/index.ts'

# すべてのMCPサーバー
pkill -9 -f 'mcp/.*src/index.ts'
```

---

**最終更新**: 2026-01-01
**作成者**: Claude Code
**レビュー**: 佐藤圭吾
