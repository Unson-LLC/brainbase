import { buildSourceDiagnosis, type SourceArea, type SourceDiagnosis } from './onboarding.js';
import { buildProjectRegistrationPlan, type ProjectRegistrationInput, type ProjectSourceReference, type ProjectStakeholder } from './projects.js';

export type GuidedTarget = 'codex' | 'claude' | 'codecode';
export type GuidedFormat = 'markdown' | 'json';

export interface GuidedFirstRunInput {
  dataDir: string;
  target: GuidedTarget;
  profile?: string;
  host?: string;
  name?: string;
  value?: string[];
  email?: string;
  secondaryEmails?: string[];
  calendar?: string;
  drive?: string;
  driveFolders?: string[];
  localFolders?: string[];
  tasks?: string;
  inactiveTaskTools?: string[];
  gogCommand?: string;
  assumeGog?: boolean;
  gogAvailable?: boolean;
  project?: ProjectRegistrationInput;
  missing?: string[];
  connected?: boolean;
}

export interface GuidedInterviewSection {
  id: string;
  title: string;
  questions: string[];
}

export interface GuidedSourceReadiness {
  area: SourceArea;
  title: string;
  input: string;
  status: SourceDiagnosis['status'];
  statusLabel: string;
  requiredUserInput: string[];
  setupCommands: string[];
  safetyNotes: string[];
}

export interface GuidedCommand {
  id: string;
  title: string;
  when: string;
  command: string;
}

export interface GuidedFirstRun {
  goal: string;
  language: 'ja';
  profile: string;
  target: GuidedTarget;
  dataDir: string;
  initialized: {
    personalOs: true;
    canonicalFactWrites: false;
    note: string;
  };
  currentStatus: {
    connected: boolean;
    missing: string[];
  };
  interview: GuidedInterviewSection[];
  answers: {
    selfName?: string;
    values: string[];
    projectName?: string;
    email: string;
    secondaryEmails: string[];
    calendar: string;
    drive: string;
    driveFolders: string[];
    localFolders: string[];
    tasks: string;
    inactiveTaskTools: string[];
  };
  sourceReadiness: GuidedSourceReadiness[];
  projectRegistration: {
    available: boolean;
    dryRunCommand?: string;
    writeCommand?: string;
    approvalNote: string;
  };
  nextCommands: GuidedCommand[];
  approvalGates: string[];
  completionCheck: string[];
}

