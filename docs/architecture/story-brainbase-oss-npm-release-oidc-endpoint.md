# GitHub Actions OIDC endpoint correction lane

## Decision

run `30893794741`の固定booleanはhostname predicateだけが失敗したことを示した。GitHub管理下の単一label `*.actions.githubusercontent.com`をHTTPS endpointとして許可し、suffix lookalike、userinfo、明示portを拒否する。取得したJWTは公式issuer、audience、repository、run ID、workflow ref、refを完全一致で検証する。固定診断フラグはworkflowから削除する。

## Existing architecture retained

この変更は[ADR-story-brainbase-oss-npm-release.md](ADR-story-brainbase-oss-npm-release.md)の「GitHub発行OIDC tokenとreview済みworkflow/refを完全一致させる」決定を維持する。endpoint predicateをGitHub管理domain境界へ合わせ、issuer claimを追加するため、新しいADRは作成しない。package単位serialization、tarball proof、registry mutation順序は維持する。

初回公開では公開済みdistがまだ存在しないため、責任契約のregistry証跡はphase-awareとする。公開前は対象versionの不存在をcurrent evidenceとして要求し、公開成功後はdist integrityとimmutable gitHeadの一致を要求する。これは公開後検証を免除せず、PR前に達成不能だった循環依存だけを解消する。

## Trust boundary

- endpointはHTTPSかつ単一label `*.actions.githubusercontent.com`だけを許可する。
- `.actions.githubusercontent.com.attacker.example`などのsuffix lookalike、userinfo、明示portをtoken request前に拒否する。
- JWTのissuerは`https://token.actions.githubusercontent.com`へ固定する。
- 診断classifierは認可predicateと同じhostname式を使うが、認可判断には流用しない。
- 出力は固定booleanだけとし、URL、hostname値、path、query、token、username、password値を含めない。
- 診断laneはclassifier実行直後に専用errorをthrowし、OIDC requestとnpm処理へ進まない。
- publish jobはnpm Trusted Publishing要件を満たすnpm CLI `11.5.1`を明示的に導入する。

## Failure and rollback

correction merge後、release ownerは一度だけmanual dispatchし、npm metadataとGitHub Releaseを検証する。問題があればcorrection commitをrevertし、公開workflowを停止したまま再調査する。npm versionが作成済みならimmutable artifactとして扱い、削除や上書きをしない。
