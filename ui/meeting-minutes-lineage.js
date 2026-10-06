/*
 * Meeting-minutes lineage is rendered as a projection of the core ledger.
 * The host supplies the actions; this module never creates judgment, Task, or
 * execution records by itself.  That keeps the screen usable with any
 * minutes provider while preserving the existing adoption and Task owners.
 */

export const MEETING_MINUTES_LINEAGE_UI_CONTRACT_VERSION = 'brainbase.meeting-minutes-lineage-ui.v1';

const STATUS_LABELS = Object.freeze({
  unconfirmed: '未確認',
  confirmed: '確認済み',
  not_adopted: '未採用',
  adopted: '採用済み',
  unrecorded: '未記録',
  actual: '実行記録あり',
  accepted: '結果確認済み',
  clear: '修正なし',
  review_required: '修正後の再確認が必要',
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function textLines(value) {
  if (Array.isArray(value)) return value.map((line) => text(line)).filter(Boolean).join('\n');
  return text(value);
}

function status(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function exactEvidence(value) {
  if (!isRecord(value)) return null;
  const meetingId = text(value.meetingId);
  const minutesId = text(value.minutesId);
  const versionId = text(value.versionId);
  const provenance = isRecord(value.provenance) ? value.provenance : null;
  if (!meetingId || !minutesId || !versionId || !provenance || !text(provenance.providerKind) || !text(provenance.providerId)) return null;
  return {
    meetingId,
    minutesId,
    versionId,
    contentDigest: value.contentDigest === null ? null : text(value.contentDigest) || null,
    locator: value.locator ?? null,
    provenance: {
      providerKind: text(provenance.providerKind),
      providerId: text(provenance.providerId),
      ...(text(provenance.revision) ? { revision: text(provenance.revision) } : {}),
      ...(text(provenance.digest) ? { digest: text(provenance.digest) } : {}),
    },
  };
}

function candidateView(value) {
  if (!isRecord(value) || !isRecord(value.candidate)) return null;
  const candidate = value.candidate;
  const id = text(candidate.id);
  const kind = candidate.kind === 'judgment' || candidate.kind === 'task' ? candidate.kind : '';
  if (!id || !kind) return null;
  return {
    ...value,
    candidate: {
      ...candidate,
      id,
      kind,
      proposal: candidate.proposal ?? null,
      evidence: exactEvidence(candidate.evidence),
    },
    confirmationStatus: status(value.confirmationStatus, ['unconfirmed', 'confirmed'], 'unconfirmed'),
    adoptionStatus: status(value.adoptionStatus, ['not_adopted', 'adopted'], 'not_adopted'),
    executionStatus: status(value.executionStatus, ['unrecorded', 'actual'], 'unrecorded'),
    resultStatus: status(value.resultStatus, ['unrecorded', 'accepted'], 'unrecorded'),
    reviewStatus: status(value.reviewStatus, ['clear', 'review_required'], 'clear'),
  };
}

/**
 * Validate the core read model while preserving a non-success state.
 * `[]` is a valid list only after the evidence and response shape are known.
 */
export function normalizeMeetingMinutesLineageView(payload) {
  if (!isRecord(payload)) return { status: 'invalid', reason: 'response_not_object' };
  if (payload.status === 'unavailable') {
    return { status: 'unavailable', reason: text(payload.reason) || 'lineage_unavailable' };
  }
  const evidence = exactEvidence(payload.evidence);
  if (!evidence || !Array.isArray(payload.candidates) || !Array.isArray(payload.corrections)) {
    return { status: 'invalid', reason: 'lineage_shape_invalid' };
  }
  const candidates = payload.candidates.map(candidateView).filter(Boolean);
  const invalidCount = payload.candidates.length - candidates.length;
  const corrections = payload.corrections.filter(isRecord).map((correction) => ({
    id: text(correction.id) || null,
    reason: text(correction.reason) || '議事録版が修正されました',
    affectedCandidateIds: Array.isArray(correction.affectedCandidateIds)
      ? correction.affectedCandidateIds.filter((id) => text(id)).map((id) => text(id))
      : [],
  }));
  return { status: 'available', evidence, candidates, corrections, invalidCount };
}

function makeElement(doc, tag, className, content) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function append(parent, ...children) {
  for (const child of children) if (child) parent.appendChild(child);
  return parent;
}

function evidenceLabel(evidence) {
  return `${evidence.provenance.providerKind}:${evidence.provenance.providerId} / ${evidence.versionId}`;
}

function proposalLabel(proposal) {
  if (typeof proposal === 'string') return proposal;
  if (isRecord(proposal)) {
    const task = isRecord(proposal.task) ? proposal.task : (isRecord(proposal.taskData) ? proposal.taskData : null);
    if (task) {
      const title = text(task.title);
      const description = text(task.description);
      if (title || description) return [title, description].filter(Boolean).join(' — ');
    }
    const learning = isRecord(proposal.learningCandidate) ? proposal.learningCandidate : (isRecord(proposal.candidate) ? proposal.candidate : null);
    if (learning) {
      const proposedChange = proposalValueLabel(learning.proposedChange);
      const grounds = proposalLinesLabel(learning.grounds);
      if (proposedChange || grounds) return [proposedChange, grounds ? `根拠: ${grounds}` : ''].filter(Boolean).join(' / ');
    }
    for (const key of ['title', 'judgment', 'summary', 'description', 'text']) {
      if (text(proposal[key])) return text(proposal[key]);
    }
  }
  return '候補の内容を開く';
}

function proposalValueLabel(value) {
  if (typeof value === 'string') return text(value);
  if (!isRecord(value)) return '';
  for (const key of ['title', 'label', 'judgment', 'summary', 'description', 'text']) {
    if (text(value[key])) return text(value[key]);
  }
  return '';
}

function proposalLinesLabel(value) {
  if (Array.isArray(value)) return value.map((line) => proposalValueLabel(line)).filter(Boolean).join(' / ');
  return proposalValueLabel(value);
}

function statusBadge(doc, value) {
  const label = STATUS_LABELS[value] || value;
  const badge = makeElement(doc, 'span', `bb-mml-status bb-mml-status-${value}`, label);
  badge.setAttribute('data-status', value);
  return badge;
}

function actionButton(doc, label, action, candidate) {
  if (typeof action !== 'function') return null;
  const button = makeElement(doc, 'button', 'bb-mml-action', label);
  button.type = 'button';
  button.addEventListener('click', () => action(candidate));
  return button;
}

function candidateActions(doc, item, actions) {
  const actionsNode = makeElement(doc, 'div', 'bb-mml-candidate-actions');
  const candidate = item.candidate;
  if (item.reviewStatus === 'review_required') {
    append(actionsNode, actionButton(doc, '修正を確認', actions.reviewCandidate, candidate));
  } else if (item.confirmationStatus === 'unconfirmed') {
    append(actionsNode, actionButton(doc, '確認する', actions.confirmCandidate, candidate));
  } else if (item.adoptionStatus === 'not_adopted') {
    append(actionsNode, actionButton(doc, candidate.kind === 'judgment' ? '判断として採用' : 'Taskとして採用', candidate.kind === 'judgment' ? actions.adoptJudgment : actions.adoptTask, candidate));
  }
  if (!actionsNode.children?.length) actionsNode.appendChild(makeElement(doc, 'span', 'bb-mml-action-hint', '操作は接続済みの正本から行います'));
  return actionsNode;
}

function actionErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error) && text(error.message)) return text(error.message);
  return '操作に失敗しました。再試行してください。';
}

