# Cloudflare Tenant Runtime Private Bridge

## 目的と境界

`brainbase-tenant-runtime`は、mana-runtimeのCloudflare Service Bindingと、BrainbaseのNode tenant runtimeを接続するBrainbase所有のprivate bridgeである。tenant解決、service auth、connection revision、credential lease、provider request検証はNode側のcanonical実装が引き続き所有し、bridgeはそれらを再実装しない。

```text
mana-runtime Worker
  -> Service Binding: brainbase-tenant-runtime
  -> Cloudflare Worker（workers.dev/preview URLなし）
  -> Cloudflare Accessで保護したHTTPS Tunnel hostname
  -> cloudflared
  -> http://127.0.0.1:31016/api/v1/runtime/{allowlisted-route}
  -> Brainbase canonical service auth / tenant boundary / credential broker
```

bridgeが受理するのは、次の`POST` routeとqueryなし要求だけである。

- `GET /api/v1/runtime/verification-keys`
- `/api/v1/runtime/tenant-context:resolve`
- `/api/v1/runtime/credential-leases`
- `/api/v1/runtime/provider-requests:forward`
- `/api/v1/runtime/quota:decide`
- `/api/v1/runtime/usage-events`
- `/api/v1/runtime/operation-receipts:finalize`
- `/api/v1/runtime/operation-receipts:finalize-with-pricing`
- `/api/v1/runtime/operation-receipts/{receipt_id}/history:read`（`receipt_` + canonical ULIDのみ）

別method、別path、allowlist外のcanonical route、不正receipt IDは404で拒否する。request bodyは256 KiBを上限とし、`Content-Length`と実stream byte数の両方を検査する。bridgeは`Brainbase-Protocol-Version`、`Brainbase-Deployment-Id`、`Content-Type`、`Accept`だけをcallerからupstreamへ渡す。callerの`Authorization`は破棄してWorker SecretのBrainbase service JWTで上書きし、Cloudflare Access headerはWorker Secretから注入する。callerが送ったCookie、forwarding header、任意headerは渡さない。

Node runtimeのloopback既定を変更しない。`BRAINBASE_TENANT_RUNTIME_HOST=127.0.0.1`を維持し、`BRAINBASE_TENANT_RUNTIME_ALLOW_NON_LOOPBACK`は未設定または`0`にする。cloudflaredが同じhost上のloopback originへ接続するため、wildcard listenは不要である。

## Cloudflare TunnelとAccess

1. Brainbase runtime hostに専用Cloudflare Tunnelを作成し、tunnel tokenをhostのsecret managerへ保存する。repo、shell history、ログへ記録しない。
2. 専用hostnameのingressを`http://127.0.0.1:31016`へ向ける。catch-allは`http_status:404`にし、他のlocal serviceへfallbackさせない。
3. 専用hostnameをCloudflare Accessのself-hosted applicationで保護する。
4. `Service Auth` policyにはbridge専用Service Tokenだけを許可する。メール、Everyone、Bypass policyを追加しない。
5. Access applicationのpathはallowlistの各pathへ限定する。Tunnel hostnameを直接公開APIとして運用しない。
6. origin疎通を確認するときもservice tokenをコマンド引数へ置かない。Access audit logとNodeのsecret非含有構造化ログで結果を照合する。

## Node runtime設定

Node runtimeには既存のcanonical production設定を注入する。値はdeployment-local secret managerで管理する。

- `BRAINBASE_TENANT_RUNTIME_ENABLED=1`
- `BRAINBASE_TENANT_RUNTIME_HOST=127.0.0.1`
- `BRAINBASE_TENANT_RUNTIME_PORT=31016`
- `BRAINBASE_TENANT_RUNTIME_ALLOW_NON_LOOPBACK=0`または未設定
- `BRAINBASE_TENANT_RUNTIME_SERVICE_TOKEN`
- `BRAINBASE_SERVICE_TOKEN_SECRET`
- `BRAINBASE_TENANT_RUNTIME_SERVICE_ISSUER`
- `BRAINBASE_TENANT_RUNTIME_SERVICE_AUDIENCE`
- `BRAINBASE_TENANT_RUNTIME_REQUIRED_CAPABILITIES`
- `BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID`
- `BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_PROFILE`
- Tenant Context署名鍵、正本PostgreSQL、credential materializer／provider forwarder設定

mana-runtimeがService Binding requestへ設定した`Authorization`はbridgeで信頼せず破棄する。bridgeは`BRAINBASE_SERVICE_JWT`をWorker Secretから読み、`Authorization: Bearer <value>`としてcanonical Node verifierへ渡す。JWT署名secretはbridgeへ複製せず、JWTの検証とtenant boundaryはNode側canonical実装が所有する。

## Worker secretと配備

次の5値はWrangler Secretとして設定する。`wrangler.jsonc`の`vars`、Git、CI出力へ値を書かない。

- `BRAINBASE_TENANT_RUNTIME_ORIGIN`: Accessで保護した専用HTTPS origin。path、query、fragment、credential、非標準portを含めない。
- `BRAINBASE_TENANT_RUNTIME_ORIGIN_HOSTNAME`: 上記originのhostnameと完全一致する値。
- `BRAINBASE_SERVICE_JWT`: canonical Node service authが検証する署名済みBrainbase service JWT/token。Workerは値をログ・応答・監査票へ出さない。
- `CF_ACCESS_CLIENT_ID`: bridge専用Access Service TokenのClient ID。
- `CF_ACCESS_CLIENT_SECRET`: bridge専用Access Service TokenのClient Secret。

