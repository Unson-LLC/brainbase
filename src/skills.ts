export type SkillTarget = 'codex' | 'claude' | 'portable';

export type BrainbaseSkillId =
  | 'brainbase-personal-onboarding'
  | 'brainbase-connected-world-onboarding'
  | 'brainbase-source-import'
  | 'brainbase-candidate-review'
  | 'brainbase-daily-routines';

export interface BrainbaseSkillDefinition {
  id: BrainbaseSkillId;
  title: string;
  description: string;
  body: string;
}

export interface SkillFile {
  id: BrainbaseSkillId;
  description: string;
  relativePath: string;
  recommendedPath: string;
  content: string;
}

export interface SkillBundle {
  target: SkillTarget;
  goal: string;
  canonicalWrites: false;
  liveConfigWrites: false;
  skills: SkillFile[];
  safetyRules: string[];
  nextSteps: string[];
}

export const ALL_BRAINBASE_SKILLS: BrainbaseSkillId[] = [
  'brainbase-personal-onboarding',
  'brainbase-connected-world-onboarding',
  'brainbase-source-import',
  'brainbase-candidate-review',
  'brainbase-daily-routines'
];

const TARGET_BASE_PATHS: Record<SkillTarget, string> = {
  codex: '~/.agents/skills',
  claude: '.claude/skills',
  portable: 'skills'
};

const SECRET_RULE = 'OAuthトークン、パスワード、APIキー、リフレッシュトークンをチャットに貼るようユーザーに依頼しない。';

