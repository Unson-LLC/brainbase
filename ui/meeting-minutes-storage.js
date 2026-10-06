/*
 * Read-only projection of the meeting-minutes storage policy.
 *
 * The host supplies the already-authorized controller result.  This module
 * never chooses a provider, fetches a source, or turns an unavailable source
 * into an empty/successful body.
 */

export const MEETING_MINUTES_STORAGE_UI_CONTRACT_VERSION = 'brainbase.meeting-minutes-storage-ui.v1';

const PLACEMENT_LABELS = Object.freeze({
  native: 'Brainbase内蔵',
  external: '会社指定の外部保存先',
  unknown: '未確認',
});

const STATUS_LABELS = Object.freeze({
  native: 'Brainbase内蔵の本文',
  available: '外部本文を取得済み',
  denied: '外部本文の権限を確認できません',
  unavailable: '外部保存先を取得できません',
  historical_unavailable: '保存時点の外部版を取得できません',
  unconfirmed: '保存先の状態は未確認です',
});

const STATUS_NOTICE = Object.freeze({
  denied: '現在の組織権限では本文を読めません。権限があるように表示せず、管理者の設定を確認してください。',
  unavailable: '外部ファイルが見つからないか、接続を確認できません。本文を代用して表示していません。',
  historical_unavailable: '外部保存先に履歴機能がないため、保存時点の版を現在版で代用していません。',
  unconfirmed: '保存先と権限の状態を確認できる応答がありません。',
});

const CAPABILITY_LABELS = Object.freeze({
  read: '読み取り',
  read_only: '読み取り専用',
  save: '外部保存先への保存',
  history: '履歴取得',
  retention_delete: '保持・削除',
  current_acl: '現在の権限',
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function placement(value) {
  return value === 'native' || value === 'external' ? value : 'unknown';
}

function status(value) {
  return Object.hasOwn(STATUS_LABELS, value) ? value : 'unconfirmed';
}

function sourceRef(value) {
  if (!isObject(value)) return null;
  const provider = text(value.provider);
  const locator = text(value.locator);
  const revision = text(value.revision);
  const digest = text(value.digest);
  if (!provider || !locator || !revision || !digest) return null;
  return { provider, locator, revision, digest };
}

function capabilities(value) {
  if (!isObject(value)) return null;
  return {
    read: value.read === true,
    read_only: value.read_only === true,
    save: value.save === true,
    history: value.history === true,
    retention_delete: value.retention_delete === true,
    current_acl: text(value.current_acl) ?? '未確認',
  };
}

/** Normalize the controller result without inventing a source or body. */
export function normalizeMeetingMinutesStoragePanel(value) {
  const source = sourceRef(value?.source_ref ?? value?.sourceRef) ?? sourceRef(value?.version?.source_ref ?? value?.version?.sourceRef);
  const normalizedPlacement = placement(value?.placement ?? (source ? 'external' : undefined));
  const normalizedStatus = status(value?.source_status ?? value?.sourceStatus ?? (normalizedPlacement === 'native' ? 'native' : undefined));
  const sourceResult = isObject(value?.source_result) ? value.source_result : null;
  return Object.freeze({
    contractVersion: MEETING_MINUTES_STORAGE_UI_CONTRACT_VERSION,
    placement: normalizedPlacement,
    placementLabel: PLACEMENT_LABELS[normalizedPlacement],
    sourceStatus: normalizedStatus,
    sourceStatusLabel: STATUS_LABELS[normalizedStatus],
    sourceNotice: text(value?.reason ?? value?.sourceNotice) ?? STATUS_NOTICE[normalizedStatus] ?? null,
    source,
    capabilities: capabilities(value?.capabilities ?? sourceResult?.capabilities),
    placementOptions: Array.isArray(value?.placement_options ?? value?.placementOptions)
      ? (value.placement_options ?? value.placementOptions).filter((item) => item === 'native' || item === 'external')
      : ['native', 'external'],
    versionId: text(value?.version?.version_id),
  });
}

function getDocument(explicit) {
  const candidate = explicit ?? (typeof document === 'undefined' ? undefined : document);
  if (!candidate || typeof candidate.createElement !== 'function') throw new Error('document_unavailable');
  return candidate;
}

function makeElement(doc, tag, { className, text: value, attrs = {}, hidden, disabled } = {}) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined && value !== null) element.textContent = String(value);
  for (const [name, attrValue] of Object.entries(attrs)) {
    if (attrValue === undefined || attrValue === null || attrValue === false) continue;
    element.setAttribute(name, attrValue === true ? '' : String(attrValue));
  }
  if (hidden !== undefined) element.hidden = Boolean(hidden);
  if (disabled !== undefined) element.disabled = Boolean(disabled);
  return element;
}

function append(parent, ...children) {
  parent.append(...children.filter((child) => child !== null && child !== undefined));
  return parent;
}

