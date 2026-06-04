export type OnboardingFormat = 'markdown' | 'json';

export type SourceArea = 'email' | 'calendar' | 'drive' | 'tasks';

export interface ConnectorRecommendation {
  area: SourceArea;
  input: string;
  recommendation: string;
  sourcePath: string;
  importMode: 'metadata-first' | 'export-first' | 'manual' | 'not-configured';
  setupHints: string[];
  safetyNotes: string[];
}

export interface ConnectorRecommendationSet {
  goal: string;
  recommendations: ConnectorRecommendation[];
  canonicalization: string[];
  nextCommands: string[];
}

export type SourceDiagnosisStatus = 'ready' | 'needs_setup' | 'needs_input' | 'not_configured';

export interface SourceDiagnosis {
  area: SourceArea;
  input: string;
  status: SourceDiagnosisStatus;
  collector: string | null;
  sourcePath: string;
  writeTarget: string;
  importMode: ConnectorRecommendation['importMode'];
  requiredUserInput: string[];
  setupCommands: string[];
  safetyNotes: string[];
}

export interface SourceDiagnosisSet {
  goal: string;
  diagnostics: SourceDiagnosis[];
  nextCommands: string[];
  safetyRules: string[];
}

export interface AgentOnboardingProtocol {
  goal: string;
  interviewSections: Array<{
    id: string;
    title: string;
    questions: string[];
  }>;
  safetyRules: string[];
  nextCommands: string[];
  completionCheck: string[];
}

export interface RecommendationInput {
  email?: string;
  calendar?: string;
  drive?: string;
  tasks?: string;
}

export interface SourceDiagnosisInput extends RecommendationInput {
  dataDir: string;
  gogCommand?: string;
  gogAvailable?: boolean;
  driveFolders?: string[];
}

export interface CandidateInput {
  dataDir: string;
  name?: string;
  values?: string[];
  projects?: string[];
  relationships?: string[];
  decisionPrinciples?: string[];
  now?: string;
}

export interface OnboardingCandidate {
  id: string;
  kind: 'self' | 'value' | 'project' | 'relationship' | 'decision';
  payload: Record<string, string | string[] | undefined>;
  source: 'agent-interview';
  promoted: false;
  createdAt: string;
}

export interface CandidateDraftSet {
  goal: string;
  canonicalWrites: false;
  candidatePath: string;
  candidates: OnboardingCandidate[];
  safetyRules: string[];
  nextCommands: string[];
}

