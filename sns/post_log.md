# SNS投稿ログ

投稿履歴を自動記録。`/sns` コマンドでネタ被りを避けるために参照。

## 戦略レイヤー定義
- **MAGNET**: OSパーツ配布（組織図/RACI/brainbase構造/会議体の1枚図＋テンプレ）→ フォロー獲得
- **CORE**: 構造ログ（日々の実験/Tips/ポストモーテム）→ 信頼構築
- **REPLY**: 会話・関係構築 → KPI評価対象外

## タグ定義
| タグ | 説明 | 最短間隔 |
|------|------|----------|
| `#brainbase` | brainbase全体の構造・設計 | 7日 |
| `#会議` | 会議管理・議事録 | 5日 |
| `#人脈` | 連絡先・ネットワーク管理 | 5日 |
| `#タスク` | タスク管理 | 5日 |
| `#AI連携` | AI/Claude Code連携・hooks | 3日 |
| `#ツール` | ツール紹介・移行 | 3日 |
| `#告知` | サービス・イベント告知 | 制限なし |
| `#意思決定` | Decision Log・判断記録 | 5日 |
| `#自動化` | 自動化・スクリプト | 5日 |

**運用ルール**: 同じタグの投稿は「最短間隔」以上空ける。複数タグがある場合は全て確認。

## 投稿履歴

