# Meeting minutes edit and withdraw UI v1

このSpecは [story-meeting-minutes-edit-and-withdraw-ui-v1](../stories/story-meeting-minutes-edit-and-withdraw-ui-v1.md) の最小実装契約を固定する。

## 共通コア

- `withdraw_minutes(input, context)` は、会議と文書への `can_write` に加えて、`context.principal_id === document.created_actor_id` を求める。一致しなければ `authorization_denied`。
- 取り下げ済みの文書を作った本人が取り下げ直した場合は、今どおり記録を変えずに同じ結果を返す。

## ローカルの HTTP

- `POST {base}/{meeting_id}/minutes/{minutes_id}/withdraw` に body `{ expected_revision }` を送ると、`withdraw_minutes` を呼んで詳細を 200 で返す。
- 会議に指定の文書が無ければ `not_found`。

## UI のオプション

```ts
type CurrentPrincipalId = string | (() => string | null | undefined);

interface MeetingMinutesUIOptions {
  currentPrincipalId?: CurrentPrincipalId;
}
```

- `currentPrincipalId` が空でない文字列を返すときは、文書の `created_actor_id` と一致する場合だけ［取り下げる］を出す。一致しない場合は「取り下げられるのは、この議事録を作った人だけです。」を灰色で出す。
- 省略時と、関数が空を返すときは、書き込める人に［取り下げる］を出す。断るかどうかはサーバーが決める。
- 編集は `canEditMinutes` が真で、選んでいる版が最新で、`body` が文字列で `source_ref` が無く、文書が取り下げられていないときだけ出す。保存は今の経路 `POST {base}/{meeting_id}/minutes/{minutes_id}` に `{ body, expected_revision }` を送る。
- 取り下げは `POST {base}/{meeting_id}/minutes/{minutes_id}/withdraw` に `{ expected_revision }` を送る。成功したら一覧と詳細を読み直す。

## 表示

- 見出し：題名、ラベル、日時と参加者。その下の操作の帯には、状態の印、［この版を確認済みにする］、［編集］、［取り下げる］を置く。
- 本文の下：`第n版（最新）・{作成日時}`。版が2つ以上なら［版の履歴（n件）］。
- 本文の先頭の行が `#` の見出しで、NFKC 正規化して空白を除いた文字列が会議の題名と同じなら、その行を描かない。
