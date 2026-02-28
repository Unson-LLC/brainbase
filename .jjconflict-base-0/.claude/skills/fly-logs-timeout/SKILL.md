---
name: fly-logs-timeout
description: Fly.io logsコマンド使用時は必ずタイムアウトを設定するベストプラクティス
---

# Fly.io Logs タイムアウト設定

## 目的

Fly.io の `fly logs` コマンドはストリーミング方式でログを出力し続けるため、タイムアウトを設定しないと無限に実行され続けて、処理がハングアップします。このSkillは、確実にタイムアウトを設定する方法を提供します。

## 主な機能

- `timeout` コマンドを使用したタイムアウト設定
- Bash ツールの `timeout` パラメータを使用したタイムアウト設定
- 推奨タイムアウト時間の提示（10-15秒）
- grep と組み合わせた効率的なログ検索

## 使用方法

### パターン1: timeout コマンド（推奨）

```bash
# 10秒でタイムアウト
timeout 10 fly logs --config fly.web-unson.toml

# grep と組み合わせて特定のログのみ抽出
timeout 10 fly logs --config fly.web-unson.toml 2>&1 | grep "ERROR" | head -20
```

### パターン2: Bash ツールの timeout パラメータ

Claude Code の Bash ツール使用時（timeoutパラメータ: ミリ秒単位）：

```
Bash tool invocation:
  command: fly logs --config fly.web-unson.toml 2>&1 | grep "ERROR" | head -20
  description: Fly.ioログでエラーを確認
  timeout: 10000  # 10秒（ミリ秒単位）
```

**重要**: Bash ツールの `timeout` パラメータは**ミリ秒単位**です（10秒 = 10000）

## 推奨タイムアウト時間

| 用途 | 推奨タイムアウト |
|------|----------------|
| 特定ログの検索 | 10秒 |
| 直近ログの確認 | 10-15秒 |
| 長期間のログ調査 | 30秒 |

**原則**: 必要最小限の時間に設定し、処理がハングアップしないようにする

## よくある使用例

### エラーログの検索

```bash
timeout 10 fly logs --config fly.web-unson.toml 2>&1 | grep -i "error\|exception\|failed" | head -30
```

### 特定の機能のログ追跡

```bash
timeout 15 fly logs --config fly.web-unson.toml 2>&1 | grep "フォーム送信\|submitForm" | head -50
```

### 最近のアクセスログ

```bash
timeout 10 fly logs --config fly.web-unson.toml 2>&1 | grep "GET\|POST" | head -20
```

## トラブルシューティング

### タイムアウトしても結果が得られない

**原因**: ログ出力が少ない、またはgrep条件が厳しすぎる

**解決**:
- タイムアウト時間を延長（15-30秒）
- grep条件を緩和
- `head` の件数を増やす

### タイムアウト前に処理が終了する

**症状**: ログが途中で止まる

**原因**: Fly.io側の接続タイムアウトまたはログストリーム終了

**解決**: 正常動作です。必要なログが取得できていれば問題ありません。

## ベストプラクティス

1. **常にタイムアウトを設定**: fly logs 実行時は必ずタイムアウトを設定する
2. **grep + head で効率化**: 大量のログから必要な情報だけを抽出
3. **2>&1 でエラー出力も含める**: 標準エラー出力もパイプに流す
4. **適切なタイムアウト時間**: 10-15秒を基準に、用途に応じて調整

## 関連コマンド

### fly status

デプロイ状況の確認（タイムアウト不要）:

```bash
fly status --config fly.web-unson.toml
```

### fly secrets list

環境変数の確認（タイムアウト不要）:

```bash
fly secrets list --config fly.web-unson.toml
```

## プロジェクト固有の設定

### SalesTailor の Fly.io 環境

- **web-unson環境**: `fly.web-unson.toml`
- **標準環境**: `fly.toml`

常に `--config` オプションで正しい設定ファイルを指定すること。

## 参考

- Fly.io公式ドキュメント: https://fly.io/docs/flyctl/logs/
- timeout コマンド: `man timeout`