const SKILL_DEFINITIONS: Record<BrainbaseSkillId, BrainbaseSkillDefinition> = {
  'brainbase-personal-onboarding': {
    id: 'brainbase-personal-onboarding',
    title: 'Brainbase個人オンボーディング',
    description: '公開版Brainbaseの個人オンボーディング面談とローカルMCP設定を、安全に進める。',
    body: [
      '## 目的',
      '',
      'ユーザーがCodex、Claude Code、または他のコーディングエージェントからBrainbaseを使い始める時に使う。',
      '',
      '## 手順',
      '',
      '1. 最初に、Brainbaseを使って試したい現実の依頼を一つ聞く。',
      '2. `brainbase onboard:start --target codex|claude|codecode` を実行し、本人、プロジェクト、関係者、判断基準の最小候補を確認する。',
      '3. ユーザーが明示的に承認した事実だけを `brainbase onboard:seed` で保存する。',
      '4. `brainbase onboard:install --target codex|claude|codecode --dry-run` でMCP設定を確認し、承認後に実設定へ反映して対象エージェントを再起動する。',
      '5. 新しい実際のエージェントで、Brainbaseの `resolve_entity`、`get_context`、`search` を使うよう明示して最初の現実の依頼を実行する。',
      '6. 内部準備の宣言を挟まず、利用者向け回答の先頭を「覚えていたこと」にする。続けて「つながったこと」「次にできること」の3節を短い箇条書きで示す。確認済みの事実と未確認事項は混ぜず、初回表示に表は使わない。',
      '7. 正規ID、関係経路、Receipt digest、生のtool trace、source file名は「詳細」に分け、ホストが対応する場合は折りたたむ。利用者が求めない限り初回の本文へ並べない。',
      '8. 内部Skillの読み込み、検索の再試行、tool orchestrationは説明しない。失敗によって結果や次の行動が変わる場合だけ示す。',
      '9. その実回答について本人に役立ったかを確認する。取得開始からここまでを10分以内の初回価値候補ジャーニーとして測る。',
      '10. CLIの `onboard:demo` は必要なら接続前のプレビューに使えるが、CLIサンプルは初回価値の達成証拠にしない。',
      '11. 本人が役立つと確認した後だけ、必要に応じてsource診断、追加候補、Skills、ルーティンへ進む。',
      '12. 継続利用するプロジェクトの詳細が必要なら、本人確認後に `brainbase onboard:projects --write` で登録する。',
      '',
      '## 安全ルール',
      '',
      `- ${SECRET_RULE}`,
      '- Brainbaseはローカルファーストで扱う。ユーザーが別のローカルパスを明示しない限り、ローカルMCPサーバーと `~/.brainbase/personal-os/` を使う。',
      '- メール、カレンダー、ドライブ、タスク、メモの生データは `sources/` 配下の二次材料として扱う。',
      '- canonical contextは、ユーザー確認後の `graph.json`、`relationships.json`、`personal-kg.jsonl`、`decisions.jsonl` だけから作る。',
      '- 終了コード0、`ready: true`、CLIサンプル、合成ペルソナ判定を、人間本人の価値認識に置き換えない。'
    ].join('\n')
  },
  'brainbase-connected-world-onboarding': {
    id: 'brainbase-connected-world-onboarding',
    title: 'Brainbase接続済み世界オンボーディング',
    description: '実際に呼び出せる仕事ソースを棚卸しし、承認済み事実だけで最初の価値まで進める。',
    body: [
      '## 目的',
      '',
      '既に接続できる仕事ソースから、最小範囲の証拠を人間レビューへつなぎ、10分以内に最初の価値を評価する。',
      '',
      '## 手順',
      '',
      '1. 最初に「Brainbaseで最初に何が分かると価値があるか」を一つ聞く。',
      '2. 自分が実際に呼び出せるMCP、Drive、Gmailを確認する。ローカルはユーザーが明示した限定フォルダ、fallbackは明示された単一ドキュメントだけを対象にする。',
      '3. 各sourceを `ready`、`waiting_for_authorization`、`unavailable`、`error`、`unconfirmed` に分ける。認証失敗、timeout、未確認を0件やreadyにしない。',
      '4. 最初の価値とsource inventoryを `brainbase_onboarding_start` に渡し、返された `selectedSourceIds` だけを使う。',
      '5. selected sourceをmetadata-firstで最小範囲だけ取得し、本文ではなくpointer、SHA-256 hash、permission snapshotと短い構造化候補を `brainbase_onboarding_ingest` に渡す。',
      '6. `brainbase_onboarding_get` の候補を、要約・evidence ID・observed/inferred区分付きでユーザーへ示す。',
      '7. ユーザーの判断を `brainbase_onboarding_review` の `approve`、`edit`、`reject`、`merge` とreasonで記録する。inferred候補はapproveせず、確認できた内容へeditするかrejectする。',
      '8. 昇格済みcanonical IDだけで最初の回答を作る。回答本文を渡さず、hashと使用IDを `brainbase_onboarding_first_value` の `record` で記録する。',
      '9. ユーザーへ役立ったかを聞き、`useful` または `not_useful` と不足文脈を同toolの `review` で記録する。',
      '',
      '## 安全ルール',
      '',
      `- ${SECRET_RULE}`,
      '- 全Drive、全mailbox、home directory全体を走査しない。selected sourceのpermission scopeを越えない。',
      '- source本文と回答本文をBrainbase onboarding ledgerへ保存しない。',
      '- 候補はcanonical memoryではない。人間が明示的にreviewしたobserved factだけを昇格する。',
      '- connectorが使えない時は状態をそのまま報告し、別sourceまたは明示された単一ドキュメントを提案する。'
    ].join('\n')
  },
  'brainbase-source-import': {
    id: 'brainbase-source-import',
    title: 'Brainbaseソース取り込み',
    description: 'ローカルソースのメタデータを集め、Brainbase sourcesへ取り込み、レビュー候補を抽出する。',
    body: [
      '## 目的',
      '',
      'ユーザーがBrainbaseオンボーディングでメール、カレンダー、ドライブ/ドキュメント、タスク、ローカルメモを対象にした時に使う。',
      '',
      '## 手順',
      '',
      '1. ドライブフォルダ、ローカルフォルダ、カレンダー、タスクプロジェクト、メールアカウントを読む前に、明示的な許可範囲を確認する。',
      '2. まずメタデータ優先で集める。Google Workspaceでは、利用可能ならローカルのGoG系コレクタを使い、出力は `sources/` 配下に置く。',
      '3. 集めたJSONを `brainbase onboard:import --source gmail|calendar|drive|local --from <file>` で取り込む。',
      '4. `brainbase onboard:extract --self-email <email> --write` で決定的なレビュー候補を抽出する。',
      '5. 昇格前に、候補id、provenance count、source areaをユーザーに見せる。',
      '',
      '## 安全ルール',
      '',
      `- ${SECRET_RULE}`,
      '- ユーザーが抜粋の利用を明示的に承認しない限り、メール本文全体、予定説明全文、ファイル本文を集めない。',
      '- ドライブ全体やホームディレクトリ全体をスキャンしない。明示的な許可リストを使う。',
      '- import/extractはcanonical memoryではない。二次ソース記録とレビュー候補を作るだけにする。'
    ].join('\n')
  },
  'brainbase-candidate-review': {
    id: 'brainbase-candidate-review',
    title: 'Brainbase候補レビュー',
    description: 'Brainbase候補をユーザーと確認し、承認されたものだけを個人SSOTへ昇格する。',
    body: [
      '## 目的',
      '',
      '面談やsource extractionからBrainbase候補が作られた時に使う。',
      '',
      '## 手順',
      '',
      '1. 候補をself、value、project、person、organization、relationship、decision、next actionに分類する。',
      '2. private sourceの生データをそのまま出さず、候補id、平易な要約、provenanceを提示する。',
      '3. どの候補idを承認、却下、修正するかをユーザーに確認する。',
      '4. まず `brainbase onboard:apply --from <candidate-file> --select <id>` でdry-runする。手入力の事実には `brainbase onboard:seed` を使う。',
      '5. `--write` は明示的な承認後にだけ使い、canonical filesへ書き込む。',
      '6. `brainbase doctor` を実行し、Brainbase MCPの `resolve_entity`、`get_context`、`search` で承認済み事実と正規ID接続が見えることを確認する。',
      '',
      '## 安全ルール',
      '',
      `- ${SECRET_RULE}`,
      '- 頻出しているだけの候補を自動昇格しない。',
      '- 却下または不確実な候補はcanonical SSOTに入れない。',
      '- source由来の推測と、ユーザー承認済みのdurable memoryを分ける。'
    ].join('\n')
  },
  'brainbase-daily-routines': {
    id: 'brainbase-daily-routines',
    title: 'Brainbase日次ルーティン',
    description: 'ユーザーのエージェントスケジューラ向けに、個人用Brainbase ohayo、oyasumi、retroを生成する。',
    body: [
      '## 目的',
      '',
      'ユーザーがBrainbaseを一度きりの設定ではなく、継続的な個人オペレーティングループにしたい時に使う。',
      '',
      '## 手順',
      '',
      '1. `brainbase onboard:routines --target codex|claude` でルーティン定義を生成する。',
      '2. 必要に応じて `--routines ohayo,oyasumi,retro` またはsubsetを使う。',
      '3. `--ohayo-hour`、`--oyasumi-hour`、`--retro-dow`、`--retro-hour` で実行時刻を調整する。',
      '4. スケジューラに登録する前に、生成されたpromptとscheduleをユーザーと確認する。',
      '5. 各ルーティンは、ユーザー自身のローカルBrainbase MCP contextと承認済みソースだけに限定する。',
      '',
      '## 安全ルール',
      '',
      `- ${SECRET_RULE}`,
      '- 明示的な確認なしに、メッセージ送信、公開、カレンダー変更、レコード削除をしない。',
      '- 認証やcollectorの失敗は「データ未取得」と扱い、「対象ゼロ」とは扱わない。',
      '- ルーティン生成はlive scheduler登録ではない。登録はユーザーが別ステップとして行う。'
    ].join('\n')
  }
};

