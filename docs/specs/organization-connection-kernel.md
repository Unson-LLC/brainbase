# Spec: Organization Connection OAuth kernel

親Story: [組織接続 OAuth カーネルの公開](../stories/story-organization-connection-kernel.md)

## 目的

組織版 API に共通する OAuth state の発行・消費、tenant/person binding、provider の
安全な接続 readback、監査 envelope を公開する。カーネル自身は provider、DB、Graph、
組織認証、secret、deployment を知らず、すべてを DI boundary の外側へ委譲する。

## 公開契約

- `OrganizationConnectionService`: `startAuthorization`, `completeAuthorization`, `readConnection`
- `OrganizationConnectionStateRepository`: state record の保存と atomic `consume`
- `OrganizationConnectionProviderAdapter`: authorization URL、code exchange、safe readback
- `OrganizationConnectionPolicy`: authorize/complete/read の組織固有認可
- `OrganizationConnectionAudit`: credentialを含まない監査 entry
- `OrganizationConnectionClock`: deterministic な時刻供給
- `OrganizationConnectionError`: 安定した `code`/`status`/`details` envelope

## 不変条件

1. state token は `randomBytes` で発行し、repository には SHA-256 hash、binding、intent、発行時刻、失効時刻だけを渡す。
2. repository の `consume` は missing、expired、replayed、consumed を区別し、consumed marker を atomic に保存する。
3. callback の provider、tenant、person は発行時の値と一致しない限り provider exchange を実行しない。
4. intent は JSON-compatible な値に限定し、token、secret、credential、password、private key、authorization code を示す field を拒否する。
5. provider adapter の readback は provider、connection id、status、表示名、外部ID、scope、時刻だけを返し、credential-shaped field を拒否する。
6. state store、provider、audit の例外は raw message を返さず、安定した公開エラーへ正規化する。
7. policy、state repository、provider adapter、audit、clock の実装は利用側が所有する。

## 検証

- `tests/organization-connection.test.ts`: TTL、one-time replay、tenant/person/provider binding、policy委譲、provider failure、safe readback、audit failure。
- `scripts/npm-consumer-smoke.mjs`: 公開 tarball を fresh consumer から subpath import し、start/complete/readback/replay を実行する。
- `npm run build`、focused Vitest、consumer smoke を PR で実行する。

## 非対象

Slack/GitHub固有のOAuth URL、Postgres/Graph adapter、組織 membership の判定、credential exchange 実装、secret値、配備設定、既存Unson route の切替。
