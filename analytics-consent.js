(() => {
  'use strict';
  const KEY = 'ergpath.analytics-choice.v1';
  const TTL = 180 * 24 * 60 * 60 * 1000;
  const dialog = document.getElementById('analytics-choice');
  const settings = document.getElementById('analytics-settings');
  const status = document.getElementById('analytics-status');
  let loaded = false;
  let timer;
  let regionReady = false;
  let requiresConsent = true;
  let current = read();
  function permitted() {
    return current?.choice === 'allow' || (regionReady && !requiresConsent && current?.choice !== 'reject');
  }
  function applyRegion() {
    load();
    expire();
    if (regionReady && requiresConsent && !current) open();
  }
  function read() {
    if (new URL(location.href).searchParams.get('analytics') === 'off') return {version:1, choice:'reject', expires:Date.now()+TTL};
    try {
      const x = JSON.parse(localStorage.getItem(KEY));
      return x && x.version === 1 && ['allow', 'reject'].includes(x.choice) &&
        Number.isFinite(x.expires) && x.expires > Date.now() && x.expires <= Date.now() + TTL ? x : null;
    } catch { return null; }
  }
  function close() { dialog.close(); settings.focus(); }
  function open() {
    status.textContent = '';
    if (!dialog.open) dialog.show();
  }
  function load() {
    if (loaded || !permitted()) return;
    const token = document.querySelector('meta[name="ergpath-analytics-token"]')?.content || '';
    // Unconfigured review copies fail closed. The site token is public, not an API credential.
    if (!/^[a-f0-9]{32}$/.test(token)) return;
    loaded = true;
    const script = document.createElement('script');
    script.type = 'module';
    script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    script.defer = true;
    script.dataset.cfBeacon = JSON.stringify({token});
    document.head.appendChild(script);
  }
  function expire() {
    clearTimeout(timer);
    if (!current) return;
    // setTimeout has a signed 32-bit limit; check long-lived tabs at least daily.
    timer = setTimeout(() => {
      if (Date.now() >= current.expires) {
        current = null;
        if (loaded) location.reload(); else applyRegion();
      } else expire();
    }, Math.min(current.expires - Date.now(), 86400000));
  }
  function choose(choice) {
    const next = {version:1, choice, expires:Date.now()+TTL};
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      if (localStorage.getItem(KEY) !== JSON.stringify(next)) throw new Error('storage');
    } catch {
      if (loaded && choice === 'reject') {
        try { localStorage.removeItem(KEY); } catch { /* URL override still stops this tab. */ }
        const url = new URL(location.href);
        url.searchParams.set('analytics','off');
        location.replace(url.href);
        return;
      }
      status.textContent = loaded ? 'Your browser could not save this choice. Your existing analytics choice still applies.' : 'Your browser could not save this choice. Analytics remains off. You can close this panel and use the site.';
      return;
    }
    current = next;
    if (choice === 'allow') {
      const url = new URL(location.href);
      url.searchParams.delete('analytics');
      history.replaceState(null,'',url.href);
    }
    close();
    // Reload destroys the existing beacon listeners; merely removing its script does not.
    // A final beacon for the already-consented page may be sent during navigation.
    if (loaded && choice === 'reject') location.reload();
    else { load(); expire(); }
  }
  settings.addEventListener('click', open);
  document.getElementById('analytics-allow').addEventListener('click', () => choose('allow'));
  document.getElementById('analytics-reject').addEventListener('click', () => choose('reject'));
  document.getElementById('analytics-close').addEventListener('click', close);
  window.addEventListener('storage', event => {
    if (event.key !== KEY && event.key !== null) return;
    current = read();
    if (loaded && !permitted()) location.reload();
    else applyRegion();
  });
  // The owner explicitly chose automatic analytics for non-EU and unknown locations.
  // Never cache a visitor's region or share a region response between visitors.
  async function init() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch('/analytics-region', {cache:'no-store', credentials:'omit', signal:controller.signal});
      if (!response.ok) throw new Error('region unavailable');
      const region = await response.json();
      requiresConsent = region.region === 'eu';
    } catch {
      requiresConsent = false;
    } finally {
      clearTimeout(timeout);
      regionReady = true;
      current = read();
      applyRegion();
    }
  }
  init();
})();