export function buildGuidedFirstRun(input: GuidedFirstRunInput): GuidedFirstRun {
  const profile = input.profile || 'google-workspace-local';
  const email = normalize(input.email || 'google-workspace');
  const calendar = normalize(input.calendar || 'google-calendar');
  const drive = normalize(input.drive || 'google-drive');
  const tasks = normalize(input.tasks || 'scattered-calendar-notes');
  const secondaryEmails = input.secondaryEmails ?? [];
  const driveFolders = input.driveFolders ?? [];
  const localFolders = input.localFolders ?? [];
  const values = input.value ?? [];
  const inactiveTaskTools = input.inactiveTaskTools ?? [];

  const sourceSet = buildSourceDiagnosis({
    dataDir: input.dataDir,
    email,
    calendar,
    drive,
    tasks,
    gogCommand: input.gogCommand,
    gogAvailable: input.gogAvailable,
    driveFolders
  });

  const project = input.project?.name
    ? buildProjectRegistrationPlan({
      ...input.project,
      sources: normalizeProjectSources([
        ...(input.project.sources ?? []),
        ...deriveProjectSources({ email, calendar, drive, tasks, driveFolders, localFolders })
      ])
    })
    : undefined;

  const diagnoseCommand = command([
    'brainbase',
    'onboard:diagnose-sources',
    '--dir', input.dataDir,
    '--email', email,
    '--calendar', calendar,
    '--drive', drive,
    ...driveFolders.flatMap((folder) => ['--drive-folder', folder]),
    '--tasks', tasks,
    ...(input.gogCommand ? ['--gog-command', input.gogCommand] : []),
    ...(input.assumeGog ? ['--assume-gog'] : [])
  ]);
  const selfSeedCommand = command([
    'brainbase',
    'onboard:seed',
    '--dir', input.dataDir,
    '--name', input.name || '<あなたの名前>',
    ...values.flatMap((value) => ['--value', value]),
    '--project', input.project?.name || '<最初に登録するプロジェクト>'
  ]);
  const projectDryRunCommand = project
    ? projectCommand(input.dataDir, project.project.name, input.project, project.project.sources, false)
    : undefined;
  const projectWriteCommand = project
    ? projectCommand(input.dataDir, project.project.name, input.project, project.project.sources, true)
    : undefined;

  return {
    goal: 'Codex / Claude Code / CodeCode が質問しながら、ローカル Brainbase MCP の初回セットアップを日本語で開始できるようにする。',
    language: 'ja',
    profile,
    target: input.target,
    dataDir: input.dataDir,
    initialized: {
      personalOs: true,
      canonicalFactWrites: false,
      note: 'このコマンドはPersonal OSの最小ディレクトリだけを用意します。自己情報、プロジェクト、関係性、判断基準は承認後のコマンドで正本化します。'
    },
    currentStatus: {
      connected: input.connected ?? false,
      missing: input.missing ?? ['self', 'work', 'relationships']
    },
    interview: buildJapaneseInterview(),
    answers: {
      selfName: input.name,
      values,
      projectName: input.project?.name,
      email,
      secondaryEmails,
      calendar,
      drive,
      driveFolders,
      localFolders,
      tasks,
      inactiveTaskTools
    },
    sourceReadiness: sourceSet.diagnostics.map(toGuidedSourceReadiness),
    projectRegistration: {
      available: Boolean(project),
      dryRunCommand: projectDryRunCommand,
      writeCommand: projectWriteCommand,
      approvalNote: project
        ? 'まずdry-runでプロジェクト名、目的、状態、自分の役割、関係者、許可ソースを確認し、承認後だけ --write で正本へ入れます。'
        : 'プロジェクト名が未入力です。Codex / Claude Code は最初に「いまBrainbaseに登録したいプロジェクト」を確認してください。'
    },
    nextCommands: [
      {
        id: 'self-seed',
        title: '自己情報と最初の仕事文脈を正本化する',
        when: '名前、価値観、最初のプロジェクトを本人が確認した後',
        command: selfSeedCommand
      },
      {
        id: 'source-diagnosis',
        title: 'メール・カレンダー・ドライブ・タスクの接続準備を診断する',
        when: '利用ツールと読み取り範囲を聞き取った後',
        command: diagnoseCommand
      },
      ...(projectDryRunCommand ? [{
        id: 'project-dry-run',
        title: 'プロジェクト登録内容を確認する',
        when: 'プロジェクトの目的、状態、役割、関係者、許可ソースを聞き取った後',
        command: projectDryRunCommand
      }] : []),
      ...(projectWriteCommand ? [{
        id: 'project-write',
        title: '承認済みプロジェクトを正本化する',
        when: 'dry-run結果を本人が承認した後',
        command: projectWriteCommand
      }] : []),
      {
        id: 'candidates',
        title: '候補ファクトをレビュー用に作る',
        when: '聞き取り内容をまだ正本化せずレビュー材料にしたい時',
        command: command([
          'brainbase',
          'onboard:candidates',
          '--dir', input.dataDir,
          '--write',
          '--name', input.name || '<あなたの名前>',
          '--project', input.project?.name || '<現在のプロジェクト>'
        ])
      },
      {
        id: 'install',
        title: `${targetLabel(input.target)} 用のMCP設定を確認する`,
        when: 'Personal OSの最小seed後',
        command: command(['brainbase', 'onboard:install', '--target', input.target, '--dir', input.dataDir, '--dry-run'])
      },
      {
        id: 'doctor',
        title: '不足しているseedと接続状態を確認する',
        when: '各ステップの後',
        command: command(['brainbase', 'doctor', '--dir', input.dataDir])
      }
    ],
    approvalGates: [
      'OAuth token、password、API key、refresh tokenはチャットへ貼らない。',
      'メール、カレンダー、ドライブ、タスクは最初はmetadata-firstで扱う。',
      'Google Driveとローカルファイルは明示されたfolder allowlistだけを見る。',
      'sources/ と candidates/ は二次材料であり、本人承認前にMCPの正本文脈へ入れない。',
      'プロジェクト、関係者、判断基準はdry-run確認後だけ --write または onboard:seed で正本化する。'
    ],
    completionCheck: [
      'doctor の missing が空になる。',
      `${targetLabel(input.target)} のMCP設定に Brainbase が入っている。`,
      '最初のプロジェクトが get_context/search で見える。',
      '外部ソースは許可範囲、保存先、正本化前レビューの流れが説明できる。'
    ]
  };
}

