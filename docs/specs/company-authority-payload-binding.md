# 実行データ付き会社権限参照

対象Story: `story-company-authority-payload-binding`。

## 入出力と不変条件

- Manaが送る `project:<id-or-code>` または `project:<id-or-code>#payload_sha256=sha256:<64桁の小文字16進数>` をproducer内で検証する。
- fragment付きproject参照は上記形式だけを許可する。空project、空白、追加fragment、区切り文字のエンコード、不正digestを拒否する。fragmentなしのproject参照もidentityのproject_idまたはproject_codeとの一致を確認し、binding検索には正本project_idを使う。personal://等の非project参照は元の値を保持する。
- 外側producerでは経路検索前、resolverではidentity検索前に構文検証する。
- identity解決後、project部分が正本のproject_idまたはproject_codeに一致しなければauthority検索前に拒否する。project_hintだけでは許可しない。
- repositoryへ渡すresource_refだけを正本project_idのfragmentなしにする。後述の管理されたSlack channel policyに該当しない場合、正本bindingがなければ拒否し、その場の権限作成へ切り替えない。
- 元のrequestは変更しない。context.scope.resource_refとtenant_context.authorization.data_scopesには元の参照を保持し、hash付き参照は2つの署名と既存consumer検証で実行データに拘束する。
- 公開v1 wire、SQLの権限条件、認証方式、Personal昇格契約は変更しない。

## 検証

- resolver: ID/codeの受理と正本project_idでの安定参照検索、元の参照の保存、別projectと不正fragmentの拒否、権限未登録の拒否。
- producer: 経路検索前の拒否、2署名の受理、hashを変更したrequestの拒否。
- 既存repository・producer・resolver・conformanceの影響テストを実行する。
- テスト成功はローカルの証明。本番DBのbindingや配備済みSHA、実行境界のreadbackの代用にはしない。

## Slack channel policy

### 正本設定

- `config/manifests/slack-channel-authority.json` をサービス管理者が管理する非秘密設定とする。manifest versionは `slack-channel-authority.v1` とし、policyごとに `provider=slack`、workspace ID、app ID、channel ID、tenant ID、tenant側 organization ID、Graph側 organization ID、`capability_id=runtime.execute`、`allowed_effects`、`policy_revision`、`raci_revision`、statusを持つ。
- policyのchannel IDは `C` または `G` で始まるSlack channelだけを受理する。DM・personal channelをmanifestに登録しない。各policyは1件以上のproject `{project_id, project_code, placement_id, resource_revision}` を持ち、同じchannelに複数projectを設定できる。
- 初期manifestにはback-office用channelとmana用channelを登録し、他channelは未登録のまま既存経路を使う。設定は権限対象を限定するもので、人物別のSlack subjectやsecretを含めない。

### 解決契約

1. 署名検証済みrequestのSlack channelを選択する。`slack.channel_id` と `delivery.channel_id` が両方ある場合は一致を要求する。未登録channelは `null` として既存のcanonical identity/authority解決へ渡す。
2. 登録channelを選択した場合、provider、top-level `workspace_id`/`app_id`、`provider_identity.workspace_id`/`app_id`をpolicyと相互に照合する。Slackの `requester_id` が存在する場合は `provider_identity.authenticated_subject_id` と一致させる。不一致、別tenant、別capability、許可されていないeffectは拒否する。
3. requested resourceはproject ID/codeまたは既存のpayload hash付きproject参照でなければならない。personal://等はchannel policyに適用せず、既存経路へ渡す。project ID/codeはpolicy上のprojectに一意に解決し、binding照会はcanonical `project_id`に限定し、同じprojectのID/codeによる既存resource参照を確認する。これにより `project:back-office` の旧aliasが別の文字列として検索される問題を防ぐ。
4. projectが一意に決まったら、同じtenant・Graph organization・Slack subject/workspaceに一致するactive `auth_grants` とactive `people`を1件に確定する。次に同じtenant・tenant organization・canonical personのactive membershipをrevision付きで1件に確定する。該当がない、複数ある、またはstatus/revisionが有効でない場合は拒否する。人物・identity・membership・grantの自動登録は行わない。
5. 既存の同じSlack subject・workspace・app・projectのexternal identityと、そのmembershipの現在状態を確認する。revoked/suspended/inactive、または紐づくmembershipが欠落・無効・revisionなしなら拒否する。別のactive membershipが存在するだけではcanonical personの解決を曖昧にしない。
6. 既存bindingはcanonical membershipとlegacy membershipの対象範囲を確認し、明示deny・approval・human actionをそのまま返す。active auto bindingのeffectはchannel policyとの共通部分だけを使う。要求effectが共通部分にない場合は拒否する。
7. binding履歴が0件のときだけ、channel policyのproject placement・effect・revisionから、DBを書き換えずsynthetic auto authorityを組み立てる。`superseded`だけの履歴は旧版として自動許可に使わず拒否する。現在の`revoked` binding、期限切れのbinding、未来から有効なbindingが検索結果に含まれる場合は、synthetic autoで権限を復活させずfail closedする。有効なactive bindingがある場合だけ、そのbindingを評価する。

### 保持する境界

- channel policyは `runtime.execute` に限定し、`read`、`write`、`external_side_effect` の許可はmanifestと既存bindingの共通範囲に限定する。既存のexplicit deny、approval、人手操作、Personal昇格契約を上書きしない。
- 解決結果はcanonical person、membership、canonical project、MANA placement、policy/binding revision、identity/authority receiptを返す。解決は読み取り専用で、既存の署名付きtenant contextとconsumer側のresource bindingを継続して使う。
- 未登録channel、DM、personal resourceは既存経路へ戻る。これらの経路をchannel policyのsynthetic authorityで拡張しない。

### 検証

- manifest: C/G channel、2channelのproject設定、複数project、ID/codeの重複、DM/不正effectの拒否。
- request: top-levelとnested workspace/appの不一致、Slack requesterとsubjectの不一致、unknown channel、DM/personal、別project、capability/effect逸脱、payload hashの不正を独立に確認する。
- database: active auth grant/person/membershipからのcanonical person導出、旧aliasのcanonical project解決、legacy identity/bindingの制限、deny/approval/human action、revoked/expired/future/superseded bindingのfail-closedを確認する。
- 実DB shadowでUmeda/Satoの対象channel・projectをread-only照合し、HTTPの成功だけでなくcanonical person、membership、project、placement、effect、receiptを読み戻す。ローカルテスト成功やmanifest読込だけを本番権限の証明にしない。
