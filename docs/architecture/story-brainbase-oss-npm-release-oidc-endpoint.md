# GitHub regional OIDC endpoint trust-boundary correction

## Decision

`assertSerializedPublicationContext`のendpoint検証を、単一のcanonical hostname比較から、anchored hostname predicateへ置き換える。許可集合は`pipelines` prefix、英小文字・数字・hyphenからなる任意のregional segment、正確な`.actions.githubusercontent.com` suffixだけとする。

## Existing architecture retained

この変更は[ADR-story-brainbase-oss-npm-release.md](ADR-story-brainbase-oss-npm-release.md)の「GitHub発行OIDC tokenとreview済みworkflow/refを完全一致させる」決定を変更しない。endpoint取得後のaudience、repository、run ID、workflow ref、ref claim検証、package単位serialization、tarball proof、registry mutation順序はそのまま維持するため、新しいADRは作成しない。

## Trust boundary

- URL protocolは`https:`のみ。
- hostname全体を`^pipelines[a-z0-9-]*\.actions\.githubusercontent\.com$`へ一致させる。
- port、username、passwordを拒否する。
- token responseと全OIDC claimは既存ロジックで検証する。

## Failure and rollback

不一致endpointはnpm registryを参照または変更する前にfail closedする。問題があればhotfix commitをrevertし、公開workflowを停止したままendpoint evidenceを再取得する。npm versionはこの変更だけでは作成されないため、rollback時のregistry migrationはない。
