---
name: daily-reflection
description: 今日1日の会議を振り返り、議事録から固有名詞・顧客・パートナー・意思決定・次アクションを抽出して、Graph SSOT (bb.unson.jp) と NocoDB (noco.unson.jp) の両方に自動反映する夕方ルーティン。ohayo-orchestrator の対になる夕方版。
---

# daily-reflection — 1日の振り返りと SSOT 反映

**対象**: 毎日夕方〜夜、1日の会議を棚卸しして、知識（Graph）と状態（NocoDB）の両正本に反映する。
**補完関係**: `ohayo-orchestrator` = 朝のインプット / `daily-reflection` = 夕方のアウトプット整理。

---

## Triggers

以下の発話で起動：
- 「今日の振り返り」「今日1日の会議を振り返り」
- 「振り返り + NocoDB/Graph 反映」
- 「夕方の SSOT 反映」

---

## Pipeline（7 Phase）

```
Phase 0: 日付確定
Phase 1: カレンダーから会議リスト取得（gog）
Phase 2: Github から議事録ファイル取得
Phase 3: 議事録から固有名詞・決定事項・アクション抽出
Phase 4: Graph SSOT 既存エンティティ突合（新規 vs 既存）
Phase 5: Graph SSOT 書き込み（Decision + Wiki）
Phase 6: NocoDB タスク書き込み（プロジェクト別）
Phase 6.5: Archive blocked 日次整理
Phase 7: レポート（成功/失敗件数・残作業）
```

---

## Phase 0: 日付確定

**注意**: セッションが夜を跨ぐと日付が変わる。明確に「昨日」「今日」を確認。

```bash
# 現在日付（Claude Code context の currentDate を優先）
# ユーザーの「今日」が既に過ぎていれば、確認する
```

**確認質問テンプレート**: 「振り返り対象日を確定させてください: `YYYY-MM-DD` でよろしいですか？」

---

## Phase 1: カレンダーから会議リスト取得

`gog` CLI を使用（Google Calendar MCP は認証不要）。

```bash
# 対象日の全予定を取得
gog calendar list --from=YYYY-MM-DD --to=YYYY-MM-DD --plain

# 次ページがあれば --page で追跡
```

**整形**: ID / START / END / SUMMARY を表形式でまとめ、ミラー重複（同一時間帯の複数 account ソース）を排除。

---

## Phase 2: Github から議事録取得

mana の議事録パイプラインは以下の構造で Github に push される：

```
Unson-LLC/<project>-project/meetings/
  ├── minutes/YYYY-MM-DD_<slug>.md       ← AI要約＋アクション
  └── transcripts/YYYY-MM-DD_<slug>.txt   ← 発話全文
```

### mana 管理リポジトリ（網羅リスト）

**brainbase-config の `config.yml` が正本**。2026-04 時点の主要 repo:

| プロジェクト | Github Repo |
|---|---|
| salestailor | Unson-LLC/salestailor-project |
| zeims | Unson-LLC/zeims-project |
| senrigan | Unson-LLC/senrigan-project |
| baao | Unson-LLC/baao-project |
| brainbase | Unson-LLC/brainbase-project |
| back-office | Unson-LLC/back_office |
| ncom-catalyst | Unson-LLC/ncom-catalyst |
| mywa | Unson-LLC/MyWa |
| vibepro-project | Unson-LLC/vibepro-project |
| unson-os | Unson-LLC/unson_os |
| **unson-board** | **Unson-LLC/Drive/meetings/unson-board/minutes** ⚠️特殊パス |
| back-office | Unson-LLC/Drive/meetings/back-office/minutes |
| dialogai | Unson-LLC/Drive/meetings/dialogai/minutes |
| mywa | Unson-LLC/Drive/meetings/mywa/minutes |
| unson-os | Unson-LLC/Drive/meetings/unson-os/minutes |
| yakumokai | Unson-LLC/Drive/meetings/yakumokai/minutes |
| other | Unson-LLC/Drive/meetings/other/minutes |
| tech-knight | Tech-Knight-inc/tech-knight-project |
| senpainurse | Tech-Knight-inc/senpainurse |
| web-inn | Tech-Knight-inc/web-inn |
| smartfront | Tech-Knight-inc/smartfront |
| aitle | Tech-Knight-inc/Aitle |
| fx | sintariran/FX |
| keiba | sintariran/keiba |

### 一括探索スクリプト

