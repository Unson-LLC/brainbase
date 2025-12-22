---
skill: brainbase-ui-launchd-gotchas
description: brainbase-uiのlaunchd自動起動とwatchモードによる競合問題のトラブルシューティング
globs: ["brainbase-ui/**/*"]
alwaysInclude: false
userInvocable: false
tags: [project, troubleshooting, gotcha, launchd]
---

# brainbase-ui launchd自動起動の落とし穴

## 問題の症状

- server.jsを手動で修正・再起動しても変更が反映されない
- 日本語フォント等の設定変更が適用されない
- ポート3000が既に使用中のエラーが出る
- プロセスをkillしても自動的に再起動される

## 根本原因

`com.brainbase.ui` というlaunchdサービスがバックグラウンドで動いており、自動的に`npm run dev`（watchモード）を起動し続けている。

**問題点：**
1. watchモードは`--watch`フラグでファイル変更を監視し、自動再起動する
2. 手動で起動したプロセスと競合する
3. watchモードは古いコードやキャッシュを使う場合がある
4. 複数のnodeプロセスが同じポートを奪い合う

## 診断方法

### 1. launchdサービスの確認

```bash
# brainbase関連のlaunchdサービスを検索
launchctl list | grep brainbase

# 特定サービスの詳細確認
launchctl list com.brainbase.ui
```

### 2. 実行中のnodeプロセスを確認

```bash
# brainbase-ui関連のnodeプロセスを確認
ps aux | grep "node.*brainbase-ui"

# 複数のプロセスが動いている場合は競合の可能性あり
```

### 3. ポート使用状況の確認

```bash
# ポート3000を使用しているプロセスを確認
lsof -i :3000
```

## 解決方法

### オプション1: launchdサービスを完全停止（推奨）

```bash
# サービスを停止
launchctl stop com.brainbase.ui

# サービスをアンロード（起動しないようにする）
launchctl unload ~/Library/LaunchAgents/com.brainbase.ui.plist

# plistファイルを削除（完全削除）
rm ~/Library/LaunchAgents/com.brainbase.ui.plist

# 確認
launchctl list | grep brainbase  # 何も表示されなければOK
```

### オプション2: 正しいコマンドに変更

自動起動が必要な場合は、plistファイルを編集してwatchモードを無効化：

```xml
<!-- 変更前 -->
<string>npm</string>
<string>run</string>
<string>dev</string>  <!-- これがwatchモード -->

<!-- 変更後 -->
<string>npm</string>
<string>start</string>  <!-- 通常モード -->
```

変更後、サービスを再読み込み：

```bash
launchctl unload ~/Library/LaunchAgents/com.brainbase.ui.plist
launchctl load ~/Library/LaunchAgents/com.brainbase.ui.plist
```

## 正しい起動方法

### 開発時（手動起動）

```bash
# 通常モード（推奨）
node server.js

# または
npm start

# バックグラウンド起動
nohup node server.js > /tmp/brainbase-ui.log 2>&1 &
```

### 本番環境（自動起動が必要な場合のみ）

launchdを使う場合は、**必ず`npm start`を使用**し、watchモードは避ける。

## 予防策

1. **launchdサービスを作成する前に確認**
   - 本当に自動起動が必要か？
   - watchモードではなく通常モードか？
   - ログ出力先は適切か？

2. **開発時はlaunchdを無効化**
   - 開発中はlaunchdサービスを停止
   - 必要な時だけ手動で起動

3. **定期的にlaunchdサービスを確認**
   ```bash
   launchctl list | grep brainbase
   ```

## トラブルシューティングチェックリスト

サーバー設定変更が反映されない場合：

- [ ] `launchctl list | grep brainbase` で自動起動サービスを確認
- [ ] `ps aux | grep "node.*brainbase-ui"` で複数プロセスがないか確認
- [ ] launchdサービスがあれば停止・削除
- [ ] すべてのnodeプロセスをkill: `pkill -9 -f "node.*brainbase-ui"`
- [ ] すべてのttydプロセスをkill: `pkill -9 -f "ttyd"`
- [ ] 手動で再起動: `node server.js`
- [ ] ブラウザのキャッシュをクリア（Cmd+Shift+R）

## 関連ドキュメント

- `skill: claude-code-cicd-auth` - CI/CD環境での自動化
- `_codex/common/ops/launchd/` - 他のlaunchdサービス設定

---

**教訓:** watchモードは開発時便利だが、手動デバッグ時は競合の原因になる。launchdでの自動起動は慎重に設定すること。