function field(doc, label, { type = 'text', value = '', required = false, placeholder = '' } = {}) {
  const wrapper = makeElement(doc, 'label', 'bb-mml-field');
  wrapper.appendChild(makeElement(doc, 'span', 'bb-mml-field-label', label));
  const input = makeElement(doc, type === 'textarea' ? 'textarea' : 'input', 'bb-mml-input');
  if (type !== 'textarea') input.type = type;
  input.value = value ?? '';
  if (required) input.setAttribute('required', '');
  if (placeholder) input.setAttribute('placeholder', placeholder);
  wrapper.appendChild(input);
  return { wrapper, input };
}

function selectField(doc, label, options, value) {
  const wrapper = makeElement(doc, 'label', 'bb-mml-field');
  wrapper.appendChild(makeElement(doc, 'span', 'bb-mml-field-label', label));
  const input = makeElement(doc, 'select', 'bb-mml-input');
  for (const option of options) {
    const item = makeElement(doc, 'option', '', option.label);
    item.value = option.value;
    if (option.value === value) item.selected = true;
    input.appendChild(item);
  }
  input.value = value ?? options[0]?.value ?? '';
  wrapper.appendChild(input);
  return { wrapper, input };
}

function valueOf(input) {
  return typeof input?.value === 'string' ? input.value.trim() : '';
}

function linesOf(input, fallback = '') {
  const value = valueOf(input);
  const lines = value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  return lines.length ? lines : (fallback ? [fallback] : []);
}

function setFieldsDisabled(fields, disabled) {
  for (const fieldRef of fields) fieldRef.input.disabled = disabled;
}

