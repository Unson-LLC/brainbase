# BrainbaseからVibeProへ成果契約を引き渡す

## Storyと今回の範囲

開発を依頼する利用者として、Brainbaseで決めた成果とVibeProの技術受入条件を同じ案件として引き継ぎ、引渡し成功を成果達成と取り違えずに開発を進めたい。

今回の単位は、発行ライブラリと既存の受取処理を接続するローカル契約試験である。本番の認証済みデータ取得・発行経路は次の単位とし、今回の成功から推定しない。

## 設計判断

- BrainbaseがOutcomeCaseの成果を保持し、採用済み判断のsnapshotから引渡しデータを組み立てる。VibeProは技術作業用の投影を保持する。Manaを必須経路にはしない。
- 既存の `brainbase-vibepro-managed-handoff.v2` とHMAC-SHA256を使う。新しい署名基盤やHTTP APIを作らない。
- 発行関数は純粋関数とする。入力snapshotの認証・取得権限は呼出元の責務であり、入力の相互整合性検証を認証の代用にはしない。
- 共有鍵の署名は同じ信頼範囲内での改ざん検知であり、鍵を持つ受信者に対する独立した発行者証明ではない。
- `brainbase://` は既存wire形式の論理参照であり、解決可能なAPIや実際の読戻しの証明とはしない。
- `authorized` と `graph_promotion_allowed` は常にfalse。発行も受取も外部操作、OutcomeCase更新、閉鎖を行わない。

## 最小Spec

1. OutcomeCase、判断、対象repositoryのcase/projectが整合する場合だけ発行する。OutcomeCaseの成果文を保持し、判断snapshotのcanonical SHA256を `decision_digest` に入れる。
2. 技術受入条件と本番確認手順は明示入力とし、欠落・空値・重複IDを拒否する。成功状態や実施済みの証拠を生成しない。
3. 対象HEAD、期間、鍵、識別子を検証する。canonical化不能な入力を曖昧に変換しない。
4. 発行した実データをVibeProの既存 `bindBrainbaseContext` へ渡し、同一の7項目が投影されることを確認する。技術完了はfalseのままとする。
5. 改ざんされたデータを拒否する。出典不足をconfirmedへ昇格しない。既存v1受取の回帰試験も行う。

## 作業分担と検証境界

- Terra A: Brainbase発行関数と単体テスト。
- Terra B: VibeProの既存受取処理を使ったリポジトリ間契約テスト。
- 親: 契約採用、独立テスト実行、差分確認。

外部依存の契約テストは `BRAINBASE_PRODUCER_MODULE` で発行モジュールを指定する。未指定時はskipを明示し、接続成功と報告しない。CIへの両リポジトリ取得配線、本番データ取得経路、鍵の配備、実メンション・議事録の外部読戻しは未実施として残す。

## 2026-09-04 ローカル検証

- Brainbase: 新規発行処理15件と既存OutcomeCaseサービス22件、計37件成功。
- VibePro: 既存受取処理39件成功。v1互換、不正署名、期限、保存元欠損等を含む。
- 接続試験: 発行モジュールを明示指定し、実OutcomeCaseサービス → 発行関数 → VibePro受取・投影の3件成功。保存はメモリ内、権限・参照照会はテスト用実装であり、本番認証の証拠ではない。
- 親レビューで、非JSON入力の曖昧な署名を拒否する修正を採用。共有canonical処理や既存consumer本体は変更していない。

再実行はBrainbaseで `npm run test:run -- tests/server/services/outcome-case/vibepro-managed-handoff.test.js tests/server/services/outcome-case-service.test.js`、VibeProで `node --test test/brainbase-integration.test.js`。接続試験はVibeProで `BRAINBASE_PRODUCER_MODULE=<Brainbase checkout>/server/services/outcome-case/vibepro-managed-handoff.js node --test test/brainbase-producer-contract.test.js` を実行する。

この結果はローカルライブラリ間の契約受入であり、リリース・本番接続・利用者成果の完了ではない。

## 認証済み取得への接続：保存元の不足を隠さない

調査で、既存のJudgment receiptにはcaseとの結合、対象repository、技術受入条件、本番確認手順、組織の所有情報がないことを確認した。resolution_idによる保存済み判断の取得APIもない。前節のdecisionは試験用snapshotであり、現行Resolverの保存形式ではない。

このため、現行receiptへ呼出元の任意項目を追加して「採用済み判断」として署名する実装は採らない。保存済みの採用情報を取得する境界を先に実装する。取得元が未設定なら発行は不可とし、動かないHTTP APIや空の成功応答は追加しない。

### 取得サービスのSpec

1. 公開入力はcaseIdとresolutionIdのみ。snapshot、対象repository、鍵、期限、権限の上書き入力を拒否する。actorは認証層から別引数として受け取る。
2. confirmedな組織文脈を必須とし、既存OutcomeCaseService.readで認証済みのcaseを取得する。戻り値のcase_id、organization_id、project_codeをactorと完全一致で照合する。失敗時は採用情報の取得も署名も行わない。
3. 採用情報はサーバー構築時に渡すreadAdoptedHandoffだけから取得する。case/resolution/project/organizationとOutcomeCaseのrevisionを保存済みレコードと照合する。未取得・別組織・別案件・古いrevision・未採用は拒否する。これは新しい保存元のインターフェースであり、既存Resolverが提供するという意味ではない。
4. 取得結果はdecision、target、technicalAcceptance、productionProbeを持つ。decisionはこの引渡し用の採用snapshotであり、通常のTurn receiptとの同一視は禁止する。将来の永続化では元receiptと採用snapshotの参照関係・所有権を保持する必要がある。
5. 鍵・keyId・時計・有効期間は構築時に固定する。発行処理は既存の純粋関数を使い、OutcomeCaseの変更・閉鎖、Graph昇格、外部操作を行わない。
6. 取得元未設定は503相当とし、テスト用取得元による成功を本番取得経路の完成と報告しない。認証済みの永続化・読戻し・HTTP接続は未完了として明示する。

