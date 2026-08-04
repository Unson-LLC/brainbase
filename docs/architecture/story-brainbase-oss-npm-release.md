# Brainbase OSS npm Release Architecture

## Decision

`scripts/npm-release.mjs`をnpm公開の単一実行境界とする。ローカルのpackage scriptとGitHub Actionsは同じCLIを呼び、registryが未公開ならpublish、公開済みならimmutableな`version + gitHead`を照合する。

## Flow

1. `plan`: base refとrelease refの`package.json` versionを比較する。
2. `validate`: credentialなしで固定package名・version・clean HEAD・trusted default-branch到達性を照合し、build、test、production dependency auditを完了する。
3. `validate`は実tarballをrepository外へ生成し、manifestへreviewed commitを`gitHead`として刻印した後、その最終tarballのSHA-256、SHA-512 integrity、package identity、commitをvalidation proofへ束縛する。
4. `publish`: proof、package identity、HEAD、ancestry、cleanliness、両digestを再照合する。
5. registryにversionがなければ、検証済みtarballを`--ignore-scripts`で選択したdist-tagへ公開する。
6. registry metadataが収束するまでbounded retryする。
7. `version`、`gitHead`、registry `dist.integrity`を照合し、対象tagを同系列の最大versionへ収束させる。
8. npm成功後だけGitHub Releaseを作成または照合する。

## Trust boundaries

- package sourceとrelease CLIはdefault branch上のレビュー済みworkflowから読み込む。
- 公開artifactはPRの`merge_commit_sha`をdetached checkoutしてcredentialなしでbuild・packし、manifestの`gitHead`とdigestが一致した同一tarballだけを公開する。
- 手動`release_ref`も`origin/develop`から到達可能なcommitだけを許可し、package名を`@unson/brainbase-mcp`へ固定する。
- validation jobは`contents: read`だけを持ち、OIDCとnpm credentialを持たない。artifact/proofを短期Actions artifactでpublish jobへ渡す。
- publish jobだけが`id-token: write`と`NODE_AUTH_TOKEN`を持つ。
- pull requestの任意scriptを、merge前の`pull_request_target`権限で実行しない。

## Failure semantics

- npm credentialなし、scope権限なし、2FA拒否は公開失敗として終了する。
- registry 404だけを未公開として扱い、timeout、401、5xxを未公開へ読み替えない。
- 同一versionの`gitHead`不一致はimmutable collisionとしてfail loudする。
- registry収束を確認できない場合、GitHub Releaseを作成しない。
- registry `dist.integrity`が検証済みtarballのSHA-512 integrityと異なる場合、dist-tagを変更せず失敗する。
- 再実行時は既存の正しいnpm versionを再publishせず、検証から継続する。
- `verify`はregistryを変更せず、metadataまたはdist-tag不一致を非0で報告する。

## Recovery

GitHub Actionsの手動dispatchへ対象refを渡して再実行する。npm versionが正しく存在すればpublishをskipし、metadata、dist-tag、GitHub Releaseを再調整する。version自体が誤って公開された場合は上書きせず、新versionで修正する。
