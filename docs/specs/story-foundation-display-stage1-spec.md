# 最小Spec: Foundation表示の初段

`GET /api/foundation/catalog?scope_id=<project code>` をread-onlyで追加する。返り値は `{contractVersion:'foundation-overview.v1',scopeId,objectives,variables,models,philosophies}`。Foundation各配列は最新 `FoundationCatalogRecord`、哲学は `PhilosophyRevisionRecord`。Objectiveの `details` はimmutable payloadからtitle/criteria_text/beneficiary_description/evaluation_period_note/evaluator_note/current_stateだけを取り出す。現状は保存時点の記述として扱う。

Graph adapterは既存trusted identity/transaction/readinessに閉じ、projectとcurrent ACL/history digest/scope検証を通す。哲学列挙は選択projectのRLS-visible latest historyを同じ検証関数で読む。全件を返し、UIが50件ずつ検索結果を表示する。未知query/重複scope/body/認可外scopeは拒否。POST/PUTは405。部分失敗を空配列へ変えない。

共有 `createFoundationOverview({root,port,scopeId,document})` が目的→現状/不足→哲学→世界モデルを描画する。読み取りは `port.readCatalog()`。状態は別項目として表示し、推定の達成率を作らない。目的details.current_stateは『記録上の現状』『保存時点の記述』と日付を添え、登録前の不足記述を現在の事実へ昇格しない。版不一致の評価変数は参照未確認とする。

組織BFFは既存Foundation route認可を再利用し、新assetをpinned OSSから配信。既存Objective editorは維持し、共有overviewを先頭に置く。未接続World Modelと判断閲覧の常時blockは初段から除外。自分の引継ぎ目的は既存の別sectionを維持。scope切替は旧controllerをdestroyし、新mountとgenerationを使う。未選択ではcatalogを呼ばない。

ロールバックはroute/asset/mountを元へ戻す。データmigrationもDB変更も不要。
