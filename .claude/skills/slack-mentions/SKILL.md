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

| workspace | MCP namespace | 佐藤圭吾 User ID | DM Channel ID |
|---|---|---|---|
| salestailor | `mcp__slack_salestailor__` | `U08FB9S7HUL` | 主要DMは下表 |
| unson | `mcp__slack_unson__` | `U07LNUP582X` | `D07L8FG6L4F` |
| techknight | `mcp__slack_techknight__` | `U07B19N048G` | `D07ACCJUXK5` |

## 主要チャンネル・DM相手（salestailor）

| 名前 | User ID | チャンネル種別 | Channel/DM ID |
|------|---------|--------------|---------------|
| 堀 汐里 / Shiori Hori | `U08EUJKRHN3` | DM | `D08FB9SB97W` |
| 渡邊博昭 | `U09GQSY3AUD` | DM | `D09GQSYG42H` |
| 藤井志穂 / Shiho Fujii | `U09JV6DUEG7` | - | - |
| 谷口達彦 / Tatsuhiko Taniguchi | `U08FLSLMRAM` | - | - |
| 八雲まな / Mana Yakumo (BOT) | `U0A1T6NTSJW` | DM | `D0A264FGG65` |
| 山下大輝 / Hiroki Yamashita | `U08UZF58F0C` | - | - |
| 舘岡麻美 | `U09PJMXF70W` | - | - |
| #eng | - | Channel | `C08SX913NER` |
| #cxo | - | Channel | `C08U2EX2NEA` |
| #bo | - | Channel | `C08GBHJ3THV` |
| #cs | - | Channel | `C08G07NKHUN` |
| #salestailor-all | - | Channel | `C08EUJL4CPR` |
| #eng-notify | - | Channel | `C0A1620L4TS` |

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
salestailorは下記の主要DMを優先する。unson / techknight は `users_search` でDM IDを確認し、直接読めない場合は `filter_users_with=<workspace user id>` で補完し、取得制限を evidence に残す。

```
# 堀さんDM
slack_read_channel(channel_id="D08FB9SB97W", limit=10)

# 渡邊さんDM
slack_read_channel(channel_id="D09GQSYG42H", limit=10)

# mana DM
slack_read_channel(channel_id="D0A264FGG65", limit=5)
```

### Step 3: スレッド展開（必要な場合のみ）

Step 1で見つかったスレッド内メンションの前後文脈が必要な場合に展開する。

```
slack_read_thread(channel_id="<channel_id>", message_ts="<parent_ts>")
```

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
2. **`from:ユーザー名` は漢字で動かないことがある**: User IDで `from:U09GQSY3AUD` も機能しない場合あり
3. **スレッド内のメンションは検索で拾えないことがある**: 必ずチャンネル直読み → スレッド展開で確認

### 名前の表記ゆれ

渡邊さんの名前は複数の表記が存在する：
- `渡邊博昭`（Slack表示名）
- `渡邉`（一部メッセージ内での表記）
- `渡辺`（さらに別表記）

検索時は `渡邊` `渡邉` `渡辺` の3パターンで検索するか、User ID `U09GQSY3AUD` を使う。

### 時刻

Slack APIのタイムスタンプはUNIX timestamp。JSTはUTC+9。
`oldest`/`latest` パラメータで期間を絞る場合はUNIX timestampで指定。

## よくある使い方

### 「直近1時間のメンションを確認して」

```
1. #eng を limit=20 で読む → スレッドにメンションがないか確認
2. 主要DM（堀・渡邊）を limit=5 で読む
3. to:me 検索で補完
```

### 「渡邊さんからの連絡を確認して」

```
1. DM D09GQSYG42H を直接読む
2. #eng の最新メッセージでスレッド内に渡邊さんの発言がないか確認
3. 検索: slack_search_public_and_private(query="渡邊 OR 渡邉", sort="timestamp")
```

### 「未対応のメンションをまとめて」

```
1. Step 1-3 を3ワークスペース全てで実行
2. 自分の返信がないメンションをフィルタ
3. アクション必要なものを優先順位付け
```