export function buildAgentOnboardingProtocol(): AgentOnboardingProtocol {
  return {
    goal: 'Help the user build a local Brainbase Personal OS that Codex, Claude Code, or CodeCode can read through MCP.',
    interviewSections: [
      {
        id: 'email',
        title: 'Mail',
        questions: [
          'What mail tool do you use: Gmail, Outlook, Apple Mail, or something else?',
          'Which account should Brainbase inspect first?',
          'Should the first pass be metadata only, or are short body excerpts allowed after confirmation?'
        ]
      },
      {
        id: 'calendar',
        title: 'Calendar',
        questions: [
          'What calendar do you use: Google Calendar, Outlook Calendar, Apple Calendar, or something else?',
          'How far back and forward should Brainbase inspect?',
          'Are private calendars excluded?'
        ]
      },
      {
        id: 'drive',
        title: 'Drive and Docs',
        questions: [
          'Where do work documents live: Google Drive, OneDrive, Dropbox, Notion, local folders, or somewhere else?',
          'Which folders are explicitly allowed?',
          'Should Brainbase start with metadata only before reading excerpts?'
        ]
      },
      {
        id: 'tasks',
        title: 'Tasks',
        questions: [
          'What task system do you use: Notion, Todoist, Linear, GitHub Issues, NocoDB, CSV, or none?',
          'Which projects or workspaces should be included?',
          'Who owns task status decisions?'
        ]
      },
      {
        id: 'permissions',
        title: 'Permissions',
        questions: [
          'Which accounts, calendars, folders, projects, or workspaces are explicitly allowed?',
          'Which sources must be excluded from Brainbase onboarding?',
          'Is metadata-only collection acceptable before any body text or document excerpts are read?'
        ]
      },
      {
        id: 'approval',
        title: 'Review and approval',
        questions: [
          'What active projects should become canonical work context?',
          'Which key relationships should Brainbase remember?',
          'Which decision principles should guide future Codex or Claude Code work?',
          'Which extracted people, organizations, projects, relationships, and decisions should be promoted to canonical SSOT?',
          'Which sources are sensitive and should stay raw-only or excluded?',
          'What should Codex or Claude Code remember for future work?'
        ]
      }
    ],
    safetyRules: [
      'Do not ask the user to paste OAuth tokens, passwords, API keys, or refresh tokens into chat.',
      'Use read-only collection paths where available.',
      'Keep mail, calendar, drive, and task data under sources/ until the user approves candidates.',
      'Prefer metadata-first import. Body excerpts require explicit user approval.',
      'Drive collection must be folder allowlist based.',
      'Canonical MCP context comes from graph.json, personal-kg.jsonl, relationships.json, and decisions.jsonl.'
    ],
    nextCommands: [
      'brainbase onboard:init',
      'brainbase onboard:diagnose-sources --email gmail --calendar google-calendar --drive google-drive --drive-folder "<folder-id>" --tasks notion',
      'brainbase onboard:candidates --write --name "<name>" --project "<current project>"',
      'brainbase onboard:recommend --email gmail --calendar google-calendar --drive google-drive --tasks notion',
      'brainbase onboard:seed --name "<name>" --value "<what matters>" --project "<current project>"',
      'brainbase onboard:install --target codex --dry-run',
      'brainbase doctor'
    ],
    completionCheck: [
      'Personal OS directory exists.',
      'sources/ has provider-specific folders but raw source files are not canonical context.',
      'doctor reports connected=true and missing=[].',
      'The selected MCP client has a Brainbase config snippet.',
      'The user has reviewed what Brainbase is allowed to remember.'
    ]
  };
}

export function buildSourceDiagnosis(input: SourceDiagnosisInput): SourceDiagnosisSet {
  const recommendationSet = buildConnectorRecommendations(input);
  const diagnostics = recommendationSet.recommendations.map((recommendation) => diagnoseRecommendation(recommendation, input));

  return {
    goal: 'Diagnose local source collection readiness before any raw material or candidates are promoted into canonical Brainbase SSOT.',
    diagnostics,
    nextCommands: [
      'brainbase onboard:candidates --write --name "<name>" --project "<current project>"',
      'brainbase doctor',
      'brainbase onboard:seed --name "<name>" --value "<approved value>" --project "<approved project>"'
    ],
    safetyRules: [
      'Do not paste OAuth tokens, passwords, API keys, or refresh tokens into chat.',
      'Use metadata-first source collection before body text or document excerpts.',
      'Keep provider output under sources/ and extracted facts under candidates/.',
      'Promote only reviewed candidate facts into canonical SSOT.',
      'Drive collection must use explicit folder allowlists.'
    ]
  };
}

export function buildCandidateDrafts(input: CandidateInput): CandidateDraftSet {
  const now = input.now ?? new Date().toISOString();
  const candidates: OnboardingCandidate[] = [];

  if (input.name) {
    candidates.push(candidate('self', { name: input.name }, now));
  }
  for (const value of input.values ?? []) {
    candidates.push(candidate('value', { text: value, tags: ['onboarding'] }, now));
  }
  for (const project of input.projects ?? []) {
    candidates.push(candidate('project', { name: project, summary: 'Approved during Brainbase agent onboarding.' }, now));
  }
  for (const principle of input.decisionPrinciples ?? []) {
    candidates.push(candidate('decision', {
      title: 'Agent onboarding decision principle',
      decision: principle,
      tags: ['principle', 'onboarding']
    }, now));
  }
  for (const encoded of input.relationships ?? []) {
    const [person, role, context] = encoded.split('|').map((part) => part.trim());
    if (!person || !context) {
      throw new Error('relationship must be "person|role|context" or "person||context"');
    }
    candidates.push(candidate('relationship', { person, role: role || undefined, context }, now));
  }

  return {
    goal: 'Review candidate facts before promoting them into canonical Brainbase SSOT.',
    canonicalWrites: false,
    candidatePath: `${input.dataDir}/candidates/onboarding-candidates-${fileSafeTimestamp(now)}.json`,
    candidates,
    safetyRules: [
      'Candidates are not canonical memory.',
      'Do not promote raw source material without user review.',
      'Only approved facts should be copied into graph.json, personal-kg.jsonl, relationships.json, or decisions.jsonl.'
    ],
    nextCommands: [
      'Review the candidate file with the user.',
      'Promote approved self/work/relationship facts with brainbase onboard:seed.',
      'Run brainbase doctor after promotion.'
    ]
  };
}