function capabilityRows(doc, model) {
  const values = model.capabilities;
  if (!values) return [makeElement(doc, 'li', { className: 'bb-mms-capability is-unconfirmed', text: '機能: 未確認' })];
  const rows = [
    ['read', values.read ? '利用可能' : '利用不可'],
    ['read_only', values.read_only ? '有効' : '無効'],
    ['save', values.save ? '利用可能' : '外部管理'],
    ['history', values.history ? '利用可能' : '未対応'],
    ['retention_delete', values.retention_delete ? '利用可能' : '外部管理'],
    ['current_acl', values.current_acl],
  ];
  return rows.map(([key, value]) => makeElement(doc, 'li', {
    className: `bb-mms-capability bb-mms-capability-${key}`,
    text: `${CAPABILITY_LABELS[key]}: ${value}`,
  }));
}

function render(model, { document: explicitDocument, onRetry, onPlacementChange } = {}) {
  const doc = getDocument(explicitDocument);
  const section = makeElement(doc, 'section', {
    className: `bb-mms bb-mms-status-${model.sourceStatus}`,
    attrs: {
      'data-contract-version': MEETING_MINUTES_STORAGE_UI_CONTRACT_VERSION,
      'aria-label': '議事録の保存先',
    },
  });
  const heading = makeElement(doc, 'h2', { className: 'bb-mms-title', text: '議事録の保存先' });
  const status = makeElement(doc, 'p', {
    className: 'bb-mms-status',
    attrs: { 'data-source-status': model.sourceStatus },
    text: model.sourceStatusLabel,
  });
  const header = makeElement(doc, 'header', { className: 'bb-mms-header' });
  append(header, makeElement(doc, 'div', { className: 'bb-mms-header-copy' }), status);
  header.children[0].append(heading);

  const placementLabel = makeElement(doc, 'dt', { text: '本文の正本' });
  const placementValue = makeElement(doc, 'dd', { text: model.placementLabel });
  const placementList = makeElement(doc, 'dl', { className: 'bb-mms-facts' });
  append(placementList, placementLabel, placementValue);

  if (model.source) {
    const sourceLabel = makeElement(doc, 'dt', { text: '入力元' });
    const sourceValue = makeElement(doc, 'dd', { className: 'bb-mms-source' });
    append(
      sourceValue,
      makeElement(doc, 'span', { className: 'bb-mms-source-provider', text: model.source.provider }),
      makeElement(doc, 'code', { className: 'bb-mms-source-locator', text: model.source.locator }),
      makeElement(doc, 'small', { className: 'bb-mms-source-revision', text: `revision: ${model.source.revision}` }),
      makeElement(doc, 'small', { className: 'bb-mms-source-digest', text: `digest: ${model.source.digest}` }),
    );
    append(placementList, sourceLabel, sourceValue);
  }

  const capabilitySection = makeElement(doc, 'section', {
    className: 'bb-mms-capabilities',
    attrs: { 'aria-label': '保存先の機能' },
  });
  append(capabilitySection,
    makeElement(doc, 'h3', { text: '保存先の機能' }),
    makeElement(doc, 'ul', { className: 'bb-mms-capability-list' }),
  );
  capabilitySection.children[1].append(...capabilityRows(doc, model));

  const body = makeElement(doc, 'div', { className: 'bb-mms-body' });
  append(body, placementList, capabilitySection);

  if (model.sourceNotice && model.sourceStatus !== 'native' && model.sourceStatus !== 'available') {
    append(body, makeElement(doc, 'p', {
      className: 'bb-mms-notice',
      attrs: { role: 'status', 'data-source-notice': model.sourceStatus },
      text: model.sourceNotice,
    }));
  }

  if (model.placementOptions.length > 1) {
    const settings = makeElement(doc, 'div', { className: 'bb-mms-placement-settings' });
    const label = makeElement(doc, 'label', { text: '正本の保存形態' });
    const select = makeElement(doc, 'select', { attrs: { name: 'canonical-placement' }, disabled: typeof onPlacementChange !== 'function' });
    for (const option of model.placementOptions) {
      const element = makeElement(doc, 'option', {
        text: PLACEMENT_LABELS[option],
        attrs: { value: option },
      });
      if (option === model.placement) element.selected = true;
      select.append(element);
    }
    if (typeof onPlacementChange === 'function') {
      select.addEventListener('change', () => onPlacementChange(select.value));
    }
    label.append(select);
    settings.append(label);
    body.append(settings);
  }

  if (typeof onRetry === 'function' && model.sourceStatus !== 'native' && model.sourceStatus !== 'available') {
    const retry = makeElement(doc, 'button', {
      className: 'bb-mms-retry',
      attrs: { type: 'button' },
      text: 'もう一度確認',
    });
    retry.addEventListener('click', () => onRetry());
    body.append(retry);
  }

  append(section, header, body);
  return section;
}

