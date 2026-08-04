# GitHub Actions OIDC endpoint correction Spec

## Contract

`assertSerializedPublicationContext(environment, request)`は、`BRAINBASE_NPM_OIDC_DIAGNOSTIC=true`のとき、`ACTIONS_ID_TOKEN_REQUEST_URL`を分類して専用errorで停止する。

診断errorのJSON objectは次のboolean keyだけを、この順序で含む。

1. `url_present`
2. `parse_ok`
3. `protocol_https`
4. `hostname_trusted`
5. `raw_authority_colon`
6. `userinfo_present`
7. `normalized_nondefault_port`

URL全文、hostname値、raw authority、path、query、request token、username、password値は含めない。classifierは認可predicateと同じ式で観測するが、通常モードの認可判断には使わない。診断モードはclassification後に必ず停止し、`request`を呼ばない。通常モードはHTTPSかつ単一label `*.actions.githubusercontent.com`を許可し、suffix lookalike、userinfo、明示portを拒否する。JWTはissuer `https://token.actions.githubusercontent.com`を含む既存claim完全一致を要求する。

## Examples

| Input shape | Diagnostic result |
|---|---|
| trusted regional HTTPS endpoint with explicit`:443` | `protocol_https=true`, `hostname_trusted=true`, `raw_authority_colon=true`, `normalized_nondefault_port=false` |
| trusted HTTPS endpoint with`:8443` | 上記に加えて`normalized_nondefault_port=true` |
| userinfo付きendpoint | `userinfo_present=true`; 値は出力しない |
| malformed endpoint | `url_present=true`, `parse_ok=false`; 残りはfalse |

診断run `30893794741`のproduction vectorは、URL、parse、HTTPS、authority、userinfo、portが正常でhostname predicateだけがfalseだった。correctionでは`pipelines` prefix依存を外し、GitHub管理domainの単一label境界へ合わせる。

## Verification

- `tests/npm-release.test.ts`: 固定boolean完全一致、機密sentinel非包含、request未呼出、通常モードの既存positive/negative cases。
- `tests/npm-release-validation.integration.test.ts`: credential-free validationと公開前failure semantics。
- `tests/npm-release-workflow.test.ts`: validation/publish job boundaryとworkflow state。
- `tests/e2e/story-brainbase-oss-npm-release-oidc-endpoint-acceptance.spec.ts`: 固定診断フラグ削除、非`pipelines` endpoint許可、suffix lookalike拒否、issuer完全一致、npm CLI要件をrelease-specific flowとして再生する。
- `npm run test:integration:release-evidence`: cleanな同一HEAD上でproduction dependency audit、実tarballのSHA-256/SHA-512、npm integrity、対象versionのregistry E404を一回のintegration実行として記録する。
- `npm run test:e2e`、`npm run build`: release-specific flowを含むrepository regression evidence。

## State diagram

```mermaid
stateDiagram-v2
  [*] --> PublishReady
  PublishReady --> DiagnosticEnabled
  DiagnosticEnabled --> Classified
  Classified --> StoppedBeforeTokenRequest
  StoppedBeforeTokenRequest --> EvidenceRecorded
  EvidenceRecorded --> FollowUpPrepared
  FollowUpPrepared --> PublicationRetried
  PublicationRetried --> [*]
```

## Release operations

correction PRはworkflowの固定診断フラグを削除し、npm CLI `11.5.1`を導入する。merge後、release ownerは`gh workflow run npm-publish.yml --repo Unson-LLC/brainbase --ref develop -f release_ref=develop`を一度だけ実行する。成功時はnpm metadataのdist integrityとgitHead、dist-tag、GitHub Release targetを照合する。失敗時はrun URLと公開済みversionの有無を保存し、重複公開を避けて再調査する。

初回公開前のregistry証跡は対象versionの不存在を確認する。PR前には、公開成功後に`npm view`のdist integrityとgitHeadをreview済みdefault-branch commitへ照合し、不一致または未確認を成功として扱わない検証経路を固定する。実registryの一致は公開後のdelivery outcomeとして別途観測する。