function record(value) {
  return isRecord(value) ? value : {};
}

function candidateForm(doc, actions, candidateDefaults, onCreated) {
  if (typeof actions.createCandidate !== 'function') return null;
  const defaults = record(candidateDefaults);
  const taskDefaults = record(defaults.task);
  const judgmentDefaults = record(defaults.judgment);
  const sourceDefault = record(judgmentDefaults.sourceEvaluationRef ?? defaults.sourceEvaluationRef);
  const targetDefault = record(judgmentDefaults.target ?? defaults.target);
  const applicabilityDefault = record(judgmentDefaults.applicability ?? defaults.applicability);
  const form = makeElement(doc, 'form', 'bb-mml-candidate-form');
  form.appendChild(makeElement(doc, 'h3', 'bb-mml-form-title', 'この版から候補を作る'));
  form.appendChild(makeElement(doc, 'p', 'bb-mml-form-help', '候補を作成した後、内容を確認してから正本へ採用します。'));

  const kind = selectField(doc, '候補の種類', [
    { value: 'task', label: 'Task' },
    { value: 'judgment', label: '判断' },
  ], text(defaults.kind) === 'judgment' ? 'judgment' : 'task');
  form.appendChild(kind.wrapper);

  const task = makeElement(doc, 'div', 'bb-mml-form-group');
  task.appendChild(makeElement(doc, 'h4', 'bb-mml-form-subtitle', 'Taskの内容'));
  const taskTitle = field(doc, 'Task名', { value: text(taskDefaults.title), required: true, placeholder: '例：次回会議の資料を確認する' });
  const taskDescription = field(doc, '説明', { type: 'textarea', value: text(taskDefaults.description), placeholder: '必要な作業や完了条件' });
  const taskPriority = field(doc, '優先度', { value: text(taskDefaults.priority), placeholder: '任意' });
  const taskAssignee = field(doc, '担当者', { value: text(taskDefaults.assignee_person_id), placeholder: '任意' });
  const taskDue = field(doc, '期限', { type: 'datetime-local', value: text(taskDefaults.due_at) });
  for (const item of [taskTitle, taskDescription, taskPriority, taskAssignee, taskDue]) task.appendChild(item.wrapper);
  form.appendChild(task);

  const judgment = makeElement(doc, 'div', 'bb-mml-form-group');
  judgment.appendChild(makeElement(doc, 'h4', 'bb-mml-form-subtitle', '判断の内容'));
  const sourceId = field(doc, '評価の識別子', { value: text(sourceDefault.id), required: true, placeholder: '既存の評価ID' });
  const sourceDigest = field(doc, '評価のダイジェスト', { value: text(sourceDefault.digest), required: true, placeholder: 'sha256:...' });
  const targetKind = selectField(doc, '対象の種類', [
    { value: 'world_model', label: 'World Model' },
    { value: 'judgment_method', label: '判断方法' },
    { value: 'execution_method', label: '実行方法' },
    { value: 'objective', label: '目的' },
  ], text(targetDefault.kind) || 'world_model');
  const targetId = field(doc, '対象の識別子', { value: text(targetDefault.id), required: true, placeholder: '対象ID' });
  const targetRevision = field(doc, '対象の版', { value: text(targetDefault.revision), required: true, placeholder: '1' });
  const targetDigest = field(doc, '対象のダイジェスト', { value: text(targetDefault.digest), required: true, placeholder: 'sha256:...' });
  const proposedChange = field(doc, '判断の提案', { type: 'textarea', value: text(judgmentDefaults.proposedChange ?? defaults.proposedChange), required: true, placeholder: '何をどう判断・変更するか' });
  const grounds = field(doc, '根拠（1行1件）', { type: 'textarea', value: textLines(judgmentDefaults.grounds ?? defaults.grounds), required: true, placeholder: '議事録から確認できる根拠' });
  const counterexamples = field(doc, '反例・留保（1行1件）', { type: 'textarea', value: textLines(judgmentDefaults.counterexamples ?? defaults.counterexamples), required: true, placeholder: '分からない点も含めて記入' });
  const uncertainty = field(doc, '不確実性（1行1件）', { type: 'textarea', value: textLines(judgmentDefaults.uncertainty ?? defaults.uncertainty), required: true, placeholder: '判断を見直す条件' });
  const subjectIds = field(doc, '対象範囲（1行1件）', { type: 'textarea', value: textLines(applicabilityDefault.subjectIds ?? defaults.subjectIds ?? 'self'), required: true, placeholder: 'self' });
  const validFrom = field(doc, '適用開始', { type: 'datetime-local', value: text(applicabilityDefault.validFrom ?? defaults.validFrom) });
  const validUntil = field(doc, '適用終了', { type: 'datetime-local', value: text(applicabilityDefault.validUntil ?? defaults.validUntil) });
  for (const item of [sourceId, sourceDigest, targetKind, targetId, targetRevision, targetDigest, proposedChange, grounds, counterexamples, uncertainty, subjectIds, validFrom, validUntil]) judgment.appendChild(item.wrapper);
  form.appendChild(judgment);

  const status = makeElement(doc, 'p', 'bb-mml-form-status', '');
  const submit = makeElement(doc, 'button', 'bb-mml-action bb-mml-submit', '候補を作成');
  submit.type = 'submit';
  form.appendChild(submit);
  form.appendChild(status);

  const setMode = () => {
    const isJudgment = valueOf(kind.input) === 'judgment';
    task.hidden = isJudgment;
    judgment.hidden = !isJudgment;
    setFieldsDisabled([taskTitle, taskDescription, taskPriority, taskAssignee, taskDue], isJudgment);
    setFieldsDisabled([sourceId, sourceDigest, targetKind, targetId, targetRevision, targetDigest, proposedChange, grounds, counterexamples, uncertainty, subjectIds, validFrom, validUntil], !isJudgment);
    task.setAttribute('aria-hidden', isJudgment ? 'true' : 'false');
    judgment.setAttribute('aria-hidden', isJudgment ? 'false' : 'true');
  };
  kind.input.addEventListener('change', setMode);
  setMode();

  form.addEventListener('submit', async (event) => {
    event?.preventDefault?.();
    status.textContent = '';
    submit.disabled = true;
    const kindValue = valueOf(kind.input) === 'judgment' ? 'judgment' : 'task';
    const proposal = kindValue === 'task'
      ? {
        task: {
          title: valueOf(taskTitle.input),
          ...(valueOf(taskDescription.input) ? { description: valueOf(taskDescription.input) } : {}),
          ...(valueOf(taskPriority.input) ? { priority: valueOf(taskPriority.input) } : {}),
          ...(valueOf(taskAssignee.input) ? { assignee_person_id: valueOf(taskAssignee.input) } : {}),
          ...(valueOf(taskDue.input) ? { due_at: valueOf(taskDue.input) } : {}),
        },
      }
      : {
        learningCandidate: {
          sourceEvaluationRef: { id: valueOf(sourceId.input), digest: valueOf(sourceDigest.input) },
          target: {
            kind: valueOf(targetKind.input),
            id: valueOf(targetId.input),
            revision: valueOf(targetRevision.input),
            digest: valueOf(targetDigest.input),
          },
          proposedChange: valueOf(proposedChange.input),
          grounds: linesOf(grounds.input),
          counterexamples: linesOf(counterexamples.input),
          uncertainty: linesOf(uncertainty.input),
          applicability: {
            subjectIds: linesOf(subjectIds.input, 'self'),
            validFrom: valueOf(validFrom.input) || new Date().toISOString(),
            ...(valueOf(validUntil.input) ? { validUntil: valueOf(validUntil.input) } : {}),
          },
        },
        learningValidation: {
          findings: [],
          conclusion: 'indeterminate',
          modelDisposition: 'indeterminate',
          basis: '議事録版から作成した候補。確認後に採用します。',
          validatedAt: new Date().toISOString(),
        },
      };
    try {
      const created = await actions.createCandidate({ kind: kindValue, proposal, epistemicStatus: 'inferred' });
      status.textContent = `候補を作成しました（${created?.id ?? 'ID確認中'}）。内容を確認して採用できます。`;
      await onCreated?.(created);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '候補を作成できませんでした。';
      submit.disabled = false;
    }
  });
  return form;
}