| 日時 | URL | トピック | タグ | 戦略 | 型 | 備考 |
|------|-----|----------|------|------|-----|------|
| 2025-11-29 21:08 | https://x.com/i/web/status/1994740718049649047 | brainbase分解図（6パーツ構造） | `#brainbase` | CORE | exploded | 150imp/3プロフ |
| 2025-11-30 09:43 | https://x.com/i/web/status/1994930312925909302 | AIガードレール設計（hooks/Stop hook） | `#AI連携` | CORE | infographic | 152imp |
| 2025-11-30 09:45 | https://x.com/i/web/status/1994930889839849852 | Claude Code×カレンダー連携（/schedule） | `#AI連携` `#ツール` | CORE | infographic | 197imp/1プロフ |
| 2025-11-30 09:53 | https://x.com/i/web/status/1994932729952309562 | 人の関係性データ | `#人脈` | CORE | infographic | 150imp/0プロフ |
| 2025-11-30 10:21 | https://x.com/i/web/status/1994939928430678339 | Zeims告知（β版リリース予告+CTA） | `#告知` | MAGNET | text | **1370imp/50プロフ/1フォロー** |
| 2025-11-30 21:09 | https://x.com/i/web/status/1995102958800019751 | 議事録の固有名詞誤変換解決 | `#会議` `#AI連携` | CORE | infographic | 145imp |
| 2025-12-01 04:25 | https://x.com/i/web/status/1995213452458263036 | Google Drive→Workspace移行（movebot） | `#ツール` | CORE | screenshot | 201imp |
| 2025-12-01 12:01 | https://x.com/i/web/status/1995327342018015480 | AIにドライブ整理を任せる条件 | - | - | infographic | - |
| 2025-12-01 16:46 | https://x.com/i/web/status/1995399166902841819 | BAAO AI実践イベント | - | - | infographic | - |
| 2025-12-01 21:20 | https://x.com/i/web/status/1995467999902609848 | コマンド整理の3原則 | - | - | infographic | - |
| 2025-12-02 09:14 | https://x.com/i/web/status/1995647724314829200 | 会議記録の二層構造 | - | - | infographic | - |
| 2025-12-02 09:29 | https://x.com/i/web/status/1995651426098577824 | gitコミット→SNSネタ | - | - | infographic | - |
| 2025-12-02 09:59 | https://x.com/i/web/status/1995658962977653091 | JGrants APIの落とし穴 | - | - | infographic | - |
| 2025-12-02 13:54 | https://x.com/i/web/status/1995721157077860399 | 並列開発の前にやっとけ | - | - | infographic | - |
| 2025-12-02 14:27 | https://x.com/i/web/status/1995726606317613439 | Xブックマーク→brainbase連携 | - | - | infographic | - |
| 2025-12-02 16:38 | https://x.com/i/web/status/1995760287056863731 | ネットワーク資産の構造化（人脈管理OS） | `#人脈` `#brainbase` | MAGNET | framework | - |
| 2025-12-03 00:29 | https://x.com/i/web/status/1995878083279339566 | 人名の表記ゆれ問題と解決策 | `#人脈` | CORE | infographic | - |
| 2025-12-03 09:51 | https://x.com/i/web/status/1996019565575483461 | 複数事業でタスク管理ツールを分けると詰む | `#タスク` | CORE | infographic | - |
| 2025-12-03 21:25 | https://x.com/i/web/status/1996194176661360685 | 便利なツール3つで仕事破綻 | - | - | infographic | - |
| 2025-12-04 01:42 | https://x.com/i/web/status/1996258721706680621 | ポートフォリオ1年放置→2時間で完成 | - | - | infographic | - |
| 2025-12-04 08:39 | https://x.com/i/web/status/1996363813361516714 | ポートフォリオ1年放置→2時間で完成 | - | - | infographic | - |
| 2025-12-04 10:06 | https://x.com/i/web/status/1996385502841491884 | 朝の予定確認を自動化 | - | - | infographic | - |
| 2025-12-05 11:40 | https://x.com/i/web/status/1996771694745375167 | 1300万円の稟議が出せなかった理由 | - | - | infographic | - |
| 2025-12-05 18:21 | https://x.com/i/web/status/1996872563772064210 | 会議メモ自動抽出OS | - | - | infographic | - |
| 2025-12-05 18:31 | https://x.com/i/web/status/1996874975257731457 | AIセッションログ自動抽出 | - | - | infographic | - |
| 2025-12-05 19:00 | https://x.com/i/web/status/1996882379739406567 | 名刺管理の自動化 | - | - | infographic | - |
| 2025-12-05 19:51 | https://x.com/i/web/status/1996895123163255212 | AI活用の罠と解決策 | - | - | infographic | - |
| 2025-12-05 19:59 | https://x.com/i/web/status/1996897144041885723 | ビジネス向けAI共創IDE | - | - | infographic | - |
| 2025-12-06 01:14 | https://x.com/i/web/status/1996976594733486271 | 名刺4000枚をAIで掘り起こし→案件化 | - | - | infographic | - |
| 2025-12-06 01:30 | https://x.com/i/web/status/1996980511219360044 | decisions/で意思決定の来歴管理 | - | - | infographic | - |
| 2025-12-06 01:45 | https://x.com/i/web/status/1996984160569958724 | AI文字起こしの用語バラバラ問題 | - | - | infographic | - |
| 2025-12-06 01:54 | https://x.com/i/web/status/1996986650623451423 | Codex CLI v0.65.0 Skills機能追加 | - | - | infographic | - |
| 2025-12-06 10:21 | https://x.com/i/web/status/1997114186959392793 | 自動学習抽出システム（AIに学びを抽出させる） | `#AI連携` `#自動化` | CORE | progress | - |
| 2025-12-06 10:49 | https://x.com/i/web/status/1997121109767106845 | brainbase-ui進捗 | - | - | infographic | - |
| 2025-12-07 00:13 | https://x.com/i/web/status/1997323699675189570 | 持続資本論（3資本モデルで法人診断） | `#意思決定` | CORE | infographic | - |
| 2025-12-07 01:33 | https://x.com/i/web/status/1997343854186594732 | Jibble MCP Server（勤怠管理をAI接続） | `#ツール` | CORE | infographic | - |
| 2025-12-07 09:21 | https://x.com/i/web/status/1997461372565962974 | ICPからSSWへ - ターゲット選定の判断軸 | - | - | infographic | - |
| 2025-12-07 23:41 | https://x.com/i/web/status/1997677773775909036 | AWS CLI環境変数の罠 | - | - | infographic | - |
| 2025-12-08 09:10 | https://x.com/i/web/status/1997821129864757423 | SNS画像の画風戦略 | - | - | infographic | - |
| 2025-12-08 23:26 | https://x.com/i/web/status/1998042838488191202 | UI改善：なんか使いづらいを放置すると詰む | `#タスク` | CORE | screenshot | - |
| 2025-12-10 00:34 | https://x.com/i/web/status/1998415946118287868 | シンボリックリンク正本同期 | - | - | infographic | - |
| 2025-12-10 18:43 | https://x.com/i/web/status/1998690105972920432 | alert()撲滅：内製ツールのUI自作 | - | - | infographic | - |
| 2025-12-11 03:54 | https://x.com/i/web/status/1998828797853053378 | AI開発：1ファイル500行超えたらヤバい | - | - | infographic | - |
| 2025-12-11 04:27 | https://x.com/i/web/status/1998836891568001330 | brainbase：2週間で構築した事業OS | - | - | infographic | - |
| 2025-12-12 00:29 | https://x.com/i/web/status/1999139541651988521 | AIからのデスクトップ通知設定 | - | - | infographic | - |
| 2025-12-17 05:40 | https://x.com/i/web/status/2001029638282489891 | 会議時間90%削減のAI PM設計書 | infographic |
| 2025-12-18 10:37 | https://x.com/i/web/status/2001466850849509507 | GitHub Actions エラーなし失敗の罠 | infographic |
| 2025-12-18 20:39 | https://x.com/i/web/status/2001618304834965890 | 新幹線で開発：移動時間が最高の集中タイム | infographic |
| 2025-12-19 13:23 | https://x.com/i/web/status/2001871073630163210 | SaaS開発中止→売ってから作るに転換 | infographic |
| 2025-12-19 21:00 | https://x.com/i/web/status/2001985899144589676 | git worktree × symlinkの罠と解決策 | infographic |
| 2025-12-20 10:10 | https://x.com/i/web/status/2002184806076199124 | Cloudflare Tunnel自動起動の罠 | infographic |
| 2025-12-20 10:38 | https://x.com/i/web/status/2002191900158333100 | CHANGELOG読まない損失→週10時間回復 | infographic |
| 2025-12-20 22:05 | https://x.com/i/web/status/2002364718405820562 | Claude Code worktreeのBキーフィルタリング | infographic |
| 2025-12-21 08:09 | https://x.com/i/web/status/2002516615230017899 | Slack通知の本番誤爆からTEST_MODE_USER実装まで | infographic |
| 2025-12-24 21:32 | https://x.com/i/web/status/2003805897177678335 | 1個直したら3個見つかった（バグ芋づる式） | mystery |
| 2025-12-24 22:29 | https://x.com/i/web/status/2003820336954196479 | 親を透明にしたら子も透明になった | infographic |
| 2025-12-25 10:10 | https://x.com/i/web/status/2003996718913016175 | 有名SaaSのデザイン、全部盗んでSkillsに入れた | infographic |
| 2025-12-25 22:44 | https://x.com/i/web/status/2004186481716613131 | 公式ドキュメント読んで諦めた、その先に答えがあった | infographic |
| 2025-12-26 10:59 | https://x.com/i/web/status/2004371336467243056 | test-orchestrator検証完了（{skill}/agents/構造実証） | `#AI連携` | CORE | progress | 前回投稿（12/25）の続編、10倍高速化 |
| 2025-12-27 19:47 | https://x.com/i/web/status/2004866794746712428 | freee APIで経費精算を自動化できると思ってた。大間違いだった | infographic |
| 2025-12-28 07:59 | https://x.com/i/web/status/2005050901430763988 | 788行のサンプルデータを書いて、ようやくOSS公開準備が完了した | infographic |
| 2025-12-28 21:16 | https://x.com/i/web/status/2005251461580775471 | 3回直して3回再発。4回目でやっと根本解決した話 | infographic |
| 2025-12-29 08:09 | https://x.com/i/web/status/2005415909951950908 | 名刺1000枚、全部繋がった | infographic |
| 2025-12-29 15:53 | https://x.com/i/web/status/2005532584965787835 | 朝起きたら、AIが45個の学びを用意してた | infographic |
| 2025-12-29 16:26 | https://x.com/i/web/status/2005540789523452346 | 技術チーム、いない状態でリリースするの、危険すぎる | infographic |
| 2025-12-29 18:26 | https://x.com/i/web/status/2005571024763625558 | 3日間データ構造で地獄を見た | confession |
| 2025-12-30 11:34 | https://x.com/i/web/status/2005829852117831916 | 手を動かす努力がヤバい時代 | infographic |
| 2025-12-30 12:37 | https://x.com/i/web/status/2005845619055985093 | worktreeで並行開発したらデータが勝手に消えた | infographic |
| 2025-12-30 23:20 | https://x.com/i/web/status/2006007582323024055 | Airtableに年間30万払うのやめた | infographic |
| 2025-12-31 20:40 | https://x.com/i/web/status/2006329601816195404 | AIとの会話が毎回リセット | infographic |
| 2026-01-01 09:50 | https://x.com/i/web/status/2006528524879024318 | 2026年、AIエージェント支払額が社員給与を超える | infographic |
| 2026-01-01 23:20 | https://x.com/i/web/status/2006732186800853499 | AI PM業務100個自動化チャレンジ | infographic |
| 2026-01-01 23:37 | https://x.com/i/web/status/2006736614727577964 | 元NTTデータから見る、AIネーティブ開発の現実 | infographic |
| 2026-01-02 12:51 | https://x.com/i/web/status/2006936236477526265 | 「AI使えば生産性上がる」って言うけど、俺は逆に30分も時間かかるようになった。100日チャレンジDay 1の失敗談、暴露する | infographic |
| 2026-01-03 15:53 | https://x.com/i/web/status/2007344622830530980 | 100日チャレンジ Day 2 - 議事録自動生成 | infographic |
| 2026-01-03 16:26 | https://x.com/i/web/status/2007352867125113219 | 100日チャレンジ Day 2 - 議事録自動生成 | infographic |
| 2026-01-03 16:49 | https://x.com/i/web/status/2007358647505170891 | 100日チャレンジ Day 2 - 議事録自動生成 | infographic |
| 2026-01-03 17:15 | https://x.com/i/web/status/2007365244621140168 | 会議議事録の自動生成 mana-weekly | infographic |
| 2026-01-07 19:28 | https://x.com/i/web/status/2008848265211720008 | 1on1準備の時間浪費をゼロにした話 | infographic |
| 2026-01-09 08:16 | https://x.com/i/web/status/2009403971480527008 | タスク重複の気づかない損失 | infographic |
| 2026-01-09 14:41 | https://x.com/i/web/status/2009500645628555657 | サーバーレス神話の崩壊 | infographic |
| 2026-01-09 16:52 | https://x.com/i/web/status/2009533697524187573 | 100日チャレンジ Day 8: 週次進捗レポートの自動生成 | infographic |
| 2026-01-11 08:45 | https://x.com/i/web/status/2010135854975742197 | 100日チャレンジ Day 9: 意思決定ログの自動記録 | infographic |
| 2026-01-11 22:06 | https://x.com/i/web/status/2010337585634410921 | 100日チャレンジ Day 10: アクションアイテムの自動割り当て | infographic |
| 2026-01-12 15:00 | https://x.com/i/web/status/2010592675041571123 | Day 12: タスク依存関係の可視化 | infographic |
| 2026-01-12 15:07 | https://x.com/i/web/status/2010594583462420631 | Day 11: デッドライン通知の自動化 | infographic |
| 2026-01-12 21:15 | https://x.com/i/web/status/2010686993022484984 | 意思決定は「えいや」で決める行為 | infographic |
| 2026-01-13 22:22 | https://x.com/i/web/status/2011066304321765884 | Day 12: タスク依存関係の可視化 | infographic |
| 2026-01-15 07:39 | https://x.com/i/web/status/2011568865327858086 | Day 14: タスクテンプレートの自動適用 | infographic |
| 2026-01-15 11:47 | https://x.com/i/web/status/2011631241439953251 | 覚悟の表明 | infographic |
| 2026-01-15 21:15 | https://x.com/i/web/status/2011774206095343875 | 自分がボトルネックになる問題 | infographic |
| 2026-01-16 11:48 | https://x.com/i/web/status/2011993912865648652 | 時間の使い方の優先順位 | infographic |
| 2026-01-16 21:15 | https://x.com/i/web/status/2012136540483576111 | 人に任せることの難しさ | infographic |
| 2026-01-17 11:41 | https://x.com/i/web/status/2012354498233250173 | 構造化という武器 | infographic |
| 2026-01-17 21:13 | https://x.com/i/web/status/2012498546529067096 | AIと人間の役割分担 | infographic |
| 2026-01-18 11:54 | https://x.com/i/web/status/2012720123321413663 | 経営の全体像を見ること | infographic |
| 2026-01-18 21:14 | https://x.com/i/web/status/2012861101772554482 | 哲学的視点の重要性 | infographic |
| 2026-01-18 21:26 | https://x.com/i/web/status/2012869898712887412 | Day 15: 会議のアジェンダ自動作成 | infographic |
| 2026-01-19 11:25 | https://x.com/i/web/status/2013075337144565807 | Day 16: 会議後のフォローアップメール自動送信 | infographic |
| 2026-01-19 18:35 | https://x.com/i/web/status/2013183530290049104 | AI活用実験：参加者募集 | infographic |
| 2026-01-19 18:37 | https://x.com/i/web/status/2013184140821311510 | AI活用実験：参加者募集 | infographic |
| 2026-01-25 12:41 | https://x.com/i/web/status/2015268663251861531 | SNSは伸びた | infographic |
| 2026-01-25 15:46 | https://x.com/i/web/status/2015315276624196063 | 内製が正しい局面はある | infographic |
| 2026-01-25 19:08 | https://x.com/i/web/status/2015366187044261984 | 清掃KPIを | infographic |
| 2026-01-25 21:48 | https://x.com/i/web/status/2015406361526583657 | 離職率90%って数字が出て | infographic |
| 2026-01-26 01:08 | https://x.com/i/web/status/2015456793338712468 | セキュリティは技術の話 | infographic |
| 2026-01-26 07:07 | https://x.com/i/web/status/2015547139980726507 | 利益3割のコアプランが残り7割を食い潰す構造 | infographic |
| 2026-01-26 18:45 | https://x.com/i/web/status/2015722814263955608 | 利益3割のコアプランが残り7割を食い潰す構造 | infographic |
| 2026-01-26 21:48 | https://x.com/i/web/status/2015768888433312112 | 30%オフは「割引」ではなく利益を捨てた原価提供 | infographic |
| 2026-02-12 07:12 | https://x.com/i/web/status/2021709050095055246 | AIが受信側のメール振り分けをする中期レベルでも、エンプラ向けは | infographic |
| 2026-02-13 09:46 | https://x.com/i/web/status/2022110064228909061 | あ | infographic |
