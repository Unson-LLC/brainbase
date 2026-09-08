# Project能力意図モデル v1（廃止）

この仕様が定義していた`config.yml`保存のProject Profile API/CLIは廃止した。
Projectの事業情報はGraphを正本とし、登録・更新はProject Provisioningまたは権限付きGraph Maintenanceから行う。

現行仕様:

- [Project Provisioning v1](../architecture/story-project-provisioning-v1.md)
- [Project Graph business SSOT](../architecture/ADR-024-project-graph-business-ssot.md)
- [Project Catalog capability](../brainbase-capabilities/capabilities/project.catalog.yml)

Drive、Slack、リポジトリなどの能力参照をGraphへどう表現するかは、この廃止仕様から暗黙に移行しない。別のGraph契約として定義・検証する。
