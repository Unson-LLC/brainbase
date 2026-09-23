# JudgmentProblem snapshot 仕様

- Story: `story-company-os-problem-snapshot-v1`
- 状態: Story05 の最小実装仕様（依存する共通型の提供前）
- 所有: OSS `brainbase`。保存先は呼び出し側が所有するローカル root とする

## 目的

`JudgmentProblem` は、ひとつの判断で参照した問い・範囲・目的・世界モデル・制約・権限・資源・期限を、元の正本の代わりにすることなく、不変の参照束として残す。現在の正本が更新されても、過去の判断条件は読戻せる。スナップショットは実行許可を発行しない。

## 依存境界

Objective、Variable、Model、Constraint と、それらの版・適用範囲・用途検証は Story01〜04 が提供する共通契約を参照する。本仕様ではそれらの意味や保存型を再定義しない。観測・証拠・権限・資源・期限も、各正本または provider が返す不変参照を受け取るだけにする。

## 入力契約

```ts
type ProblemReferenceKind =
  | 'objective'
  | 'criterion'
  | 'variable'
  | 'observation'
  | 'model'
  | 'constraint'
  | 'authority'
  | 'resource'
  | 'deadline'
  | 'dag'
  | 'evidence';

interface ProblemReference {
  kind: ProblemReferenceKind;
  id: string;
  revision: string;
  digest: `sha256:${string}`;
  scope: { type: 'personal' | 'project' | 'organization'; id: string };
  valid_from: string;
  valid_to?: string | null;
  evidence?: EvidenceBinding;
}

interface EvidenceBinding {
  mode: 'embedded_content' | 'immutable_reference';
  digest: `sha256:${string}`;
  reference_id?: string;
  reference_revision?: string;
  content?: JSONValue;
  access: FoundationAcl;
}

interface FoundationAcl {
  ownerId: string;
  visibility: 'private' | 'project' | 'organization' | 'public';
  readerIds: readonly string[];
  writerIds: readonly string[];
}

interface JudgmentProblemSnapshot {
  snapshot_version: 'judgment-problem-snapshot.v1';
  problem_id: string;
  revision: string;
  question: string;
  owner_scope: { type: 'personal' | 'project' | 'organization'; id: string };
  references: readonly ProblemReference[];
  read_policy: FoundationAcl;
  execution_permission: 'none';
  created_at: string;
}

interface SnapshotAccessContext {
  principal: string;
}

interface LoadReferenceOptions {
  /** `current` is the default; both modes require a provider, with different validation phases. */
  reference_resolution?: 'current' | 'historical';
}
```

`digest` は参照元の版と使用内容を結びつける。可変な証拠は `embedded_content` または provider が保証する `immutable_reference` のどちらかで固定し、いずれも内容 hash と元の読取境界を保持する。秘密値や bearer token をスナップショットへ埋め込まない。

`immutable_reference` は `reference_id`・`reference_revision` を必須とし、保存・読取の各段階で evidence reference として `referenceProvider` に解決させる。provider が解決できない場合は成功扱いにしない。

## 保存

保存は caller-owned root の content-addressed artifact とする。同じ `problem_id`・`revision` に同じ正規化内容を保存した場合は既存として返す。同じ識別子に異なる内容を保存した場合は `conflict` として拒否する。新しい条件は同じ案件の新しい revision とし、以前の bytes を変更・削除しない。

保存前に次を検証する。Model／Constraint の意味・適用範囲・用途の判定は、この層で再実装せず `referenceProvider` に委譲する。

- 必須の問い、owner scope、Objective と基準、観測・Model、Constraint、authority、resource、deadline の参照が揃っている
- 各参照の版、hash、scope、validity が正規化された値である
- Model と Variable が今回の scope・期間に適用可能で、必須 Constraint に未解決がない
- 保存者が `read_policy` と対象範囲に書き込める。ACLの現在の権限は `accessProvider` で再確認し、参照する evidence は保存時にも read 権限を確認する
- `execution_permission` は常に `'none'` である

欠落参照、適用外 Model、未解決の必須条件は保存しない。推測で 0 や成功へ補完しない。

## 読取

読取は `snapshot_id` または `problem_id`・`revision` と `SnapshotAccessContext` を受け取る。保存時の `read_policy` と evidence の ACL を `accessProvider` で再評価し、readable でなければ `unauthorized`、artifact がなければ `not_found`、参照先の必須条件が現在の用途に適用できなければ `not_applicable`、欠落していれば `missing_reference`、解決不能なら `unresolved_constraint` を返す。アクセス境界を caller の都合で広げない。戻り値は再帰的に凍結した snapshot とする。`reference_resolution` は省略時の `current` と、保存済みの参照束を監査・再現する `historical` を選べる。どちらのモードも `referenceProvider` を必須とし、provider 欠落は fail-closed にする。

スナップショット本文の過去条件再現と、参照先正本の現在 ACL は別の境界として扱う。スナップショットの bytes、参照ID、revision、digest、埋込み証拠は保存後に変更・削除しない。`current` では canonical reference provider が読取時にも現在の正本ストアの ACL、用途、適用範囲を検証するため、現在の正本を再解決できない場合は `unauthorized`／`not_applicable`／`unresolved_constraint` を返す。これは新しい判断で参照を再利用できるかを確認する経路であり、過去の snapshot 本文を再現する経路とは分ける。`historical` でも provider を `historical_read` phase で呼び、canonical 正本の現在 read ACL と、要求した revision の digest を必ず確認する。ACL失効またはrevision/digest不一致は `unauthorized`／`integrity_mismatch` で拒否する。一方、当時の監査条件を再現するため、保存時の用途承認、適用範囲、validity/expiry は再評価しない。embedded content はsnapshot内の不変コピーだが、親referenceの現在ACL確認を迂回できず、canonical ACL失効後にそのコピーだけをhistorical readすることはできない。`historical` の結果を現在の判断・実行の適用可否へ流用してはならず、実行権限も付与しない。

`referenceProvider` は canonical store との trusted boundary である。Foundation adapter は `save`／`read` では FoundationUse と参照scopeを検証し、`historical_read` ではそれらの過去条件検証だけを省略する。全phaseで store の read は現在のACLを評価し、exact revision/digestを返さなければならない。providerは caller が渡した `authorized` 相当の値を信用せず、認証済み principal を使ってこの契約を満たす。

読取は判断条件の再確認に限定し、runner、resource reservation、external action、approval のいずれも開始しない。authority reference は判断時に観測した根拠であって、現在の権限確認や実行許可ではない。

## エラー契約

```ts
type JudgmentProblemSnapshotErrorCode =
  | 'invalid_request'
  | 'missing_reference'
  | 'not_applicable'
  | 'unresolved_constraint'
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'integrity_mismatch'
  | 'storage_io_error';
```

エラーは具体的な `code` と、欠落または不適用になった reference の識別情報を持つ。`unauthorized`、`not_found`、`not_applicable`、`missing_reference` を成功や空データへ変換しない。

## 受入シナリオ

1. すべての参照を含む snapshot を保存し、同じ `problem_id`・`revision`・access context で内容を再読できる。
2. 元の Objective や Model を更新しても、保存済み snapshot の revision、hash、embedded content は変わらない。
3. 同一 revision への異なる payload は conflict になる。新条件は新 revision へ保存できる。
4. 欠落・適用外 Model・未解決 Constraint を含む payload は保存できず、具体的な原因を返す。
5. owner scope 外の reader は保存・読取とも unauthorized になり、read policy を変更して読めない。
6. snapshot を読み取っても execution permission は付与されず、実行 API は別途現在の authority を検証する。
