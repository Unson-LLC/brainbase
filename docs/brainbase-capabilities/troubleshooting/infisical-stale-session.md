# Troubleshooting: Infisical "User session is stale"

## Symptom

```
{"statusCode":401,"message":"User session is stale, please re-authenticate","error":"StaleSession"}
```

`infisical user get token --plain` から取った JWT で API を叩くと401で返る。

## Cause

self-hosted Infisical の user session JWT は短期TTL。ログインから時間が経つと server側で無効扱いになる。
CLIが保持しているtokenは古いまま CLI コマンドに渡されるが、組織RBAC API には通らない。

## Fix

Mac本体ターミナルで再ログインする (ttyd経由ではなく):

```bash
~/.local/bin/infisical login --domain https://infisical.unson.jp
```

ttyd経由で実行すると `Login via browser failed. operation not supported by device` のあと email/password 入力にfallbackする。理由はCLIのlocalhost callback先がttydサーバー側にあるため、ユーザーのブラウザから到達できない。

## When ttyd Is The Only Option

email/password 入力にfallbackした場合:

```text
Email: <Infisical login email>
Password: <password>
```

SSO強制Orgの場合は email/password ログインができないため、Mac本体での login が必要。

## Verify Refresh

```bash
JWT=$(~/.local/bin/infisical user get token --plain 2>/dev/null)
curl -sS -H "Authorization: Bearer $JWT" \
  "https://infisical.unson.jp/api/v1/organization" | jq '.organizations | length'
```

数字が返れば成功。401が出るならまだstale、login再実行。

## Do Not

- ttyd セッション内で `infisical login` を繰り返してエラーループに入る (root causeはbrowser callback)
- 古い JWT を `bash -c 'curl ...'` で使い続ける
- Machine Identity の token と user session の token を混同する (Identity側はTTLが長く別管理)
