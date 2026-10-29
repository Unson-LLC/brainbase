# 受信箱（段1）

Story: `story-inbox-stage1-v1`

## 読み取りの約束（ホスト → 共通UI）

共通UIは待っているものを自分で取りに行かない。ホストが次の port を渡す。Personal Web と組織版は、同じ形で返す。

```ts
type InboxGroup = 'answer' | 'approve' | 'triage' | 'task';
// 答える・決める / 承認する / 振り分ける・取り込む / タスク

interface InboxSource {
  kind: string;                 // 種類のID（例: assigned_task / memory_candidates / meeting_triage）
  label: string;                // 種類の名前（例: 新しく割り当てられたタスク）
  group: InboxGroup;
  status: 'ok' | 'unavailable' | 'not_connected';
  reason?: string | null;       // unavailable・not_connected の理由のコード
}

interface InboxItem {
  id: string;                   // 受信箱の中で一意。読み直しても変わらない
  kind: string;                 // InboxSource.kind
  group: InboxGroup;
  title: string;
  detail?: string | null;       // 1行の説明
  facts?: Array<{ label: string; value: string }>; // 名前つきの項目（例: 依頼 / 対象）。ホストの順で並べる
  href?: string | null;         // 重い判断をする元の画面
  receivedAt?: string | null;
  dueAt?: string | null;
  blocking?: boolean;           // 他の人やAIを止めている
  units?: number;               // この行が表す件数（まとめの行。既定 1）
  revision?: string | null;     // 中身が変わると変わる。古い版への片付けた・あとでは効かない
  clearOnOpen?: boolean;        // 開いたら片付けたに移す（新しく割り当てられたタスク: 見たら外す）
  actions?: Array<{
    id: string;
    label: string;
    tone?: 'primary' | 'danger';
    confirm?: string | null;     // 取り消せない操作の確かめる文。あれば行の中で2回目の押下を求める
    doneLabel?: string | null;   // 成功したときの言葉（例: 断りました）。無ければ「〈label〉」を実行しました
  }>;
}

interface InboxDisposition {
  itemId: string;
  revision: string | null;
  state: 'later' | 'cleared';
  until?: string | null;        // later の戻る時刻
  at: string;
}

type InboxDispositionChange =
  | { state: 'later'; until: string; revision: string | null }
  | { state: 'cleared'; revision: string | null }
  | { state: 'open' };          // 片付けた・あとでを解く

interface InboxPort {
  readInbox(): Promise<
    | { status: 'ok'; sources: InboxSource[]; items: InboxItem[]; dispositions: InboxDisposition[]; uncollected?: string[] }
    | { status: 'unavailable'; reason: string }
  >;
  setDisposition(itemId: string, change: InboxDispositionChange): Promise<{ status: 'ok' } | { status: 'unavailable'; reason: string }>;
  runAction?(itemId: string, actionId: string): Promise<{ status: 'ok' } | { status: 'unavailable'; reason: string }>;
  readNotices?(): Promise<{ status: 'ok'; items: unknown[] } | { status: 'unavailable'; reason: string }>; // 段4。段1では渡さない
}
```

- `sources` は、ホストが読もうとした種類の全部を返す。`status: 'ok'` の種類の行だけが `items` に入る。`unavailable` の種類を `ok` と空の行に変えない。
- `uncollected` は、まだ読み手の無い種類の名前（例: 「AIからの質問」）。件数に数えず、画面に1行で出す。
- 片付けた・あとでの状態の正本はホストが持つ（D16「受信箱が正本」）。共通UIは `readInbox` が返した `dispositions` を、`revision` が行と一致するときだけ当てる。`later` は `until` を過ぎたら効かない。
- 行のボタンは `runAction` を呼ぶだけで、共通UIは書き込みの経路を持たない。ホストは元の画面と同じ操作を呼ぶ。成功したら共通UIは `readInbox` を読み直す。

## 段1の片付けた・あとでの置き場（Claudeの代理決定）

段1では、正本API に受信箱の状態の置き場が無い。そこで、片付けた・あとでは閲覧者のブラウザに置く（`createLocalInboxDispositions`、鍵は `brainbase.inbox.dispositions.v1:<personId>`）。ホストは `withLocalInboxDispositions(reader, store)` で、読み手に状態を添えた port を作る。

- 別の端末やブラウザには引き継がれない。段4（Slack との片付けの同期）で状態を正本へ移し、この置き場は捨てる。port の形は変えない。
- 過ぎたあとでと、30日を過ぎた片付けたは読むときに落とす。
- 保存できないブラウザでは、操作は `store_unavailable` で失敗し、行は対応待ちに戻る。

