---
name: slack-mentions
description: Slack MCPで佐藤圭吾宛のメンション・DMを漏れなく抽出する手順書
---

# Slack メンション・DM抽出

## 目的

佐藤圭吾（Keigo Sato）宛のSlackメンション・DMを**漏れなく**抽出する。
Slack検索APIは DM のスレッドやチャンネル内スレッドを取りこぼすことがあるため、
複数の手法を組み合わせて網羅的に拾う。

## ユーザー情報

佐藤圭吾（Keigo Sato）のSlack確認は、1ワークスペースだけで完了扱いにしない。
少なくとも以下3ワークスペースを横断する。

| workspace | MCP namespace | 佐藤圭吾 User ID |
|---|---|---|
| salestailor | `mcp__slack_salestailor__` | `U08FB9S7HUL` |
| unson | `mcp__slack_unson__` | `U07LNUP582X` |
| techknight | `mcp__slack_techknight__` | `U07B19N048G` |

## 起動前チェック

Slack MCP が起動できない状態を「Slack 0件」と誤報告しない。取得前に必ず3ワークスペースの前提を確認する。

```bash
cd /Users/ksato/workspace/code/brainbase
scripts/check-slack-mcp-health.sh
```

- `ok: salestailor` / `ok: unson` / `ok: techknight` が揃った場合だけ取得に進む
- `blocked` / `SLACK_MCP_UNAVAILABLE` の場合は Slack 未確認として報告し、未対応0件とは書かない
- 失敗理由は workspace 名と前提名だけを残し、token や secret 値は表示しない

## 抽出手順

### Step 1: User IDで全ワークスペース検索（最優先）

**これが最も確実。チャンネルリストの管理不要で、スレッド内も全て拾える。**

```
salestailor: slack_search_public_and_private(query="<@U08FB9S7HUL>", sort="timestamp", count=50)
unson: slack_search_public_and_private(query="<@U07LNUP582X>", sort="timestamp", count=50)
techknight: slack_search_public_and_private(query="<@U07B19N048G>", sort="timestamp", count=50)
```

- 各ワークスペースの全チャンネル（public/private）+ DM + スレッド内を横断検索
- `to:me` より確実（`to:me`はスレッド内を取りこぼす）
- チャンネルリストに無い場所のメンションも拾える
- **3ワークスペース分を最初に実行し、結果を元にまとめる**

### Step 2: DM履歴の補完（検索に出ないDMメッセージ用）

DMは`@`メンションなしで送られることがあるため、主要DMは直接読む。
DM IDはworkspace固有の派生識別子なので固定台帳にしない。対象者を各workspaceの`users_search`で解決し、その実行で得たDM IDを使う。直接読めない場合は `filter_users_with=<workspace user id>` で補完し、取得制限を evidence に残す。

```
users_search(query="<target name or email>")
slack_read_channel(channel_id="<resolved_dm_channel_id>", limit=10)
```

### Step 3: スレッド展開（必要な場合のみ）

Step 1で見つかったスレッド内メンションの前後文脈が必要な場合に展開する。

```
slack_read_thread(channel_id="<channel_id>", message_ts="<parent_ts>")
```

### チャンネルURLが渡された場合

URL内のworkspaceとchannel IDを最優先の識別子として使い、表示名だけで別workspaceの同名チャンネルを推測しない。

1. `https://<workspace>.slack.com/archives/<channel_id>/...` からworkspaceとchannel IDを抽出する
2. 対応するworkspaceのSlack接続でchannel IDを直接読む
3. URLがない場合だけチャンネル名検索へフォールバックする
4. workspaceを解決できない、またはアクセスできない場合は「未確認」とし、0件扱いにしない

## 出力フォーマット

抽出結果は以下の形式でまとめる：

```
## 直近のSlackメンション

### 1. [送信者名] — [日時]
**チャンネル/DM**: #eng / DM
**内容**: 要約
**ステータス**: 未対応 / 対応済み / 確認待ち
**アクション必要**: あり/なし

### 2. ...
```

## 注意点・Gotchas

### 検索APIの制限

1. **`to:me` はDM優先**: チャンネル内スレッドのメンションを取りこぼす
2. **`from:ユーザー名` は表記に依存する**: `users_search` で現在のUser IDを解決し、名前検索とID検索を相互に補完する
3. **スレッド内のメンションは検索で拾えないことがある**: 必ずチャンネル直読み → スレッド展開で確認

### 名前の表記ゆれ

人名検索は表示名、漢字・かな・ローマ字などの表記ゆれを試す。現在の `users_search` でUser IDを解決できた場合は、そのIDを優先し、個人別の固定ID台帳は持たない。

### 時刻

Slack APIのタイムスタンプはUNIX timestamp。JSTはUTC+9。
`oldest`/`latest` パラメータで期間を絞る場合はUNIX timestampで指定。

## よくある使い方

### 「直近1時間のメンションを確認して」

```
1. Step 1のUser ID検索を3ワークスペースで行う
2. 対象者が指定されていれば users_search でDM IDを解決して直接読む
3. 必要なスレッドを展開し、取得できないworkspaceは未確認として残す
```

### 「特定の人からの連絡を確認して」

```
1. 各workspaceで users_search を行い、対象者とDM IDを解決する
2. 解決したDMを直接読み、対象者のUser IDでも検索する
3. 表記ゆれ検索で補完し、workspaceごとの取得結果を区別する
```

### 「未対応のメンションをまとめて」

```
1. Step 1-3 を3ワークスペース全てで実行
2. 自分の返信がないメンションをフィルタ
3. アクション必要なものを優先順位付け
```