### 取得サービスの実装・検証結果

- `createVibeproHandoffIssuer(...).issue({caseId, resolutionId}, actor)`を追加。actorは認証層から渡されることを前提とし、この関数自体はtokenを認証しない。
- 通常のTurn receipt単体、未採用、別組織・project・case・resolution、古いrevision、取得元未設定を拒否する。鍵の設定ミスや時計の例外は取得データの不正と混同せず、内部情報を含まない設定エラーにする。
- 発行期間は既定5分・上限1時間のローカル設定とした。長期有効な署名を誤発行しないための保守的な上限であり、組織全体の承認方針や実測値を表すものではない。
- 親の独立実行で取得サービス19件、純粋発行15件、既存OutcomeCase22件、計56件成功。追加2件は修正前に失敗を再現した。
- VibePro接続試験は4件成功・skip 0。実OutcomeCaseServiceの読取→新取得サービス→純粋発行→VibeProの既存受取を接続し、7項目の維持と技術完了falseを確認した。DBと採用情報の取得元はメモリ内fixtureであり、本番認証の証拠ではない。

次の実装対象は、元の判断記録と成果案件・対象repository・技術条件の結び付きを、所有組織とrevisionを保持して保存・読戻しする経路である。現在はこの保存元がなく、HTTPへの配線もしていない。ライブラリと試験の完成を、認証済み発行APIや議事録・Manaメンションの成果達成と置き換えない。

## 元の判断記録の保存・読戻し：ローカル実装

上記の保存元を段階的に作るため、まずサーバーが生成した元の判断記録だけを保存する。採用済み契約の保存とは分ける。

### 保存契約

- `JudgmentReceiptPostgresRepository.record` は、認証済みの本人・組織・アクセス可能なprojectに結び付けて記録する。`findByResolutionId` も同じ範囲だけを読み戻す。複数projectに同じ識別子がある場合は曖昧な取得を拒否する。
- `judgment-receipt-schema.sql` は行単位のアクセス制限を強制し、更新・削除を拒否する。同じ識別子への再保存は上書きせず409とする。JSON内の識別子と保存列の欠落・不一致をDBでも拒否する。
- DB操作ごとに既存の認証文脈と本人識別子をトランザクション内へ設定する。コミット・ロールバック後の接続に権限情報を残さない。
- JSONへ変換すると消失・変質する値は保存前に拒否する。元記録を勝手に補完・正規化しない。
- 認証済みの既存 `/api/judgment/resolve` 登録に任意の `receiptWriter` を追加した。本人・組織・projectが確定した場合、サーバー生成結果の保存を待ってから応答する。保存失敗は503とする。保存対象外の文脈では既存の判断応答を維持し、保存済みとは主張しない。

ここで保存するのはResolverの応答試行であり、Hostが最終確定したjudgment episodeではない。同じ要求を再試行すると別のresolution_idになり得る。元記録の保存を、案件との結合や契約の採用、外部操作の承認へ昇格させない。

### 実装済みと未接続の境界

認証済みルートへの依存注入と、実PostgreSQLへの保存・本人による読戻しまでを検証した。通常起動の `registerApiRoutes` はまだwriterを渡さず、新SQLも本番のmigrationへ組み込んでいない。公開の読戻しAPI、本番DBへの適用、鍵の配備、発行APIは未実施である。

次に必要なのは、元記録とcase・対象repository・技術条件を結び付ける採用済みsnapshot、およびその採用権限の定義である。既存の案件閉鎖権限を、契約採用権限として自動流用しない。`readAdoptedHandoff` の実保存元は引き続き未接続である。

発行サービスのrevision照合は、取得時点のOutcomeCaseと保存された採用情報の一致を意味する。受信時の最新性や発行後の失効を保証する仕組みではない。

### 検証結果

- 親の独立実行で7ファイル107件成功、skip 0。元記録の単体15件、ルート24件、登録5件、実DB7件、既存発行・OutcomeCase56件を含む。
- 実DBでは非superuserかつRLSを迂回できないロールを使用。実Resolverから認証済みルート登録を経由した保存・読戻し、別人・別組織・別projectの不可視、更新・削除・重複保存の拒否、権限文脈の消去を確認した。認証tokenの検証器はテスト用であり、本番認証の検証ではない。
- 必須JSON項目の欠落をSQLのNULL判定が許してしまう問題と、JSON変換時の値の消失を、追加テストの失敗で再現して修正した。
- VibeProの既存受取39件も独立再実行で成功。この結果から本番稼働や議事録・メンション返信の成果達成は推定しない。

実DB試験は専用の一時DBに対し、`RUN_OUTCOME_CASE_DB_TESTS=1 OUTCOME_CASE_DATABASE_URL=<専用DBの接続先> npm run test:run -- tests/server/services/outcome-case-postgres-rls.integration.test.js` で実行する。通常のDBや本番DBを試験先に使わない。