export function buildConnectorRecommendations(input: RecommendationInput): ConnectorRecommendationSet {
  const recommendations = [
    recommendEmail(input.email),
    recommendCalendar(input.calendar),
    recommendDrive(input.drive),
    recommendTasks(input.tasks)
  ];

  return {
    goal: 'Choose a local, read-only source collection path before promoting reviewed candidates into Brainbase canonical SSOT.',
    recommendations,
    canonicalization: [
      'Store imported source material under sources/ by provider.',
      'Extract candidates into candidates/ before canonical writes.',
      'Promote only user-approved people, organizations, projects, relationships, decisions, and personal KG entries.',
      'Normal MCP tools should prefer canonical files over raw source material.'
    ],
    nextCommands: [
      'brainbase onboard:init',
      'brainbase onboard:install --target codex --dry-run',
      'brainbase doctor'
    ]
  };
}

export function renderAgentProtocol(format: OnboardingFormat): string {
  const protocol = buildAgentOnboardingProtocol();
  if (format === 'json') {
    return `${JSON.stringify(protocol, null, 2)}\n`;
  }

  return [
    '# Brainbase Agent Onboarding Protocol',
    '',
    protocol.goal,
    '',
    '## Interview',
    ...protocol.interviewSections.flatMap((section) => [
      '',
      `### ${section.title}`,
      ...section.questions.map((question) => `- ${question}`)
    ]),
    '',
    '## Safety Rules',
    ...protocol.safetyRules.map((rule) => `- ${rule}`),
    '',
    '## Next Commands',
    ...protocol.nextCommands.map((command) => `- \`${command}\``),
    '',
    '## Completion Check',
    ...protocol.completionCheck.map((check) => `- ${check}`),
    ''
  ].join('\n');
}

export function renderConnectorRecommendations(input: RecommendationInput, format: OnboardingFormat): string {
  const recommendationSet = buildConnectorRecommendations(input);
  if (format === 'json') {
    return `${JSON.stringify(recommendationSet, null, 2)}\n`;
  }

  return [
    '# Brainbase Connector Recommendations',
    '',
    recommendationSet.goal,
    '',
    ...recommendationSet.recommendations.flatMap((recommendation) => [
      `## ${labelForArea(recommendation.area)}`,
      '',
      `- Input: ${recommendation.input}`,
      `- Recommendation: ${recommendation.recommendation}`,
      `- Source path: \`${recommendation.sourcePath}\``,
      `- Import mode: ${recommendation.importMode}`,
      '- Setup hints:',
      ...recommendation.setupHints.map((hint) => `  - ${hint}`),
      '- Safety notes:',
      ...recommendation.safetyNotes.map((note) => `  - ${note}`),
      ''
    ]),
    '## Canonicalization',
    ...recommendationSet.canonicalization.map((item) => `- ${item}`),
    '',
    '## Next Commands',
    ...recommendationSet.nextCommands.map((command) => `- \`${command}\``),
    ''
  ].join('\n');
}

