---
name: vibepro-internal-workflow
description: 社内リポジトリが明示的にVibeProを使う場合の、軽量なStoryから通常PRまでの流れ。
---

# VibePro Internal Workflow

## 目的

社内の依頼や不具合を、一つの利用者価値、最小のSpec、実装、影響範囲のテスト、通常のGitHub PRへつなぐ。

## 実行手順

1. 依頼元のIssue、NocoDB、Storyから目的と受け入れ条件を確認する。
2. 作業中の差分を壊さないbranchまたはworktreeを使う。
3. 必要なStoryと最小のSpecだけを更新する。境界や契約が変わる場合だけADRを更新する。
4. 対象テストで期待する振る舞いを固定し、実装する。
5. 影響範囲のテストを実行し、対象リポジトリの通常手順でGitHub PR、CI、レビュー、mergeへ進む。
6. 依頼元の状態更新は、求められた範囲で実結果を確認して行う。

## 廃止済みルール

`vibepro pr prepare` の反復、Gate DAG、証跡登録、強制並列レビュー、review lifecycle、`vibepro pr create`、`vibepro execute merge` を必須にしない。旧成果物の不足を新しい作業へ変換しない。

## 検証

完了判断は受け入れ条件、実際の差分、影響範囲のテスト、通常のCI／レビューで行う。未確認や外部未反映は成功に丸めない。
