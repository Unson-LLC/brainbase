import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import PlaywrightReporter from '../../../scripts/evidence-reporters/canonical-task-playwright-reporter.js';
import VitestReporter from '../../../scripts/evidence-reporters/canonical-task-vitest-reporter.js';
import {
  EVIDENCE_ATTACHMENT_NAME,
  EVIDENCE_ANNOTATION_TYPE,
  EVIDENCE_CONTENT_TYPE,
  withCanonicalTaskEvidence,
} from '../../helpers/canonical-task-evidence.js';

const originalEvidenceEnv = {
  VIBEPRO_EVIDENCE_ID: process.env.VIBEPRO_EVIDENCE_ID,
  VIBEPRO_EVIDENCE_RESULT: process.env.VIBEPRO_EVIDENCE_RESULT,
  VIBEPRO_EVIDENCE_NONCE: process.env.VIBEPRO_EVIDENCE_NONCE,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEvidenceEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function evidenceEnv(id = 'scenario.SC-001') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'canonical-task-reporter-'));
  const resultPath = path.join(directory, 'runner.json');
  process.env.VIBEPRO_EVIDENCE_ID = id;
  process.env.VIBEPRO_EVIDENCE_RESULT = resultPath;
  process.env.VIBEPRO_EVIDENCE_NONCE = 'a'.repeat(64);
  return { directory, resultPath };
}

describe('withCanonicalTaskEvidence', () => {
  it('emits one structured Playwright attachment only after the assertion callback resolves', async () => {
    await evidenceEnv();
    const order = [];
    const attachments = [];
    const context = {
      async attach(name, attachment) {
        order.push('attach');
        attachments.push({ name, ...attachment });
      },
    };

    await withCanonicalTaskEvidence('scenario.SC-001', async () => {
      order.push('assert-start');
      await Promise.resolve();
      order.push('assert-end');
    }, context);

    expect(order).toEqual(['assert-start', 'assert-end', 'attach']);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      name: EVIDENCE_ATTACHMENT_NAME,
      contentType: EVIDENCE_CONTENT_TYPE,
    });
    const event = JSON.parse(Buffer.from(attachments[0].body).toString('utf8'));
    expect(event).toMatchObject({
      kind: 'canonical-task-evidence-final',
      evidence_id: 'scenario.SC-001',
      nonce: 'a'.repeat(64),
      marker: `VIBEPRO_ASSERT:scenario.SC-001:${'a'.repeat(64)}`,
    });
  });

  it('does not emit a final event when the callback fails', async () => {
    await evidenceEnv();
    const attachments = [];

    await expect(withCanonicalTaskEvidence(
      'scenario.SC-001',
      async () => { throw new Error('assertion failed'); },
      { attach: async (name, attachment) => attachments.push({ name, attachment }) },
    )).rejects.toThrow('assertion failed');
    expect(attachments).toEqual([]);
  });

  it('rejects an evidence ID that does not match the collector environment', async () => {
    await evidenceEnv('scenario.SC-002');
    await expect(withCanonicalTaskEvidence(
      'scenario.SC-001',
      async () => {},
      { attach: async () => {} },
    )).rejects.toThrow(/VIBEPRO_EVIDENCE_ID/);
  });

  it('uses Vitest annotations and Node diagnostics as runner-specific final-event channels', async () => {
    await evidenceEnv();
    const annotations = [];
    const diagnostics = [];

    await withCanonicalTaskEvidence('scenario.SC-001', async () => {}, {
      annotate: async (...args) => annotations.push(args),
    });
    await withCanonicalTaskEvidence('scenario.SC-001', async () => {}, {
      diagnostic: (line) => diagnostics.push(line),
    });

    expect(annotations).toHaveLength(1);
    expect(annotations[0][0]).toBe(`VIBEPRO_ASSERT:scenario.SC-001:${'a'.repeat(64)}`);
    expect(annotations[0][1]).toBe(EVIDENCE_ANNOTATION_TYPE);
    expect(annotations[0][2].contentType).toBe(EVIDENCE_CONTENT_TYPE);
    expect(diagnostics).toEqual([`VIBEPRO_ASSERT:scenario.SC-001:${'a'.repeat(64)}`]);
  });
});

describe('canonical task evidence reporters', () => {
  it('fails before test execution when required evidence environment is missing', () => {
    delete process.env.VIBEPRO_EVIDENCE_ID;
    delete process.env.VIBEPRO_EVIDENCE_RESULT;
    delete process.env.VIBEPRO_EVIDENCE_NONCE;
    expect(() => new PlaywrightReporter()).toThrow(/VIBEPRO_EVIDENCE_ID/);
    expect(() => new VitestReporter()).toThrow(/VIBEPRO_EVIDENCE_ID/);
  });

  it('writes Playwright test status and only helper attachments through atomic rename', async () => {
    const { directory, resultPath } = await evidenceEnv();
    const attachments = [];
    await withCanonicalTaskEvidence('scenario.SC-001', async () => {}, {
      attach: async (name, attachment) => attachments.push({ name, ...attachment }),
    });
    attachments.push({
      name: 'forged-marker',
      contentType: 'text/plain',
      body: Buffer.from(`VIBEPRO_ASSERT:scenario.SC-001:${'a'.repeat(64)}`),
    });

    const reporter = new PlaywrightReporter();
    reporter.onTestEnd({ title: 'scenario.SC-001' }, { status: 'passed', attachments });
    await reporter.onEnd();

    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    expect(result).toMatchObject({
      protocol: 'canonical-task-runner-evidence-v1',
      adapter: 'playwright',
      evidence_id: 'scenario.SC-001',
    });
    expect(result.tests).toEqual([{
      title: 'scenario.SC-001',
      status: 'passed',
      final_events: [expect.objectContaining({ marker: `VIBEPRO_ASSERT:scenario.SC-001:${'a'.repeat(64)}` })],
    }]);
    expect((await readdir(directory)).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('writes Vitest annotations for the exact test case without accepting plain marker messages', async () => {
    const { resultPath } = await evidenceEnv('surface.auth.matrix');
    const annotations = [];
    await withCanonicalTaskEvidence('surface.auth.matrix', async () => {}, {
      annotate: async (message, type, attachment) => annotations.push({ message, type, attachment }),
    });
    annotations.push({
      message: `VIBEPRO_ASSERT:surface.auth.matrix:${'a'.repeat(64)}`,
      type: EVIDENCE_ANNOTATION_TYPE,
    });

    const reporter = new VitestReporter();
    reporter.onTestCaseResult({
      name: 'surface.auth.matrix',
      result: () => ({ state: 'passed' }),
      annotations: () => annotations,
    });
    await reporter.onTestRunEnd();

    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    expect(result.tests).toEqual([{
      title: 'surface.auth.matrix',
      status: 'passed',
      final_events: [expect.objectContaining({ evidence_id: 'surface.auth.matrix' })],
    }]);
  });
});
