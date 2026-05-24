# oyasumi

寝る前の1日振り返りルーティン。議事録から固有名詞・顧客・パートナー・意思決定・次アクションを抽出し、Graph SSOT (bb.unson.jp) と NocoDB (noco.unson.jp) の両方に自動反映する。

## トリガー

- `/oyasumi`
- `/oyasumi YYYY-MM-DD`（対象日指定）
- ユーザーが「今日の振り返り」「おやすみ前に整理」「今日の SSOT 反映」と言及
- `/ohayo` の対（朝=入力 / 夜=出力）

## 実行フロー

`daily-reflection` skill を呼び出し、以下の 7 Phase を実行：

1. **Phase 0**: 日付確定（跨ぎ検知）
2. **Phase 1**: `gog calendar list` で対象日の会議を取得
3. **Phase 2**: Github の mana 管理リポジトリから議事録を一括取得
4. **Phase 3**: 議事録から固有名詞・決定・アクションを抽出、期限表現を絶対日付に変換
5. **Phase 4**: Graph 既存エンティティと突合（表記ゆれ修正含む）
6. **Phase 5**: Graph SSOT 書き込み
   - Decision: `POST https://bb.unson.jp/api/info/decisions`
   - Person/Customer/Partner Wiki: `POST http://localhost:31013/api/wiki/page`
7. **Phase 6**: NocoDB 各プロジェクト base のタスクテーブルに一括投入
   - 二重投入ガード（既存件数チェック）
   - base ごとの column_name 差異対応（Brainbase だけ日本語、Zeims は 担当者 MultiSelect）
8. **Phase 7**: 成功/失敗件数・残作業のサマリ報告

## Personal KG Agent Handoff

議事録/transcriptに加えて、その日の Codex / Claude Code での直接会話ログも Personal KG の入力として扱う。思想・実績・営業哲学・読者理解・運用上の修正・繰り返し出た判断基準は、Graph/Wiki/NocoDBとは別に owner-visible personal KG candidate へ戻す。
これは `/ohayo` の投稿生成だけでなく、今後AIが「俺の脳で考える」ための個人KG集約である。
`/oyasumi` 自体はcandidate本文を直接作る作業者ではなく、以下のagent fan-out/fan-inを指揮するcoordinatorとして扱う。

| agent role | responsibility |
|---|---|
| `meeting_harvester` | 当日minutesと同名transcriptを集め、source metadataを保持する |
| `personal_kg_extractor` | SNS化前の `personal_kg_core` を抽出する |
| `sensitivity_reviewer` | family/medical/private/counterparty confidentialをpersonal core保持可否とprojection不可に分ける |
| `sns_projection` | `personal_kg_core` のうちSNSで使えるものだけを `sns_ready` へ投影する |
| `conversation_harvester` | `~/.codex/history.jsonl` と `~/.claude/projects/**/*.jsonl` から当日JSTの直接ユーザー入力を集める |
| `conversation_personal_kg_extractor` | agent会話から繰り返し出た判断基準を `personal_kg_core` / `needs_review` へ分類する |

まず議事録/transcriptを dry-run で採用/除外/要確認を確認する。

```bash
cd /Users/ksato/workspace/code/brainbase
npm run oyasumi:meeting-personal-kg:all -- --date YYYY-MM-DD --json
```

続けて Codex / Claude Code の当日会話ログを dry-run する。ここで `input_count` が0件や極端に少ない場合は「Personal KG 0件」と報告せず、ログ取得漏れとして扱う。

```bash
npm run oyasumi:conversation-personal-kg -- --date YYYY-MM-DD --json
```

semantic議事録抽出は OpenRouter / OpenAI-compatible fallback を使わない。`--semantic` を使う場合は `codex exec` が実行可能で、必要なら `CODEX_CLI_PATH`, `OYASUMI_AGENT_MODEL`, `OYASUMI_AGENT_REASONING_EFFORT`, `OYASUMI_AGENT_EXEC_CWD` を明示する。Bedrock系のMana captureは `AWS_REGION` / `AWS_PROFILE` / `BEDROCK_MODEL_ID` 側の設定を正とし、OpenRouter系envの有無に依存させない。

問題なければ両方を本番 `brainbase_ssot.memory_candidates` へ書き込む。

```bash
INFO_SSOT_DATABASE_URL="$INFO_SSOT_DATABASE_URL" npm run oyasumi:meeting-personal-kg:all -- --date YYYY-MM-DD --write --json
INFO_SSOT_DATABASE_URL="$INFO_SSOT_DATABASE_URL" npm run oyasumi:conversation-personal-kg -- --date YYYY-MM-DD --write --json
```

write 時は `personal_kg_entity_links` の project link も同じ DB 接続で自動更新する。`unson-board` と `yakumokai` は Graph project `unson` に紐づける。出力の `project_link_summary` で `linked / unchanged / unresolved` を確認する。隔離再実行でリンクを止める場合だけ `--no-project-link` を使う。

対象repoを限定する場合だけ `--repo` / `--project` を使う。通常の `/oyasumi` は mana 管理repo全体を横断する。

```bash
INFO_SSOT_DATABASE_URL="$INFO_SSOT_DATABASE_URL" npm run oyasumi:meeting-personal-kg -- --date YYYY-MM-DD --repo Unson-LLC/salestailor-project --project salestailor --write --json
```

扱い:

