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
  listJudgmentsUsing(id: string, limit: number): Promise<{ status: 'ok'; items: Array<{ decisionId: string; title: string | null; at: string; kind: string | null }>; total: number } | { status: 'unavailable'; reason: string }>;
  // 任意。一覧の「使われた判断」の件数。無いとき・unavailable のときは各行を「確認できない」と出す。
  countJudgmentsUsing?(ids: string[]): Promise<{ status: 'ok'; counts: Record<string, number> } | { status: 'unavailable'; reason: string }>;
  isOwner(): boolean; // false ならタブを出さず、記憶を読まない
}
```

- `status: 'ok'` で `items` が空のときだけ「0件（確認済み）」とする。`unavailable` を空の一覧に変えない。
- 記憶の本文・語句は、関数の引数と戻り値だけで運ぶ。URLには絞り込みの種類・状態・組織と記憶のIDだけを残し、語句と本文は載せない。
- 状態の既定（「有効」）は、`active` と `unrecorded` を出す。状態の記録が無い書き手（OSSの手元）の記憶を既定で隠さないためで、行と詳細では「状態の記録なし」と出し、「有効」と書かない。札は「状態：有効・状態の記録なし」と出す。
- 共通UIは `listMemories` に状態を渡さず、状態の絞り込みは受け取った一覧に掛ける。要約の1行（状態ごとの件数）を、状態の絞り込みの前の件数で出すため。

## OSSの手元のWebホスト

- 読み取りの経路を `GET /api/personal-memory`（一覧）・`GET /api/personal-memory/<id>`（1件）・`GET /api/personal-memory/<id>/judgments?limit=N`（使った判断）・`GET /api/personal-memory?view=judgment-counts`（件数）とする。本文が私的なので、書き込みと同じ手元のトークンと同じ出どころの検査を、読み取りにも掛ける。
- 一覧は全件を返し、手元の読み取り口（`ui/personal-memory-http-port.js`）が絞り込む。語句をリクエストのURLにも載せないため。
- `personal-kg.jsonl` の `PersonalKgEntry` を次のとおり写す。`type` → `kind`、`text`・`tags`・`updatedAt` はそのまま、`state` は `'unrecorded'`、`origin.organizationLabel` は `'手元'`、`recallScope` は `'general'`、`history` は空。
- `listJudgmentsUsing` は、手元の判断の記録から `kind=personal_knowledge` の参照（`ref` が記憶のID）を逆に引く。参照IDと `personal-kg.jsonl` の `id` が一致することを、実装の最初に実データで確かめる。一致しなければ、この行を「確認できない」で出し、推測で結ばない。
- 確かめた結果（2026-10-17）: OSSの手元のMCPは `personal-kg.jsonl` の `id` をそのまま返すので、OSSだけで使う場合は一致する。組織版のMCPにつないだ運用環境の判断の記録では、`personal_answer` の参照は90種類あり、すべて組織版の個人KGのID（`adopt_…`・`oyasumi_…` など）だった。同じ環境の手元の `personal-kg.jsonl`（`self-…` 形式）とは1件も一致しない。
- そのため手元のホストは、判断の記録に個人KGの参照が1件以上あり、そのどれも手元の記憶のIDでないときは `unavailable`（`reference_source_mismatch`）を返す。判断の記録が読めない・一部しか読めないときも `unavailable`（`journal_unavailable`・`journal_partial`）とし、0件にしない。参照が1件も無い記録は「まだ使われていない」（0件、確認済み）とする。
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
