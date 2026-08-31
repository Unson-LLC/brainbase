# Brainbase Architecture Catalog

このディレクトリは、Brainbase共通Kernelと組織版の設計判断、境界、実装Story、運用契約を保持します。

文書数が増えたため、ファイル名順に読むのではなく、次の順で辿ってください。

## 1. Visual overview

| View | 用途 | Source |
|---|---|---|
| PLATFORM OVERVIEW | OSS版と組織版の共有Kernel、包含関係、Mana、Domain Judgment Pack、完成度の境界 | [platform-overview.archify.json](diagrams/platform-overview.archify.json) |
| CURRENT | 現在の組織版主要component・正本・信頼境界 | [current.archify.json](diagrams/current.archify.json) |
| NORTH STAR | Organizational Intelligence PlaneとDomain Judgment Packの到達像 | [north-star.archify.json](diagrams/north-star.archify.json) |
| DATA FLOW | Signal → Context → Judgment → Action → Learning | [data-flow.archify.json](diagrams/data-flow.archify.json) |

Repository rootの[ARCHITECTURE.md](../../ARCHITECTURE.md)から、生成HTML・SVGを含めて閲覧できます。

## 2. Foundation and source-of-truth boundaries

- [Brainbase基本構成](brainbase-foundation.md)
- [Brainbase Surface Responsibility Matrix](brainbase-surface-responsibility-matrix.md)
- [Brainbaseマルチテナント基盤](story-brainbase-multitenant-platform.md)
- [Cloudflare Private Ingress](story-brainbase-cloudflare-private-ingress.md)
- [Personal Vaultと組織イベントの境界](adr-personal-organization-memory-boundary.md)

ここでは、OSS Local Personal OS、Organization Graph、PostgreSQL、Git、外部System of Record、Personal Vault、UI projectionの責務を定義します。

## 3. Authority and execution safety

- [ADR-023: Brainbase-owned Company Authority](ADR-023-brainbase-owned-company-authority.md)
- [Organization Agent Loop Control](org-agent-loop-control-architecture.md)
- [Judgment Resolver v1](story-brainbase-judgment-resolver-v1.md)
- [Judgment Audit Fail Closed](story-brainbase-judgment-audit-fail-closed.md)
- [Runtime Capability Scope Integration](story-runtime-capability-scope-integration.md)
- [Cross-runtime Run Receipt Inbox](story-cross-runtime-run-receipt-inbox-v1.md)

会社権限の意味はBrainbaseが正本解決します。Agent hostやManaは、外部identityとrequested actionを渡し、署名済みcontextの範囲で実行するconsumerです。

## 4. Graph, ontology, and organizational memory

- [ADR-021: Ontology Kernel](ADR-021-brainbase-ontology-kernel.md)
- [Organization Judgment DAG](organization-judgment-dag.md)
- [Knowledge Event Cycle](adr-knowledge-event-cycle.md)
- [Memory Promotion Kernel Boundary](ADR-010-memory-promotion-kernel-boundary.md)
- [Meeting Minutes Context Receipt](story-meeting-minutes-context-receipt.md)
- [Mana Secretary Memory Promotion](mana-secretary-memory-promotion-architecture.md)

Graphは現在有効な組織事実・Decision・RACIを持ちます。raw eventやAI出力はcandidateであり、evidence、scope、authority、reviewなしにGraphへ昇格しません。

## 5. Product direction and domain judgment

- [Domain Judgment DAG Platform Vision](domain-judgment-dag-platform-vision.md)
- [VibePro / Brainbase Dogfood Architecture](vibepro-brainbase-dogfood-architecture.md)
- [Intent-to-Outcome North Star](../decisions/2026-08-18_intent-to-outcome-north-star.md)
- [Agent-first Product Surface ADR](ADR-017-agent-first-product-surface.md)
- [AI Employee Node Runtime Boundary](ADR-020-ai-employee-node-runtime-boundary.md)

Brainbaseは一つの巨大な判断DAGではありません。共通Context・Authority・Receipt・Learning契約の上で、VibePro、Zeims、営業、マーケティング、バックオフィス等のDomain Judgment Packを選択・接続・改善する基盤です。

## 6. How to interpret document status

- `accepted`: 現在の設計判断。後続文書にsupersedeされていない限り優先する。
- `proposed`: 到達候補。実装済み・本番適用済みとは限らない。
- `CURRENT`: 実装・検証済みの主要境界。
- `FRONTIER`: 一部実装または設計は存在するが、Exit Gate・fresh E2E・production readbackのいずれかが未成立。
- Story内のcode complete、deploy、production readback、E2Eは別の完了条件として扱う。
- 同じ概念が複数文書にある場合、明示されたADR・Spec・machine-readable manifestを優先する。
- UI・生成図・READMEはprojectionであり、詳細契約の正本を置換しない。

## 7. Updating the visual architecture

1. 変更対象がPLATFORM OVERVIEW、CURRENT、NORTH STAR、DATA FLOWのどれかを決める。
2. 関連するOSS／組織版のADR・Story・Spec・コードをreadbackする。
3. `diagrams/*.archify.json`を更新する。
4. node/component IDを安定させ、viewのfocusとconnection参照を壊さない。
5. Archify `validate`、`deliver`を通す。
6. PLATFORM OVERVIEWは実Chromeによる`visual-check`も必須とする。
7. 生成HTML・SVG・receiptは手編集せずCIに任せる。
8. CURRENTに未実装要素を混ぜる場合、tagとcardで状態を明示する。

詳細は[diagrams/README.md](diagrams/README.md)を参照してください。