/** Create a browser view backed by a host-owned controller result. */
export function createMeetingMinutesStorageUI({
  root,
  view,
  document: explicitDocument,
  onRetry,
  onPlacementChange,
  autoRender = true,
} = {}) {
  if (!root || typeof root.replaceChildren !== 'function') throw new TypeError('root is required');
  let current = normalizeMeetingMinutesStoragePanel(view ?? {});
  const update = (next) => {
    current = normalizeMeetingMinutesStoragePanel(next ?? {});
    root.replaceChildren(render(current, { document: explicitDocument, onRetry, onPlacementChange }));
    return current;
  };
  if (autoRender) update(current);
  return Object.freeze({
    update,
    get state() { return current; },
    destroy() { root.replaceChildren(); },
  });
}

function sourceFromVersion(version) {
  const source = version?.source_ref;
  if (!isObject(source)) return null;
  const provider = text(source.provider);
  const locator = text(source.locator);
  return provider && locator ? { provider, locator } : null;
}

function storagePath(basePath, detail, documentRecord, version) {
  return `/${encodeURIComponent(detail.meeting.meeting_id)}/minutes/${encodeURIComponent(documentRecord.minutes_id)}/versions/${encodeURIComponent(version.version_id)}`;
}

function rebindPath(detail, documentRecord) {
  return `/${encodeURIComponent(detail.meeting.meeting_id)}/minutes/${encodeURIComponent(documentRecord.minutes_id)}`;
}

function failureStatus(error) {
  const code = text(error?.code);
  if (code === 'source_denied' || error?.status === 403) return 'denied';
  if (code === 'source_changed' || code === 'historical_unavailable') return 'historical_unavailable';
  return 'unavailable';
}

/**
 * Adds the host-owned storage projection to a selected minutes version.
 * The browser supplies only a placement choice; root and authorization stay
 * in the LocalWebHost configuration.
 */
export function createMeetingMinutesStorageExtension({
  basePath = '/api/meeting-minutes',
  defaultExternal = null,
} = {}) {
  const normalizedBase = String(basePath).replace(/\/+$/u, '');
  const configuredExternal = isObject(defaultExternal)
    && text(defaultExternal.provider) && text(defaultExternal.locator)
    ? { provider: text(defaultExternal.provider), locator: text(defaultExternal.locator) }
    : null;
  return Object.freeze({
    id: 'meeting-minutes-storage',
    mount({ root, document: explicitDocument, detail, documentRecord, version, request, refresh, setStatus }) {
      const source = sourceFromVersion(version);
      const external = source ?? configuredExternal;
      const initial = {
        placement: source ? 'external' : 'native',
        source_status: source ? 'unconfirmed' : 'native',
        source_ref: version?.source_ref,
        placement_options: external ? ['native', 'external'] : ['native'],
        version: { version_id: version?.version_id, source_ref: version?.source_ref },
      };
      let panel;
      const panelUpdate = (value) => panel?.update(value);
      const call = typeof request === 'function' ? request : null;
      const path = storagePath(normalizedBase, detail, documentRecord, version);
      const reload = async () => {
        if (!call) return;
        setStatus?.('保存先を確認しています。');
        try {
          const value = await call(path, { headers: { Accept: 'application/json' } });
          panelUpdate(value);
          setStatus?.('保存先を確認しました。', 'success');
        } catch (error) {
          panelUpdate({ ...initial, source_status: failureStatus(error), reason: error instanceof Error ? error.message : '保存先を確認できません。' });
          setStatus?.(error instanceof Error ? error.message : '保存先を確認できません。', 'error');
        }
      };
      const changePlacement = async (kind) => {
        if (!call || (kind !== 'native' && kind !== 'external')) return;
        const selectedExternal = source ?? configuredExternal;
        if (kind === 'external' && !selectedExternal) {
          const message = '会社指定の外部保存先がホストに設定されていません。';
          panelUpdate({ ...initial, source_status: 'unavailable', reason: message });
          setStatus?.(message, 'error');
          return;
        }
        const placement = kind === 'native'
          ? { kind: 'native' }
          : { kind: 'external', ...selectedExternal };
        const body = { expected_revision: documentRecord.revision, placement };
        const idempotency = `meeting-minutes-storage-${version.version_id}-${kind}`;
        setStatus?.(kind === 'native' ? 'Brainbase内蔵へ切り替えています。' : '外部保存先へ切り替えています。');
        try {
          await call(rebindPath(detail, documentRecord), {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': idempotency },
            body: JSON.stringify(body),
          });
          setStatus?.('保存先を変更しました。', 'success');
          await refresh?.();
        } catch (error) {
          const message = error instanceof Error ? error.message : '保存先を変更できません。';
          panelUpdate({ ...initial, source_status: failureStatus(error), reason: message });
          setStatus?.(message, 'error');
        }
      };
      panel = createMeetingMinutesStorageUI({
        root,
        document: explicitDocument,
        view: initial,
        onRetry: () => void reload(),
        onPlacementChange: (kind) => void changePlacement(kind),
      });
      void reload();
      return panel;
    },
  });
}
