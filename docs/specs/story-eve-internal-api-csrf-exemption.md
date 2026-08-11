---
story_id: story-eve-internal-api-csrf-exemption
title: Spec - internal API key requestのCSRF境界
status: active
diagrams:
  - kind: flow
    path: docs/architecture/ADR-eve-internal-api-csrf-exemption.md
    purpose: internal API key付きPOSTがCSRF middlewareとrequireAuthを順に通るflowを示す。
  - kind: threat_model
    path: docs/architecture/ADR-eve-internal-api-csrf-exemption.md
    purpose: browser、internal client、CSRF境界、認証境界、workflow routeのtrust boundaryを示す。
---

## Invariants

- **INV-1 (exact key only)**: `INTERNAL_API_SECRET`と完全一致する単一の`x-internal-api-key`を持つ変更リクエストだけがCSRF middlewareを通過する。
- **INV-2 (auth remains authoritative)**: CSRF通過後も`requireAuth`が同じkeyを検証し、`authSource=internal`を設定する。CSRF middlewareだけでroute権限を与えない。
- **INV-3 (fail closed)**: server secret未設定、header欠落、値不一致、複数値headerはinternal requestとして扱わない。
- **INV-4 (browser behavior unchanged)**: internal keyを持たない本番POSTは、既存のCSRF token検証を通る。

## Constraints

- 比較は長さを確認した上で`crypto.timingSafeEqual`を使う。
- safe methodおよび既存の限定的なserver-to-server exemptionは変更しない。
- DB、workflow payload、監査データのschema変更は行わない。

## Scenarios

- **S-001**: production POST + exact key -> CSRF通過 -> `requireAuth`でinternal service認証 -> route到達。
- **S-002**: production POST + wrong key -> CSRF 403 -> route未到達。
- **S-003**: production POST + missing key -> CSRF 403 -> route未到達。
- **S-004**: production POST + server secret unset -> CSRF 403 -> route未到達。

## Diagrams

- kind: flow
  path: `docs/architecture/ADR-eve-internal-api-csrf-exemption.md`
  purpose: internal API key付きPOSTがCSRF middlewareとrequireAuthを順に通るflowを示す。
- kind: threat_model
  path: `docs/architecture/ADR-eve-internal-api-csrf-exemption.md`
  purpose: browser、internal client、CSRF境界、認証境界、workflow routeのtrust boundaryを示す。

## Failure Modes

- FM-001: server secret未設定時はinternal exemptionを無効にする。
- FM-002: key欠落、不一致、複数値headerはCSRF 403でfail closedにする。
- FM-003: CSRF通過は認証成功を意味せず、`requireAuth`を必須とする。
- FM-004: browser requestのCSRF token契約は変更しない。

## Verification

- Unit: `tests/unit/csrf-internal-api-key-exempt.test.js`
- E2E: `tests/e2e/story-eve-internal-api-csrf-exemption-contract.spec.ts`
- Production: 対象meeting sourceのexact-run dry-run後にexecuteし、dispatch run作成を確認する。
