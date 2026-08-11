---
spec_id: SPEC-BRAINBASE-ONTOLOGY-PRODUCTION-COMPATIBILITY
story_id: story-brainbase-ontology-production-compatibility
architecture: docs/architecture/ADR-021-brainbase-ontology-kernel.md
status: accepted
version: 1.0.0
date: 2026-08-03
---

# Brainbase Ontology Production Compatibility Spec

## C-001 Production vocabulary inventory

本番read-only集計でentityの存在とedgeの両endpoint型を確認できた語彙だけを1.0.0候補へ追加する。追加語彙は`classification: compatibility`とcanonical replacementの有無を保持する。endpoint entityが欠落して型を確認できないrelationは、名称から型を推測して登録しない。

## C-002 Project membership

`belongs_to_project`は本番で確認した既存始点型を許容し、同一entityが複数projectに属し得るため`many_to_many`とする。終点は`project`に限定し、孤児endpointは`edge-reference-integrity`として残す。

## C-003 Decision lifecycle and authority

`active`と`decided`を有効なDecision statusとする。有効なDecisionは、`owned_by` outgoing edgeで`person` deciderを、`belongs_to_project` outgoing edgeで`project` scopeを持つ。`pending_validation`は有効判断として推論しない。`supersedes`と競合推論もreleaseに宣言した同じeffective status集合を使う。

競合推論のscopeはGraphの`belongs_to_project` edgeから導出する。既存の未検証callerとの互換性のためpayload `scope_ids`は補助入力として受理するが、canonical snapshotの検証と監査はedgeを正本とする。

entity単体のvalidation/writeではdecider/scope edgeを検証できないため、active current下の有効Decisionは単体合格にせず、entityと必須edgeを同時検証するatomic Graph commitを要求する。current不在時のlegacy write互換性は維持する。

## C-004 Honest residuals

互換語彙の追加は、org ownerを確認できないapp、孤児edge、endpoint型未確認relationを有効にしない。監査は完全snapshotでのみ`verified`となり、残存違反をrule ID別に返す。

## C-005 Activation boundary

この変更はproposed releaseの互換性を高めるだけである。publication governance、receipt署名、`current`、本番DBを変更しない。active化は残存データ修復とauthority bindingを別の証跡付き作業として完了した後に限る。

## Test matrix

- production vocabulary fixture: 既知storage型・legacy relation・project membershipを受理する。
- decision fixture: `decided` + decider/scope edgesを受理・推論し、いずれか欠落時はrule ID付きで拒否する。
- honesty fixture: orphan endpoint、ownerなしapp、未登録relationを引き続き拒否する。
- shadow audit: 本番snapshotを`BEGIN READ ONLY`で収集し、変更後kernelの違反内訳と完全性を保存する。