```bash
TARGET_DATE="YYYY-MM-DD"
REPOS=(
  "Unson-LLC/salestailor-project"
  "Unson-LLC/zeims-project"
  "Unson-LLC/senrigan-project"
  "Unson-LLC/baao-project"
  "Unson-LLC/brainbase-project"
  "Unson-LLC/back_office"
  "Unson-LLC/ncom-catalyst"
  "Unson-LLC/MyWa"
  "Unson-LLC/vibepro-project"
  "Unson-LLC/unson_os"
  "Tech-Knight-inc/tech-knight-project"
  "Tech-Knight-inc/senpainurse"
  "Tech-Knight-inc/web-inn"
  "Tech-Knight-inc/smartfront"
  "Tech-Knight-inc/Aitle"
)
DRIVE_SUBDIRS=("unson-board" "back-office" "dialogai" "mywa" "unson-os" "yakumokai" "other")

for repo in "${REPOS[@]}"; do
  gh api "repos/$repo/contents/meetings/minutes" 2>/dev/null \
    | jq -r ".[]?.name" 2>/dev/null | grep "$TARGET_DATE" | while read f; do
      echo "$repo:meetings/minutes/$f"
    done
done

for sub in "${DRIVE_SUBDIRS[@]}"; do
  gh api "repos/Unson-LLC/Drive/contents/meetings/$sub/minutes" 2>/dev/null \
    | jq -r ".[]?.name" 2>/dev/null | grep "$TARGET_DATE" | while read f; do
      echo "Unson-LLC/Drive:meetings/$sub/minutes/$f"
    done
done
```

### ファイル取得

```bash
gh api "repos/<owner>/<repo>/contents/<path>" \
  -H "Accept: application/vnd.github.raw" > /tmp/meetings-<date>/<slug>.md
```

**ギャップ検出**: カレンダー件数 vs 議事録件数の差分を列挙。mana パイプラインが対象外の会議（1on1, 登壇配信, BAAOBar 等）は手動補完を促す。

---

## Phase 3: エンティティ・意思決定・アクション抽出

各議事録の front matter＋本文から以下を抽出：

### 抽出対象
- **人物**: 全発言者・関係者（役職・所属と共に）
- **組織/顧客/パートナー**: 企業名・所属先
- **決定事項**: 「決定した」「合意した」「統一する」系の宣言
- **アクション**: 「📅 次の手配・アクション」セクション（mana の標準セクション）
- **期限表現**: 「今週中」「GW明け」「明日のMTG」等 → 絶対日付へ変換

### タスク化候補の文脈必須契約

議事録から NocoDB タスク候補を作る場合、抽出結果には必ず以下を含める。これを満たさない候補は NocoDB に登録せず、Phase 7 の「要確認」に回す。

```json
{
  "title": "実行可能な作業タイトル",
  "why_now": "なぜこのタスクが必要か。議事録から読み取れる背景だけを書く",
  "source_meetings": [
    {
      "repo": "Unson-LLC/Drive",
      "path": "meetings/unson-board/minutes/YYYY-MM-DD_slug.md",
      "source_url": "https://github.com/Unson-LLC/Drive/blob/<commit-or-branch>/meetings/unson-board/minutes/YYYY-MM-DD_slug.md",
      "source_ref": "<commit-sha-or-branch>",
      "meeting_date": "YYYY-MM-DD",
      "meeting_title": "会議名またはslug",
      "source_type": "minutes|transcript",
      "evidence_quote": "タスク化の根拠になった短い引用または要約",
      "speaker": "発言者名"
    }
  ],
  "extraction_reason": "この発言をタスク化した判断理由",
  "acceptance_criteria": ["完了条件1", "完了条件2"]
}
```

**禁止**:
- 背景・根拠議事録・引用なしでタスクを作らない
- 議事録の「構造化発言」や「提案」を、ユーザーの実行意思があるタスクとして勝手に独立プロジェクト化しない
- 「自動抽出パイプラインを作る」のようなメタタスクを、議事録内の示唆だけから作らない。必要なら `oyasumi` 実行中の改善メモとして残す

**判断基準**:
- 会議中に明示された次アクションか？ → タスク化可
- 正本候補・知見として残すべきだけか？ → Graph/Wiki/learning 候補へ回し、NocoDB タスクにはしない
- 文脈が不足しているか？ → 登録せず、Phase 7 に「確認が必要な候補」として出す