function renderUnavailable(root, normalized, doc) {
  const notice = makeElement(doc, 'p', 'bb-mml-notice', normalized.status === 'unavailable'
    ? '議事録の判断履歴を読み取れません。権限または保存先を確認してください。'
    : '議事録の判断履歴の形式を確認できません。');
  notice.setAttribute('data-lineage-status', normalized.status);
  root.appendChild(notice);
  return root;
}

/** Render one lineage projection into a host-owned slot. */
export function renderMeetingMinutesLineage(root, payload, { actions = {}, candidateDefaults = null, onCandidateCreated, actionError = null, documentRef = globalThis.document } = {}) {
  if (!root || !documentRef || typeof documentRef.createElement !== 'function') throw new TypeError('root and documentRef are required');
  const normalized = normalizeMeetingMinutesLineageView(payload);
  while (root.firstChild) root.removeChild(root.firstChild);
  root.className = `${root.className || ''} bb-mml`.trim();
  if (normalized.status !== 'available') return renderUnavailable(root, normalized, documentRef);

  const heading = makeElement(documentRef, 'div', 'bb-mml-heading');
  append(heading,
    makeElement(documentRef, 'h2', 'bb-mml-title', '議事録からの判断・Task'),
    makeElement(documentRef, 'p', 'bb-mml-evidence', `根拠: ${evidenceLabel(normalized.evidence)}`));
  root.appendChild(heading);

  if (actionError) {
    const notice = makeElement(documentRef, 'p', 'bb-mml-notice', `操作に失敗しました。${actionErrorMessage(actionError)} 再試行できます。`);
    notice.setAttribute('data-lineage-action-status', 'error');
    root.appendChild(notice);
  }

  if (normalized.invalidCount > 0) {
    root.appendChild(makeElement(documentRef, 'p', 'bb-mml-notice', `${normalized.invalidCount}件の候補は形式を確認できないため表示していません。`));
  }
  const form = candidateForm(documentRef, actions, candidateDefaults, onCandidateCreated);
  if (form) root.appendChild(form);
  const list = makeElement(documentRef, 'div', 'bb-mml-candidates');
  if (!normalized.candidates.length) {
    list.appendChild(makeElement(documentRef, 'p', 'bb-mml-empty', 'この議事録版から作られた候補はありません。'));
  }
  for (const item of normalized.candidates) {
    const row = makeElement(documentRef, 'article', 'bb-mml-candidate');
    row.setAttribute('data-candidate-id', item.candidate.id);
    const title = makeElement(documentRef, 'h3', 'bb-mml-candidate-title', `${item.candidate.kind === 'judgment' ? '判断' : 'Task'}: ${proposalLabel(item.candidate.proposal)}`);
    const statuses = makeElement(documentRef, 'div', 'bb-mml-statuses');
    append(statuses,
      statusBadge(documentRef, item.confirmationStatus),
      statusBadge(documentRef, item.adoptionStatus),
      statusBadge(documentRef, item.executionStatus),
      statusBadge(documentRef, item.resultStatus),
      statusBadge(documentRef, item.reviewStatus));
    append(row, title, statuses, candidateActions(documentRef, item, actions));
    list.appendChild(row);
  }
  root.appendChild(list);
  if (normalized.corrections.length) {
    const corrections = makeElement(documentRef, 'details', 'bb-mml-corrections');
    corrections.appendChild(makeElement(documentRef, 'summary', '', `修正履歴 (${normalized.corrections.length})`));
    for (const correction of normalized.corrections) corrections.appendChild(makeElement(documentRef, 'p', '', correction.reason));
    root.appendChild(corrections);
  }
  return root;
}

