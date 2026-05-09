# Troubleshooting: Infisical Project DELETE Returns 403

## Symptom

```
DELETE /api/v1/workspace/<id> -> 403
{"statusCode":403,"message":"Project delete protection is enabled","error":"ForbiddenError"}
```

User は Org admin で、project にも admin権限があるのに DELETE が通らない。

## Cause

ProjectのSettings に `hasDeleteProtection: true` が立っている。Infisicalは本番事故防止のため、DELETE前に明示的にprotectionを外す二段階を要求する。

別の似た 403:

```
"Your token is scoped to organization with ID X, but this resource belongs to a different organization."
```

これは hasDeleteProtection ではなく **JWT scope が異なる Org に向いている**ケース。 `select-organization` で対象Orgへ再scopeする必要がある。

## Confirm

```bash
JWT=$(~/.local/bin/infisical user get token --plain 2>/dev/null)
SCOPED=$(curl -sS -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"organizationId\":\"<ORG_ID>\"}" \
  "https://infisical.unson.jp/api/v3/auth/select-organization" | jq -r '.token')

curl -sS -H "Authorization: Bearer $SCOPED" \
  "https://infisical.unson.jp/api/v1/workspace/<PROJECT_ID>" \
  | jq '.workspace | {slug, hasDeleteProtection}'
```

`hasDeleteProtection: true` が見えれば原因確定。

## Fix

```bash
# 1. Disable protection
curl -sS -X PATCH -H "Authorization: Bearer $SCOPED" -H "Content-Type: application/json" \
  -d '{"hasDeleteProtection":false}' \
  "https://infisical.unson.jp/api/v1/workspace/<PROJECT_ID>" \
  | jq '.workspace.hasDeleteProtection'

# 2. Delete
curl -sS -X DELETE -H "Authorization: Bearer $SCOPED" \
  "https://infisical.unson.jp/api/v1/workspace/<PROJECT_ID>"
```

200 が返ればproject削除完了。

## Pre-Delete Safety Check

protection 解除と削除はそれぞれ可逆（再create）だが、削除前に **どのrutimeがその project を読みにいっているか** を確認すること:

```bash
curl -sS -H "Authorization: Bearer $SCOPED" \
  "https://infisical.unson.jp/api/v1/workspace/<PROJECT_ID>/service-token" | jq '.serviceTokenData | length'
curl -sS -H "Authorization: Bearer $SCOPED" \
  "https://infisical.unson.jp/api/v2/workspace/<PROJECT_ID>/identity-memberships" | jq '.identityMemberships | length'
curl -sS -H "Authorization: Bearer $SCOPED" \
  "https://infisical.unson.jp/api/v1/workspace/<PROJECT_ID>/integrations" | jq '.integrations | length'
```

3つとも `0` なら自動runtime参照は無し。GitHub Actions / Vercel env / Lambda env に project ID が直書きされているケースは API では検知できないので、削除後の deploy/CI失敗で初めて発覚する点に留意。

## Do Not

- protection 立っているprojectを `force` フラグで削除しようとする (Infisical APIにそのフラグは無い)
- 削除前に上記 safety check を飛ばす（runtime consumer があるとproduction が落ちる）
- delete後すぐに同じslugで再createしてrollbackしようとする (encryption key/rotation history が失われている)
