# NocoDB Canonical Task project binding architecture

## 境界

`CanonicalTaskNocoDBRepository`がNocoDB固有の列形式をCanonical Task契約へ変換する。
上位serviceとHTTP routeは既存の`project_codes` / 反復`project_code`契約を維持する。

## 読み取り

1. `project_codes`を優先して配列へ正規化する。
2. 値がない場合だけ移行前の`プロジェクトコード`、`プロジェクト`、`project_code`を読む。
3. 空白値を除き、入力順のまま重複を除く。
4. 一覧条件は要求コードとの配列overlapで判定する。

## 書き込み

create/updateで値が明示された場合だけ、正規化後の配列をJSON文字列として
`project_codes`列へ送る。未指定の更新で既存値を消さない。

## 失敗境界

このコードは列を自動作成しない。実NocoDBに`project_codes`列がない状態で複数コードを
書き込むとNocoDBが拒否するため、列追加とbackfillは配備前の別運用として確認する。
読み取りは旧単一列へ限定フォールバックし、情報なしを任意のプロジェクトへ推測しない。

