# テナント本番プロビジョニング制御面のArchitecture

## 目的と判断

本番テナントの登録を、個別の管理画面操作やproviderごとの手作業ではなく、再実行可能な宣言を受け取るBrainbase制御面として扱う。制御面は「検証→claim永続化→transaction／lock解放→bounded外部検証→fresh transactionでclaim fencing→適用→読戻し」を一つの操作相関へ束ねる。

この変更では、テナントの識別・履歴、workspace接続、契約、操作ledgerをBrainbase PostgreSQLの正本とする。Graphはcanonical projectや既存entityの解決・検証境界であり、プロビジョニングの重複抑止やrevision履歴の正本ではない。秘密管理はSecret Manager／Infisical等の外部境界を正本とし、制御面はopaque referenceのみを受け取る。

## 責務と境界

### Provisioning Coordinator

宣言を正規化してfingerprintを作り、schemaが利用可能か、実行actorが許可されているか、対象tenantとdeploymentが一意かを先に検証する。操作ledgerを最初の永続化境界として確保し、同じ宣言の再実行を既存結果へ収束させる。副作用を行う順序と失敗分類を所有する。ledgerのclaimは短いDB transactionで確定し、Graph／credential resolverはtransactionとadvisory lockの外でbounded timeout付きに実行する。

### Control-plane Repository

テナント識別子、revision履歴、workspace接続のrevision、契約revisionへの参照、service actor／capability、操作ledgerをPostgreSQLで管理する。claim確保と最終適用は別々の短いtransactionとし、その間のGraph／credential／OAuth外部呼出し中はDB transactionもadvisory lockも保持しない。workspace接続の最終適用では、`workspace_connection_revisions`へ不変snapshotを先に追加し、その同じfresh transaction内で`workspace_connections`のcurrent pointerを進める。current pointerは既存snapshotだけを指し、credential／usage／receipt等のrevision FKはhistoryへ向ける。履歴から可変current rowを親参照する旧方向のFKは持たず、過去のtenant-owned recordが新revisionで壊れないようにする。契約payloadの宣言的upsertは既存 `tenant_contract_revisions` の状態を確認してから別実装レーンで追加する。

### Graph Verification Boundary

本番workerは `createPostgresGraphProjectResolver` を使い、専用のread clientでcanonical projectsをbounded timeout付き・read-onlyで一意解決し、宣言されたproject境界と一致することだけを確認する。Graph障害、未登録、複数候補、別projectはすべて有効化前に停止する。サービスactorをGraphの `person` として登録しない。サービス権限の組合せはControl-plane Repositoryが所有し、Graphへは必要な既存project参照だけを渡す。

### Secret Boundary

provider credential、OAuth token、署名秘密鍵、service token本文は制御面の入力・DB・Graph・ログ・Receiptへ流さない。プロビジョニング入力はopaque credential reference、credential mode、refresh revision、public key ID／fingerprint等の非秘密metadataに限定する。実値の取得はruntimeが認証済みのSecret Manager境界で行う。

### Activation and Readback

有効化は、schema確認、永続化済みclaim、Graph検証、credential reference検証、service capability検証が完了し、fresh transactionで同じclaimをfencing確認した後だけ可能とする。各段階はoperation IDに紐づけ、失敗時にはclaimでfencingされた失敗状態を残して再実行可能にする。migration applyは明示的な `--approve-apply` と実行actorを要求し、actorをDB migration ledgerの `applied_by` に保存する。本番適用の承認とreadbackはrollout receiptへ固定する。完了判定はCLIの終了コードではなく、DBのledger、各revision、registry、Graph検証、秘密境界のreadbackを照合して行う。

## 依存方向

```mermaid
flowchart LR
  M[宣言manifest] --> V[Provisioning Coordinator]
  V --> S[Schema contract]
  S --> C[短いClaim Transaction]
  C --> U[Commit / Lock解放]
  U --> G[Bounded Graph Verification]
  U --> K[Bounded Secret Verification]
  G --> F[Fresh Transaction / Claim Fencing]
  K --> F
  F --> A[Snapshot追加 / Current更新 / Activation]
  A --> Q[Readback / Receipt]
```

CoordinatorはGraphやSecret Managerの実装詳細を所有せず、検証結果とopaque referenceを受け取る。GraphやSecret Managerが利用不能な場合に別deployment、別tenant、推測したproject、別credentialへfallbackしない。

## 操作シーケンス