### 期限表現→日付変換（会議日基準）
| 表現 | 変換ロジック |
|---|---|
| 今日中 / 本日中 | 会議日 |
| 明日 | 会議日 +1 |
| 今週中 | 会議週の金曜（最大） |
| 今週金曜 | 会議週の金曜 |
| 来週中 | 翌週月曜 〜 金曜 |
| GW明け | 2026年なら 2026-05-07 相当 |
| 今月末 | 会議月末日 |
| 来月上旬 | 翌月 10日 |
| 来月半ば | 翌月 15日 |
| 5月中 | 2026-05-31 |
| 対応済 | 会議日（status=完了） |

---

## Phase 4: Graph SSOT 既存エンティティ突合

### 既存エンティティ取得

```bash
TOKEN=$(cat ~/.brainbase/tokens.json | jq -r .access_token)

for type in person customer partner org; do
  curl -s -H "Authorization: Bearer $TOKEN" \
    "https://bb.unson.jp/api/info/graph/entities?type=$type&limit=500" \
    | jq -r ".records[] | \"\(.id)\t\(.payload.name)\t\(.payload.aliases // [] | join(\",\"))\"" \
    > /tmp/graph_$type.tsv
done
```

### 突合ルール
- **完全一致**（name or alias）→ 既存流用
- **表記ゆれ**（例: AI転写名 vs Graph正本名）→ 既存に alias 追加（既存 Wiki ページを取得・編集 → POST /api/wiki/page）
- **未登録**（Wiki にある person なのに Graph にない）→ Wiki ページ新規 POST
- **完全新規** → Wiki ページ新規 POST

### 表記ゆれの典型
| 議事録表記 | 正本 |
|---|---|
| AI転写名A / AI転写名A' | **Graph正本名A** |
| hiroki | **山下 大輝** (Hiroki Yamashita) |
| Kohei / 金田 | **金田 光平** |
| 三協 | **サンキョウ** (株式会社サンキョウ) |
| Sho | **持田 涉** (mochida_sho) |
| シン | **現在の利用者名**（自分自身の呼び名） |
| YK | **倉本 裕太**（TechKnight） |

---

## Phase 5: Graph SSOT 書き込み

### 5a. Decision（意思決定ログ）

**エンドポイント**: `POST http://localhost:31013/api/info/decisions`

> ⚠️ `bb.unson.jp/api/info/decisions` は CSRF token required で 403。Graph 読み取りには `x-brainbase-role`, `x-brainbase-projects`, `x-brainbase-clearance` ヘッダーも必要。必ずローカル brainbase-ui（ポート 31013）を使用。

```bash
curl -s -X POST "http://localhost:31013/api/info/decisions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "x-brainbase-role: member" \
  -H "x-brainbase-projects: brainbase,salestailor,zeims,techknight,baao,unson,mana,mywa,senrigan,postio,unson-os,aitle,ncom,back_office,vibepro-project" \
  -H "x-brainbase-clearance: internal" \
  -d '{
    "projectCode": "<projectCode>",
    "title": "<決定タイトル>",
    "ownerPersonName": "<決定者フルネーム>",
    "decidedAt": "YYYY-MM-DDTHH:MM:SS+09:00",
    "context": {...},
    "options": [...],
    "chosen": {"name": "...", ...},
    "reason": "<理由>",
    "source": "meeting_YYYY-MM-DD_<slug>",
    "decisionDomain": "<domain>",
    "enforceRaci": false,
    "roleMin": "member",
    "sensitivity": "internal"
  }'
```

#### 🚨 projectCode は「ハイフン無し」形式

| ❌ 拒否される | ✅ 受理される |
|---|---|
| `tech-knight` | `techknight` |
| `ncom-catalyst` | `ncom` (catalyst系も `ncom` で代用か要確認) |
| `back-office` | `back_office` |
| `unson-os` | `unson-os`（これは OK） |

JWT の `projectCodes` クレームを事前確認：
```bash
echo "$TOKEN" | cut -d'.' -f2 | node -e "console.log(JSON.parse(Buffer.from(process.argv[1],'base64url').toString()))" "$(cat)"
```

#### `enforceRaci: false` 必須

RACI が未整備のプロジェクト・ドメインでは true だと 403。新規ドメインは false で投入。

#### 受理プロジェクト（現時点の利用者 token の場合）
```
brainbase, salestailor, zeims, techknight, baao, unson,
mana, mywa, senrigan, postio, unson-os, aitle, ncom,
back_office, vibepro-project
```

### 5b. 人物・顧客・パートナー Wiki ページ

**エンドポイント**: `POST http://localhost:31013/api/wiki/page`

