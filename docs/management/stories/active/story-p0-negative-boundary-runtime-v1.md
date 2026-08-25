---
story_id: story-p0-negative-boundary-runtime-v1
title: P0 Personal→Organization負境界を本番runtimeへ実装する
status: implementation
program_id: brainbase-program-master-roadmap-v1
work_package: P0
predecessor: story-p0-negative-boundary-contract-v1
production_evidence: not_collected
done: false
---

# P0 Personal→Organization負境界を本番runtimeへ実装する

## 利用者成果

Personal KGの本人が正規化payloadへ同意し、本人とは別の組織責任者が同じpayloadを別authorityで承認した場合だけ、組織Graphへ昇格できる。Personal本文は組織reviewer、Graph、検索、Receipt、LLMへ漏らさない。

## 実装境界

- predecessor contract: `story-p0-negative-boundary-contract-v1`
- predecessorは境界契約を確定した履歴であり、本Storyが実runtimeの受入条件を置き換える。predecessorの`production_evidence: not_collected`と「組織側writeなし」は旧contract sliceだけに適用する。
- active implementation PR: `#1274`
- ingress: 署名済みBrainbase access context。未認証のdirect ingressはdenyする。
- canonical tenant key: `organization_id`
- canonical person key: `person_id`
- source data: Personal KG event
- promoted data: allowlistで再構成したnormalized payloadのみ

## 受け入れ条件

- [x] AC-001: source person・organization・projectをA0署名contextへ束縛し、署名欠落・cross-tenant・cross-personをGraph write前にdenyする。
- [x] AC-002: owner consentとorganization acceptanceを別actor・別authority・同一request・同一normalized payload hashへ束縛し、owner=reviewerをdenyする。
- [x] AC-003: expired・invalid・replayed authority、無効な状態遷移、normalized payload差し替えをdenyし、event・Graph・receiptを含む更新effectを0にする。
- [x] AC-004: normalized payloadはallowlist schemaだけを受け入れ、Personal本文、raw content、preview、local path、secret、credential、personal event idをGraph payloadから排除する。
- [x] AC-005: 組織承認とGraph mutationを単一transactionで実行し、同一署名authorityの再送を409で拒否してauthority使用台帳を含む更新差分を0にし、二重Entity・Edge・Receiptを生成しない。新しい署名authorityで完了済みrequestを再確認した場合は、新しいauthority使用Receiptだけを監査記録として追加できるが、event・Graph・promotion・Receiptは変更しない。
- [x] AC-006: synthetic fixtureで正常系、cross-tenant、cross-person、owner=reviewer、期限切れ、署名改ざん、再送をfocused testする。
- [x] AC-007: schema migrationへauthority使用台帳とRLSを後方互換で追加し、旧Personal KG経路を維持する。
- [ ] AC-008: VibePro Gate、PR更新、merge、migration、service deploy後に同一runのReceipt・DB/Graph readback・冪等性を確認する。確認前は`production_evidence: not_collected`と`done: false`を維持する。

## 非目標

Personal本文の組織共有、owner単独承認によるGraph write、customer実データを使うsmoke test、authority不足時のfallback、別tenantへの候補探索は行わない。
