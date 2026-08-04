# Portable Connected-world Onboarding Spec

## MCP surface

次のadditive toolを提供する。

1. `brainbase_onboarding_start`: `valueTarget`とsource inventoryを検証・正規化しrunを作る。
2. `brainbase_onboarding_get`: run、source receipt、candidate review、first-value receiptの監査viewを返す。
3. `brainbase_onboarding_ingest`: bounded source receiptとcandidate batchを一括検証して保存する。
4. `brainbase_onboarding_review`: `approve|edit|reject|merge`を事前検証し、承認済み候補だけをcanonical SSOTへatomic promotionする。
5. `brainbase_onboarding_first_value`: `record`でanswer hashと使用canonical IDを、`review`で`useful|not_useful`と不足文脈を保存する。

全toolは任意の`dataDir`を受け取り、指定がなければ既存のPersonal OS path resolutionを使う。

## Source inventory contract

sourceは`id`、`mode`、`status`、任意の`evidencePointer`、`permissionScope`、`detail`を持つ。modeは`mcp|drive|gmail|local_folder|single_document`、statusは`ready|waiting_for_authorization|unavailable|error|unconfirmed`に限定する。

startはready sourceが1件以上なら`warm`、readyな`single_document`だけなら`fallback`、それ以外は`blocked`を返す。blocked runも失敗理由を保持するがingestは許可しない。

## Ingest contract

receiptは`sourceId`、`evidencePointer`、`contentHash`、`permissionSnapshot`、`collectionStatus: collected`を持つ。`contentHash`は`sha256:`と64桁hexに限定する。candidateは`kind`、`payload`、`observationClass: observed|inferred`、`evidenceId`を持ち、runtimeはingest時payload hashをcandidate identityへ保存する。

次を満たさないbatchは全体を拒否する。

- sourceがrun inventoryにありstatus readyである。
- source identityが既存receiptと一致する。
- permission snapshotがinventory scopeのsubsetである。
- receipt/candidateにbody、content、token、password、secret、credential等（複数形・camelCaseを含む）の禁止key/valueがない。
- 配列は50件以下、permission JSONは8KiB以下、永続ledgerは1MiB以下である。
- candidate kindが既存`planApply`のsupported kindでありpayloadがpromotion可能である。

## Review contract

各actionはcandidate ID、decision、reasonを必須とする。`edit`は置換payload、`merge`は同kindかつ`observed`で未レビューのtarget candidate IDを必須とし、merge元も`observed`に限定する。terminal targetへの後続mergeは拒否する。全actionをvalidation後、promotion対象とreview ledgerを1回のrecovery可能なSSOT transactionへ渡す。

- approve/mergeはobserved candidateだけに限定する。editは人間が置換payloadを確認する契約として、inferred candidateをobservedへ変換してpromotionできる。
- rejected candidateは`rejected`となりpromoted IDは空である。
- merge sourceは`merged`となり、targetだけがpromotion対象になる。
- unsupported/invalid candidate、Ontology violation、SSOT lock/recovery errorではledger review状態を更新しない。canonical/ledgerの途中publish失敗は両方を旧状態へ復旧する。
- retry済みterminal stateはdecision-specific fieldを含む完全に同一の正規化actionだけをidempotentとし、異なる決定・reason・payload・merge target・余分なfieldは拒否する。approve/rejectはpayloadとmerge targetを持たず、editはpayloadだけ、mergeはmerge targetだけを持つ。

## First-value contract

`record`は`answerHash`、`usedCanonicalIds`、任意の`missingContext`を受ける。使用IDはそのrunでpromotionされたIDのsubsetであり、かつ現在のcanonical aggregateに実在しなければならない。answer textやsource bodyは入力schemaに存在しない。

`review`は`verdict: useful|not_useful`、任意の`missingContext`を受ける。最初のready source timestampからreview timestampまでの`elapsedSeconds`と`withinTargetSeconds`を返す。targetは600秒である。

## Verification scenarios

- warm path fixture: Drive相当のready receiptをingestし、observed project/personをapproveし、Graph検索で確認する。
- fallback fixture: 明示したsingle documentだけでrunを進める。
- unavailable path: authorization待ち/timeoutをempty readyへ変換しない。
- security negatives: secret key/value、body field、oversized permission、source identity mutationを拒否する。
- review negatives: inferred approval、invalid batch、unknown candidate、terminal mutation、unpromoted first-value IDを拒否し、canonical filesが不変である。
- retry/recovery: duplicate ingest/reviewがduplicate canonical factを作らず、unknown ledger schema、permission snapshot不整合、source/receipt mode不一致、candidate identity/backlink欠落、merge元のobservation class・kindまたはtargetとの関係不整合、review status/decision/promotion ID不整合、canonicalに存在しないpromotion ID、lock failureを全公開操作でfail loudする。sidecarは大文字小文字を区別せずcanonical・lock・staging・transaction管理pathと衝突してはならず、Windows形式のseparator、drive/UNC absolute path、親directory traversalも拒否する。
- stdio E2E: MCP list/callから5 toolの一連のflow、verdict、600秒判定まで確認する。
