import { readFileSync } from 'node:fs';
import {
  EVIDENCE_ANNOTATION_TYPE,
  EVIDENCE_CONTENT_TYPE,
  atomicWriteJson,
  createRunnerResult,
  parseFinalEventEnvelope,
  validateEvidenceEnvironment,
} from './canonical-task-evidence-protocol.js';

function annotationBody(annotation) {
  const attachment = annotation.attachment;
  if (!attachment) return null;
  if (attachment.body !== undefined) return attachment.body;
  if (!attachment.path) return null;
  try {
    return readFileSync(attachment.path);
  } catch {
    return null;
  }
}

export default class CanonicalTaskVitestReporter {
  constructor() {
    this.evidence = validateEvidenceEnvironment(process.env);
    this.tests = [];
  }

  onTestCaseResult(testCase) {
    const finalEvents = [];
    for (const annotation of testCase.annotations?.() ?? []) {
      if (
        annotation.type !== EVIDENCE_ANNOTATION_TYPE
        || annotation.attachment?.contentType !== EVIDENCE_CONTENT_TYPE
      ) continue;
      const event = parseFinalEventEnvelope(annotationBody(annotation), this.evidence);
      if (event) finalEvents.push(event);
    }

    this.tests.push({
      title: testCase.name,
      status: testCase.result().state,
      final_events: finalEvents,
    });
  }

  async onTestRunEnd() {
    await atomicWriteJson(
      this.evidence.resultPath,
      createRunnerResult('vitest', this.evidence, this.tests),
    );
  }
}
