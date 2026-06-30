# story-companion-people-ssot-api

## Story

Mac CompanionのTask候補レビューで担当者を選ぶとき、候補はAIの抽出文字列やSpeakerラベルではなく、BrainbaseのGraph SSOTに登録されたpersonエンティティを正本として取得する。

## Invariants

- INV-people-ssot-1: `GET /api/companion/people?source=graph_ssot&type=person` はGraph SSOTのpersonエンティティだけを担当者候補として返す。
- INV-people-ssot-2: `Speaker 1` のような話者ラベルや、AI推定名だけの値は正本候補として返さない。
- INV-people-ssot-3: `/api/companion/people` は既存のnative companion APIと同じbearer/service/internal認証ガードを通す。

## API Contract

`GET /api/companion/people?source=graph_ssot&type=person`

Response:

```json
{
  "source": "graph_ssot",
  "type": "person",
  "count": 1,
  "people": [
    {
      "id": "person_yajima",
      "entity_id": "person_yajima",
      "person_id": "person_yajima",
      "display_name": "矢島様",
      "name": "矢島様",
      "aliases": ["矢島さん"],
      "email": "yajima@example.com",
      "org": "Hotel Client",
      "role": "",
      "status": "active",
      "source": "graph_ssot"
    }
  ]
}
```

## Verification

- `npm test -- tests/server/routes/companion-approval-inbox.test.js`
