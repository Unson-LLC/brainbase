import {
  EVIDENCE_ANNOTATION_TYPE,
  EVIDENCE_ATTACHMENT_NAME,
  EVIDENCE_CONTENT_TYPE,
  createFinalEvent,
  validateEvidenceEnvironment,
} from '../../scripts/evidence-reporters/canonical-task-evidence-protocol.js';

export {
  EVIDENCE_ANNOTATION_TYPE,
  EVIDENCE_ATTACHMENT_NAME,
  EVIDENCE_CONTENT_TYPE,
};

export async function withCanonicalTaskEvidence(evidenceId, assertionCallback, runnerContext) {
  if (typeof assertionCallback !== 'function') {
    throw new TypeError('assertionCallback must be a function');
  }
  if (!runnerContext || typeof runnerContext !== 'object') {
    throw new TypeError('runnerContext is required');
  }

  const environment = validateEvidenceEnvironment(process.env);
  if (environment.evidenceId !== evidenceId) {
    throw new Error(
      `VIBEPRO_EVIDENCE_ID mismatch: expected ${evidenceId}, received ${environment.evidenceId}`,
    );
  }

  const callbackResult = await assertionCallback();
  const event = createFinalEvent(evidenceId, environment.nonce);
  const marker = event.marker;
  const body = JSON.stringify(event);

  if (typeof runnerContext.attach === 'function') {
    await runnerContext.attach(EVIDENCE_ATTACHMENT_NAME, {
      body: Buffer.from(body),
      contentType: EVIDENCE_CONTENT_TYPE,
    });
  } else if (typeof runnerContext.annotate === 'function') {
    await runnerContext.annotate(marker, EVIDENCE_ANNOTATION_TYPE, {
      body,
      contentType: EVIDENCE_CONTENT_TYPE,
    });
  } else if (typeof runnerContext.diagnostic === 'function') {
    runnerContext.diagnostic(marker);
  } else {
    throw new TypeError('runnerContext must expose attach, annotate, or diagnostic');
  }

  return callbackResult;
}
