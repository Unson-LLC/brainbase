# フェーズ1: 準備と目的

最初にBrainbaseを動かし、何に役立てるかをひとつ決めます。この段階では、メールやカレンダーを接続しません。

## 必要なもの

- Node.js 20以上
- npm
- Codex、Claude Code、またはMCPに対応したAIエージェント
- Brainbaseのローカルcheckout

```bash
git clone https://github.com/Unson-LLC/brainbase.git
cd brainbase
npm install
npm run build
```

## AIに開始を依頼する

CodexやClaude CodeでBrainbaseのフォルダを開き、次の一言を入力します。

```text
Brainbaseのオンボーディングを始めたいです。
```

AIは利用中のエージェントに合わせて、次のコマンドを実行します。

```bash
npm run onboard:start -- --target codex
```

Claude Codeの場合は `--target claude` を使います。このコマンドは初期ディレクトリを準備しますが、自分、プロジェクト、関係者、決定事項を勝手に正本へ書きません。

## 最初に役立てたい依頼を決める

AIは「何度も説明したくないこと」を聞きます。最初は、実際に近いうちに使う依頼をひとつ選びます。

例:

- 次の面談準備を、相手との経緯を踏まえて整理する
- 進行中のプロジェクトについて、判断基準に沿った次の一手を出す
- 会議メモから、決定事項と自分の次の行動を分ける
- 重要な相手への返信を、関係性に合う表現で下書きする

この依頼を扱うプロジェクトもひとつ決めます。Brainbaseでいうプロジェクトは、開発案件に限りません。病院経営、共同研究、新規事業、特定の顧客対応もプロジェクトとして扱えます。

## このフェーズの完了

次の2つが決まったら、[フェーズ2: 仕事の前提](/guide/project-context)へ進みます。

- Brainbaseで最初に試す、現実の依頼
- その依頼を扱うプロジェクト