1. CLIまたは管理APIがmanifestとidempotency keyを受け取る。
2. Coordinatorがmanifestを正規化し、秘密らしいキー・値を拒否してdesired-state fingerprintを算出する。
3. Schema contractと実行actor/capabilityをread-onlyで確認する。
4. 操作ledgerをkeyとfingerprintへ原子的に紐づける。claim token hashとattemptを保存し、既存成功なら結果を返し、fingerprint不一致ならconflictにする。`failed`は同じkey・同じfingerprintに限り新しいclaim tokenで再claimでき、`claimed`のstale claimはfencingして旧実行の完了を拒否する。
5. Graphのcanonical projectとcredential referenceを、claim transactionをcommitしてlockを解放した後に境界越しで検証する。検証不能なら短い失敗更新でledgerをfailedにし、DB副作用を開始しない。
6. fresh transactionとtenant advisory lockを取得し、同じclaim token hashとattemptが現在の所有者であることをfencing確認してから、tenant識別子・revision履歴、接続snapshot／current pointer、service registryを確定する。既存contract revisionの境界は確認するが、契約payloadが未指定なら推測せず次レーンへ渡す。
7. capability境界を再確認し、manifestから消えたcapability grant／JWKをrevokedへ遷移させてreadbackする。DB副作用失敗時はrollbackし、別の短いtransactionで同じclaimにfencingされたledgerだけをfailedへ遷移させる。
8. DB、Graph、registry、ledgerをoperation IDでreadbackし、秘密値を含まないreceiptを返す。

## Slack OAuth導入シーケンス

1. 認証済みtenant adminまたは事前登録connectionに結びついた単回intentを検証し、callbackのrequest digest、exchange claim hash、attemptを短いtransactionで永続化する。
2. claim transactionをcommitしてlockを解放してからSlack OAuth token exchangeを一回だけ呼ぶ。完了済みledgerのreplayは保存済み結果を返し、同時処理中のcallbackは外部exchange前に抑止する。
3. exchange後はfresh transactionを開始し、同じclaim、request digest、intent、tenant、workspace、appをfencing再検証する。別tenant／workspace／appとの既存接続衝突はfallbackせず拒否する。
4. `workspace_connection_revisions`の不変snapshotを追加してからcurrent pointerを進め、opaque credential reference保存、intent消費、exchange ledger完了を同じtransactionで確定する。
5. exchange失敗はclaimに対応するfailed状態として記録する。同じbindingとrequest digestの再試行だけが新claimを取得でき、旧実行の遅延完了は`INSTALLATION_CLAIM_STALE`として拒否する。

## 失敗と復旧

- schema未適用・hash不一致・DB到達不能: 計画またはschema状態で停止し、既存tenantへ書き込まない。
- tenant／project／credentialの不一致: denyとして記録し、候補を横断検索しない。
- Graph／Secret Managerのunavailable: unavailableとして記録し、0件や成功へ丸めない。
- DBトランザクションまたは外部検証失敗: その操作のDB副作用をrollbackし、現在claimでfencingした安全な失敗状態を短いtransactionで残す。同じkey・同じfingerprintの再試行は外部呼出し前に新claimを永続化し、旧claim token、別fingerprint、別binding、旧callbackの完了を拒否する。
- provider側副作用が伴う将来拡張: provider callをDBトランザクション内へ隠さず、独立したoutbox／compensation契約をArchitecture変更として先に承認する。

## 運用上の不変条件

- tenantの正本キーは入力境界から全リポジトリ操作へ一意に伝播する。
- revision履歴は不変で、現在値の更新が過去の書込みの参照を壊さない。
- 外部resolverとOAuth token exchangeは、対応するclaimが永続化される前にも、DB transaction／advisory lockを保持したままにも実行しない。
- current pointerは既存の不変revision snapshotだけを指し、依存するcredential／usage／receiptはhistory revisionを参照する。
- 同一tenant・provider・workspace・appの有効接続は一つだけである。
- service actorは人物ではなく、明示的なactor／capability registryの主体である。
- 秘密値はSecret Boundaryの外へ出ない。
- 未確認、部分適用、障害を成功や0件として確定しない。

## 変更対象外と別承認

実際の本番DBへのmigration apply、provider credential発行、Graph ontologyの新しい人物種別、Cloudflare／mana-runtimeのデプロイ、Slack配送の切替はこのArchitectureの実装PRでは実行しない。それぞれの環境証跡と承認を別途要求する。
