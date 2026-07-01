# CEO Monthly Review: 2026-07

**Mode**: SELECTIVE EXPANSION

---

## 現状グラウンディング

**Brainbase** は "AI-first Company OS" としての自社内ツール兼、VibePro の control plane 基盤として開発中。主要モジュール: mana 観測ループ、Personal KG、SNS 投稿コックピット、Meeting Workflow Pack、Companion Inbox、Eve ランタイム、UnsonOS world UI。

**外部エンゲージメント（6月確認分）:**
- **杉山氏**（福祉施設）: AI 業務改善契約の最終回完了。年次集計が1週間→数分へ。7/3 最終レポートレビュー予定。コンサル案件。
- **大田原氏**（クリニック AI）: Omi デバイス+AI 経営パッケージ協業。レベニューシェアモデル。6月末テストサイクル未完了（アクション残存）。
- **林崎氏**（福祉 FC、加盟20社）: 初回面談のみ。FC 加盟店サポートの AI マネージャー構築を模索中。次回面談調整要。

**エンジニアリング速度（retro から）:**
- 5/1 週: 91 commits, 8 ships
- 5/15 週: 75 commits, 21 ships
- 5/22 週: 83 commits, 31 ships
- 6/5 週: 101 commits, 34 ships
- 6/19 週: 8 commits, 6 ships（一時低下）
- 6/15〜6/30: 48 commits（V字回復）

**計測インフラの問題**: 複数週で "目標達成率 N/A（Wiki API 不到達）"。北極星への前進をアナログで測れていない。

---

## 前提チェック（壁打ち）

| 問い | 現在の仮説 | 疑うべき点 | 判定 |
|------|-----------|-----------|------|
| **enemy の定義** | 「AI ツールは増えたが、文脈・判断・状態が人間の頭に残り、人間がボトルネック」 | Enemy は正確。しかし**三つの戦場が同時進行**している: (1) 社内 OS 整備 (2) コンサル案件 (3) 個人 SNS 運用自動化。これらは互いに正当化し合っているが、それぞれ異なる勝利条件を持つ。結果として「どこで勝てば enemy を倒したことになるか」が曖昧になっている。 | 🟡 |
| **northstar への道筋** | Brainbase 内部で AI-first OS を確立 → VibePro として外部化 | **「外部化」がいつ始まるかが定義されていない。** 4 月期の Quarter Story には "VibePro control plane 商品仕様定義" があるが、外部クライアントとの接点はすべてコンサル形式。Product として初めて売る moment が設計されていない。 | 🔴 |
| **timing の正しさ** | 今が AI-first OS の整備タイミング | **正しい。** 林崎氏（福祉 FC 20社）、大田原氏（クリニック市場）は共に「AI で経営を回したい」という pull が来ている。プロダクト化の窓が開いている。ただし窓は永遠に開いていない。 | 🟢 |
| **resource の賭け方** | Meeting Workflow / Personal KG / SNS Cockpit / Companion Inbox / Eve Runtime / UnsonOS World UI を並行 build | **賭け方が広すぎる。** SNS 投稿コックピットは「さとけいの個人 SNS 運用」のためのツールであり、Company OS の northstar に直結しない。UnsonOS の world UI（Company City / District / Holding Region）は壮大だが、外部クライアントが最初に求めるのは「朝に全店の状況が分かること」であり、地図 UI ではない。 | 🔴 |
| **Stop Pattern 診断** | | **Build 止まり**: 社内インフラは精緻化し続けているが、外部顧客に deliver した product がゼロ。コンサルの成功体験（杉山氏）が "product の成功" に見えてしまうリスクがある。**Decision 止まり**: Story Map 末尾の "次に決めること" 項目（northstar story の統合、Quarter 2+ の Ship 作成）が未解決のまま。 | 🔴 |

---

## 10-star バージョン

現在の Brainbase は「Keigo が1人で会社を回すためのコックピット」として動いている。

10-star は「林崎氏が FC 本部にいながら、加盟20社の現場責任者全員を AI がサポートし、林崎氏は承認だけ行う」世界観だ。

具体的には:
- mana が毎朝全 20 店の前日データ（LINE 履歴・売上・タスク消化率）から日次ブリーフを生成し、各店長の LINE に届く
- 停滞している店舗を自動フラグし、林崎氏の画面に「介入候補 3件、理由付き」で上げる
- 林崎氏はスマホで30秒で「OK / 差戻し / エスカレーション」を判断する
- 3ヶ月後、全店平均通所人数が10%改善し、林崎氏の管理工数が60%削減される

この10-star を実現するために必要な要素は、**すでに Brainbase の中に全て存在している**: Meeting Workflow Pack、Companion Inbox、mana 観測ループ、Personal KG、承認フロー。不足しているのは「これらを林崎氏の課題のために組み立てる」という意思決定だけだ。

---

## 来月の最優先アクション（3つまで）

### 1. 林崎氏を最初の VibePro Product 顧客として落とす

**根拠**: 「resource の賭け方」と「northstar への道筋」チェック

7月に林崎氏との2回目 MTG を設定する（6月中に面談要求があったはずだが次回調整が残存している）。コンサル提案ではなく、**「Brainbase を使った FC 加盟店 AI マネジメントパッケージ」のプロダクト提案**として持ち込む。月額 SaaS or 成功報酬モデル。1店舗あたり月 ¥30,000〜¥50,000 × 20 店舗 = ¥600,000〜¥1,000,000 MRR のポテンシャル。

アクション:
- 林崎 MTG 日程を今週中に確定
- 「加盟店 AI マネジメント」の1枚提案書（before/after + 価格 + 3ヶ月ロードマップ）を作成
- 7月中に PoC 開始の合意を取る

### 2. SNS コックピットを「さとけい専用」に封印し、VibePro story に繋がらない build を止める

**根拠**: 「resource の賭け方」チェック

SNS 投稿コックピット（story-sns-posting-cockpit）は「さとけいが X を運用するためのツール」として明示されている。これは personal ops であり company OS product ではない。今後の新機能追加を freeze し、既存の動作で運用する。

同様に UnsonOS World UI（Holding Region / Company City / District）の新規 build も、林崎氏 PoC に必要になるまで凍結する。

解放されたエンジニアリング時間を「林崎 PoC に必要な組み立て」に投じる。

### 3. Wiki API を修復し、KPI 計測インフラを1週間以内に回復させる

**根拠**: 「northstar への道筋」チェック

複数週の retro で "目標達成率 N/A（Wiki API 不到達）" が続いている。北極星に向けて進んでいるかどうかを、自社でも測れていない状態は論外。Brainbase が "AI-first Company OS" と主張するなら、まず自社の KPI を AI が読める状態で正本化することが先決。

アクション:
- Wiki API の障害原因を特定し、月曜中に fix または workaround を deploy
- 次週 retro で "目標達成率" が正常に計算されることを確認
- 月次レビューで「先月は northstar に向けて何%前進したか」を答えられる状態にする

---

## 言い切り

**VibePro の最初の Product 顧客は林崎氏になれる。7月がその窓だ。コンサルを1件終わらせた安心感から抜け出し、内部 build の一部を止めてでも林崎氏向けの product 提案に集中する月にする。**

---

*生成: 2026-07-01 / agent/ceo-review / Brainbase repo のみを参照（wiki API 不到達のため外部情報なし）*
