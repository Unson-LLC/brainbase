---
story_id: story-t0-offline-negative-e2e-receipt
title: T0本番実行前のオフライン負系を機械可読Receiptへ固定する
source_requirement:
  source: T0 master roadmap production provisioning exit gate
  approved_at: 2026-08-21
architecture_docs:
  - path: docs/architecture/story-t0-offline-negative-e2e-receipt.md
    status: accepted
spec_docs:
  - docs/specs/story-t0-offline-negative-e2e-receipt.md
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "本番接続を持たない負系fixtureと、その実行証跡を1つの検証境界に固定する。"
status: contract_evidence_completed
t0_program_status: partial
created_at: 2026-08-21
updated_at: 2026-08-21
---

# T0本番実行前のオフライン負系を機械可読Receiptへ固定する

## Story

T0のproduction provisioningを検証する開発者として、本番DB・Graph・秘密・Cloudflare・Slackへ接続せずに、重複配信・テナント越境・上流停止の失敗閉鎖を反復実行したい。fixture-onlyで確認した範囲と、本番未実行・deploy禁止の境界を、後から機械的に監査できるReceiptとして残したい。この成果物はdeterministic contract fixtureであり、ファイル名にE2Eを含んでもproduction E2Eの証明にはならない。

## 現在地

このStoryのfixture-only contract evidenceは完了した。T0 programのproduction exitは完了していない。本番PostgreSQL/runtime E2E、schema/bridge/secret/OAuth、外部readbackが未実施のため、T0はpartialである。

## 受け入れ基準

- [x] AC-001: fixture-only dry runが固定T0 base `e44843bd1bfc995c760dd6ec7e2916d62685a514`と実行worktreeの`git rev-parse HEAD`に厳密に束縛されたbase/head、fixture hash、3ケース、観測カウンター、`production_executed=false`、`deploy_allowed=false`を含む機械可読Receiptを出力する。別の有効形式SHAは拒否し、`--json`省略または未知CLI optionもexit 1で拒否する。
- [x] AC-002: 同一eventのredeliveryはprovider、delivery、accountingの各効果カウンターを1に保つ。pipeline再配信と各layerのdirect redeliveryを対象とする。
- [x] AC-003: cross-tenant eventはresolver、provider、delivery、accountingより前に拒否され、各カウンターは0になる。
- [x] AC-004: upstream unavailableはresolverの`available=false`を確認してblocked/failureとして扱い、provider/delivery/accountingは0、external readbackは`not_collected`、未知の数量は`null`のまま残す。`available=true`はfail-loudとする。
- [x] AC-005: 各fixture操作は明示的なfixture-only adapter layerを経由し、factory発行identityを持つ禁止外部adapter境界と注入adapterだけを受理する。低層layerの直接呼出しでもboundary／injectionのidentityを生成前に検証し、構造を偽装したadapterは呼び出し前に拒否する。fixture-only実行中に外部adapterを呼ぶ、またはproduction形状のadapterを注入するとテストが失敗する。実行成功は外部adapter呼び出し0件を含む。
- [x] AC-006: Receiptは固定fixtureから決定的に生成され、同じ厳密Git bindingの入力でfixture hashとケース結果が変わらない。

## スコープ外

- production PostgreSQL、Graph、credential broker、OAuth、Cloudflare、Slackへの接続・readback
- 既存runtime、deploy_allowed、runbook、package、mana repo、DB/migration、secret、顧客データの変更
- T0 production exit gateの完了宣言。production schema/bridge/secret/OAuth/readbackとreal PostgreSQL/runtime E2Eは未実行のため、T0はpartialのまま残す。