export function renderSourceDiagnosis(input: SourceDiagnosisInput, format: OnboardingFormat): string {
  const diagnosisSet = buildSourceDiagnosis(input);
  if (format === 'json') {
    return `${JSON.stringify(diagnosisSet, null, 2)}\n`;
  }

  return [
    '# Brainbase Source Diagnosis',
    '',
    diagnosisSet.goal,
    '',
    ...diagnosisSet.diagnostics.flatMap((diagnosis) => [
      `## ${labelForArea(diagnosis.area)}`,
      '',
      `- Input: ${diagnosis.input}`,
      `- Status: ${diagnosis.status}`,
      `- Collector: ${diagnosis.collector ?? 'none'}`,
      `- Source path: \`${diagnosis.sourcePath}\``,
      `- Write target: \`${diagnosis.writeTarget}\``,
      `- Import mode: ${diagnosis.importMode}`,
      '- Required user input:',
      ...(diagnosis.requiredUserInput.length === 0 ? ['  - none'] : diagnosis.requiredUserInput.map((item) => `  - ${item}`)),
      '- Setup commands:',
      ...(diagnosis.setupCommands.length === 0 ? ['  - none'] : diagnosis.setupCommands.map((command) => `  - \`${command}\``)),
      '- Safety notes:',
      ...diagnosis.safetyNotes.map((note) => `  - ${note}`),
      ''
    ]),
    '## Safety Rules',
    ...diagnosisSet.safetyRules.map((rule) => `- ${rule}`),
    '',
    '## Next Commands',
    ...diagnosisSet.nextCommands.map((command) => `- \`${command}\``),
    ''
  ].join('\n');
}

export function renderCandidateDrafts(input: CandidateInput, format: OnboardingFormat): string {
  const candidateSet = buildCandidateDrafts(input);
  if (format === 'json') {
    return `${JSON.stringify(candidateSet, null, 2)}\n`;
  }

  return [
    '# Brainbase Onboarding Candidates',
    '',
    candidateSet.goal,
    '',
    `- Canonical writes: ${String(candidateSet.canonicalWrites)}`,
    `- Candidate path: \`${candidateSet.candidatePath}\``,
    '',
    '## Candidates',
    ...(candidateSet.candidates.length === 0
      ? ['- none']
      : candidateSet.candidates.map((candidate) => `- ${candidate.kind}: ${JSON.stringify(candidate.payload)}`)),
    '',
    '## Safety Rules',
    ...candidateSet.safetyRules.map((rule) => `- ${rule}`),
    '',
    '## Next Commands',
    ...candidateSet.nextCommands.map((command) => `- ${command}`),
    ''
  ].join('\n');
}

export function parseOnboardingFormat(value: string | undefined): OnboardingFormat {
  if (!value || value === 'markdown') {
    return 'markdown';
  }
  if (value === 'json') {
    return 'json';
  }
  throw new Error('format must be markdown|json');
}

function diagnoseRecommendation(recommendation: ConnectorRecommendation, input: SourceDiagnosisInput): SourceDiagnosis {
  const writeTarget = `${input.dataDir}/${recommendation.sourcePath}`;
  if (recommendation.importMode === 'not-configured') {
    return {
      area: recommendation.area,
      input: recommendation.input,
      status: 'not_configured',
      collector: null,
      sourcePath: recommendation.sourcePath,
      writeTarget,
      importMode: recommendation.importMode,
      requiredUserInput: [],
      setupCommands: [],
      safetyNotes: recommendation.safetyNotes
    };
  }

  if (isGoogleDiagnosis(recommendation)) {
    const gogCommand = input.gogCommand || 'gog';
    const driveFolders = input.driveFolders ?? [];
    const needsDriveFolder = recommendation.area === 'drive' && driveFolders.length === 0;
    const status: SourceDiagnosisStatus = input.gogAvailable
      ? (needsDriveFolder ? 'needs_input' : 'ready')
      : 'needs_setup';
    return {
      area: recommendation.area,
      input: recommendation.input,
      status,
      collector: 'gog',
      sourcePath: recommendation.sourcePath,
      writeTarget,
      importMode: 'metadata-first',
      requiredUserInput: [
        ...(input.gogAvailable ? [] : [`Install or configure local GoG command: ${gogCommand}`]),
        ...(needsDriveFolder ? ['At least one allowed Google Drive folder id'] : []),
        ...(recommendation.area === 'calendar' ? ['Date range and private-calendar exclusion decision'] : []),
        ...(recommendation.area === 'email' ? ['Mail account and metadata/body-excerpt scope decision'] : [])
      ],
      setupCommands: googleSetupCommands(recommendation.area, gogCommand, writeTarget, driveFolders),
      safetyNotes: recommendation.safetyNotes
    };
  }

  return {
    area: recommendation.area,
    input: recommendation.input,
    status: recommendation.importMode === 'manual' ? 'needs_input' : 'needs_setup',
    collector: collectorFor(recommendation),
    sourcePath: recommendation.sourcePath,
    writeTarget,
    importMode: recommendation.importMode,
    requiredUserInput: nonGoogleRequiredInput(recommendation),
    setupCommands: nonGoogleSetupCommands(recommendation, writeTarget),
    safetyNotes: recommendation.safetyNotes
  };
}

