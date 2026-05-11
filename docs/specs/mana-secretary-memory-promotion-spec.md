---
spec_id: SPEC-006
title: mana秘書 Memory Promotion Pipeline 仕様
source_story: docs/stories/STR-006-mana-secretary-memory-promotion.md
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
---

# SPEC-006: mana秘書 Memory Promotion Pipeline 仕様

## 対象

- Brainbase session / terminal / activity を Raw Ledger read model に変換する adapter
- Dreaming が生成する memory candidate
- Promotion Gate の approval / rejection / expiry / audit
- 承認済み candidate の Graph SSOT 昇格
- Brainbase terminal と Slack mana の scoped memory retrieval

## Raw Ledger read model

Raw Ledger は Brainbase activity と mana message/workflow history を同じ形で読むための read model であり、物理DB統合を必須にしない。

各 record は次のフィールドを必ず持つ。

```js
{
  raw_event_id: string,
  source_system: 'brainbase' | 'mana_slack' | 'mana_workflow' | string,
  source_event_id: string,
  occurred_at: string,
  captured_at: string,
  actor_external_id: string | null,
  actor_person_id: string | null,
  workspace: string | null,
  channel_id: string | null,
  project_code: string | null,
  permission_snapshot: {
    roles: string[],
    clearance: string[]
  },
  evidence_ref: {
    kind: 'source_pointer',
    uri: string,
    hash: string
  },
  retention_policy: string
}
```

Raw Ledger は raw transcript を Graph payload に直接コピーしない。Graph へ移るのは承認済み memory と source pointer だけとする。

## Memory candidate

Dreaming は Raw Ledger record から candidate draft を生成する。candidate は未承認の作業記憶であり、Graph entity ではない。

```js
{
  candidate_id: string,
  owner_person_id: string,
  actor_person_id: string | null,
  source_system: string,
  source_event_ids: string[],
  workspace: string | null,
  channel_id: string | null,
  project_code: string | null,
  subject_type: 'person' | 'project' | 'org' | 'customer' | 'role' | 'philosophy' | string,
  subject_id: string,
  visibility: 'private' | 'project' | 'org',
  role_min: 'member' | 'pm' | 'gm' | 'ceo',
  sensitivity: 'public' | 'internal' | 'customer' | 'contract',
  permission_snapshot: {
    roles: string[],
    clearance: string[]
  },
  evidence_ids: string[],
  expires_at: string | null,
  redaction_status: 'none' | 'needs_redaction' | 'redacted',
  promotion_status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'expired' | 'promoted',
  memory: {
    title: string,
    body: string
  }
}
```

private / low-risk preference は本人scopeへ自動昇格できる。project / org / customer / policy / philosophy へ昇格する候補は owner 承認を必須にする。

## Promotion Gate

Promotion Gate は candidate の状態遷移を管理する。

```text
draft -> pending_approval -> approved -> promoted
                         \-> rejected
                         \-> expired
```

状態変更時は次を audit log に残す。

- candidate_id
- previous_status
- next_status
- actor_person_id
- reason
- decided_at

`redaction_status === 'needs_redaction'` の candidate は Graph 昇格してはいけない。`rejected` / `expired` / `pending_approval` は Graph entity として返してはいけない。

## Graph SSOT 昇格

承認済み candidate は既存 Brainbase Graph type に写像できる場合だけ Graph へ昇格する。新規 Graph type はこの slice では増やさない。

`subject_type === 'role'` は `raci_assignment` へ写像する。写像できない candidate は `pending_approval` または `approved` のまま止め、Graph writer は失敗理由を audit log に残す。

Graph payload には次を保持する。

- memory_candidate_id
- subject_type / subject_id
- owner_person_id / actor_person_id
- visibility / role_min / sensitivity
- source_system / source_event_ids / evidence_ids
- workspace / channel_id / project_code
- permission_snapshot
- promoted_at

Graph payload に raw transcript や raw_text を入れてはいけない。

## Scoped memory retrieval

assistant context へ memory を注入する前に、必ず access context を評価する。

Brainbase terminal の access context は次から作る。

- login user / person_id
- role
- project code
- session id
- sensitivity clearance

Slack mana の access context は次から作る。

- workspace
- channel id
- Slack user / person_id
- project code
- role
- sensitivity clearance

retrieval は deny-by-default とする。次のいずれかに該当する memory は返さない。

- project_code が access context の project_codes に含まれない
- channel_id が指定され、access context の channel_id と一致しない
- required role が access context の role より高い
- sensitivity が clearance に含まれない
- visibility が private で、owner_person_id が access context の person_id と一致しない
- role が失効している

## API contract

Learning / Promotion API は少なくとも次を扱う。

- candidate list
- candidate approve
- candidate reject
- candidate expire
- promotion audit list

Info SSOT context API は `includeMemory=true` のときだけ scoped memory を返す。未指定時は Graph / Philosophy context だけを返す。

## UI contract

Brainbase UI は owner が自分に割り当てられた candidate を確認し、承認または却下できる導線を持つ。

UI は candidate の source_system、visibility、role_min、sensitivity、evidence_ids、redaction_status、promotion_status を表示できる必要がある。

## Test contract

次の文脈で deny-by-default retrieval test を通す。

- 佐藤個人
- 雲孫GM
- project member
- Slack channel外ユーザー
- role失効ユーザー

次の contract を fixture で検証する。

- Raw Ledger evidence から candidate まで source_event_ids / evidence_ids が追跡できる
- approved candidate だけが Graph payload に変換できる
- raw_text / transcript は Graph payload に含まれない
- redaction required candidate は昇格できない
- scoped retrieval は role / project / channel / sensitivity / private owner を評価する

## スコープ外

- 専用GraphDBの追加
- Graphify artifact の正本化
- 全Slack履歴の一括投入
- HR / finance / contract memory の自動昇格
