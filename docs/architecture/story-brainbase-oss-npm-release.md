# Brainbase OSS npm Release Architecture

## Decision

`scripts/npm-release.mjs`をnpm公開の単一実行境界とする。plan、validate、verifyはローカル実行できるが、publishはpackage単位で直列化されたupstream GitHub Actions内だけを許可する。registryが未公開ならpublishし、公開済みならimmutableな`version + gitHead`を照合する。

## Flow

1. `plan`: base refとrelease refの`package.json` versionを比較する。
2. `validate`: credentialなしで固定package名・version・clean HEAD・trusted default-branch到達性を照合し、build、test、production dependency auditを完了する。
3. `validate`は実tarballをrepository外へ生成し、manifestへreviewed commitを`gitHead`として刻印した後、その最終tarballのSHA-256、SHA-512 integrity、package identity、commitをvalidation proofへ束縛する。
4. `publish`: proof、package identity、HEAD、ancestry、cleanliness、両digestを再照合する。
5. registryにversionがなければ、検証済みtarballを`--ignore-scripts`でcommit固有の非consumer staging tagへ公開する。
6. registry metadataが収束するまでbounded retryする。
7. `version`、`gitHead`、registry `dist.integrity`を照合し、package単位で直列化されたworkflowと現在tagのSemVer再確認により、対象consumer tagを同系列の最大versionへ前進させてからstaging tagの除去を試みる。
8. npm成功後だけGitHub Releaseを作成または照合する。

## Trust boundaries

- package sourceとrelease CLIはdefault branch上のレビュー済みworkflowから読み込む。
- 公開artifactはPRの`merge_commit_sha`をdetached checkoutしてcredentialなしでbuild・packし、manifestの`gitHead`とdigestが一致した同一tarballだけを公開する。
- 手動`release_ref`も`origin/develop`から到達可能なcommitだけを許可し、package名を`@unson/brainbase-mcp`へ固定する。
- validation jobは`contents: read`だけを持ち、OIDCとnpm credentialを持たない。artifact/proofを短期Actions artifactでpublish jobへ渡す。
- publish jobだけが`id-token: write`と`NODE_AUTH_TOKEN`を持ち、CLIが要求するActions repository/run/serialization contextを設定する。
- pull requestの任意scriptを、merge前の`pull_request_target`権限で実行しない。

## Failure semantics

- npm credentialなし、scope権限なし、2FA拒否、またはGitHub runner OIDC attestation不成立は公開失敗として終了する。Actionsを名乗る環境変数だけでは公開境界を通過できず、OIDCのworkflow refとref claimはreview済み`refs/heads/develop`へ完全一致させる。
- registry 404だけを未公開として扱い、timeout、401、5xxを未公開へ読み替えない。
- 同一versionの`gitHead`不一致はimmutable collisionとしてfail loudする。
- registry収束を確認できない場合、GitHub Releaseを作成しない。
- registry `dist.integrity`が検証済みtarballのSHA-512 integrityと異なる場合、dist-tagを変更せず失敗する。
- 未検証のpublishはcommit固有staging tagだけを変更し、consumer tagを直接指定しない。CLIはupstream Actionsのpackage単位queue外からのpublishを拒否し、変更直前に現在tagを再取得して同系列のより新しいversionを上書きしない。したがって古いversionの復旧、並行実行、metadata収束失敗でもconsumer tagを巻き戻さない。
- npmが権限上staging tagの削除だけを403で拒否した場合、検証済みversionとconsumer tagの成功を取り消さず、`registry_permission_denied`として結果へ残す。その他のcleanup errorは失敗させる。
- 再実行時は既存の正しいnpm versionを再publishせず、検証から継続する。
- `verify`はregistryを変更せず、metadataまたはdist-tag不一致を非0で報告する。

## Recovery

GitHub Actionsの手動dispatchへ対象refを渡して再実行する。npm versionが正しく存在すればpublishをskipし、metadata、dist-tag、GitHub Releaseを再調整する。version自体が誤って公開された場合は上書きせず、新versionで修正する。
