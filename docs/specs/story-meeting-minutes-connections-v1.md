# Meeting minutes connections v1

このSpecは [story-meeting-minutes-connections-v1](../stories/story-meeting-minutes-connections-v1.md) の最小実装契約を固定する。共有UIは、ホストが解決した「この会議から生まれたもの・残した場所・知らせた先」を表示するだけで、値を推測・保存しない。

## API

`createMeetingMinutesUI(options)` は省略可能な `meetingConnections` を受け付ける。

```ts
type ConnectionItem = {
  label: string;          // 表示名（例: タスク名、#channel、owner/repo/path.md）
  href?: string;          // http(s) URL か "/" で始まる同じサイト内のパス（"//" は不可）
  detail?: string;        // 補足（例: 状態、日時、コミット）
};

type ConnectionRow =
  | { status: 'recorded'; items: ConnectionItem[] }     // 記録あり（items が空なら記録なし扱い）
  | { status: 'none' }                                  // 無いことを確かめた
  | { status: 'unrecorded'; reason?: string }           // 記録する仕組みが無い・記録されていない
  | { status: 'unavailable'; reason?: string };         // 読めなかった

type MeetingConnections = {
  project?: ConnectionRow;
  tasks?: ConnectionRow;
  decisions?: ConnectionRow;
  stored?: ConnectionRow;   // 保存先
  shared?: ConnectionRow;   // 共有先
};

type MeetingConnectionsLoader = (input: {
  meeting: Record<string, unknown>;
  minutes: Record<string, unknown>[];
  versions: Record<string, unknown>[];
}) => MeetingConnections | Promise<MeetingConnections>;
```

既存のオプションの契約は変えない。

## 表示

- 詳細の見出しの直後に `section.bb-minutes-connections`（見出し「この会議から」）を置き、次の順で5行を出す: プロジェクト・タスク・判断・保存先・共有先。
- ローダーの結果が届くまでは、各行を「読み込んでいます」と出す。
- `recorded` かつ項目が1件以上: 項目を並べる。`label` が空の項目は捨てる。全部捨てたら「記録なし」。
- `none`: 「なし」。タスク・判断で0件を出してよいのはこのときだけ。
- `unrecorded`、欠けた行、未知の `status`、形の違う値: 「記録なし」。`reason` があれば続けて出す。
- `unavailable`: 「読み込めません」。`reason` があれば続けて出す。
- ローダーが例外・失敗・オブジェクトでない値を返したとき: 5行すべて「読み込めません」。
- `href` は `http:`/`https:` のURL、または `/` で始まり `//` で始まらないパスだけをリンクにする。外部URLは `target="_blank" rel="noopener noreferrer"`。サイト内のパスは同じタブで開く。
- すべて `textContent` で描画する。

## 古い応答

- ローダーの結果は、呼び出した時点の詳細の世代と会議IDが今も同じときだけ描画する。
- 版を切り替えて詳細を描き直したときは、最後に届いた結果を使い、ローダーを呼び直さない。

## 右の「関連」

- `project` が `recorded` で最初の項目に有効な `href` があれば、右の「関連」のプロジェクト名をリンクにする。無ければ従来どおり `meetingLabel` の文字列か「プロジェクトは記録されていません」。

## 省略時

- `meetingConnections` が関数でなければ区画を出さず、ローダーも呼ばない。
