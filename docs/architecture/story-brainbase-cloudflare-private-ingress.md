---
story_id: story-brainbase-cloudflare-private-ingress
title: Cloudflare private ingressでBrainbase runtimeを安全に公開する
status: proposed
updated_at: 2026-08-19
---

# Architecture: Brainbase Cloudflare private ingress

## Decision

Brainbaseは、ManaからのService Binding呼出しを受ける専用Cloudflare Worker `brainbase-tenant-runtime` をIngress adapterとして持つ。WorkerはManaのcanonical transportが実際に使用するrouteだけを明示allowlistし、業務ロジックを持たず、固定HTTPS Tunnel originに中継する。

```text
mana-runtime Worker
  -> Service Binding: BRAINBASE_TENANT_RUNTIME_SERVICE
  -> brainbase-tenant-runtime (workers.dev=false, preview=false)
  -> fixed HTTPS hostname protected by Cloudflare Access
  -> cloudflared (catch-all=404)
  -> http://127.0.0.1:31016
  -> Brainbase canonical service auth / tenant boundary / runtime operations
```

WorkerはCloudflareの公開URL、arbitrary proxy、別origin、Nodeの別portへfallbackしない。Tunnelの公開hostnameはAccess Service Authで保護し、cloudflaredはNodeのloopbackだけへ接続する。

## Responsibility split

| component | responsibility | must not do |
| --- | --- | --- |
| Mana Worker | Service Bindingからcanonical runtime requestを送る | Brainbase Secretを保持する、別routeへfallbackする |
| Brainbase ingress Worker | route、origin、body、header、response境界を検査し、固定originへ中継する | tenant解決、credential発行、provider判断、任意proxy |
| Cloudflare Access/Tunnel | hostname到達制御とloopbackへの接続 | tenant業務認可、別local serviceへのfallback |
| Brainbase Node runtime | service JWT検証、tenant／connection境界、credential lease、provider forward、Receipt | non-loopback公開、Ingress境界の迂回 |

## Route and request contract

許可する入口は、Manaのcanonical transportが使用する次のrouteだけである。

| method | path | query | result |
| --- | --- | --- | --- |
| `POST` | `/api/v1/runtime/tenant-context:resolve` | なし | fixed originへ中継 |
| `POST` | `/api/v1/runtime/credential-leases` | なし | fixed originへ中継 |
| `POST` | `/api/v1/runtime/provider-requests:forward` | なし | fixed originへ中継 |
| `POST` | `/api/v1/runtime/quota:decide` | なし | fixed originへ中継 |
| `POST` | `/api/v1/runtime/usage-events` | なし | fixed originへ中継 |
| `POST` | `/api/v1/runtime/operation-receipts:finalize` | なし | fixed originへ中継 |
| `POST` | `/api/v1/runtime/operation-receipts:finalize-with-pricing` | なし | fixed originへ中継 |
| `POST` | `/api/v1/runtime/operation-receipts/{receipt_id}/history:read`（canonical receipt ID） | なし | fixed originへ中継 |

別method、別path、query付き、canonical形式でないreceipt IDの要求は`404 application/problem+json`で拒否する。Workerは`negotiate`、verification keys、tenant boundary、migrationなどallowlist外のrouteを公開しない。routeの業務判断、tenant境界、credential、quota、usage、Receiptの正本はNode canonical runtimeが行う。

Workerがupstreamへ渡す通常ヘッダーは`Accept`、`Content-Type`、`Brainbase-Protocol-Version`、`Brainbase-Deployment-Id`だけとする。Manaから受けた`Authorization`、`CF-Access-*`、Cookie、forwarding header、任意headerは破棄する。

## Secret and authentication boundary

Worker Secretは次の5値である。

- `BRAINBASE_TENANT_RUNTIME_ORIGIN`: fixed HTTPS Access hostname
- `BRAINBASE_TENANT_RUNTIME_ORIGIN_HOSTNAME`: origin hostnameの照合値
- `BRAINBASE_SERVICE_JWT`: Brainbase canonical service authが検証する署名済みservice JWT/token
- `CF_ACCESS_CLIENT_ID`: bridge専用Access Service TokenのID
- `CF_ACCESS_CLIENT_SECRET`: bridge専用Access Service Tokenのsecret

Workerはinbound `Authorization`を捨て、`BRAINBASE_SERVICE_JWT`を`Authorization: Bearer <value>`として上書きする。Access資格情報もinbound値を捨て、Worker Secretから`CF-Access-Client-Id`と`CF-Access-Client-Secret`を注入する。WorkerはJWT署名鍵を持たず、JWTのissuer、audience、deployment、capability、tenant boundaryの検証はNode canonical service authが行う。

Secretの値はコード、`wrangler.jsonc`の`vars`、テストの実値、ログ、problem body、Receiptへ出さない。Secret欠落や空値はorigin到達前に`503`とする。

## Origin and body boundary

`BRAINBASE_TENANT_RUNTIME_ORIGIN`はHTTPS scheme、想定hostname、標準origin pathだけを許可し、user/password、port、query、fragment、追加pathを拒否する。upstream URLはroute allowlistから得たpathとの組み合わせで生成するため、request URLからhostやallowlist外pathを採用しない。

request bodyは256 KiBを上限とし、数値だけの`Content-Length`が上限以下であることと、実streamの累計byte数を検査する。宣言値が不正、上限超過、streamが上限超過の場合は`413`でfetchを実行しない。

## Response and failure contract

upstream fetchは`redirect: manual`で実行する。Workerはstatus、body、`Content-Type`（特に`application/problem+json`）、`Retry-After`、`Cache-Control`を許可範囲で透過し、下流cacheは`no-store`へ固定する。redirectを追従せず、別originへ再送しない。

| condition | response | upstream fetch |
| --- | --- | --- |
| route not allowed | `404 BRIDGE_ROUTE_NOT_ALLOWED` | 0 |
| invalid origin/secret | `503 BRIDGE_CONFIGURATION_INVALID` | 0 |
| body invalid/too large | `400` / `413` | 0 |
| Tunnel、Access、Node fetch failure | `502 BRIDGE_UPSTREAM_UNAVAILABLE` | 1以下 |
| Node response | Nodeのstatus/bodyを透過 | 1 |

Workerはretry、直通Node URL、workers.dev URL、別Tunnel hostnameなどのdirect fallbackを持たない。再試行とidempotencyはManaまたはcanonical Node側の契約で扱う。

## Deployment shape and verification

`wrangler.jsonc`は`workers_dev=false`、`preview_urls=false`を維持し、専用hostnameはAccess applicationでService Auth policyだけを許可する。cloudflared ingressは専用hostnameをloopback `127.0.0.1:31016`へ向け、catch-allは404とする。

この実装レーンでは、unit testとWrangler build dry-runのみを実行する。Secret投入、Tunnel／Access変更、Worker deploy、本番Slack E2Eは別の承認済みprovisioning/releaseレーンの責務であり、ここで成功扱いにしない。