function isGoogleDiagnosis(recommendation: ConnectorRecommendation): boolean {
  return recommendation.importMode === 'metadata-first'
    && (recommendation.recommendation.includes('GoG') || recommendation.recommendation.includes('Google'));
}

function googleSetupCommands(area: SourceArea, gogCommand: string, writeTarget: string, driveFolders: string[]): string[] {
  if (area === 'email') {
    return [
      `${gogCommand} gmail auth --readonly`,
      `${gogCommand} gmail threads --metadata --out ${writeTarget}`
    ];
  }
  if (area === 'calendar') {
    return [
      `${gogCommand} calendar auth --readonly`,
      `${gogCommand} calendar events --metadata --out ${writeTarget}`
    ];
  }
  if (area === 'drive') {
    const folder = driveFolders[0] ?? '<allowed-folder-id>';
    return [
      `${gogCommand} drive auth --readonly`,
      `${gogCommand} drive ls ${folder} --json --out ${writeTarget}`,
      `${gogCommand} drive download <file-id> --out <approved-output-path>`
    ];
  }
  return [];
}

function collectorFor(recommendation: ConnectorRecommendation): string | null {
  if (recommendation.area === 'tasks') {
    if (matches(recommendation.input, ['notion'])) return 'notion-mcp-or-export';
    if (matches(recommendation.input, ['linear'])) return 'linear-mcp-or-export';
    if (matches(recommendation.input, ['github', 'github issues', 'github-issues', 'issues'])) return 'github-connector-or-export';
    if (matches(recommendation.input, ['nocodb'])) return 'nocodb-mcp-or-export';
  }
  return recommendation.importMode === 'manual' ? 'manual-export' : 'external-export';
}

function nonGoogleRequiredInput(recommendation: ConnectorRecommendation): string[] {
  if (recommendation.importMode === 'manual') {
    return ['Explicit local file, folder, CSV, or JSONL export path'];
  }
  if (recommendation.area === 'tasks') {
    return ['Workspace/project/database allowlist', 'Read-only export or connector path'];
  }
  return ['Read-only export path', 'Allowed account or workspace'];
}

function nonGoogleSetupCommands(recommendation: ConnectorRecommendation, writeTarget: string): string[] {
  if (matches(recommendation.input, ['none', 'no', 'なし'])) {
    return [];
  }
  if (matches(recommendation.input, ['csv', 'spreadsheet', 'excel', 'manual'])) {
    return [`Normalize the approved export into ${writeTarget}`];
  }
  return [`Export or collect read-only data, then normalize JSONL into ${writeTarget}`];
}

function candidate(kind: OnboardingCandidate['kind'], payload: OnboardingCandidate['payload'], createdAt: string): OnboardingCandidate {
  return {
    id: `candidate-${kind}-${hash(`${kind}:${JSON.stringify(payload)}`)}`,
    kind,
    payload,
    source: 'agent-interview',
    promoted: false,
    createdAt
  };
}

function fileSafeTimestamp(value: string): string {
  return value.replace(/[^0-9A-Za-z-]/g, '-');
}

