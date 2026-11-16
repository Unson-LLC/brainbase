import { ConfigParser } from '../src/config-parser.js';
import type {
    ConfigParserOptions,
    ConfigSnapshot,
    IntegrityReport,
    PluginSettings,
    ProjectCatalog,
    ProjectConfig,
    SlackChannel,
    UnifiedView,
} from '../src/config-parser.js';

const options = {
    configPath: '/tmp/brainbase/config.yml',
    slackDir: '/tmp/brainbase/slack',
    brainbaseRoot: '/tmp/brainbase/root',
    projectsRoot: '/tmp/brainbase/projects',
    catalogMode: 'required' as const,
} satisfies ConfigParserOptions;

async function verifyPublicContract(): Promise<void> {
    const parser = new ConfigParser(options);
    const snapshot: ConfigSnapshot = await parser.getAll();
    const projects: ProjectCatalog = await parser.getProjects();
    const channels: SlackChannel[] = await parser.getChannels();
    const unified: UnifiedView = await parser.getUnifiedView();
    const integrity: IntegrityReport = await parser.checkIntegrity();
    const plugins: PluginSettings = await parser.getPlugins();

    parser.invalidateCache();
    void snapshot;
    void projects;
    void channels;
    void unified;
    void integrity;
    void plugins;
}

void verifyPublicContract();

const invalidOptions = {
    ...options,
    catalogMode: 'unsupported' as const,
};
// @ts-expect-error catalogMode is intentionally outside the public union.
new ConfigParser(invalidOptions);

const invalidProject = { id: 123 };
// @ts-expect-error ProjectConfig ids are strings when provided.
const invalidProjectConfig: ProjectConfig = invalidProject;
void invalidProjectConfig;
