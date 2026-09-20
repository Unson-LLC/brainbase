/**
 * Structural reference for the five Mana operations screens.
 *
 * This fixture intentionally records viewport and layout anchors only. It does
 * not copy Mobbin/VibePro imagery, copy, or brand treatment.
 */
export const OUTCOME_MANA_VISUAL_FIXTURE = Object.freeze({
  viewport: Object.freeze({ width: 1586, height: 992 }),
  screens: Object.freeze([
    Object.freeze({
      id: 'overview',
      reference: 'exec-661ddeeb…',
      requiredSelectors: Object.freeze([
        '.outcome-mana-kpi-grid',
        '.outcome-mana-overview-layout',
        '.outcome-mana-inspector',
      ]),
    }),
    Object.freeze({
      id: 'connections',
      reference: 'exec-17d7…',
      requiredSelectors: Object.freeze([
        '.outcome-mana-connection-table',
        '.outcome-mana-connection-inspector',
        '.outcome-mana-resource-panel',
      ]),
    }),
    Object.freeze({
      id: 'settings',
      reference: 'exec-b2de…',
      requiredSelectors: Object.freeze([
        '.outcome-mana-settings-form',
        '.outcome-mana-settings-rail',
      ]),
    }),
    Object.freeze({
      id: 'delegation',
      reference: 'exec-3e6f…',
      requiredSelectors: Object.freeze([
        '.outcome-mana-delegation-layout',
        '.outcome-mana-sticky-actions',
      ]),
    }),
    Object.freeze({
      id: 'runs',
      reference: 'exec-d9fc…',
      requiredSelectors: Object.freeze([
        '.outcome-mana-run-table',
        '.outcome-mana-run-detail',
      ]),
    }),
  ]),
});

export default OUTCOME_MANA_VISUAL_FIXTURE;