/** Host adapter: the core owns loading and action implementations. */
export function createMeetingMinutesLineageView({ root, load, actions = {}, candidateDefaults = null, documentRef = globalThis.document } = {}) {
  let state = { status: 'unavailable', reason: 'not_loaded' };
  let actionError = null;
  let wrappedActions;
  const renderCurrent = () => renderMeetingMinutesLineage(root, state, {
    actions: wrappedActions,
    candidateDefaults,
    onCandidateCreated: () => controller.refresh(),
    actionError,
    documentRef,
  });
  const runAction = async (action, candidate) => {
    try {
      await action(candidate);
      actionError = null;
      await controller.refresh();
    } catch (error) {
      actionError = error;
      renderCurrent();
    }
  };
  wrappedActions = { ...actions };
  for (const name of ['confirmCandidate', 'adoptJudgment', 'adoptTask', 'reviewCandidate']) {
    if (typeof actions[name] === 'function') {
      wrappedActions[name] = (candidate) => runAction(actions[name], candidate);
    }
  }
  const controller = {
    get state() { return state; },
    render(payload = state) {
      actionError = null;
      state = normalizeMeetingMinutesLineageView(payload);
      renderCurrent();
      return state;
    },
    async refresh() {
      if (typeof load !== 'function') {
        state = { status: 'unavailable', reason: 'loader_not_connected' };
        renderCurrent();
        return state;
      }
      try {
        const payload = await load();
        return controller.render(payload);
      } catch (error) {
        state = {
          status: 'unavailable',
          reason: error && typeof error.code === 'string' ? error.code : 'lineage_unavailable',
        };
        renderCurrent();
        return state;
      }
    },
  };
  controller.render(state);
  return controller;
}

export default renderMeetingMinutesLineage;
