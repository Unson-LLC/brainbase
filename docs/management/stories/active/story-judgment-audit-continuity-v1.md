---
story_id: story-judgment-audit-continuity-v1
title: Brainbase監査障害があっても長時間taskを人手なしで継続する
source_requirement:
  source: Codex conversation 2026-08-28
  approved_at: 2026-08-28
architecture_docs:
  - path: docs/architecture/story-judgment-audit-continuity-v1.md
    status: accepted
spec_docs:
  - docs/specs/story-judgment-audit-continuity-v1.md
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "誤ったepisode欠損を防ぐlock修正と、真の欠損を完全監査へ偽装せず有限回で継続させる処理は、同じStop lifecycle境界で検証する必要がある。"
status: active
created_at: 2026-08-28
updated_at: 2026-08-28
---

# Brainbase監査障害があっても長時間taskを人手なしで継続する

## Story

永続Goalで長時間の開発を任せるownerとして、Brainbase監査の一時障害やCodex内部continuationのlifecycle差によって、毎回新しいtaskを作る作業を求められたくない。正常に監査できるturnは従来どおり完全監査し、監査不能なturnは成功へ丸めず`audit_degraded`として残したうえで、開発そのものは安全境界の範囲内で継続してほしい。

## 共有サービス境界の適用性

このStoryの対象は、単一利用者のローカルCLIとして動くCodex Host adapterのsession/turn監査だけである。外部主体ごとのデータ経路、認証情報、共有資源は読み書きしないため、主体別の分離契約は適用対象外とする。

## 確認した原因

- `startEpisode`はtransition lock内でResolver応答を待ってからepisodeを保存するが、`finalizeEpisode`と`recordBrainbaseToolUse`はlock取得前にepisodeを読む。このため開始中のStopは誤って`judgment_episode_not_found`になり、PostToolUseは無音で欠落し得る。
- Codexの永続Goal自動continuationは新しい`turn_id`を発行する一方、`UserPromptSubmit` Hookを発火しない実例がある。Stop時点からmodel生成前のrouteを遡及作成することはできず、完全監査として復元してはならない。
- 現行Hostは最初のorphan Stopをblockし、active再Stopを非zero終了するため、利用者が新しいtaskを作るまで作業が止まる。案内文の「Hook有効化前」は確認事例の主因でもない。

## 受け入れ基準

- [ ] AC-001: episode開始、Brainbase tool event記録、Stop確定は、同一identityのtransition lockを取得してからepisodeを再読込する。
- [ ] AC-002: 開始処理と同時に来たPostToolUse/Stopは、開始のcommitまたはrollbackまで待つ。正常commit後のeventを欠落させず、Stopを誤ってorphan扱いしない。
- [ ] AC-003: 本当にepisodeがない最初のStopは、元の回答本文を保持したまま先頭へ正確な`⚠️ Brainbase監査未完了:`行を追加するよう、1回だけ`decision:block`で要求する。
- [ ] AC-004: 同じorphan turnのactive再Stopは非zero終了や新規task作成要求を返さず、immutableな`audit_degraded` receiptを保存して有限回で終了する。
- [ ] AC-005: `audit_degraded`は`complete`、`task_complete`、Brainbase参照成功、action authorizationとして扱わず、後続turnのprior finalized judgmentにも採用しない。
- [ ] AC-006: active再Stopで警告行または本文保持が不完全でも監査失敗をreceiptへ明記し、Hook処理自体は無限再生成・人手復旧待ちへ戻さない。
- [ ] AC-007: identity欠損、Brainbase PostToolUseの`tool_use_id`欠損、episode schema/digest矛盾、project/authority矛盾は対象を安全に束縛できないため、従来どおりterminal failureにする。非Brainbase toolは監査対象外として無変更で無視する。
- [ ] AC-008: orphan診断にはraw IDや回答本文を保存せず、session/turn digest、journal root digest、Host digest、同sessionのepisode候補数、active再Stopか、検証可能な正規ISO timestampを残す。
- [ ] AC-009: episodeへ結合できないBrainbase PostToolUseはdigest-only markerと可視警告を残し、Stopのone-shot修復状態は消費しない。markerの再読込時はschema、digest、正規ISO timestampを検証する。
- [ ] AC-010: 正常なepisodeのrequired knowledge、owner監査行、本文保持、exactly-one complete final契約は変更しない。
- [ ] AC-011: unit/integrationでlock競合、Goal型orphan first Stop、active再Stop、degraded非採用、identity欠損を検証する。
- [ ] AC-012: VibePro Gateと独立reviewで、監査の成功偽装と外部操作権限の拡張がないことを確認する。

## スコープ外

- Codex Desktop本体に`UserPromptSubmit`相当eventを追加すること
- Stopから初期route receiptやBrainbase tool callを捏造すること
- merge、配布、global Hook切替、本番反映
- merge、push、deploy、外部送信など既存の実行権限を緩和すること
