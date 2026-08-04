# GitHub Actions OIDC endpoint diagnosis lane

## Decision

現行の`assertSerializedPublicationContext`認可ロジックを変更せず、`BRAINBASE_NPM_OIDC_DIAGNOSTIC=true`のときだけendpointの固定boolean分類を出してOIDC request前に停止する診断laneを追加する。このPRではworkflowを変更せず、診断機構のmerge後に続くactivation PRがフラグをworkflow固定値として設定する。dispatch入力にはしない。

## Existing architecture retained

この変更は[ADR-story-brainbase-oss-npm-release.md](ADR-story-brainbase-oss-npm-release.md)の「GitHub発行OIDC tokenとreview済みworkflow/refを完全一致させる」決定を変更しない。通常モードのendpoint predicate、audience、repository、run ID、workflow ref、ref claim検証、package単位serialization、tarball proof、registry mutation順序はそのまま維持するため、新しいADRは作成しない。

初回公開では公開済みdistがまだ存在しないため、責任契約のregistry証跡はphase-awareとする。公開前は対象versionの不存在をcurrent evidenceとして要求し、公開成功後はdist integrityとimmutable gitHeadの一致を要求する。これは公開後検証を免除せず、PR前に達成不能だった循環依存だけを解消する。

## Trust boundary

- 診断classifierは現行predicateと同じURL parser、hostname正規表現、raw authority colon式を使うが、認可判断には流用しない。
- 出力は固定booleanだけとし、URL、hostname値、path、query、token、username、password値を含めない。
- 診断laneはclassifier実行直後に専用errorをthrowし、OIDC requestとnpm処理へ進まない。
- 通常laneは既存のHTTPS、hostname、raw authority、userinfo、token response、claim検証をそのまま実行する。

## Failure and rollback

activation PR後の診断runは常にOIDC request前でfail closedする。boolean vectorを取得後、原因修正PRでworkflowの診断フラグを削除する。問題があればactivation commitをrevertし、公開workflowを停止したまま再調査する。この変更だけではnpm versionは作成されない。