const BANNED_PUBLIC_TERMS = [
  'slack',
  'sns',
  'nocodb',
  'vibepro',
  'infisical',
  'lightsail',
  'hosted backend',
  'server operations',
  'server operation',
  'unson'
];

export function parseSkillTarget(value: string | undefined): SkillTarget {
  if (value === 'codex' || value === 'claude' || value === 'portable') {
    return value;
  }
  throw new Error('onboard:skills requires --target codex|claude|portable');
}

export function parseSkillIds(value: string | undefined): BrainbaseSkillId[] {
  if (!value) {
    return [...ALL_BRAINBASE_SKILLS];
  }
  const requested = new Set(value.split(',').map((part) => part.trim()).filter(Boolean));
  const unknown = [...requested].filter((id) => !isBrainbaseSkillId(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown Brainbase skill id(s): ${unknown.join(', ')}. Expected one of: ${ALL_BRAINBASE_SKILLS.join(', ')}`);
  }
  const selected = ALL_BRAINBASE_SKILLS.filter((id) => requested.has(id));
  if (selected.length === 0) {
    throw new Error(`--skills must include at least one of: ${ALL_BRAINBASE_SKILLS.join(', ')}`);
  }
  return selected;
}

export function buildSkillBundle(target: SkillTarget, ids: BrainbaseSkillId[] = ALL_BRAINBASE_SKILLS): SkillBundle {
  const skills = ids.map((id) => buildSkillFile(target, SKILL_DEFINITIONS[id]));
  return {
    target,
    goal: '個人のコーディングエージェント運用向けに、公開safeなBrainbaseオンボーディングskillsを生成する。',
    canonicalWrites: false,
    liveConfigWrites: false,
    skills,
    safetyRules: [
      SECRET_RULE,
      '生成されるskillsは個人スコープかつローカルファーストに限定する。',
      '生成されるskillsは内部Brainbase運用からコピーしない。',
      'このコマンドはportableなSKILL.mdを表示または書き出すだけで、live agent configurationは変更しない。'
    ],
    nextSteps: [
      `生成された ${target} skill files を確認する。`,
      '対象エージェントのskill directoryへ配置するか、生成ディレクトリをエージェントに参照させる。',
      '`brainbase onboard:agent` を実行し、オンボーディング面談を続ける。'
    ]
  };
}

export function renderSkillsMarkdown(bundle: SkillBundle, outDir?: string): string {
  const lines: string[] = ['# Brainbase公開オンボーディングSkills', ''];
  lines.push(`- 対象: ${bundle.target}`);
  lines.push(`- Skills: ${bundle.skills.map((skill) => skill.id).join(', ')}`);
  lines.push(`- canonical writes: ${bundle.canonicalWrites}`);
  lines.push(`- live config writes: ${bundle.liveConfigWrites}`);
  if (outDir) {
    lines.push(`- 出力ディレクトリ: ${outDir}`);
  }
  lines.push('', '## ファイル');
  for (const skill of bundle.skills) {
    lines.push('', `### ${skill.id}`, '');
    lines.push(`- 推奨パス: ${skill.recommendedPath}`);
    lines.push(`- 相対パス: ${skill.relativePath}`);
    lines.push('', '```markdown', skill.content.trimEnd(), '```');
  }
  lines.push('', '## 安全ルール');
  for (const rule of bundle.safetyRules) {
    lines.push(`- ${rule}`);
  }
  lines.push('', '## 次のステップ');
  for (const step of bundle.nextSteps) {
    lines.push(`- ${step}`);
  }
  return `${lines.join('\n')}\n`;
}

export function assertPublicSafeSkillBundle(bundle: SkillBundle): void {
  const haystack = bundle.skills.map((skill) => skill.content).join('\n').toLowerCase();
  for (const term of BANNED_PUBLIC_TERMS) {
    if (haystack.includes(term)) {
      throw new Error(`Generated public Brainbase skills contain banned internal term: ${term}`);
    }
  }
  for (const skill of bundle.skills) {
    if (!skill.content.includes(SECRET_RULE)) {
      throw new Error(`Generated skill ${skill.id} is missing the no-secrets safety rule.`);
    }
  }
}

function buildSkillFile(target: SkillTarget, definition: BrainbaseSkillDefinition): SkillFile {
  const relativePath = `${definition.id}/SKILL.md`;
  return {
    id: definition.id,
    description: definition.description,
    relativePath,
    recommendedPath: `${TARGET_BASE_PATHS[target]}/${relativePath}`,
    content: renderSkillContent(definition)
  };
}

function renderSkillContent(definition: BrainbaseSkillDefinition): string {
  return [
    '---',
    `name: ${definition.id}`,
    `description: ${definition.description}`,
    '---',
    '',
    `# ${definition.title}`,
    '',
    definition.body,
    ''
  ].join('\n');
}

function isBrainbaseSkillId(value: string): value is BrainbaseSkillId {
  return (ALL_BRAINBASE_SKILLS as string[]).includes(value);
}
