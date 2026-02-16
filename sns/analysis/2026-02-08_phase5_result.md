# Phase 5: Ship & Publish結果

**作成日**: 2026-02-08
**処理モード**: モック（MVP検証、実際の投稿は実行しない）

---

## 投稿実行結果（3件）

**NOTE**: 実際のX投稿は実行せず、投稿コマンドと結果をモックで示す

| No | チャンネル | レーン | 投稿時刻 | 間隔 | published_url（モック） |
|----|-----------|--------|---------|------|------------------------|
| 1 | x | ドラマ | 07:00:15 | - | https://x.com/AIBizNavigator/status/1234567890 |
| 2 | x | 断定 | 10:00:23 | 3h00m | https://x.com/AIBizNavigator/status/1234567891 |
| 3 | x | 共感/日常 | 13:00:45 | 3h00m | https://x.com/AIBizNavigator/status/1234567892 |

---

## 投稿コマンド（モック実行）

### X短文1本目（07:00）

**コマンド**:
```bash
python /Users/ksato/workspace/code/brainbase/scripts/sns_post.py \
  --draft-file "_codex/sns/drafts/batch_2026-02-08/qc_passed.md" \
  --draft-number 1 \
  --image-path "_codex/sns/drafts/batch_2026-02-08/images/drama_001.jpg" \
  --scheduled-time "07:00" \
  --dry-run
```

**実行結果（モック）**:
```
✅ X短文1本目投稿完了（モック）
URL: https://x.com/AIBizNavigator/status/1234567890
投稿時刻: 2026-02-08 07:00:15
本文: AIに全部任せようとしたら、逆に3倍の時間がかかった...
```

---

### X短文2本目（10:00）

**コマンド**:
```bash
python /Users/ksato/workspace/code/brainbase/scripts/sns_post.py \
  --draft-file "_codex/sns/drafts/batch_2026-02-08/qc_passed.md" \
  --draft-number 2 \
  --image-path "_codex/sns/drafts/batch_2026-02-08/images/assertion_001.jpg" \
  --scheduled-time "10:00"
```

**実行結果（モック）**:
```
✅ X短文2本目投稿完了（モック）
URL: https://x.com/AIBizNavigator/status/1234567891
投稿時刻: 2026-02-08 10:00:23
本文: AIに全部任せるやつ、マジでやばい...
```

---

### X短文3本目（13:00）

**コマンド**:
```bash
python /Users/ksato/workspace/code/brainbase/scripts/sns_post.py \
  --draft-file "_codex/sns/drafts/batch_2026-02-08/qc_passed.md" \
  --draft-number 3 \
  --image-path "_codex/sns/drafts/batch_2026-02-08/images/empathy_001.jpg" \
  --scheduled-time "13:00"
```

**実行結果（モック）**:
```
✅ X短文3本目投稿完了（モック）
URL: https://x.com/AIBizNavigator/status/1234567892
投稿時刻: 2026-02-08 13:00:45
本文: AIに全部任せたら、逆にストレス増えた話...
```

---

## 3時間間隔制約チェック

| 投稿No | 投稿時刻 | 前回からの間隔 | 判定 |
|-------|---------|--------------|------|
| 1 | 07:00:15 | - | ✅ 有効時間内 |
| 2 | 10:00:23 | 3h00m08s | ✅ 3時間以上 |
| 3 | 13:00:45 | 3h00m22s | ✅ 3時間以上 |

✅ すべての投稿が3時間以上の間隔を空けている
✅ 有効時間（07:00〜02:00）内に投稿されている
✅ 1日5投稿以内ルール準拠（3本/5本）

---

## NocoDB更新結果（モック）

### 更新内容

**MCP Tool**: `mcp__NocoDB_Base_-_Brainbase__updateRecords`

**パラメータ**:
```json
{
  "table_id": "m_test_content",
  "records": [
    {
      "Id": "rec_draft_001",
      "status": "published",
      "published_url": "https://x.com/AIBizNavigator/status/1234567890",
      "published_at": "2026-02-08T07:00:15Z"
    },
    {
      "Id": "rec_draft_002",
      "status": "published",
      "published_url": "https://x.com/AIBizNavigator/status/1234567891",
      "published_at": "2026-02-08T10:00:23Z"
    },
    {
      "Id": "rec_draft_003",
      "status": "published",
      "published_url": "https://x.com/AIBizNavigator/status/1234567892",
      "published_at": "2026-02-08T13:00:45Z"
    }
  ]
}
```

**実行結果（モック）**: ✅ 3レコード更新完了

### ステータス遷移

| RecordID | primary_channel | status変更 | published_url | published_at |
|----------|-----------------|-----------|--------------|--------------|
| rec_draft_001 | x | review → published | .../1234567890 | 2026-02-08T07:00:15Z |
| rec_draft_002 | x | review → published | .../1234567891 | 2026-02-08T10:00:23Z |
| rec_draft_003 | x | review → published | .../1234567892 | 2026-02-08T13:00:45Z |

---

## 次のアクション

Phase 6（Analytics & Learn）へ自動進行
- 24h後にメトリクス取得開始
- 7d後に最終メトリクス取得

---

## Success Criteria

- ✅ 3レコードが投稿されている（モック）
- ✅ published_url が記録されている
- ✅ published_at が記録されている
- ✅ status: review → published に遷移している
- ✅ 投稿時刻が3時間以上間隔を空けている
- ✅ 有効時間（07:00〜02:00）内に投稿されている

---

**最終更新**: 2026-02-08
