# Story: Slackログイン権限を組織内のプロジェクトに限定する

## 利用者価値

組織の管理画面へSlackでログインした利用者として、所属組織が所有するプロジェクトだけを見たい。別組織のプロジェクトがgrant生成処理や古いデータの混入によって表示されてはならない。

## 受け入れ条件

- [x] `auth_grants.project_codes`の書き込みは、各codeの`projects.organization_id`がgrantの`organization_id`と一致する場合だけ成功する。
- [x] 旧grant生成入口も組織単位の検証済みwriterへ委譲し、CEOへ全組織のprojectを付与しない。
- [x] 既存の不整合データが残っていても、ログイン・refresh・組織アクセス一覧では所属組織のprojectだけを返す。
- [x] DB triggerが別組織・未登録project codeの新規混入を拒否する。
- [ ] 本番の既存grantをバックアップ後に正本所有へ整合させ、不整合件数が0件であることをreadbackする。
- [ ] 再ログインまたはrefresh後、Unsonのログイン情報にTechKnightとSalesTailorのproject codeが含まれないことを公開APIで確認する。