export function renderGuidedFirstRun(input: GuidedFirstRunInput, format: GuidedFormat): string {
  const guide = buildGuidedFirstRun(input);
  if (format === 'json') {
    return `${JSON.stringify(guide, null, 2)}\n`;
  }

  const lines: string[] = [
    '# Brainbase 初回オンボーディング開始',
    '',
    guide.goal,
    '',
    `- 対象エージェント: ${targetLabel(guide.target)}`,
    `- データディレクトリ: \`${guide.dataDir}\``,
    `- 正本ファクト書き込み: ${guide.initialized.canonicalFactWrites ? 'あり' : 'なし'}`,
    `- 現在の不足: ${guide.currentStatus.missing.length > 0 ? guide.currentStatus.missing.join(', ') : 'なし'}`,
    '',
    '## エージェントの聞き取り',
    ...guide.interview.flatMap((section) => [
      '',
      `### ${section.title}`,
      ...section.questions.map((question) => `- ${question}`)
    ]),
    '',
    '## 接続準備',
    ...guide.sourceReadiness.flatMap((source) => [
      '',
      `### ${source.title}`,
      `- 入力: ${source.input}`,
      `- 状態: ${source.statusLabel}`,
      '- 追加で必要な確認:',
      ...(source.requiredUserInput.length === 0 ? ['  - なし'] : source.requiredUserInput.map((item) => `  - ${item}`)),
      '- 次に実行する候補:',
      ...(source.setupCommands.length === 0 ? ['  - なし'] : source.setupCommands.map((item) => `  - \`${item}\``))
    ]),
    '',
    '## プロジェクト登録',
    `- 状態: ${guide.projectRegistration.available ? '登録案あり' : 'プロジェクト名の聞き取り待ち'}`,
    `- 方針: ${guide.projectRegistration.approvalNote}`,
    ...(guide.projectRegistration.dryRunCommand ? [`- 確認コマンド: \`${guide.projectRegistration.dryRunCommand}\``] : []),
    ...(guide.projectRegistration.writeCommand ? [`- 承認後コマンド: \`${guide.projectRegistration.writeCommand}\``] : []),
    '',
    '## 次コマンド',
    ...guide.nextCommands.map((item) => `- ${item.title}: \`${item.command}\` (${item.when})`),
    '',
    '## 承認ルール',
    ...guide.approvalGates.map((item) => `- ${item}`),
    '',
    '## 完了条件',
    ...guide.completionCheck.map((item) => `- ${item}`),
    ''
  ];
  return `${lines.join('\n')}\n`;
}

function buildJapaneseInterview(): GuidedInterviewSection[] {
  return [
    {
      id: 'self',
      title: '本人情報',
      questions: [
        'あなたの名前、呼ばれ方、Codex / Claude Code に覚えてほしい仕事上の前提は何ですか？',
        '判断基準、重視する価値観、避けたい進め方は何ですか？'
      ]
    },
    {
      id: 'project',
      title: '最初のプロジェクト',
      questions: [
        'まずBrainbaseへ登録したいプロジェクト名は何ですか？',
        'そのプロジェクトの目的、現在の状態、あなたの役割は何ですか？',
        '関係者は誰で、それぞれ何をAIに覚えておいてほしいですか？'
      ]
    },
    {
      id: 'sources',
      title: 'メール・カレンダー・ドライブ・タスク',
      questions: [
        'メールは Gmail / Google Workspace / Outlook / Apple Mail / その他のどれですか？',
        'カレンダーは Google Calendar / Outlook Calendar / Apple Calendar / その他のどれですか？',
        'ドキュメントは Google Drive / OneDrive / Dropbox / Notion / ローカルフォルダのどこにありますか？',
        'タスク管理は Notion / Todoist / Linear / GitHub Issues / NocoDB / CSV / カレンダーやメモ散在 / なし のどれですか？',
        '最初に読んでよいアカウント、カレンダー、Driveフォルダ、ローカルフォルダはどれですか？'
      ]
    },
    {
      id: 'approval',
      title: '承認',
      questions: [
        'metadataだけなら先に収集してよいですか？本文やファイル本文の抜粋はどこまで許可しますか？',
        '候補として抽出した人物、組織、プロジェクト、関係性、判断基準のどれを正本へ入れますか？'
      ]
    }
  ];
}

function toGuidedSourceReadiness(diagnosis: SourceDiagnosis): GuidedSourceReadiness {
  return {
    area: diagnosis.area,
    title: sourceTitle(diagnosis.area),
    input: diagnosis.input,
    status: diagnosis.status,
    statusLabel: statusLabel(diagnosis.status),
    requiredUserInput: diagnosis.requiredUserInput.map(translateRequiredInput),
    setupCommands: diagnosis.setupCommands,
    safetyNotes: diagnosis.safetyNotes.map(translateSafetyNote)
  };
}

