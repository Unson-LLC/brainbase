# 実行データ付き会社権限参照

対象Story: `story-company-authority-payload-binding`。

## 入出力と不変条件

- Manaが送る `project:<id-or-code>#payload_sha256=sha256:<64桁の小文字16進数>` をproducer内で検証する。
- fragment付き参照は上記形式だけを許可する。空project、空白、追加fragment、区切り文字のエンコード、不正digestを拒否する。fragmentなしの参照は既存の完全一致検索を維持する。
- 外側producerでは経路検索前、resolverではidentity検索前に構文検証する。
- identity解決後、project部分が正本のproject_idまたはproject_codeに一致しなければauthority検索前に拒否する。project_hintだけでは許可しない。
- repositoryへ渡すresource_refだけをfragmentなしにする。正本bindingがなければ拒否し、project-only検索やその場の権限作成へ切り替えない。
- 元のrequestは変更しない。context.scope.resource_refとtenant_context.authorization.data_scopesにはhash付き参照を保持し、2つの署名と既存consumer検証で実行データに拘束する。
- 公開v1 wire、SQLの権限条件、認証方式、Personal昇格契約は変更しない。

## 検証

- resolver: ID/codeの受理、安定参照の検索、元の参照の保存、別projectと不正fragmentの拒否、権限未登録の拒否。
- producer: 経路検索前の拒否、2署名の受理、hashを変更したrequestの拒否。
- 既存repository・producer・resolver・conformanceの影響テストを実行する。
- テスト成功はローカルの証明。本番DBのbindingや配備済みSHA、実行境界のreadbackの代用にはしない。