対象Cloudflare accountを`wrangler whoami`で固定した後、値を標準入力から投入する。

```bash
npx wrangler secret put BRAINBASE_TENANT_RUNTIME_ORIGIN --config packages/cloudflare-tenant-runtime-bridge/wrangler.jsonc
npx wrangler secret put BRAINBASE_TENANT_RUNTIME_ORIGIN_HOSTNAME --config packages/cloudflare-tenant-runtime-bridge/wrangler.jsonc
npx wrangler secret put BRAINBASE_SERVICE_JWT --config packages/cloudflare-tenant-runtime-bridge/wrangler.jsonc
npx wrangler secret put CF_ACCESS_CLIENT_ID --config packages/cloudflare-tenant-runtime-bridge/wrangler.jsonc
npx wrangler secret put CF_ACCESS_CLIENT_SECRET --config packages/cloudflare-tenant-runtime-bridge/wrangler.jsonc
npm run build --prefix packages/cloudflare-tenant-runtime-bridge
npm run deploy --prefix packages/cloudflare-tenant-runtime-bridge
```

`build`はdry-runだけを行う。`deploy`は外部変更なので、対象account、Tunnel、Access policy、secret名、Node readinessを確認した承認済みリリースでだけ実行する。

mana-runtime側のWrangler設定はService Bindingを次の名前で参照する。

```json
{
  "binding": "BRAINBASE_TENANT_RUNTIME_SERVICE",
  "service": "brainbase-tenant-runtime"
}
```

## 本番readback

配備成功やHTTP 200だけで完了としない。同一相関IDで次を照合する。

1. `wrangler deployments list`でbridgeのWorker versionとGit SHAを記録する。
2. `wrangler secret list`では5つのsecret名だけを確認し、値を出力しない。
3. mana-runtimeの配備readbackで`BRAINBASE_TENANT_RUNTIME_SERVICE -> brainbase-tenant-runtime`を確認する。
4. 新規Slack eventからprovider requestを1件実行し、mana event ID、tenant、connection revision、operation IDを固定する。
5. Access audit logでbridge専用Service Tokenの許可が1件であることを確認する。
6. Node側でcanonical service auth、署名済みTenantContext、authoritative connection revision、single-use lease、provider forwardが同じoperation IDで成功したことを確認する。
7. provider credential、service token、Access secretがWorker log、Node log、Receipt、Slack返信へ出ていないことを確認する。
8. Slack返信1件、Brainbase Receipt 1件、idempotency replay時の追加provider call 0件を確認する。

bridgeの応答分類は、route不許可404、body超過413、設定欠落503、Tunnel／Access到達不能502である。いずれも別origin、別tenant、Nodeの別portへfallbackしない。

## Rotationとrollback

Access Service Tokenは新tokenを作成し、Worker secretを更新して疎通を確認してから旧tokenを失効する。Brainbase service JWTは、Node expected tokenとbridge Worker Secretを片方だけ先に更新せず、provider利用を停止／drainした同じ保守rotation windowで切り替える。

現行実装は旧新tokenのoverlapをサポートしない。Node verifierは`BRAINBASE_TENANT_RUNTIME_SERVICE_TOKEN`の単一expected tokenを比較し、bridgeは必須Worker Secret `BRAINBASE_SERVICE_JWT`の単一値を`Authorization: Bearer`へ注入する。次の順序で実施する。

1. 新しいcanonical `bbsvc_` JWTを発行し、issuer、subject、audience、deployment、expiry、capabilityがNode verifierの期待値と一致することを確認する。値をログ、コマンド引数、リポジトリへ出さない。
2. 実行中のprovider requestをdrainし、新規provider利用を停止する。Brainbase Node runtimeのdeployment-local secret managerで`BRAINBASE_TENANT_RUNTIME_SERVICE_TOKEN`を新JWTへ更新し、Nodeをreload／restartしてreadinessを確認する。
3. 同じ新JWTをCloudflare Worker Secret `BRAINBASE_SERVICE_JWT`へ設定してbridgeをdeployする。`wrangler secret list`ではsecret名だけをreadbackし、値を出力しない。
4. bridge経由のcanonical routeを1件だけ疎通し、Node canonical service auth、Access、Tunnelのreadbackを揃えてからprovider利用を再開する。
5. 旧JWTを発行元とsecret managerから失効／削除する。途中で失敗した場合は、Worker SecretとNode expected tokenを旧ペアへ戻してから既知のWorker versionへrollbackする。

`BRAINBASE_TENANT_RUNTIME_SERVICE_TOKEN`と`BRAINBASE_SERVICE_JWT`は同じJWTを指す。前者はBrainbase Node runtimeのdeployment-local secret managerだけに、後者はCloudflare Worker Secretだけに置く。JWT値をmana-runtimeのWorker vars／secrets、Service Binding設定、リポジトリ、CI、ログ、Receiptへ置かない。mana-runtimeはservice tokenを保持せず、Service Bindingを呼ぶだけである。将来Node verifierが旧新tokenのoverlapを受理できる実装になった場合だけ、Nodeへ新tokenを追加 → Worker Secretを新tokenへ更新 → bridge smoke → overlap期間後にNodeから旧tokenを削除、の順で行う。現行は単一値比較のため、このoverlap手順を適用しない。

障害時はmana-runtimeのprovider利用機能を停止し、既知のWorker versionへ戻す。Access protectionやNode tenant boundaryを外して復旧しない。Tunnel、Access、Node runtimeのいずれが未確認でも`upstream_unavailable`として残し、成功へ丸めない。
