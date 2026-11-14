# Meeting participants row v1

このSpecは [story-meeting-participants-row-v1](../stories/story-meeting-participants-row-v1.md) の最小実装契約を固定する。共有UIは、ホストが返した参加者と候補を表示し、人の操作をホストへそのまま渡すだけで、結び付きを推測・保存しない。

## API

`createMeetingMinutesUI(options)` は省略可能な `meetingParticipants` を受け付ける。既存のオプションの契約は変えない。

```ts
type MeetingInput = { meeting: Record<string, unknown>; minutes?: unknown[]; versions?: unknown[] };

type Participant =
  | { display_name: string; state: 'linked'; entity_id: string; name: string; href?: string; removable?: boolean }
  | { display_name: string; state: 'unconfirmed'; other_meetings?: number }
  | { display_name: string; state: 'not_person'; removable?: boolean };

type ParticipantsRow =
  | { status: 'recorded'; participants: Participant[]; redrafting?: boolean }
  | { status: 'none' }          // 参加者の対応の記録が無い：行を出さない
  | { status: 'unavailable' };  // 読めなかった

type Candidate = { name: string; evidence?: string[] };
type Candidates = {
  other_meetings?: number;
  people?: (Candidate & { entity_id: string })[];
  contacts?: (Candidate & { contact_id: string; company?: string })[];
  companies?: (Candidate & { entity_id: string })[];
};

type LinkInput =
  | { display_name: string; action: 'person' | 'company'; entity_id: string }
  | { display_name: string; action: 'new_person'; name: string; contact_id?: string }
  | { display_name: string; action: 'not_person' };

type MeetingParticipantsClient = {
  read(input: MeetingInput): ParticipantsRow | Promise<ParticipantsRow>;
  candidates(input: MeetingInput, displayName: string): Candidates | Promise<Candidates>;
  link(input: MeetingInput, body: LinkInput): Promise<{ linked?: { name?: string }; redraft?: { meetings: number } }>;
  unlink(input: MeetingInput, body: { display_name: string; entity_id?: string }): Promise<{ redraft?: { meetings: number } }>;
};
```

- `link` の失敗は `Error` を投げる。`message` は利用者に見せる文。同じ名前の人がいるときは `error.candidate = { entity_id, name }` を添える。`message` が `snake_case` の符号だけなら画面は既定の文を出す。

## 表示

- 区画 `section.bb-minutes-participants`（`aria-label="参加者"`）を、詳細の見出しの下、「この会議から」の上に置く。
- `none` は区画を `hidden` にして中身を空にする。読み込み中は「読み込んでいます」。`unavailable`・例外・形の違い（`state` が3つ以外、`linked` に `entity_id`・`name` が無い）は「参加者を読み込めませんでした」。
- `linked`：`href` が `/` で始まる同じサイト内のパスか http(s) ならリンク。表示名が名前と違えば「（表示名）」を添える。
- `unconfirmed`：`button.bb-minutes-participant-badge`「表示名（未確認）」。`aria-expanded` でパネルの開閉を示す。
- `not_person`：表示名と「（人ではない）」。
- `removable`：「取り消す」ボタン。
- `redrafting`：「名前を結んだので、この議事録を作り直しています。」。

## パネル

- 札を押すと `candidates` を1回読み、区画の中に開く。開いている札をもう一度押すか「あとで」で閉じる。開くのは同時に1つ。
- `other_meetings > 0` なら「同じ表示名の議事録があとN件あります。結ぶとそれらも作り直します。」。
- 人物ごとに「この人」（`action: 'person'`）、名刺ごとに「この名刺の名前で登録」（`action: 'new_person'`、名刺の名前と `contact_id`）、名前の入力（初期値は表示名）と「新しい人として登録」、会社ごとに「〈会社〉（会社）に結ぶ」（`action: 'company'`）、「結ばない」（`action: 'not_person'`）、「あとで」。
- 一括の操作は置かない。
- 送信中はボタンを止める。成功したら行を読み直してパネルを閉じ、「「表示名」を〈名前〉に結びました。議事録N件を作り直します（数分かかります）。」を `role="status"` で出す。失敗はパネルに理由を出す。
