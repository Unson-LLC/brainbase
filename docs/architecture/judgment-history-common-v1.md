# 通常判断履歴の共通読取契約 v1

このパッケージは、入口ごとの既存receipt・journal・episodeを横断して表示するための正規化された読取契約を公開する。履歴用の新しい正本は作らず、`JudgmentHistorySource` が各入口の既存正本を投影する。

横断仕様は [brainbase-project の実装Spec](https://github.com/Unson-LLC/brainbase-project/blob/develop/docs/specs/judgment-history-end-to-end-v1.md) と [記録境界](https://github.com/Unson-LLC/brainbase-project/blob/develop/docs/architecture/judgment-history-recording-boundary-v1.md) が正本である。OSSは `JudgmentHistoryRecord`、`JudgmentHistorySource`、`createJudgmentHistoryReader`、`createLocalJudgmentHistorySource` を提供する。

local adapterは設定された本人journalだけを読み、未接続・破損・欠損を `coverage` と `missing_fields` に残す。value-proofは成果実証の別契約として維持し、通常判断履歴へ変換しない。組織・Mana・Hostは既存の認可済み正本から同じsource契約へ投影する。

この文書とOSSの型・readerは接続境界の実装を示す。入口横断、認可、実判断、本人画面、本番配備の受入は親Specに従い別途確認する。
