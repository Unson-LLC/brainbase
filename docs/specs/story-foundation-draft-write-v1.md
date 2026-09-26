# Foundation草案Graph write v1 Spec

## 対象

`src/foundation-graph-write.ts` が、Hostで解決済みの信頼済みprincipal・project contextと、取得済みGraph row/current definitionを入力として、4 Foundation型のdraft upsert candidateを純粋に検証・正規化する。

## 入力と不変条件

1. `context.principal` と `context.projectCode` は非空のHost trusted contextとして必須。candidateから主体・projectを推測しない。
2. rowの `id`、`type`、`revision`、`projectCode`、`payload.foundation` は必須。typeは `objective`、`variable`、`model`、`constraint` のいずれかで、rowとdefinitionの値は一致する。
3. definitionは `validateFoundationDefinition(..., { use: 'draft' })` を通過し、`adoptionState=draft`、`storage=candidate`、`authorizedUses` は順序を含め `[draft]`、provenanceは1件以上の非空sourceIdを持つ。
4. definition.scopeは少なくとも1つのsubjectIdとRFC3339のvalidFromを持ち、trusted scopeがある場合はその内側、ない場合はselected projectだけを含む。

## create / update

- createはrevision `1`、`expectedNextRevision` `1`、ownerIdがprincipalであることを要求する。
- updateはcurrent definitionの同一id/type、candidateと同一owner、principalがcurrent ACLのownerまたはwriterであること、current revisionの次revisionを要求する。旧版の保持はcanonical writerのPostgreSQL row version/history triggerで担保する。
- updateではcandidateのownerId変更を拒否し、ACL変更を受け付ける場合でもowner transferとして扱わない。現在ACLでwriter権限がなければ失敗する。

## 出力と失敗

成功時は `FoundationGraphWriteResult` を返し、draft用途の3不変条件を正規化してcanonical writerへ渡す。失敗時は `valid=false` と機械判定可能なissue code/path/messageを返し、I/Oを行わない。throwing wrapperは同じissue集合を `FoundationGraphWriteError` として投げる。

## Graph history parity

`contracts/foundation/graph-history.sql` の履歴捕捉は、canonical writerが受け付けるDraft契約と同じ境界を持つ。4型のDraftは、型固有項目がまだ解決していなくても保存できる。Draft payloadに項目が存在する場合は、その項目のコンテナまたは値のJSON型（文字列・配列・オブジェクト）を検証し、不正な値は拒否する。配列要素、列挙値、期間や参照の詳細な形状・整合性はcanonical validatorの責務とし、履歴側でObjectiveの受益者・基準・評価期間、Modelの入出力・適用範囲などを補完してはならない。

`adoptionState` がDraft以外、またはDraftの `storage` / `authorizedUses` 契約を満たさない場合は、履歴側も型固有の必須項目を要求する。これにより保存されたDraftを判断用途へ暗黙に昇格させず、非Draftの欠落や承認境界の緩和を防ぐ。

## 変更境界

このSpecはOSSの純粋契約とpackage export、および配布するGraph history SQLのDraft形状契約とそのテストを扱う。認証解決、transaction/lock/RLS、canonical Graph upsert、Ontology publicationはHostまたは別Storyの責務とする。
