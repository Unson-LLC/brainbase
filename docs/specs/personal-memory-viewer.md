# あなたの記憶

Story: `story-personal-memory-viewer-v1`

## 読み取りの約束（ホスト → 共通UI）

共通UIは記憶を自分で取りに行かない。ホストが次の関数を渡す。OSSの手元のWebホストと組織版のホストは、同じ形で返す。

```ts
type PersonalMemoryState = 'active' | 'superseded' | 'retracted' | 'unrecorded';

interface PersonalMemoryItem {
  id: string;
  kind: string | null;          // self / work / relationship / value / judgment / experience / sns_context、無ければ null
  text: string;                 // 本文の全文
  tags: string[];
  state: PersonalMemoryState;   // 状態の記録が無い書き手は 'unrecorded'
  supersededBy: string | null;  // state が superseded のときの置き換え先
  origin: {
    organizationLabel: string | null; // 出どころの組織。手元は '手元'、決められなければ null（「不明」と出す）
    projectLabel: string | null;
    workplace: string | null;          // 会議・リポジトリ・会話など
    inferred: boolean;                 // ログイン中の組織から付いた
  };
  occurredAt: string | null;
  updatedAt: string | null;
  recallScope: 'organization' | 'general' | 'unknown'; // AIが使う範囲（ADR-023 P3）
  history: Array<{ state: PersonalMemoryState; at: string; reason: string | null }>;
}

interface PersonalMemoryPort {
  listMemories(filter: { kinds?: string[]; states?: PersonalMemoryState[]; organization?: string; query?: string; cursor?: string }):
    Promise<{ status: 'ok'; items: PersonalMemoryItem[]; nextCursor: string | null } | { status: 'unavailable'; reason: string }>;
  readMemory(id: string): Promise<{ status: 'ok'; item: PersonalMemoryItem } | { status: 'not_found' } | { status: 'unavailable'; reason: string }>;
  listJudgmentsUsing(id: string, limit: number): Promise<{ status: 'ok'; items: Array<{ decisionId: string; title: string; at: string; kind: string | null }>; total: number } | { status: 'unavailable'; reason: string }>;
  isOwner(): boolean; // false ならタブを出さず、記憶を読まない
}
```

- `status: 'ok'` で `items` が空のときだけ「0件（確認済み）」とする。`unavailable` を空の一覧に変えない。
- 記憶の本文・語句は、関数の引数と戻り値だけで運ぶ。URLには絞り込みの種類・状態・組織と記憶のIDだけを残し、語句と本文は載せない。

## OSSの手元のWebホスト

- 読み取りの経路を `GET /api/personal-memory`（一覧）・`GET /api/personal-memory/<id>`（1件）とし、既存の手元のトークンの検査を通す。
- `personal-kg.jsonl` の `PersonalKgEntry` を次のとおり写す。`type` → `kind`、`text`・`tags`・`updatedAt` はそのまま、`state` は `'unrecorded'`、`origin.organizationLabel` は `'手元'`、`recallScope` は `'general'`、`history` は空。
- `listJudgmentsUsing` は、手元の判断の記録から `kind=personal_knowledge` の参照（`ref` が記憶のID）を逆に引く。参照IDと `personal-kg.jsonl` の `id` が一致することを、実装の最初に実データで確かめる。一致しなければ、この行を「確認できない」で出し、推測で結ばない。
- `isOwner` は常に true（単独所有）。

## 表示の言葉

| 値 | 表示 |
|---|---|
| `kind` self / work / relationship / value / judgment / experience / sns_context | 自分 / 仕事 / 関係 / 大切にすること / 判断 / 経験 / 発信 |
| `kind` null | 種類の記録なし |
| `state` active / superseded / retracted / unrecorded | 有効 / 置き換え済み / 取り消し / 状態の記録なし |
| `recallScope` organization / general / unknown | 「〈組織〉の仕事でだけ使われます」 / 「どの組織の仕事でも使われます」 / 「使われる範囲を確かめられません」 |

## 画面

- 部品 `createPersonalMemoryUI({ port, judgmentHref })` を `ui/personal-memory.js` に置く。`judgmentHref(decisionId)` は判断の履歴の1件のURLを返す。
- 一覧と右の詳細を並べる。詳細を開いた記憶のIDはURLに残し、戻るで一覧に帰れる。
- 判断の履歴（`ui/judgment-history.js`）の「本人の考え」に、任意の `resolvePersonalMemory(refs)` を足す。ホストが渡したときだけ、記憶の本文の冒頭とリンクを出す。渡さないとき・失敗したときは、今の件数の表示のままにする。

## 検証

- 読み取り: `personal-kg.jsonl` の写し方、空ファイル（0件）と読めないファイル（unavailable）の区別、語句の絞り込み。
- UI: 本人でないときにタブも読み取りも出ないこと、状態の既定が「有効」で置き換え済み・取り消しが混ざらないこと、`unrecorded` を「有効」と書かないこと、0件と読めないの区別、使われた判断の0件と確認できないの区別、URLに本文と語句が載らないこと、編集の操作が無いこと。
- 判断の履歴: `resolvePersonalMemory` の有無・失敗で、本人以外の表示（件数だけ）が変わらないこと。
- 実ブラウザで、手元のWebに実際の `personal-kg.jsonl` を読ませて表示を確かめる。私的な実データの画像はPRに載せない。