**重要**: `bb.unson.jp/api/wiki/*` は Wiki DB 非接続で 500 を返す。必ずローカル brainbase-ui（ポート 31013）を使用。

#### パス規則
```
_common/people/<姓_名>.md             ← 人物
_common/customers/<customer_id>.md    ← 顧客
_common/orgs/<org_id>.md              ← 組織（パートナー含む）
```

#### 組織・顧客・パートナー登録前のWeb/公式情報確認（必須）

`_common/orgs/*`、`_common/customers/*`、パートナー相当のWikiページを新規作成・更新する前に、議事録だけで登録してはいけない。必ずWeb調査で公式情報または信頼できる一次情報を確認し、本文に出典URLを残す。

確認するもの:
- 公式サイト / 公式About / 会社概要ページ
- 親会社・グループ会社がある場合は親会社公式情報
- 法人名、ブランド名、事業概要、公式URL
- 議事録由来の案件メモと、外部組織として確認済みの事実を分離する

禁止:
- 議事録に出た名前だけで `_common/orgs/*` を作る
- 「案件名」なのか「法人/ブランド名」なのか未確認のまま、組織正本として断定する
- 出典URLなしで組織・顧客・パートナーの事業概要を書く

記載例:

```markdown
## 正本確認

- 公式サイト: https://example.com/
- 親会社公式情報: https://parent.example.com/about/

## 議事録由来の文脈

YYYY-MM-DD の議事録では「...案件」として登場。正式な窓口・契約主体は未確認のため、案件メモと外部組織情報を分けて扱う。
```

#### 書き込みスクリプト（JSON エスケープ確実版）

```bash
# 1. Markdown を一時ファイルに
cat > /tmp/_wp.md <<'EOF'
---
name: <name>
role: <role>
...
---

## ...
EOF

# 2. jq で JSON payload 化してファイル保存
jq -Rs --arg p "_common/people/<id>" '{path:$p, content:.}' < /tmp/_wp.md > /tmp/_wp.json

# 3. POST（--data-binary @file で改行問題回避）
curl -s -X POST "http://localhost:31013/api/wiki/page" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "@/tmp/_wp.json" -w "\n[HTTP %{http_code}]\n"
```

#### ⚠️ echo "$json" | curl は NG

shell が改行を展開するため `Bad control character in string literal` エラー。必ず一時ファイル経由で `--data-binary @file` を使う。

#### 人物ページのフロントマター
```yaml
---
name: 姓 名                             # 必須
role: 役職/役割                         # 必須
org: 所属組織                           # 必須
org_tags: [tag1, tag2]                  # 必須
projects: [proj1, proj2]                # 必須
aliases: [別名, English Name]           # 必須
status: active | stakeholder | inactive # 必須
updated: YYYY-MM-DD                     # 必須
---
```

#### 既存ページ更新時
1. まず GET で取得 → content を編集
2. aliases 配列に追加
3. updated 日付更新
4. POST で上書き（ID 不要、path がキー）

---

## Phase 6: NocoDB タスク書き込み

### ベース ID 一覧

| プロジェクト | Base ID | Task Table ID |
|---|---|---|
| SalesTailor | pqot58neiu3o1xo | m14kuvtm6xngiy8 |
| Zeims | pr8u5q4qnb8op11 | myn1tfep47h32dp |
| Senrigan | p0f59uaty8zr8yd | mqdrju9ckck453b |
| TechKnight | p3tzrrtqi5hm40t | mb9nydzjy2sqhkm |
| Brainbase | pva7l2qlu6fdfip | m7iys8m7o1abr3f |
| BAAO | pqj22ze3jh0mkms | mxsy93mwfdvhug1 |
| BackOffice | pypw36aox9nkhb6 | ms377z03fyo27y8 |
| NCOM | p95wu69gwchz94m | mgx5y6y9xxiqpfq |

配列最新化は `brainbase-config/config.yml` の `nocodb.base_id` を確認。

### 🚨 Base ごとの column_name 差異

**SalesTailor / Senrigan / TechKnight**（英語 column_name・SingleLineText）:
```json
{
  "title": "...", "assignee": "<schema_valid_assignee>", "status": "未着手",
  "priority": "高", "deadline": "YYYY-MM-DD", "description": "...",
  "project": "salestailor", "meeting_date": "YYYY-MM-DD",
  "meeting_title": "<slug>"
}
```

`description` には必ず以下の見出しを含める：