## 並び

- 区画の順は `answer` → `approve` → `triage` → `task`。行も読めない種類も無い区画は出さない。
- 区画の中は、`blocking` が先、次に `dueAt` が近い順（期限の無いものは後）、次に `receivedAt` の新しい順。

## 件数

`countInboxWaiting(result, now)` は `{ count, unreadable }` を返す。

- `count`: 対応待ちに見えている行の `units`（既定 1）の合計。片付けた・あとでの行は数えない。
- `unreadable`: `unavailable` の種類の名前。左メニューは件数を出し、読めない種類があることを読み上げ名に添える。
- 全体が読めない（`status: 'unavailable'`）ときは `count: null` を返し、左メニューは件数を出さない。

## アドレス

- 画面は `inbox`。お知らせは `inbox?tab=notices`、あとでの一覧は `inbox?view=later`、片付けたの一覧は `inbox?view=cleared`。
- 待っているものの題名・説明・IDはアドレスに載せない。

## あとでの時刻

閲覧者のブラウザの時計で、次の3つから選ぶ。今日の夕方（18:00。過ぎていれば出さない）、明日の朝（9:00）、来週の月曜の朝（9:00）。

## 画面

- 部品 `createInboxUI({ root, document, port, route, onRouteChange, onNavigate, onCount, now })` を `ui/inbox.js` に置く。見た目は `ui/inbox.css`。`onCount` は、読み直しと片付けた・あとでのたびに `countInboxWaiting` の結果を返す（左メニューの件数を合わせるため）。
- 行の題名は `href` へのリンク。`clearOnOpen` の行は、開いたときに `setDisposition(id, { state: 'cleared' })` を呼ぶ。失敗しても移動は止めない。
- 「あとで」「片付けた」は行の右に置く。押したら、ホストの成功を待たずに行を隠し、失敗したら行を戻して理由を出す。
- 読み込みの途中は前の表示を保つ。

## 行の操作の手触り

AffectUI の Decision Inbox（MIT）の動きを参考に、共通UIで次を守る。Approval Card（Pro）のコードは使わない。どれも表示と押し方だけで、書き込みの経路は増やさない。

1. **送っている間は行を止める**: `runAction` の結果を待つ間、その行のボタン（操作・あとで・片付けた）を押せなくし、行に `aria-busy="true"` と「送っています」を出す。同じ行の二重送信は起きない。
2. **成功を見せてから畳む**: 成功したら、その行のボタンの代わりに `✓ <doneLabel>` を `doneShownMs`（既定 1100ms）出してから `readInbox` を読み直す。出すのはホストの成功を受け取った後だけ。失敗したら今までどおり行を戻して理由を出す。表示中の行は件数に数えない。
3. **件数の変化を読み上げる**: 受信箱は画面の外側に1つの読み上げ欄（`role="status"`）を持つ。最初の件数は読み上げず、対応待ちの件数が変わったら `対応待ち <N>件` と読む。成功のときは `<doneLabel>。対応待ち <N>件` とまとめて読む。
4. **名前つきの項目**: `facts` は題名の下に `<dl>` で並べる。`label` と `value` のどちらかが空の項目は出さない。`detail` はその下に今までどおり出す。
5. **取り消せない操作は行の中で確かめる**: `confirm` のある操作は、1回目の押下で行のボタンを確かめる帯に替え、`confirm` の文・同じ名前のボタン・「やめる」を出す。2回目の押下で初めて送る（`undoWindowMs` があればそこから元に戻すの帯に進む）。ブラウザの確認ダイアログは使わない。帯を出したら送るボタンへ、「やめる」で元のボタンへフォーカスを移す。読み直しで行の `revision` が変わったら帯を閉じる。
6. **期限の近さ**: `dueAt` が過ぎていれば「期限切れ」（`bb-inbox-due is-expired`）、24時間以内なら「期限まであと<N>時間」（1時間未満は「あと<N>分」、`is-soon`）、それより先なら今までどおり「期限 <月/日 時:分>」と出す。言葉を変えるだけで、失効を決めるのはホストの記録。閲覧者の時計で行を隠したり断ったりしない。

取り入れないもの:

- 「今後は常に許可」: 受信箱から任せる範囲を変える新しい入口になる（D16・ADR-025）。
- 期限切れで自動的に断る: 失効はサーバーが決める。
- リスクの札: 今の記録にリスクの値が無い。推測で付けない。
- ⌘Enter・Esc の操作: 一覧の中ではどの行への操作か取り違えやすい。

## 表示の言葉

