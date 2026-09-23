# Company OS reservations v1

## 目的

同じテナントの同じ資源について、承認済みの確保を単独所有者のローカル正本へ原子的に記録する。見積・承認・確保・消費は別の状態として扱い、資源の目的やモデルの正本をこの台帳へ複製しない。

## 公開契約

`@unson/brainbase-mcp/resource-reservations` が `ResourceReservationService` と契約型を公開する。

- `estimate` は容量portから現在の容量を読み、見積結果だけを返す。
- `approve` は注入された認可portの現在の承認結果を検証し、承認根拠を履歴付きで保存する。
- `reserve` は `approve` が返した承認IDを要求し、承認、Problem snapshotの固定参照、現在容量、テナント境界を同じSSOTロック内で検証して予約へ遷移させる。
- `release`、`cancel`、`consume` は状態遷移と履歴を同じ原子的更新で保存する。
- `readLedger` は現在の台帳を読み戻す。認可・容量・Problem snapshotの実装はportの責務とし、roles・budget・組織DBは実装しない。

すべての操作は `tenantId`、`principal`、`operationId`、資源、期間、量、単位、対象run、固定Problem snapshot参照を持つ。snapshot参照は Story05 の `problem_snapshot_id`（`sha256:<64桁hex>`）、`problem_id`、`revision` の組であり、Problem本文は保存しない。

### Problem snapshot storeとの接続

`ResourceReservationProblemSnapshotPort` は、Story05の実Storeをローダーとして注入して使う。予約側はProblem本文を保存せず、ローダーが読んだ固定snapshotの `problem_id`、`revision`、`owner_scope.id`、`execution_permission: 'none'` だけを照合する。読取ACL・内容アドレス・保存形式の検証はStory05のローダーが担当し、テナント境界と現在の実行認可は予約の各portが担当する。

```ts
import { loadJudgmentProblemSnapshot } from '@unson/brainbase-mcp/judgment-problem-snapshot';
import {
  createResourceReservationProblemSnapshotPort,
  ResourceReservationService,
} from '@unson/brainbase-mcp/resource-reservations';

const problemSnapshot = createResourceReservationProblemSnapshotPort({
  root: snapshotRoot,
  load: (input) => loadJudgmentProblemSnapshot({
    ...input,
    referenceProvider: snapshotReferenceProvider,
  }),
});
const reservations = new ResourceReservationService({
  dataDir,
  authorization,
  capacity,
  problemSnapshot,
});
```

`referenceProvider` はSnapshot側で既に構成したものを渡す。予約の新規 `estimate`・`approve`・`reserve` は `reference_resolution: 'current'` でこのproviderを必須とし、現在のread ACL、canonical参照の存在・用途適用、参照digestを検証する。監査・再現用のhistorical readは予約の実行経路とは別であり、現在のread ACL・snapshotの整合性・provider検証を維持したうえで、過去時点の用途・期限の再評価だけを省略する。

## 保存と不変条件

- 台帳は既存のcanonical SSOT lock/transactionを通じたJSON sidecarに保存する。
- 予約確保は、同じ資源・期間・単位・テナントの既存予約量をロック内で合算し、容量を超える場合は失敗する。容量不明も失敗する。
- 同一テナントの同一 `operationId` を同じpayloadで再試行すると保存済み結果を返す。payload（actionと `approvalId` を含む）が違えば `operation_conflict` で拒否し、量を増やさない。
- 別テナントから既存予約を指定する操作は `scope_mismatch` で拒否する。tenant境界をまたぐ台帳の読書きを許可しない。
- 承認の期限切れ・拒否・失効は確保を止める。外部作用開始済みの予約は期限だけで解放せず、照合待ちの状態を返す。
- Problem snapshotの固定参照は実行許可そのものではない。新規の見積・承認・確保ではcurrent参照検証と認可portを操作時点で再確認し、historical readは監査・再現経路でのみ使用する。

## 最小検証

実際の同一ローカルstoreを共有する2プロセスが、容量10に対して量8を同時に確保する。一方だけが成功し、台帳の確保量は10を超えない。同じ操作IDの再試行、異なるpayloadの衝突、期限切れ承認、越境操作、外部作用開始済みの解放拒否も、永続化後の読み戻しで確認する。
