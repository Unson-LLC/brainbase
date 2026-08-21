---
story_id: story-canonical-company-authority-producer-contract-v1
title: "A0: Brainbase company authority producer contract v1を固定する"
status: active
source:
  type: milestone
  id: M0-company-authority-and-personal-boundary
architecture_reason: "ADR-023の観測要求・正本authority context・署名・wire境界を、Mana consumerが機械検証できる一つのproducer contractとして固定する。"
architecture_docs:
  - docs/architecture/ADR-023-brainbase-owned-company-authority.md
  - docs/architecture/canonical-company-authority-producer-contract-v1.md
spec_docs:
  - docs/specs/canonical-company-authority-producer-contract-v1.md
related_tasks:
  - docs/management/tasks/canonical-company-authority-producer-contract-v1.json
---

# A0: Brainbase company authority producer contract v1を固定する

## User outcome

Mana側がauthorityを自己生成せず、Brainbaseが解決して署名した`CanonicalExecutionContextV1`だけを同じwire、schema、canonical JSON、署名、error codeで検証できる。producerとconsumerは、merge SHAを自己参照せず、manifest versionとfixture digestで同じ契約 payload を照合できる。

## Scope

このStoryは、A0の契約準備と決定論的conformance fixtureだけを扱う。`server/**`、route、DB/migration、deployment、secret、customer data、mana-runtime worktreeには変更を加えない。Brainbase authority resolverの本番実装や外部送信も行わない。

## 受け入れ基準

- [x] AC-001: 観測要求の入力境界を機械検証できる

`ObservedExecutionRequestV1`はprovider identity、requested action、delivery、correlationだけを受け付ける。`desired_effect`は`read`、`write`、`external_side_effect`のいずれかを必須とし、capability名から推測しない。canonical person、organization、project、owner、RACI、approver、decision、policy、credentialは入力に含めない。

- [x] AC-002: CanonicalExecutionContextV1のschemaとwireを固定する

成功responseのcontextはJSONPathルート`$`の`$.context`に置き、`$.context.tenant_context.authorization.capability_ids`に`company_authority_v1`を必須とする。actor、scope、authority、evidence、revision、TTL、audience、deployment、integrityを一つのcontextとして検証し、requestのcorrelation、capability、effect、resourceをcontextへ束縛する。

- [x] AC-003: canonical JSONと署名 profileを固定する

RFC 8785 JCSとUTF-8をcanonical payloadに使い、`integrity`を除いたunsigned contextに対するdetached JWS Ed25519を検証する。protected header、`application/mana-brainbase-company-authority+jws`、TTL 300秒、clock skew 30秒、audience`mana-runtime`を機械可読に固定する。

- [x] AC-004: decision modeを固定する

`auto`、`approval`、`human_action`、`deny`をそれぞれsynthetic positive fixtureで示す。approvalは指定approver以外を認めず、human_actionは通知を完了とみなさず、denyはbusiness/model/credential/external effectを発生させない。

- [x] AC-005: canonical errorとfail-closed negative matrixを固定する

desired effect/capability欠落、unknown/ambiguous person、cross-org、project scope、inactive membership、tenant/connection/RACI/policy/resource stale、wrong approver、authority unavailable、Personal owner欠落・cross-person、invalid signature、expired、replay conflictを、17 canonical error codeとbusiness effect falseで固定する。default person/tenant/owner/credentialへのfallbackは許可しない。

- [x] AC-006: synthetic fixtureとmanifest digestを固定する

2 tenant × 2 person、9 positive、28 negativeを決定論的fixtureとして保存する。fixture setはmanifest自身を除外した相対path + NUL + bytesのSHA-256で識別し、source lockにはcontract/manifest versionとdigestだけを含める。producerのcommit、branch head、merge SHAは自己参照せず、merged SHAはdownstream lockで後から固定する。

- [x] AC-007: TDD conformanceを実行できる

targeted conformance testがwire path、capability path、schema metadata、signature profile、manifest digest、全decision mode、全negative error code、detached signature tamperを検証する。契約準備の範囲であり、production actionやruntime E2Eの成功とは主張しない。trusted `kid`からのkey解決、key rotation、key revocationはruntime非目標であり、reference validator単独をauthorityとは扱わない。

## Out of scope

- Brainbase resolver、Graph query、route、DB schema、runtime consumerの実装
- 本番署名鍵、customer data、deployment、外部送信
- merged SHAのproducer側自己参照

## Release gate

本Storyの成果物は`contract_ready`であり、consumer cutover、merge、deploy、production E2Eの許可ではない。trusted `kid`→key trust、rotation、revocation、downstream consumer verificationがruntimeで実装・検証されるまでproduction cutoverはblockedとする。downstream consumerがこのsource lockとfixture digestを読戻し、merged SHAを自分のlockへ記録して初めて次の実装段階へ進む。
