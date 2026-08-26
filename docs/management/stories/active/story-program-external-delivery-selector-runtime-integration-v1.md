---
story_id: story-program-external-delivery-selector-runtime-integration-v1
title: Program external delivery selector runtime integration v1
status: planned
program_id: brainbase-program-master-roadmap-v1
predecessor: story-program-external-delivery-reconciliation-v1
planning_only: true
blocked: true
blocked_by:
  - story-program-external-delivery-reconciliation-v1
production_evidence: not_collected
done: false
---

# Program external delivery selector runtime integration v1

## 利用者成果

Program orchestratorは、外部deliveryの実readbackを同一runで取得した後にだけselectorを呼び出し、selectorの結果をProgram status評価へ渡せる。readback、selector、status評価の境界を一つの証跡で追跡でき、途中の失敗を見落とさない。

## predecessorとの依存境界

- `story-program-external-delivery-reconciliation-v1`はexternal delivery identity、lineage、status separationの契約専用Storyとして維持する。
- 本Storyはその後継のplanning-only契約であり、predecessorへselector runtime実装を追加しない。
- 本Storyは`planned`かつ`blocked`である。runtime owner、実装Task、独立review/Gate、production readbackが揃うまで実装へ進めない。
- predecessorの`production_evidence: not_collected`と、本Storyの`production_evidence: not_collected`は、それぞれの未収集境界を示す。どちらも本番成功や完了を意味しない。

## 計画する処理順序

1. actual external delivery readbackを取得し、source、readback時刻、repository-qualified identity、immutable provenanceを同一runへ束縛する。
2. selectorは、そのactual readbackの結果だけを入力として実行する。古いsnapshot、title一致、黙った候補除外を入力にしない。
3. selectorはProgram statusを評価する前に実行する。
4. readback、identity、selectorのいずれかが失敗した場合はfail-closedで`needs_review`とし、候補を黙って除外しない。
5. external delivery、selector成功、merge、release、docsだけでProgram statusを自動promotionしない。

## 受け入れ条件（planning-only）

- [ ] AC-001: actual external delivery readbackが完了し、source、readback時刻、repository-qualified identity、immutable provenanceが同一runへ保存されてからselectorを呼び出す。
- [ ] AC-002: selectorはactual readbackの結果を受け取り、Program status評価より前に一度だけ実行する。stale snapshotやtitle一致だけの候補は使わない。
- [ ] AC-003: readback、identity、selectorの失敗はfail-closedでreconciliation Gateを`needs_review`にし、候補の黙った除外やstatus評価の継続を行わない。
- [ ] AC-004: selector成功、external merge、release、docs、open PRはProgram statusを自動promotionせず、exit evidenceとして別途確認する。
- [ ] AC-005: runtime実装、外部mutation、deploy、production readbackは本Storyのplanning-only範囲に含めず、production evidenceは`not_collected`、doneはfalseに保つ。

## 非目標

selector runtime本体、既存reconciliation scriptの変更、P0/A0/J0 runtime変更、外部PRの変更・close・merge、release、deploy、migration、secret・顧客データ、本番smoke、Program statusの自動promotionは対象外。
