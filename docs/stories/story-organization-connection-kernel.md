# Story: 組織接続 OAuth カーネルの公開

Story ID: `story-organization-connection-kernel`

## Story

組織版の利用者として、OAuth state の発行・消費と接続 readback の共通契約を、
保存先、provider、tenant 認可、監査、時刻の実装から切り離して利用したい。
これにより、組織版 API は同じ安全境界を保ったまま、provider と環境固有の実装を注入できる。

## 受け入れ条件

1. `@unson/brainbase-mcp/organization-connection` からサービス、DI interface、エラー型を import できる。
2. OAuth state は opaque token として発行され、保存先には SHA-256 hash だけが保存される。
3. state は injected repository の atomic consume 契約によって TTL と一度きりを満たす。
4. tenant、person、provider の binding は callback で完全一致し、policy は組織固有の認可判断を所有する。
5. provider adapter の返却値は credential を含まない readback projection に正規化され、raw error は公開されない。
6. `stateRepository`、provider adapter、policy、clock、audit は利用側から注入できる。
7. unit test と fresh consumer smoke で subpath import、readback、replay、境界エラーを検証する。

## 境界

- 本Storyの正本は公開Brainbaseの TypeScript service kernel と、その subpath export である。
- 永続化、OAuth provider、組織認証、tenant policy、credential、secret、URL、配備設定は利用側repoが所有する。
- Unson固有のURL、provider設定、DB/Graph adapter、secret値はこのStoryの対象外である。
