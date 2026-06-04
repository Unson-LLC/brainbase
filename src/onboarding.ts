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

export function parseOnboardingFormat(value: string | undefined): OnboardingFormat {
  if (!value || value === 'markdown') {
    return 'markdown';
  }
  if (value === 'json') {
    return 'json';
  }
  throw new Error('format must be markdown|json');
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
