/*! wan-track.js — Wajhat Al Nuzum ads tracking (gtag GA4 + Google Ads conversions). 2026-10-26 (v2: + Microsoft Clarity).
 * Usage: <script src="/path/wan-track.js" data-wan-product="tripleqms" defer></script>
 * - Loads gtag.js (AW-18345311586 + GA4 G-EFNLMQ7WTQ); no inline script needed (strict-CSP safe).
 * - Fires "WAN - WhatsApp click" on every wa.me / api.whatsapp.com / whatsapp: link click.
 * - Fires "WAN - Sign-up / trial started" when the page contains an element with data-wan-conv="signup"
 *   (render it ONLY after the server confirmed the sign-up), or when code calls wanTrack.signup().
 * - Fires "WAN - Quote form" (lead) for data-wan-conv="lead" or wanTrack.lead().
 * - Keeps gclid/gbraid/wbraid/utm_* of the landing visit in localStorage (wan_attr, 90 days): wanTrack.attribution().
 * - v2 2026-10-26: Microsoft Clarity (heatmaps/recordings, inputs masked by default) loaded after window load, per-host
 *   project id below, public paths only (SPA navigation to a non-public path stops it). Opt out: data-wan-clarity="off".
 *   CSP needs https://www.clarity.ms https://*.clarity.ms https://c.bing.com in script-src, connect-src and img-src.
 */