| 値 | 表示 |
|---|---|
| group answer / approve / triage / task | 答える・決める / 承認する / 振り分ける・取り込む / タスク |
| source unavailable | 「〈名前〉を読めませんでした（理由）。0件ではありません。」 |
| source not_connected | 「〈名前〉は未接続です。」 |
| 全区画が読めて0件 | 「待っているものはありません。」 |
| お知らせの読み手なし | 「お知らせはまだ集めていません。」 |

## 検証

- 並び: 区画の順、止めている・期限・届いた順。行の無い区画は出ない。
- 読めない種類: 区画に理由が出て、件数に数えず、「待っているものはありません」と出ない。
- あとで・片付けた: 押すと消え、一覧に移り、戻せる。時刻を過ぎた・`revision` が変わったものは戻る。ホストの失敗で行が戻る。
- 行のボタン: `runAction` が呼ばれ、成功で読み直す。
- 送っている間: 行のボタンが押せず、もう一度押しても `runAction` は1回だけ。
- 成功の表示: `✓ <doneLabel>` を出し、`doneShownMs` の後に読み直す。表示中の行を件数に数えない。失敗では出さない。
- 読み上げ: 最初の件数は読まず、変わったときと成功のときだけ読む。
- 名前つきの項目: `facts` が `<dl>` で出て、空の項目は出ない。
- 確かめる帯: `confirm` のある操作は1回目で送らず、2回目で送る。「やめる」で送らずに戻る。`revision` が変わったら閉じる。
- 期限: 過ぎた・24時間以内・それより先で言葉とクラスが変わる。期限切れでも行は隠れず、`runAction` も呼ばれない。
- `countInboxWaiting`: `units` の合計、隠したものを除く、読めない種類を返す、全体が読めないときは null。
- アドレスに題名とIDが載らない。

## 今日決めること（layout: 'today'）と元に戻す（undoWindowMs）

組織版 RQ-121 の受信箱は、この共通UIをそのまま配信したうえで、ホストから次のオプションを渡す。Personal Web などが渡さないときの見た目と振る舞いは、これまでと変えない。

- `layout: 'today'` のときは、タブを出さず1列に並べる。見出しは「受信箱」のまま、その下に `今日決めること <units合計>件` を出す。決めることが0件なら「今日決めることはありません」と出す。ただし決めることの取得元（group `answer`・`approve`）に `unavailable` があり、読めた決めることが0件のときは、「ありません」と断定せず「今日決めることを読めませんでした。0件ではありません。」を出す（`bb-inbox-today-count is-unreadable`）。`not_connected` の取得元は未接続として扱い、「ありません」のままとする。
- 段は `decide`（決めること。group `answer` と `approve`）、`batch`（まとめて片付くもの。group `triage`）、`look`（見るだけ。group `task`）の3つ。段の中の並びは `sortInboxItems` のまま。行の無い段は出さず、読めない種類の説明はその group が属する段に出す。
- 行の待ち日数は `receivedAt` から閲覧者の `now` までを日単位で切り捨て、`待ち <days>日`（0日なら「今日」）と出す。3日を超えるものは `bb-inbox-wait is-long`。`layout: 'today'` の行は相対時刻の代わりにこれを出す。
- 主ボタン（`tone: 'primary'` の action）がある行には「片付けた」を出さない。「あとで」は出す。
- 「あとで」の選択肢は `style: 'today'` のとき、今夜 21:00（21:00 より前のときだけ）・明日の朝 9:00・来週の月曜 9:00。`style` を渡さないときは従来の「今日の夕方（18:00）・明日の朝・来週の月曜の朝」のまま。
- `port.readNotices` があるときだけ、「見るだけ」の段の下に `renderNotices` の中身を出す。無ければ未収集の説明も出さない。
- 件数（`countInboxWaiting` と `onCount`）は従来どおり `units` の合計。ホストは `units: 0` の行を使って、決めることだけを数えさせてよい。
- 「あとで N件」「片付けた N件」と `route.view` は従来どおり。`layout: 'today'` では `route.tab` を無視し、常に対応待ち側を描く。

`undoWindowMs > 0` のときは、行の action を押した瞬間にその行を一覧と件数から外し、`「<action.label>」を実行します。` と「元に戻す」の帯を出す。

- 「元に戻す」はタイマーを止めて行を戻し、`runAction` を呼ばない。
- 時間が過ぎたら `runAction(itemId, actionId)` を1回呼ぶ。成功なら `load()`、失敗なら行を戻して理由を出す。
- `destroy()` のとき残っている操作は、タイマーを止めてすぐ送る（結果は描かない）。
- `undoWindowMs` が0のときは、従来どおり結果を待って読み直す。
