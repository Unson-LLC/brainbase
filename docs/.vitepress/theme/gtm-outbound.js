const NON_NAVIGABLE_PROTOCOLS = new Set(['mailto:', 'tel:', 'javascript:']);

export function registerOutboundTracking() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__brainbaseGtmOutboundRegistered) return;
  window.__brainbaseGtmOutboundRegistered = true;

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest('a[href]');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;

      let url;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (NON_NAVIGABLE_PROTOCOLS.has(url.protocol)) return;
      if (url.host === window.location.host) return;

      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'outbound_click',
        link_url: url.href,
        link_domain: url.host
      });
    },
    true
  );
}
