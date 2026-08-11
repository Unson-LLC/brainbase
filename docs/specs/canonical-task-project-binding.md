# Canonical Task project binding

Canonical Taskは `project_codes: string[]` を保持する。これはGraphのproject codeを参照する
分類属性で、Task本文の正本は引き続きPostgreSQL `canonical_tasks` とする。

## API contract

- Create: `project_codes` は任意の文字列配列。空白を除去し、入力順を維持して重複排除する。
- List: `project_code` は複数指定でき、いずれかに一致するTaskを返す（OR / array overlap）。
- Response: `project_codes` を返す。旧データは空配列とする。
- project filterは既存の認証・owner scopeを置き換えず、その内側で適用する。

## Storage

`canonical_tasks.project_codes TEXT[] NOT NULL DEFAULT '{}'` とGIN indexを追加する。
既存行は未分類の空配列となり、明示的なbackfillまでproject-scoped projectionには表示しない。
