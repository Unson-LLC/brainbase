---
story_id: story-brainbase-cloudflare-private-ingress
title: Cloudflare private ingressでBrainbase runtimeを安全に公開する
status: active
created_at: 2026-08-19
updated_at: 2026-08-19
horizon: quarter
view: platform
source:
  type: implementation-lane
  repository: Unson-LLC/brainbase
  path: packages/cloudflare-tenant-runtime-bridge/
architecture_reason: "外部到達経路、サービス認証、Tunnel originを同時に固定し、Manaからcanonical Brainbase runtimeへ安全に接続するため。"
architecture_docs:
  - path: docs/architecture/story-brainbase-cloudflare-private-ingress.md
    status: proposed
spec_docs:
  - path: .vibepro/spec/story-brainbase-cloudflare-private-ingress/spec.json
    status: final
related:
  - Unson-LLC/mana-runtime:story-mana-multitenant-runtime
  - Unson-LLC/brainbase:docs/runbooks/cloudflare-tenant-runtime-bridge.md
---

# Cloudflare private ingressでBrainbase runtimeを安全に公開する

## User Story

mana-runtimeの運用者として、ManaのCloudflare WorkerからBrainbaseのcanonical tenant runtimeへ、公開URLや任意proxyを経由せずに接続したい。そうすれば、tenant解決・サービス認証・credential lease・provider forwardの正本をBrainbase Node runtimeに保ったまま、Cloudflare間の接続を監査可能なprivate ingressとして運用できる。

## Delivery Boundary

このStoryはBrainbaseが所有するCloudflare Worker `brainbase-tenant-runtime` のIngress境界だけを扱う。

- Workerは`POST /api/v1/runtime/provider-requests:forward`だけを許可する。
- Manaから来た`Authorization`、`CF-Access-*`、Cookie、任意の転送ヘッダーは破棄する。
- Worker SecretのBrainbase service JWTとCloudflare Access Service TokenをWorker自身が注入する。
- originは固定HTTPS hostnameに限定し、redirect、arbitrary proxy、direct fallbackを許さない。
- tenant、connection、credential、providerの業務判断はNode側canonical runtimeが行う。

Tunnel作成、Access applicationの本番変更、Secret投入、Worker deploy、Mana側の切替、provisionerの実装はこのStoryの実装範囲に含めない。

## Acceptance Criteria

- [ ] `AC-001`: exact path、`POST`、queryなしの1 routeだけを受理し、別method・別path・query付き要求はoriginへ到達せず`404 application/problem+json`になる。
- [ ] `AC-002`: `BRAINBASE_TENANT_RUNTIME_ORIGIN`がHTTPSかつ、credential・port・path・query・fragmentを持たず、`BRAINBASE_TENANT_RUNTIME_ORIGIN_HOSTNAME`と完全一致しない場合は`503`でfail closedする。
- [ ] `AC-003`: `BRAINBASE_SERVICE_JWT`、`CF_ACCESS_CLIENT_ID`、`CF_ACCESS_CLIENT_SECRET`が欠落または空の場合はoriginへ到達せず`503`でfail closedする。
- [ ] `AC-004`: inboundの`Authorization`と`CF-Access-*`を信頼せず、Worker SecretからのBrainbase service JWTとAccess資格情報で上書きする。
- [ ] `AC-005`: upstreamへ渡すヘッダーを`Accept`、`Content-Type`、`Brainbase-Protocol-Version`、`Brainbase-Deployment-Id`に限定し、Cookie、forwarding、任意headerを渡さない。
- [ ] `AC-006`: request bodyを256 KiB以下に制限し、宣言された長さと実streamの両方を検査する。超過・不正長は`413`でoriginへ到達させない。
- [ ] `AC-007`: upstream requestは`redirect: manual`で送信し、upstreamのstatus、problem+json body、許可された応答ヘッダーを透過する。redirectを追従しない。
- [ ] `AC-008`: fetch失敗、設定不備、route不許可を分類して返し、別origin、別tenant、Nodeの別portへのfallbackを行わない。
- [ ] `AC-009`: Workerコード、通常ログ、テスト出力、監査証跡にSecret値・JWT・Access資格情報を出さない。
- [ ] `AC-010`: unit testとWrangler build dry-runを同一作業treeで実行し、実際のCloudflare deployを行わずに証跡を残せる。

## Scenarios

- `BBING-S-001`: 正しいService Binding経路から正しいprovider forwardを受けると、固定HTTPS originへ1回だけ中継される。
- `BBING-S-002`: 攻撃者がinbound `Authorization`、`CF-Access-*`、Cookieを差し替えても、upstreamにはWorker Secret由来の値だけが届く。
- `BBING-S-003`: query、別method、未知route、HTTP origin、hostname mismatchはNodeへ到達しない。
- `BBING-S-004`: 256 KiBを超えるbody、数値でない`Content-Length`、実stream超過は`413`になり、upstream fetchは0回である。
- `BBING-S-005`: Nodeが`application/problem+json`の409やredirect statusを返しても、Workerはbodyとstatusを改変せずredirectを追従しない。
- `BBING-S-006`: Tunnel／Access／Node到達不能時は`502`となり、公開URLや別originへ再試行しない。

## Evidence and Completion

- Story、Architecture、Specが同じroute allowlist、secret境界、origin固定、body/error契約を示す。
- `packages/cloudflare-tenant-runtime-bridge`のunit testが成功する。
- `npm run build --prefix packages/cloudflare-tenant-runtime-bridge`のdry-runが成功する。
- 実deploy、Secret readback、Tunnel／Access疎通、Mana Slack E2Eは別の承認済み運用手順で確認し、コードテストの成功だけで本番移行完了とはしない。

## Out of Scope

- Cloudflare account、Tunnel、Access policy、Worker Secretの本番変更
- `tenant-context:resolve`などprovider forward以外のruntime routeの公開
- Brainbase Node runtimeのtenant境界・認証・credential brokerの再実装
- ManaのQueue、Durable Object、Slack配送、重複抑止の変更
