# Local SSOT Atomic Commit Architecture

## Current reality

変更前のpublic contractは4 canonical filesとOntology aggregate validationを持つ一方、保存は独立した複数writeだった。そのため、別processの同時更新ではlock内の最新値から再計算されずlost updateが起こり得て、途中失敗ではBrainbase readerが新旧混在を観測し得た。今回の変更対象は、この既存形式を維持したままread/writeのruntime pathへ一つのtransaction境界を置くことに限定する。

## Decision

既存4ファイルをcanonical contractとして維持し、同一host上のprocess間lockとrecoverable transaction directoryでBrainbase read/writeを直列化する。write境界は個別file helperではなく、現在aggregateをlock内で再読込し、変更・Ontology検証・4ファイル公開を一つに扱う`mutatePersonalOs`とする。

## Transaction protocol

1. `mkdir`の排他性でdata directory専用lockを取得する。owner token、PID、hostnameを記録する。初回作成もdata directoryを作成してから同じlockを取得する。
2. recovery対象として登録済みの未完了transactionがあれば、`COMMITTED` markerのない通常mutationはbackupからrollbackし、初期化transactionは完全な`next` snapshotへroll forwardする。marker済みなら新状態を維持して残骸だけ除去する。
3. lock内で4 canonical filesを読み、mutatorが次aggregateを作る。aggregate mutation境界自身がOntology検証を行い、callerの任意規約にはしない。
4. transaction root配下の未登録`.staging-<uuid>` directoryに、通常mutationでは完全な`previous/`と`next/`、初期化では完全な`next/`とmode metadataを書く。`PREPARED` markerまで揃ってから、同一filesystem上のatomic directory renameで`<uuid>`へ変更し、初めてrecovery対象として登録する。
5. 登録後、recovery用`next` snapshotを消費せず、各`next` fileをcanonical directory内のtemporary fileへcopyし、そのtemporary fileをcanonical pathへrenameする。
6. 全file公開後に`COMMITTED` markerを書く。marker前の通常mutationの例外は完全な`previous`へrollbackし、初期化の例外は保存された完全な`next`へroll forwardする。
7. transaction directoryと、自分のowner tokenに一致するlockだけを除去する。

各fileのrenameはatomicだが4回のrename全体はOS primitiveとしてatomicではない。そのためBrainbase readerも同じlockを取得し、未完了transactionの回復後だけ読む。これによりBrainbase API/CLIからpartial stateは観測されない。lockを無視するraw file readerは保証境界外である。

`.staging-*`はcanonical fileを一切変更する前の未登録準備物である。準備途中でprocessが停止してもrecovery対象とは見なさず、次のlock ownerが安全に削除する。これにより不完全なbackupを登録済みtransactionとして解釈するwindowを作らない。

`initializePersonalOs`は、4 canonical filesがすべて存在する場合はno-opとする。すべて存在しない初回は空の完全aggregateを初期化modeでcommitする。canonical filesが一部だけ存在するlegacy/破損状態は空値で補完せずfail loudする。初期化transactionが登録後・`COMMITTED`前に停止した場合は、完全な`next` snapshotへroll forwardして部分初期化を解消する。

## Lock recovery

- 同一hostnameでowner PIDが生存中なら待機し、timeout後はfail loudする。
- 同一hostnameでPIDが存在しないlockだけをstale候補とする。
- stale lockはunique quarantine pathへのatomic renameに成功したprocessだけが除去する。
- hostnameが異なるlockは安全に生死判定できないため自動削除しない。
- owner metadataが生成途中の場合は短時間待機し、即座に奪わない。

## Dependency and compatibility boundaries

- `src/ssot.ts`がfilesystem transactionとschema serializationを所有する。
- `src/cli.ts`の3 write flowはmutator内で現在値から予定aggregateを再計算する。`src/ssot.ts`のaggregate mutation境界がOntology guardを同じlock内で必ず実行する。
- `loadPersonalOs`はlock/recovery付きpublic readerとし、transaction内部だけlockなしreaderを使う。
- canonical fileを個別に保存するserialization helperはtransaction内部のnon-exported実装とし、外部callerがatomicityを迂回できないようにする。
- `initializePersonalOs`も同じlock/recovery protocolを所有し、CLI、MCP、onboarding各経路で別実装を作らない。
- file名、JSON/JSONL shape、source countingは変更しない。
- hidden lock/transaction directoryはcanonical factではなく、回復用runtime metadataである。

## Review ownership and PR boundary

このPRは「4 canonical filesを一つのOntology-valid aggregateとしてcommitする」という一つのpublic storage contractを、実装、3つのpublic writer、回復fixtures、利用者向けREADMEまで同時に成立させる単位である。分割すると実装だけが先に入り、公開contractまたはfailure semanticsが欠けるため、同じStoryでレビューする。

- product requirement owner: Storyと12 acceptance criteriaが利用者価値と保証範囲を定義する。
- architecture/spec owners: transaction、lock、recovery、compatibility、threat modelを相互に照合する。
- implementation reviewers: code/spec alignment、runtime contract、regression riskを検査する。
- gate evidence reviewer: current HEADのtest/build、adjudication、review lifecycleがPR作成条件を満たすかを独立に確認する。
- final human owner: OSS maintainerがPR diffとGate evidenceを確認し、mergeおよびnpm publishを別判断する。

READMEはraw file readerが保証外であることと、Brainbase API/CLI経由のatomic read/write contractを利用者へ伝えるpublic contractの一部であり、実装と同じreview boundaryに含める。

## Failure semantics

- validation error: transaction staging前に拒否し、canonical fileを変更しない。
- normal mutation publish error: 完全な`previous`へのrollbackを試み、元のerrorを返す。rollback失敗時はtransactionを残し、次回read/writeで再試行する。
- normal mutation crash before `COMMITTED`: 次回accessで完全な`previous` aggregateへrollbackする。
- crash during unregistered staging: canonical stateは未変更なのでstagingだけを削除する。
- initialization publish error or crash before `COMMITTED`: recovery用に保存された完全な`next` aggregateへroll forwardする。
- crash after `COMMITTED`: 次aggregateを維持し、残骸を清掃する。
- lock timeout/foreign host lock: 推測で破壊せず、data directoryを含むerrorで停止する。
- read surface error: 通常のCLI/MCP readerはerrorを伝播する。Ontology auditだけは既存のevidence-safe contractに従い、入力未確認を`status: unverified`へ変換する。

## Done evidence

完了は文書の存在ではなく、current HEADに結び付いた次の証跡がすべて揃った状態とする。

- focused testが通常commit、別process concurrency、初回init、rollback/roll-forward、lock recovery、legacy 4-file compatibilityを通す。
- CLI/Ontologyを含むfull test suiteとbuildが通る。
- 12 acceptance criteriaのevidence adjudicationと共通judgment spineの独立adjudicationがcurrent HEADをsoundと判定する。
- architecture/spec、implementation、PR-final gateのrequired agent reviewsがpassし、各review agentのclose lifecycleが記録される。
- VibePro `pr prepare`がPR作成可能と判定する。mergeとnpm publishはこのStoryの完了条件に含めず、OSS maintainerの別判断とする。
