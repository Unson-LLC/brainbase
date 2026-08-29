---
story_id: story-remote-judgment-hook-contract-sync-v1
title: Remote Judgment Hookの回帰テストを監査継続契約へ同期する
source_requirement:
  source: Codex conversation 2026-08-29
  approved_at: 2026-08-29
architecture_docs:
  - path: docs/architecture/story-remote-judgment-hook-contract-sync-v1.md
    status: accepted
spec_docs:
  - .vibepro/spec/story-remote-judgment-hook-contract-sync-v1/spec.json
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "remote HTTP境界の旧期待値2件だけを、既にマージ済みの監査継続契約へ同期する独立した回帰修正である。"
status: active
created_at: 2026-08-29
updated_at: 2026-08-29
---

# Remote Judgment Hookの回帰テストを監査継続契約へ同期する

## Story

長時間taskを任せるownerとして、監査episodeが欠損した最初のStopではcanonicalな有限修復指示をremote runtimeまで返し、監査対象toolの識別情報が欠ける場合は理由を正確にfail closedしてほしい。これにより、監査継続の本番契約とremote HTTP回帰テストのずれをなくし、全Judgment Resolution Gateを再び緑にする。

## 確認した原因

- `story-judgment-audit-continuity-v1`のマージで、orphan Stopはtransport errorではなく、元回答を保持するone-shot修復blockを返す契約になった。
- Brainbase `PostToolUse`で`tool_use_id`が欠ける場合は、汎用的な監査未記録ではなく`judgment_tool_use_id_missing`でterminal failureにする契約になった。
- remote HTTPテスト2件だけが変更前の503期待値を保持し、cleanな`origin/develop`でも同じ2件が失敗する。

## 受け入れ基準

- [ ] AC-001: orphan Stopのremote HTTP応答は`200`かつ`accepted: true`で、canonical Hostの`decision:block`修復指示をそのままruntimeへ返す。
- [ ] AC-002: Brainbase `PostToolUse`の`tool_use_id`欠損は`503`かつ`judgment_tool_use_id_missing`としてfail closedする。
- [ ] AC-003: dispatcherが空のPostToolUse監査結果を返す場合は、従来どおり`503`かつ`judgment_hook_audit_not_recorded`とする。
- [ ] AC-004: focused remote HTTP testと`npm run test:judgment-resolution`がexact HEADで全件成功する。
- [ ] AC-005: production lifecycle、authority、Host実装コードは変更せず、回帰テスト契約の同期だけに限定する。

## スコープ外

- Judgment Hostやremote HTTP handlerの本番ロジック変更
- global Hook切替、deploy、runtime再起動
- 監査を成功へ丸めるwaiver