```markdown
## 背景
<why_now>

## 根拠議事録
- <source_url>（<repo>:<path> / ref: <source_ref> / 会議日: YYYY-MM-DD / 会議: <meeting_title>）

## 根拠発言
<speaker>: <evidence_quote>

## タスク化した理由
<extraction_reason>

## 完了条件
- <acceptance_criteria>
```

**Brainbase**（日本語 column_name・`プロジェクト` SingleSelect={mana, brainbase, 共通}）:
```json
{
  "タイトル": "...", "担当者": "<schema_valid_assignee>", "ステータス": "未着手",
  "優先度": "高", "期限": "YYYY-MM-DD", "説明": "...",
  "プロジェクト": "共通",
  "背景": "...", "会議日": "YYYY-MM-DD", "会議タイトル": "<slug>"
}
```

`背景` には `description` と同じ文脈テンプレートを入れる。テーブルに source URL / repo / path 専用カラムが無い場合も、`背景` または `description` 内に必ず埋め込む。

### GitHub ソース URL の作り方

Phase 2 で `gh api repos/<owner>/<repo>/contents/<path>` を呼ぶ時点で、レスポンスの `html_url` / `git_url` / `sha` を保存する。タスク説明に貼る URL は、可能なら branch URL ではなく commit SHA 付き permalink にする。

```bash
gh api "repos/<owner>/<repo>/contents/<path>" \
  | jq -r '{html_url, git_url, sha, path}'
```

**優先順位**:
1. `https://github.com/<owner>/<repo>/blob/<commit-sha>/<path>`（内容固定できる場合）
2. API レスポンスの `html_url`
3. `repo:path` のみ（URL取得失敗時のフォールバック。Phase 7 に URL 欠落として報告）

**Zeims**（英語 column_name・`assignee` は **MultiSelect**）:
- 担当者の valid options は schema から取得した姓表記のみ
- フルネームは schema に存在する姓表記へマッピング

```javascript
const ZEIMS_ASSIGNEE = {
  "<full_name_a>": "<schema_option_a>",
  "<full_name_b>": "<schema_option_b>",
  "<full_name_c>": "<schema_option_c>",
};
```

### スキーマ事前チェック（初回必須）

```bash
NOCO_TOKEN="32UQ6-Q8iIfB4ChGS7tcVpCk6bz9htHbaambf6TU"
for tid in m14kuvtm6xngiy8 myn1tfep47h32dp mqdrju9ckck453b mb9nydzjy2sqhkm m7iys8m7o1abr3f; do
  curl -s -H "xc-token: $NOCO_TOKEN" \
    "https://noco.unson.jp/api/v2/meta/tables/$tid" \
    | jq "{title: .title, assignee: [.columns[] | select(.title == \"担当者\") | {column_name, uidt, options: (.colOptions.options // [] | map(.title))}]}"
done
```

### 書き込み POST

```bash
curl -X POST -H "xc-token: $NOCO_TOKEN" -H "Content-Type: application/json" \
  "https://noco.unson.jp/api/v2/tables/$TABLE_ID/records" \
  -d '<body>'
```

### 🚨 二重投入ガード

**過去の事故**: スクリプトを `| tail -70` や `| head -80` で2回実行した結果、全タスクが重複登録された。

**ガード方法**:
1. 投入前に `meeting_date=YYYY-MM-DD` で既存レコードを GET して件数チェック
2. 既に同日のタスクがある場合は **中断 → ユーザー確認**
3. 投入スクリプトは**1回だけ実行**し、再実行しない
4. 失敗分だけを再実行するスクリプトを別途作る

```bash
# 既存件数チェック
curl -s -H "xc-token: $NOCO_TOKEN" \
  "https://noco.unson.jp/api/v2/tables/$TID/records?limit=100" \
  | jq "[.list[] | select(.[\"会議日\"] == \"$DATE\" or .meeting_date == \"$DATE\")] | length"
```

### プロジェクト→NocoDB base マッピング

| 会議ソース | 投入先 base |
|---|---|
| salestailor-project / cxo / eng | SalesTailor |
| zeims-project | Zeims |
| senrigan-project | Senrigan |
| tech-knight-project / senpainurse / aitle / smartfront | TechKnight |
| **unson-board（山本定例等・横断）** | **Brainbase**（base 無いため） |
| baao-project | BAAO |
| ncom-catalyst | NCOM |
| back_office | BackOffice |

---

## Phase 7: レポート

Phase 7 の前に、archive finalizer の blocked を必ず日次整理する。

```bash
cd /Users/ksato/workspace/code/brainbase
node scripts/archive-blocked-report.mjs --limit 20
```

