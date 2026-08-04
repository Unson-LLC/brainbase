# GitHub regional OIDC endpoint Spec

## Contract

`assertSerializedPublicationContext(environment, request)`は、GitHub Actionsのserialization contextを確認した後、`ACTIONS_ID_TOKEN_REQUEST_URL`をURLとして解釈する。

許可条件は次の積集合とする。

1. protocolが`https:`である。
2. hostnameが`^pipelines[a-z0-9-]*\.actions\.githubusercontent\.com$`へ完全一致する。
3. raw authorityに明示的なportがなく、username、passwordが空である。WHATWG URLが`:443`を既定portとして正規化しても、入力に明示されていれば拒否する。
4. 取得したJWTのaudience、repository、run ID、workflow ref、ref claimが期待値へ一致する。

どれか1つでも不一致なら`OIDC endpoint is not trusted`または既存のclaim-specific errorで失敗し、npm commandを実行しない。

## Examples

| Input | Result |
|---|---|
| `https://pipelines.actions.githubusercontent.com/token` | allow endpoint, then validate claims |
| `https://pipelinesghubeus4.actions.githubusercontent.com/token` | allow endpoint, then validate claims |
| `https://pipelines.actions.githubusercontent.com.attacker.example/token` | reject before token request |
| `http://pipelines.actions.githubusercontent.com/token` | reject |
| `https://pipelines.actions.githubusercontent.com:443/token` | reject before token request |
| `https://user@pipelines.actions.githubusercontent.com/token` | reject |

## Verification

- `tests/npm-release.test.ts`: canonical/regional positive cases、lookalike、protocol、port、userinfo、claim mismatchのnegative cases。
- `tests/npm-release-validation.integration.test.ts`: credential-free validationと公開前failure semantics。
- `tests/npm-release-workflow.test.ts`: validation/publish job boundaryとworkflow state。
- `npm run test:e2e`、`npm run build`: repository regression evidence。

## Release operations

このhotfixをdevelopへmerge後、`gh workflow run npm-publish.yml --repo Unson-LLC/brainbase --ref develop -f release_ref=develop`で初回公開を再実行する。失敗時はworkflow logの停止段階を保存し、npm metadataが存在しないことを確認してから原因を修正する。
