# SNS reader と curator テストの境界

正本は [SNS廃止仕様](retire-sns-spec.md)。この変更はテストを分けて廃止対象の結合範囲を明示し、個人KGの所有者・組織境界のテストを保持する。実行コードや保存データは変更しない。

## 受け入れ条件

1. `personal-knowledge-graph-reader.test.js` に reader の4テスト（S-1、S-2、S-2b、S-2c）を保持する。S-2内の `sns-curator` 候補除外も維持する。
2. reader と curator をつなぐ既存のS-3テストを `tests/sns/curator/scenarios/personal-kg-seed.test.js` へ移し、振る舞いを変えない。
3. 分割後も既存の5テストがすべて実行され、readerテストから curator 実装・curator test helper への import をなくす。reader用の `viewer` fixture は局所定義とする。
4. 既存の `retired-state-boundary` CI が reader テストと curator テスト群を実行する。
5. 実行コード、SNS廃止の境界、保存台帳には変更を加えない。

## 検証

変更前後に reader テストと `tests/sns/curator` を実行し、5件を含む既存テストが保持されることを確認する。新しい統合テストの追加や既存テストの削除は行わない。
