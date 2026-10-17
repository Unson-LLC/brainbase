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
  href?: string | null;         // 重い判断をする元の画面
  receivedAt?: string | null;
  dueAt?: string | null;
  blocking?: boolean;           // 他の人やAIを止めている
  units?: number;               // この行が表す件数（まとめの行。既定 1）
  revision?: string | null;     // 中身が変わると変わる。古い版への片付けた・あとでは効かない
  clearOnOpen?: boolean;        // 開いたら片付けたに移す（新しく割り当てられたタスク: 見たら外す）
  actions?: Array<{ id: string; label: string; tone?: 'primary' | 'danger' }>;
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
- `countInboxWaiting`: `units` の合計、隠したものを除く、読めない種類を返す、全体が読めないときは null。
- アドレスに題名とIDが載らない。
