# X出荷ライン運用手順（最小）

## 日次
0. trigger生成（sns_account_factory_trigger.py）
   - 例: `python3 _codex/sns/x/ops/scripts/sns_account_factory_trigger.py --goals reply,profile`
0.5 Seed自動生成＆採用（議事録→Seed→採用まで自動）
   - 例: `python3 _codex/sns/x/ops/scripts/seed_factory.py --days 7 --count 5 --mode auto`
1. Pillar選定
2. Batch作成（06_batches）
3. 出荷時間を07:00〜02:00で確定（主投稿は3時間以上あける）
4. sns-smartでdraft生成
4.5 Tension Gate（意外性/矛盾/不安の注入とタグ付け）
5. レーン割当（A/B/C/D）
   - 返信重視週: A2/D2/B1/C1 を目安に配分
6. QCチェック
7. Phase2.5 鬼編集長レビュー（style_review）
8. Variety Gate（文量/構成/フック/レーン条件の重複チェック）
9. 返信/プロフィール条件の最終チェック
10. reviewへ移動
9. scheduledへ移動
10. published反映
11. 24h/7d計測メモ

## 週次
- 勝ちパターン抽出
- テンプレ更新
- proof補充

## WIP制御
- reviewが20件超えたら生成停止
- 出荷消化を最優先

## 日次KPI（現行）
- 主投稿: 6本/日（短文4 + X記事2）
- note: 2本/日（X記事と同内容）
- 返信/引用: 10〜15本/日