function deriveProjectSources(input: {
  email: string;
  calendar: string;
  drive: string;
  tasks: string;
  driveFolders: string[];
  localFolders: string[];
}): ProjectSourceReference[] {
  const sources: ProjectSourceReference[] = [
    { area: 'mail', label: input.email, ref: '<allowed-mail-account>' },
    { area: 'calendar', label: input.calendar, ref: 'primary' },
    { area: 'tasks', label: input.tasks, ref: input.tasks }
  ];
  for (const folder of input.driveFolders) {
    sources.push({ area: 'drive', label: input.drive, ref: folder });
  }
  for (const folder of input.localFolders) {
    sources.push({ area: 'local', label: 'local folder', ref: folder });
  }
  return sources.filter((source) => !isNone(source.label));
}

function normalizeProjectSources(sources: ProjectSourceReference[]): ProjectSourceReference[] {
  const seen = new Set<string>();
  const result: ProjectSourceReference[] = [];
  for (const source of sources) {
    const key = `${source.area}|${source.label}|${source.ref}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(source);
    }
  }
  return result;
}

function projectCommand(
  dataDir: string,
  name: string,
  project: ProjectRegistrationInput | undefined,
  sources: ProjectSourceReference[],
  write: boolean
): string {
  const args = [
    'brainbase',
    'onboard:projects',
    '--dir', dataDir,
    '--name', name,
    ...(project?.goal ? ['--goal', project.goal] : []),
    ...(project?.status ? ['--status', project.status] : []),
    ...(project?.role ? ['--role', project.role] : []),
    ...((project?.stakeholders ?? []) as ProjectStakeholder[]).flatMap((stakeholder) => [
      '--stakeholder',
      `${stakeholder.person}|${stakeholder.role ?? ''}|${stakeholder.context}`
    ]),
    ...sources.flatMap((source) => ['--source', `${source.area}|${source.label}|${source.ref}`]),
    ...((project?.taskSources ?? [])).flatMap((taskSource) => ['--task-source', taskSource]),
    ...((project?.decisionPrinciples ?? [])).flatMap((principle) => ['--decision-principle', principle]),
    ...(write ? ['--write'] : [])
  ];
  return command(args);
}

function command(parts: string[]): string {
  return parts.map(quoteArg).join(' ');
}

function quoteArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/u.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function sourceTitle(area: SourceArea): string {
  if (area === 'email') return 'メール';
  if (area === 'calendar') return 'カレンダー';
  if (area === 'drive') return 'ドライブ';
  return 'タスク';
}

function statusLabel(status: SourceDiagnosis['status']): string {
  if (status === 'ready') return '準備済み';
  if (status === 'needs_setup') return 'ローカル設定が必要';
  if (status === 'needs_input') return '追加の許可範囲が必要';
  return '未設定';
}

function translateRequiredInput(value: string): string {
  if (value.includes('GoG')) return value.replace('Install or configure local GoG command', 'ローカルGoGコマンドをインストールまたは設定する');
  if (value.includes('Google Drive folder')) return '読み取りを許可するGoogle DriveフォルダIDを少なくとも1つ指定する';
  if (value.includes('Date range')) return '取得する期間とprivate calendarを除外するかを決める';
  if (value.includes('Mail account')) return '読み取り対象メールアカウントと本文抜粋の可否を決める';
  if (value.includes('Workspace/project/database')) return '読み取り対象workspace/project/databaseのallowlistを決める';
  if (value.includes('Read-only export')) return 'read-only exportまたはconnectorの経路を決める';
  if (value.includes('Explicit local')) return '明示的に許可したローカルファイル、フォルダ、CSV、JSONL export pathを指定する';
  return value;
}

function translateSafetyNote(value: string): string {
  if (value.includes('Do not paste secrets')) return 'secretはチャットへ貼らない。';
  if (value.includes('Do not scan the whole Drive')) return 'Drive全体は走査せず、許可フォルダだけを見る。';
  if (value.includes('metadata')) return '最初はmetadata-firstで扱う。本文やファイル本文は明示承認後だけ扱う。';
  return value;
}

function targetLabel(target: GuidedTarget): string {
  if (target === 'claude') return 'Claude Code';
  if (target === 'codecode') return 'CodeCode';
  return 'Codex';
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function isNone(value: string): boolean {
  return ['none', 'no', 'なし', ''].includes(normalize(value));
}