- `source_system=oyasumi-meeting-personal-kg`
- `owner_person_id=sato_keigo`
- `visibility=owner`
- candidateは `memory_layer=personal_kg_core` と `memory_layer=sns_ready` を分ける
- `sns_ready` は `personal_kg_core` から抽象化projectionとして同時生成する。core本文をSNS生成へ直接渡さない
- transcriptがある場合は transcript を一次情報、minutesを補助情報として扱う
- Codex/Claude Code会話は、日次の直接入力件数、dedupe後件数、`personal_kg_core`, `needs_review`, `rejected/skipped` を meeting 由来とは別に報告する
- meeting extractor の0件を Personal KG 全体0件として扱わない
- conversation由来の個人情報・第三者分析・Slack/支払/顧客文脈は、生値を保存せず `needs_review` または restricted/confidential owner-only にする
- extraction結果には `agent_reports` を残し、role別のinput/output件数を確認する
- write後は `personal_kg_entity_links` の project link が入る。未解決が出たら Graph project 不在か、folder project code の明示マッピング不足として扱う
- 家族、医療、健康、個人の私的事情は、佐藤の判断再現に必要な場合のみ `personal_kg_core` に owner-only + sensitivity tag + provenance 付きで保持する
- 顧客・相手企業の未公開予算や未公開事情は `personal_kg_core` に詳細を残してよいが、`sns_ready` / team / org / Graph promotion へは redaction / approval 済みの別instance以外で出さない
- 同じ議事録の同じ抽出単位は `source_event_ids` で重複投入しない
- 最終サマリ/HTMLレポート（存在する場合）には meeting由来と conversation由来を分けて、`input_count`, `personal_kg_core`, `sns_ready`, `needs_review`, `needs_redaction`, `projection_allowed` の件数を出し、取り込み漏れ・誤projectionを検知する

## Archive Blocked Triage

`/oyasumi` は archive blocked の日次整理トリガーでもある。Phase 7 の前に必ず実行する。

```bash
cd /Users/ksato/workspace/code/brainbase
node scripts/archive-blocked-report.mjs --limit 20
```

blocked がある場合、各項目に対して以下のいずれかを決める。

- **fix + retry**: worktree を確認し、commit/merge/不要変更の明示処理後に retry する
- **task 化**: 当日解けないものは NocoDB/Inbox に「Archive blocked 解消」タスクとして残す
- **例外化**: 外部事情で待つものは理由と次回確認日を残す

重要: `/oyasumi` では `blocked` を単に報告して終わらない。少なくとも「解消済み / task 化 / 例外化」のどれかに分類する。

## SNS Feedback Triage

SNS運用の夜処理も `/oyasumi` に寄せる。今日投稿したものを「反応の報告」ではなく、翌朝の候補選定と個人KGの学習素材へ戻す。

確認対象:

- 今日出した通常投稿、引用、リプ
- 引用元本人の like / reply / repost / follow
- 引用元の読者からの like / reply / repost / bookmark / profile visit
- LPクリック、診断開始、診断完了、TimeRex予約
- `impressions > 1000` かつ `replies / impressions > 10%` の anomaly

出力先:

```bash
mkdir -p /Users/ksato/workspace/shared/_codex/sns/x/ops/feedback
```

SNS Posting Ledger に投稿済みURLと反応数値を戻せる場合は、feedback markdown だけで終わらせず、次の script で Ledger → candidate-store の handoff まで進める。

```bash
cd /Users/ksato/workspace/code/brainbase
npm run sns:feedback-learning -- \
  --post-id <sns_posting_ledger_post_id> \
  --posted-url <https://x.com/.../status/...> \
  --metrics-json '{"impressions":0,"likes":0,"replies":0,"reposts":0,"bookmarks":0}' \
  --learning-ready
```

複数投稿をまとめて candidate 化する場合:

```bash
npm run sns:feedback-learning -- --date YYYY-MM-DD
```

`/Users/ksato/workspace/shared/_codex/sns/x/ops/feedback/YYYY-MM-DD.md` に以下を残す:

- posted_url
- lane
- source_peer
- peer_reaction
- reader_reaction
- conversion_signal
- anomaly
- learning_candidate
- next_ohayo_action

扱い:

- 反応取得は確認できた数字だけを書く。不明なものを推測しない
- anomaly は削除やミュートを自動実行せず、通知/保留/手動対応に分類する
- 勝ち筋は即正本化せず、`/retro` で再現性があるものだけ `content_pillars.md` / `style_guide.md` / skill 更新候補にする
- Persona Affect が外れた投稿は、数字が良くても勝ち型にしない

## 使い分け

| コマンド | 用途 |
|---|---|
| `/ohayo` | 朝: インプット整理（カレンダー確認・メール仕分け・今日のフォーカス提案） |
| `/oyasumi` | 夜: アウトプット整理（今日の会議結果を SSOT に反映し、archive blocked とSNS反応を日次整理して寝る） |
| `/retro` | 週次: Ship/Learn/Block とSNS勝ち筋を集計 |

## 出力先

| 出力 | 場所 |
|---|---|
| Graph Decision | `https://bb.unson.jp` (decisions テーブル) |
| Wiki ページ | `http://localhost:31013` → PostgreSQL wiki_pages |
| NocoDB タスク | `https://noco.unson.jp` 各プロジェクト base |
| 中間成果物 | `/tmp/meetings-YYYY-MM-DD/` |

## 詳細

`.claude/skills/daily-reflection/SKILL.md` 参照。過去の事故集（G1〜G10 Gotchas）も参照のこと。

## 注意

- Wiki API は **ローカル ポート 31013** でのみ動作（bb.unson.jp は 500 を返す）
- projectCode は **ハイフン無し** 形式（`techknight` ≠ `tech-knight`）
- NocoDB 投入スクリプトは **1回だけ** 実行（head/tail で2回実行すると重複）
- 日付またぎに注意（夜遅くに実行すると「今日」が変わる）