(function () {
  if (window.wanTrack) return;
  var AW = 'AW-18345311586', GA4 = 'G-EFNLMQ7WTQ';
  var SEND = {
    wa: AW + '/9ciHCKqwoIUdEOL63KtE',
    lead: AW + '/dK-wCN7tp4UdEOL63KtE',
    signup: AW + '/ZGPCCJ6vnqodEOL63KtE'
  };
  var me = document.currentScript || document.querySelector('script[data-wan-product]');
  var PRODUCT = (me && me.getAttribute('data-wan-product')) || location.hostname;

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') window.gtag = function () { window.dataLayer.push(arguments); };
  if (!document.querySelector('script[src*="googletagmanager.com/gtag/js"]')) {
    var g = document.createElement('script');
    g.async = true;
    g.src = 'https://www.googletagmanager.com/gtag/js?id=' + AW;
    (document.head || document.documentElement).appendChild(g);
  }
  gtag('js', new Date());
  gtag('config', GA4);
  gtag('config', AW);

  // ---- attribution (gclid / utm) persistence ----
  var KEY = 'wan_attr', TTL = 90 * 864e5;
  function readAttr() {
    try {
      var a = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (a && a.ts && Date.now() - a.ts < TTL) return a;
    } catch (_) {}
    return null;
  }
  try {
    var q = new URLSearchParams(location.search), got = {}, any = false;
    ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
      var v = q.get(k);
      if (v) { got[k] = v.slice(0, 200); any = true; }
    });
    if (any) {
      got.ts = Date.now();
      got.landing = location.pathname;
      localStorage.setItem(KEY, JSON.stringify(got));
    }
  } catch (_) {}

  function fire(kind, opt) {
    opt = opt || {};
    var p = { send_to: SEND[kind], value: 1.0, currency: 'SAR' };
    if (opt.transaction_id) p.transaction_id = String(opt.transaction_id);
    if (opt.event_callback) { p.event_callback = opt.event_callback; p.event_timeout = 1200; }
    try {
      if (kind === 'wa') gtag('event', 'whatsapp_click', { product: PRODUCT, page: location.pathname });
      if (kind === 'signup') gtag('event', 'sign_up', { product: PRODUCT, method: opt.method || 'trial' });
      if (kind === 'lead') gtag('event', 'generate_lead', { product: PRODUCT, form: opt.form || 'contact' });
      gtag('event', 'conversion', p);
    } catch (_) { if (opt.event_callback) opt.event_callback(); }
  }

  var WA_RE = /^(https?:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|web\.whatsapp\.com)\/|whatsapp:)/i;
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (!WA_RE.test(href) && !WA_RE.test(a.href || '')) return;
    var newTab = (a.target && a.target !== '_self') || e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1;
    if (newTab || e.defaultPrevented) { fire('wa'); return; }
    // same-tab navigation: let the hit leave first (max ~0.8 s)
    e.preventDefault();
    var done = false, go = function () { if (!done) { done = true; location.href = a.href; } };
    fire('wa', { event_callback: go });
    setTimeout(go, 800);
  }, true);

  function scanMarks() {
    var els = document.querySelectorAll('[data-wan-conv]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], kind = el.getAttribute('data-wan-conv');
      if (el.__wanDone || !SEND[kind]) continue;
      el.__wanDone = true;
      var tid = el.getAttribute('data-wan-tid') || '';
      if (tid) {
        try {
          var k = 'wan_fired_' + kind + '_' + tid;
          if (sessionStorage.getItem(k)) continue;
          sessionStorage.setItem(k, '1');
        } catch (_) {}
      }
      fire(kind, { transaction_id: tid || undefined, method: el.getAttribute('data-wan-method') || undefined });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanMarks);
  else scanMarks();

  // ---- Microsoft Clarity (public pages only; Clarity masks sensitive inputs by default) ----
  var CLARITY = {
    'tripleqms.com': { id: 'z3qfr8pn2h', allow: /^\/($|index\.html|en\/?$|subscribe(\/|$))/ },
    'shashatna.com': { id: 'z3qfzixuj7' },
    'app.shashatna.com': { id: 'z3qfzixuj7', allow: /^\/signup(\/|$)/ },
    'wasolak.com': { id: 'z3qg7l99va', allow: /^\/($|index\.html|pricing(\/|$))/ },
    'meeqat.me': { id: 'z3qgfzk6t8', allow: /^\/($|index\.html|signup\.html|en\/?$)/ },
    'markazak.com': { id: 'z3qgobbi4d' },
    'tripleodoo.com': { id: 'z3qgw8vwsb', allow: /^(\/(ar|en))?(\/(pricing|features|about|contact|register|privacy|terms)(\/.*)?)?\/?$/ }
  };
  var CL = CLARITY[location.hostname.replace(/^www\./, '')];
  var clOff = me && me.getAttribute('data-wan-clarity') === 'off';
  var clState = 0; // 0 idle, 1 loaded, 2 stopped for this page view
  function clAllowed() { return !!CL && !clOff && (!CL.allow || CL.allow.test(location.pathname)); }
  function clLoad() {
    if (clState || !clAllowed() || (window.clarity && window.clarity.t)) return;
    clState = 1;
    window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
    var t = document.createElement('script');
    t.async = true;
    t.src = 'https://www.clarity.ms/tag/' + CL.id;
    (document.head || document.documentElement).appendChild(t);
    try { window.clarity('set', 'product', PRODUCT); } catch (_) {}
  }
  function clRoute() {
    if (clState === 1 && !clAllowed()) { clState = 2; try { window.clarity('stop'); } catch (_) {} }
    else if (clState === 0) clLoad();
  }
  if (CL && !clOff) {
    var clStart = function () { setTimeout(clLoad, 0); };
    if (document.readyState === 'complete') clStart(); else window.addEventListener('load', clStart);
    ['pushState', 'replaceState'].forEach(function (m) {
      var orig = history[m];
      if (typeof orig !== 'function') return;
      history[m] = function () { var r = orig.apply(this, arguments); setTimeout(clRoute, 0); return r; };
    });
    window.addEventListener('popstate', function () { setTimeout(clRoute, 0); });
  }

  window.wanTrack = {
    product: PRODUCT,
    signup: function (opt) { fire('signup', opt); },
    lead: function (opt) { fire('lead', opt); },
    wa: function () { fire('wa'); },
    scan: scanMarks,
    attribution: readAttr,
    clarity: function () { return { id: CL && CL.id, state: clState, allowed: clAllowed() }; }
  };
})();
