import {
  auditOntology,
  resolveOntologyVersion,
  type OntologyVersion,
  type PersonalOsOntologyAudit
} from './ontology.js';
import { loadPersonalOs } from './ssot.js';

export async function auditPersonalOsDirectory(
  dataDir: string,
  options: { ontologyVersion?: OntologyVersion } = {}
): Promise<PersonalOsOntologyAudit> {
  try {
    return auditOntology(await loadPersonalOs(dataDir), options);
  } catch (error) {
    const ontologyVersion = resolveOntologyVersion(options.ontologyVersion);
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'unverified',
      ontologyVersion,
      violationCount: null,
      violations: [],
      counts: null,
      coverage: {
        complete: false,
        unavailableSources: canonicalSourcesFromError(message)
      },
      issues: [{
        ruleId: 'ONT-AUDIT-SOURCE-UNAVAILABLE',
        severity: 'error',
        path: dataDir,
        message
      }]
    };
  }
}

function canonicalSourcesFromError(message: string): string[] {
  const sources = ['graph.json', 'relationships.json', 'personal-kg.jsonl', 'decisions.jsonl'];
  const matched = sources.filter((source) => message.includes(source));
  return matched.length > 0 ? matched : sources;
}
