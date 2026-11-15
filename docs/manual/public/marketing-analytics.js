/* Public marketing only. Activation requires stream + consent/settings approval. */
(() => {
  const config = {
  "site": "brainbase",
  "hosts": [
    "brainbase.pages.dev"
  ],
  "routes": {
    "/": "home",
    "/organization": "organization",
    "/quickstart": "quickstart"
  },
  "id": "",
  "enabled": false,
  "enhancedMeasurementDisabled": false
};
  if (!config.enabled || !config.enhancedMeasurementDisabled || !/^G-[A-Z0-9]+$/.test(config.id)) return;
  if (!config.hosts.includes(location.hostname) || window.__marketingAnalytics) return;
  // Do not coexist with a GA/GTM installation, even when its ID differs.
  if (window.gtag || window.dataLayer || document.querySelector('script[src*="googletagmanager.com"],script[src*="google-analytics.com"]')) return;
  window.__marketingAnalytics = true;
  const key = 'marketing_analytics_consent_v1';
  let consent = 'denied';
  try { consent = localStorage.getItem(key) === 'granted' ? 'granted' : 'denied'; } catch { /* session-only choice */ }
  let started = false;
  let lastPage = '';
  let lastLead = '';
  const routes = config.routes;
  function page() {
    // Only literal public routes; arbitrary IDs, paths and queries never enter payloads.
    return routes[location.pathname.replace(/\/$/, '') || '/'] || null;
  }
  function source() {
    try {
      const host = new URL(document.referrer).hostname;
      if (['www.google.com', 'google.com', 'www.google.co.jp', 'www.bing.com'].includes(host)) return 'search';
      if (['x.com', 't.co', 'www.facebook.com', 'www.linkedin.com'].includes(host)) return 'social';
      if (['www.unson.jp', 'keigo.unson.jp', 'brainbase.pages.dev', 'vibepro.pages.dev', 'service.zeims.ai'].includes(host)) return 'owned';
      return 'referral';
    } catch { return 'direct'; }
  }
  const acquisition = source();
  function fields() {
    const current = page();
    if (!current) return null;
    return {
      send_to: config.id, site_name: config.site, page_group: current,
      // Synthetic fixed address, never the visitor's URL; avoids GA's URL defaults.
      page_location: 'https://' + config.hosts[0] + '/__marketing/' + current,
      page_title: config.site + ':' + current, page_referrer: '',
      campaign_source: '', campaign_medium: '', campaign_name: '', campaign_id: '',
      campaign_term: '', campaign_content: '', ignore_referrer: true,
      acquisition_group: acquisition
    };
  }
  function send(event, extra = {}) {
    const base = fields();
    if (consent !== 'granted' || !started || !base) return;
    // Extras are constructed below from fixed enumerations; no generic properties API.
    window.gtag('event', event, { ...base, ...extra });
  }
  function view() {
    const current = page();
    if (consent !== 'granted' || !started || !current || current === lastPage) return;
    lastPage = current;
    send('page_view');
  }
  function start() {
    if (started || consent !== 'granted' || !page()) return;
    started = true;
    window.dataLayer = [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
    window.gtag('js', new Date());
    window.gtag('config', config.id, {
      ...fields(), send_page_view: false, allow_google_signals: false,
      allow_ad_personalization_signals: false, cookie_domain: 'none',
      cookie_expires: 60 * 60 * 24 * 30, linker: { domains: [], accept_incoming: false }
    });
    const script = document.createElement('script');
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + config.id;
    document.head.appendChild(script);
    view();
  }
  function choose(value) {
    consent = value;
    try { localStorage.setItem(key, value); } catch { /* no persistence required */ }
    if (value === 'granted') { window['ga-disable-' + config.id] = false; start(); view(); }
    else {
      lastPage = '';
      // Drop queued events and stop GA while keeping all advertising consent denied.
      if (started) {
        window['ga-disable-' + config.id] = true;
        window.dataLayer.length = 0;
        window.gtag('consent', 'update', { analytics_storage: 'denied' });
      }
    }
    if (value === 'granted') window['ga-disable-' + config.id] = false;
    panel.hidden = true;
  }
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'アクセス解析の設定');
  panel.style.cssText = 'position:fixed;bottom:3rem;right:1rem;max-width:24rem;padding:1rem;background:#fff;color:#111;border:1px solid #aaa;z-index:9999;font:14px sans-serif';
  const message = document.createElement('p');
  message.textContent = '同意するとGoogle Analyticsで公開ページの閲覧・製品選択・問い合わせを分析します。解析cookieは30日間です。入力内容は送りません。いつでも設定を変更できます。';
  panel.appendChild(message);
  for (const [label, value] of [['解析に同意', 'granted'], ['同意しない', 'denied']]) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label;
    button.style.cssText = 'margin:.25rem;padding:.5rem;border:1px solid #888';
    button.addEventListener('click', () => choose(value)); panel.appendChild(button);
  }
  const settings = document.createElement('button');
  settings.type = 'button'; settings.textContent = 'アクセス解析設定';
  settings.style.cssText = 'position:fixed;bottom:1rem;right:1rem;z-index:9999;background:white;color:#111;padding:.25rem;border:1px solid #aaa';
  settings.addEventListener('click', () => { panel.hidden = !panel.hidden; });
  document.body.appendChild(panel); document.body.appendChild(settings);
  panel.hidden = consent === 'granted';
  document.addEventListener('click', (event) => {
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    let url;
    try { url = new URL(link.getAttribute('href'), location.origin); } catch { return; }
    const target = url.hostname;
    if (['brainbase.pages.dev', 'vibepro.pages.dev', 'service.zeims.ai'].includes(target) && target !== location.hostname) {
      send('select_product', { product_name: { 'brainbase.pages.dev': 'brainbase', 'vibepro.pages.dev': 'vibepro', 'service.zeims.ai': 'zeims' }[target] });
    } else if (config.site === 'unson' && target === location.hostname && url.pathname === '/contact/vibe-coding') {
      send('select_product', { product_name: 'vibepro' });
    } else if (target === 'web.zeims.ai' && ['/register', '/signup', '/sign-up'].includes(url.pathname)) {
      send('trial_click', { product_name: 'zeims' });
    } else if (target === 'timerex.net') {
      send('inquiry_click', { cta_kind: 'booking' });
    } else if (target === location.hostname && ['#contact', '#organization-early-access'].includes(url.hash)) {
      send('inquiry_click', { cta_kind: 'contact' });
    } else if (config.site === 'brainbase' && target === location.hostname && ['/organization', '/organization/'].includes(url.pathname)) {
      send('select_product', { product_name: 'brainbase_organization' });
    } else if (target === 'www.npmjs.com' && ['brainbase', 'vibepro'].includes(config.site)) {
      send('trial_click', { product_name: config.site });
    }
  });
  // Only explicit successful form responses call this event, never submit/click.
  document.addEventListener('marketing:lead-success', () => {
    const current = page();
    if (!current || current === lastLead || consent !== 'granted' || !started) return;
    lastLead = current;
    send('generate_lead', { cta_kind: current === 'organization' ? 'waitlist' : 'contact' });
  });
  // Framework-independent SPA observation; never wrap other owners' router/history APIs.
  window.setInterval(() => {
    if (!page() && started) window['ga-disable-' + config.id] = true;
    else if (consent === 'granted') {
      window['ga-disable-' + config.id] = false;
      start(); view();
    }
  }, 1000);
  start();
})();