blocked がある場合、各項目を以下のいずれかに分類してから最終サマリへ進む。

- **fix + retry**: worktree を確認し、commit/merge/不要変更の明示処理後に retry する
- **task 化**: 当日解けないものは NocoDB/Inbox に「Archive blocked 解消」タスクとして残す
- **例外化**: 外部事情で待つものは理由と次回確認日を残す

`/oyasumi` では blocked を単に件数報告で終えない。少なくとも「解消済み / task 化 / 例外化」のどれかに分類し、残作業に owner / next action / due を付ける。

最終サマリを以下の形式で報告：

```markdown
# YYYY-MM-DD 振り返り完了サマリ

## 収集
- 議事録 N件 取得（Github）
- カレンダー M件 確認（議事録未同期 = M-N 件）

## Graph SSOT 反映
- Decision: X/Y 成功（失敗理由）
- Person Wiki: 新規 A件 / 既存更新 B件
- Customer Wiki: C件
- Partner Wiki: D件

## NocoDB タスク反映
- SalesTailor: E件 / Zeims: F件 / ...（合計 G件）

## Archive blocked 日次整理
- blocked: X件
- 解消済み: A件 / task 化: B件 / 例外化: C件
- 残件:
  - [session-id]: [reason] → [owner / next action / due]

## 残作業（次回持ち越し）
- 議事録未同期会議の手動補完
- 未登録人物の情報収集
- 表記ゆれ修正（AI転写名/Graph正本名、サンキョウ/三協 等）
```

---

## Gotchas（過去の事故集）

### G1: 日付またぎ
セッションが夜を跨ぐと「今日」が変わる。Phase 0 で明示的に確認する。

### G2: Slack MCP が salestailor workspace 固定
他 workspace の channel（`CXXXXXXXXXX` 等）には **直接アクセス不可**。議事録は必ず Github ルート経由で取得する。

### G3: Wiki API は ローカル 31013 でのみ動作
`bb.unson.jp/api/wiki/*` は DB 非接続で 500。`http://localhost:31013` が正本。 brainbase-ui が起動していない場合は先に起動。

### G4: Graph API 書き込みは `/api/info/*` に限定
`/api/info/graph/entities` は read-only。人物・顧客・パートナー・組織は Wiki ページ経由で登録。Decision/Glossary/RACI/KPI/Initiative/Events のみ Graph 直接 POST。

### G5: projectCode のハイフン差異
JWT の `projectCodes` と一致する形式を使用。`tech-knight` ≠ `techknight`。

### G6: NocoDB column_name は base ごとに異なる
Brainbase だけ日本語 column_name。他は英語。スキーマ確認を飛ばすと null レコードができる。

### G7: NocoDB 担当者 SingleSelect/MultiSelect の valid options
Zeims は schema の valid options のみ受理。フルネーム不可。事前マッピング必須。

### G8: 二重投入
スクリプトを `| tail` や `| head` で2回実行すると全件重複。投入前に既存件数チェック。

### G9: curl JSON escape
Markdown 本文を curl --data で直接渡すと改行でエラー。必ず `jq -Rs` でエスケープ → 一時ファイル → `--data-binary @file`。

### G10: org/customer/partner を議事録だけで登録しない
外部組織のWiki登録はWeb/公式情報確認が必須。議事録は案件文脈の根拠にはなるが、法人・ブランドの正本確認には不足する。公式About/会社概要/親会社公式情報などを確認し、出典URLを本文に残す。

### G10: 表記ゆれ
- Graph正本名 ⇔ AI転写名（AI転写の誤記）
- サンキョウ ⇔ 三協（漢字誤記）
- Hiroki ⇔ 山下大輝
- Kohei ⇔ 金田光平
- Sho ⇔ 持田涉

必ず Graph の `aliases` 配列で逆引き可能に。

---

## 推奨実行タイミング

- **毎日夕方 18:00〜22:00**: その日の会議が一通り終わったあと
- **日付をまたぐ前に完了**させる（跨いだら Phase 0 で明確に対象日を指定）

---

## 関連 Skills

- `ohayo-orchestrator`: 朝のインプット整理（対）
- `people-meta`: 人物登録フォーマット詳細
- `customers-meta`: 顧客登録フォーマット詳細
- `nocodb-4table-guide`: NocoDB 操作詳細
- `brainbase-content-ssot`: SSOT ルール全般
- `slack-mentions`: Slack 抽出（workspace 固定に注意）