function hash(value: string): string {
  let hashValue = 0;
  for (const char of value) {
    hashValue = ((hashValue << 5) - hashValue + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hashValue).toString(36);
}

function recommendEmail(value: string | undefined): ConnectorRecommendation {
  const input = normalizeInput(value);
  if (isNone(input)) return notConfigured('email', input, 'sources/gmail/threads.jsonl');
  if (matches(input, ['gmail', 'google', 'google mail', 'google workspace', 'workspace'])) {
    return {
      area: 'email',
      input,
      recommendation: 'Use local GoG Gmail collection when available.',
      sourcePath: 'sources/gmail/threads.jsonl',
      importMode: 'metadata-first',
      setupHints: [
        'Run GoG auth for Gmail with a read-only scope.',
        'Start from thread metadata, participants, subject, dates, labels, URLs, and snippets.',
        'Collect body excerpts only after the user approves that scope.'
      ],
      safetyNotes: commonSafetyNotes()
    };
  }
  if (matches(input, ['outlook', 'microsoft', 'microsoft 365', 'office 365', 'exchange'])) {
    return exportFirst('email', input, 'sources/gmail/threads.jsonl', 'Use Microsoft Graph or mailbox export as a future connector path.');
  }
  if (matches(input, ['apple', 'apple mail', 'mail.app'])) {
    return exportFirst('email', input, 'sources/gmail/threads.jsonl', 'Use Apple Mail export or mbox import as a future connector path.');
  }
  return manual('email', input, 'sources/gmail/threads.jsonl');
}

function recommendCalendar(value: string | undefined): ConnectorRecommendation {
  const input = normalizeInput(value);
  if (isNone(input)) return notConfigured('calendar', input, 'sources/calendar/events.jsonl');
  if (matches(input, ['google', 'google-calendar', 'google calendar', 'gcal', 'google workspace', 'workspace'])) {
    return {
      area: 'calendar',
      input,
      recommendation: 'Use local GoG Google Calendar collection when available.',
      sourcePath: 'sources/calendar/events.jsonl',
      importMode: 'metadata-first',
      setupHints: [
        'Run GoG auth for calendar with a read-only scope.',
        'Collect event id, title, start/end, organizer, attendees, recurrence, URL, and selected metadata.',
        'Treat private calendars and descriptions as opt-in.'
      ],
      safetyNotes: commonSafetyNotes()
    };
  }
  if (matches(input, ['outlook', 'microsoft', 'microsoft 365', 'office 365', 'exchange'])) {
    return exportFirst('calendar', input, 'sources/calendar/events.jsonl', 'Use Microsoft Graph or calendar export as a future connector path.');
  }
  if (matches(input, ['apple', 'apple calendar', 'ical', 'icloud'])) {
    return exportFirst('calendar', input, 'sources/calendar/events.jsonl', 'Use iCalendar export as a future connector path.');
  }
  return manual('calendar', input, 'sources/calendar/events.jsonl');
}

function recommendDrive(value: string | undefined): ConnectorRecommendation {
  const input = normalizeInput(value);
  if (isNone(input)) return notConfigured('drive', input, 'sources/drive/files.jsonl');
  if (matches(input, ['google', 'google-drive', 'google drive', 'drive', 'google-docs', 'google docs', 'docs', 'google workspace', 'workspace'])) {
    return {
      area: 'drive',
      input,
      recommendation: 'Use local GoG Drive collection with an explicit folder allowlist.',
      sourcePath: 'sources/drive/files.jsonl',
      importMode: 'metadata-first',
      setupHints: [
        'Run GoG auth for Drive with a read-only scope.',
        'Ask the user for allowed folder ids before collection.',
        'Use metadata first: file id, title, mime type, owner, modified time, folder path, URL.',
        'If downloading is approved, use GoG Drive download with --out for selected files only.'
      ],
      safetyNotes: [
        ...commonSafetyNotes(),
        'Do not scan the whole Drive by default.',
        'Exclude contracts, medical, finance, and private folders unless explicitly approved.'
      ]
    };
  }
  if (matches(input, ['onedrive', 'one drive', 'sharepoint', 'microsoft'])) {
    return exportFirst('drive', input, 'sources/drive/files.jsonl', 'Use Microsoft Graph or selective export as a future connector path.');
  }
  if (matches(input, ['dropbox'])) {
    return exportFirst('drive', input, 'sources/drive/files.jsonl', 'Use Dropbox export or API collection as a future connector path.');
  }
  if (matches(input, ['local', 'folder', 'local folder', 'filesystem'])) {
    return manual('drive', input, 'sources/drive/files.jsonl', 'Use an explicit local folder allowlist.');
  }
  return manual('drive', input, 'sources/drive/files.jsonl');
}

function recommendTasks(value: string | undefined): ConnectorRecommendation {
  const input = normalizeInput(value);
  if (isNone(input)) return notConfigured('tasks', input, 'sources/tasks/tasks.jsonl');
  if (matches(input, ['notion'])) {
    return exportFirst('tasks', input, 'sources/tasks/tasks.jsonl', 'Use Notion MCP, Notion API, or a database export.');
  }
  if (matches(input, ['todoist'])) {
    return exportFirst('tasks', input, 'sources/tasks/tasks.jsonl', 'Use Todoist API or export.');
  }
  if (matches(input, ['linear'])) {
    return exportFirst('tasks', input, 'sources/tasks/tasks.jsonl', 'Use Linear MCP or issue export.');
  }
  if (matches(input, ['github', 'github issues', 'issues'])) {
    return exportFirst('tasks', input, 'sources/tasks/tasks.jsonl', 'Use GitHub Issues through the GitHub connector or export.');
  }
  if (matches(input, ['nocodb'])) {
    return exportFirst('tasks', input, 'sources/tasks/tasks.jsonl', 'Use NocoDB MCP/API or table export.');
  }
  if (matches(input, ['csv', 'spreadsheet', 'excel', 'manual'])) {
    return manual('tasks', input, 'sources/tasks/tasks.jsonl', 'Use CSV or JSONL import from an explicit file.');
  }
  return manual('tasks', input, 'sources/tasks/tasks.jsonl');
}

function exportFirst(area: SourceArea, input: string, sourcePath: string, recommendation: string): ConnectorRecommendation {
  return {
    area,
    input,
    recommendation,
    sourcePath,
    importMode: 'export-first',
    setupHints: [
      'Prefer an official read-only API or user-generated export.',
      'Normalize into JSONL under the source path before extracting candidates.'
    ],
    safetyNotes: commonSafetyNotes()
  };
}

function manual(area: SourceArea, input: string, sourcePath: string, recommendation = 'Use a manual export or local JSONL file until a connector is implemented.'): ConnectorRecommendation {
  return {
    area,
    input,
    recommendation,
    sourcePath,
    importMode: 'manual',
    setupHints: [
      'Ask the user for an explicit export file or folder.',
      'Normalize into JSONL under the source path before extracting candidates.'
    ],
    safetyNotes: commonSafetyNotes()
  };
}

function notConfigured(area: SourceArea, input: string, sourcePath: string): ConnectorRecommendation {
  return {
    area,
    input,
    recommendation: 'No connector configured for this area.',
    sourcePath,
    importMode: 'not-configured',
    setupHints: [
      'Skip this area during onboarding unless the user later selects a tool.'
    ],
    safetyNotes: commonSafetyNotes()
  };
}

function commonSafetyNotes(): string[] {
  return [
    'Keep raw source material under sources/ until reviewed.',
    'Do not paste secrets or OAuth tokens into chat.',
    'Promote only approved candidates into canonical SSOT.'
  ];
}

function normalizeInput(value: string | undefined): string {
  return value?.trim().toLowerCase() || 'none';
}

function matches(input: string, aliases: string[]): boolean {
  return aliases.includes(input);
}

function isNone(input: string): boolean {
  return input === 'none' || input === 'no' || input === 'なし';
}

function labelForArea(area: SourceArea): string {
  if (area === 'email') return 'Email';
  if (area === 'calendar') return 'Calendar';
  if (area === 'drive') return 'Drive and Docs';
  return 'Tasks';
}
