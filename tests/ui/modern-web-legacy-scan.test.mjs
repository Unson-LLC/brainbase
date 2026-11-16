import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packageJson = createRequire(import.meta.url).resolve('modern-web-guidance/package.json');
const cli = join(dirname(packageJson), 'skills', 'modern-web-guidance', 'modern-web.mjs');
// The scanner needs Node 22+. The Node 20 job runs only the integration suite, not this file.
const supported = Number(process.versions.node.split('.')[0]) >= 22;

describe('ui/ legacy web pattern scan', () => {
  // Deterministic rules cover about 20% of the guidance; the rest is applied through the project skill.
  it.skipIf(!supported)('finds no legacy pattern that has a modern replacement', () => {
    const output = execFileSync(process.execPath, [cli, 'legacy-scan', 'ui', '--json'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DISABLE_TELEMETRY: '1' },
      maxBuffer: 32 * 1024 * 1024,
    });
    const report = JSON.parse(output);
    const findings = report.guides.flatMap(guide => guide.rules.flatMap(rule =>
      rule.findings.map(finding => `${guide.guideId}: ui/${finding.file}:${finding.line}`)));
    expect(findings, 'Run `npx modern-web-guidance retrieve <guide-id>` and apply the guide, or keep a feature-detected fallback.').toEqual([]);
    expect(report.totalFindings).toBe(0);
  }, 120_000);
});
