---
story_id: story-ai-session-log-kernel-adapter
title: AI セッションログ (codex + claude) を candidate-store kernel に流す adapter
source_requirement:
  parent_story: STR-006
architecture_docs:
  - path: docs/architecture/ADR-010-memory-promotion-kernel-boundary.md
    status: accepted
spec_docs:
  - path: docs/specs/mana-secretary-memory-promotion-spec.md
    status: accepted
depends_on:
  - story-candidate-store-cross-repo-write
status: draft
created_at: 2026-05-15
updated_at: 2026-05-15
---

# story-ai-session-log-kernel-adapter: AI セッションログを candidate-store kernel に流す adapter

## 背景

ADR-010 で `candidate-store` が canonical Memory Promotion Kernel と確定し、 PR #726 で cross-repo write endpoint (`POST /api/candidate-store/raw-ledger`) も公開済。 ここまで silo dissolution の前提は揃ったが、 **真の forcing function** はどこにあるか？

ユーザー (佐藤) の指摘:

> 俺の AI との使用ログが学習対象じゃないの？

正解。 `~/.codex/sessions/2026/MM/DD/rollout-*.jsonl` + `~/.claude/projects/*/...jsonl` は **毎日生成される最も濃密な活動文脈** で、 STR-006 が言う「Brainbase activity」 そのもの。 ops-refactor (動いていない silo) ではなくここを kernel に統合するのが ADR-010 vision の本来の forcing function。

### 既存数値感 (2026-05 直近 3 日)

| 日付 | codex セッション数 | サイズ |
|---|---|---|
| 5/12 | 19 | 51MB |
| 5/13 | 13 | 14MB |
| 5/14 | 11+ | 進行中 |
| 5/15 | 進行中 | - |

claude code も同程度。 これだけの文脈が **個人 KG / Graph SSOT に流れずに ~/.codex/ + ~/.claude/projects/ に閉じている** = 最大 silo。

## 現状

- codex セッション: `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<TS>-<id>.jsonl` 形式、 `{payload, timestamp, type}` event 列
  - event type: `response_item` / `event_msg` / `turn_context` / `session_meta`
  - payload key 例: `base_instructions, cwd, git, model_provider, originator, source, thread_source, timestamp, ...`
- claude code セッション: `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`、 `{type, sessionId, permissionMode, ...}`
- いずれも brainbase / kernel への流入経路は無い (= silo)
- ~/.codex/codex-notify.sh は既に存在し、 hook 連携できる素地はある

## 変更内容

### 何を

local 上で動く軽量 adapter を作り、 完了したセッションを Raw Ledger envelope に変換して brainbase の `POST /api/candidate-store/raw-ledger` に流す。

1 セッション = 1 envelope を基本粒度とする (= 細粒度の turn 単位は将来検討)。

### 誰が

- adapter プロセス: 佐藤の Mac mini ローカル (launchd 起動 or codex-notify.sh hook)
- 受信: brainbase-ui (localhost:31013 経由 = 既存 cross-repo write endpoint)
- candidate owner: `person:ksato` (= 佐藤個人)

### なぜ

- 組織で最も濃密な活動文脈 (= AI との対話) を kernel に取り込み、 個人 KG / Graph SSOT に流せるようにする
- 「同じ問題を 2 度調べる」 「過去の判断理由を再現できない」 を構造的に解消する forcing function
- ADR-010 vision の **真の cross-repo 実装事例**として実用的価値を出す

## First Slice (本 story の完了境界)

最小スライス:
- **対象 source 1 系統**: codex のみ (claude は P2 で別途)
- **粒度**: 1 セッション = 1 envelope (session_meta から最初の人間 turn まで + 最後の assistant message を snippet 化)
- **取り込み方式**: 日次 batch (launchd で毎晩 1 回)、 watermark file で「処理済 session id」 を管理
- **送信先**: localhost:31013/api/candidate-store/raw-ledger (HMAC + envelope schema、 既存 endpoint)
- **PII / secrets 配慮**:
  - `retention_policy: 'envelope_only'` (本文は kernel に流さず、 evidence_ref で原 jsonl を local 参照)
  - snippet は LLM 要約 (= 機微な命令/出力を直接 paste しない)、 もしくは初回は空で OK

### 担当 file 配置案

```
~/.local/brainbase/ai-session-adapter/
├── codex-session-adapter.mjs        # main script
├── envelope-builder.mjs             # rollout jsonl → envelope 変換
├── state.json                       # watermark (processed session ids)
└── README.md
```

launchd plist: `~/Library/LaunchAgents/com.brainbase.ai-session-adapter.plist`
- StartCalendarInterval: 毎晩 23:30 JST 等
- log: `~/Library/Logs/brainbase-ai-session-adapter.log`

## 受け入れ基準

- [ ] codex の昨日分セッションが翌日 24h 以内に全件 envelope として kernel に届く
- [ ] 同じ session_id は重複 ingest されない (idempotent via raw_event_id = session_id)
- [ ] HMAC + allowlist で source `codex_session` が認証される
- [ ] watermark file の処理済 session id が再起動を跨いで永続化される
- [ ] 失敗時はリトライ可能 (次回 batch で再試行)、 永続的失敗は log + Slack #9991-unson-ops に通知 (将来)
- [ ] PII scanner で機微情報 (token / password / xoxc / Bearer) を含む snippet は block
- [ ] `retention_policy: 'envelope_only'` で raw 本文は kernel に流さない (evidence_ref で local 原本を指す)
- [ ] kernel 側で `source_system: 'codex_session'` の candidate が作成されている

## Phase 分割

| Phase | 内容 | 完了境界 |
|---|---|---|
| **P0** | envelope-builder.mjs 単体 (= rollout jsonl 1 ファイル → envelope JSON 1 件、 contract test) | unit test pass |
| **P1** | watermark state + 日次 batch loop (実 endpoint には POST せず stdout に envelope を吐く dry-run) | --dry-run で全 session 処理 OK |
| **P2** | HMAC + endpoint POST 実装、 launchd plist 配備 | 翌日 kernel に envelope 着、 idempotent 確認 |
| **P3** | claude code セッション同等対応 (`source_system: 'claude_session'`) | claude session も流れる |
| **P4** | snippet の LLM 要約導入 (codex CLI / claude API のどちらかで小さい summary を作る、 入力 prompt 全文は流さない) | snippet 200-500 字に圧縮、 機微情報 leak 0 |
| **P5** | (将来) turn 単位の細粒度 envelope、 「決定的判断」 「学習瞬間」 のみ抽出 filter | TBD |

P0-P3 を本 story の First Slice、 P4-P5 は別 story 候補。

## Scope 外

- mana / zeims など他 source の adapter (= 別 story)
- candidate-store endpoint 自体の改修 (= story-candidate-store-cross-repo-write で完了済)
- LLM 要約品質の最適化 (= P4 で扱うが、 評価は別 story)
- 個人以外の対話 (= 佐藤 1 名分のみ、 マルチユーザーは将来)

## 補足: 「自分の AI ログを kernel に流す」 の戦略的価値

1. **再質問の削減**: 「過去あの問題を解決した時の判断理由は？」 が Graph 経由で引ける
2. **学習資産化**: 設計判断 / 失敗ケース / 修復手順が candidate-store → Graph SSOT に蓄積
3. **横展開**: codex/claude 両方の活動文脈が統合され、 ツール選択に依存しない知識基盤に
4. **ADR-010 vision の最初の実用事例**: 「動いている source の adapter 化」 を示し、 mana / zeims / SNS の adapter 設計の reference 実装になる
