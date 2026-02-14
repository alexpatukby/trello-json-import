/* GA4 event tracking for Power-Up. No PII. Uses configurable measurement ID. */
(function () {
  'use strict';

  var GA_ID = null;
  var inited = false;
  var DEBUG = false;

  function getGaId() {
    if (GA_ID !== null) return GA_ID;
    GA_ID = (typeof window !== 'undefined' && window.TRELLO_IMPORT_GA4_MEASUREMENT_ID) || '';
    if (typeof window !== 'undefined' && window.TRELLO_IMPORT_DEBUG) DEBUG = true;
    return GA_ID;
  }

  function initAnalytics() {
    if (inited) return;
    var id = getGaId();
    if (!id || typeof window.gtag !== 'function') return;
    inited = true;
    try {
      window.gtag('config', id, { cookie_flags: 'SameSite=None;Secure' });
    } catch (e) {
      if (DEBUG) console.warn('[GA4] init error', e);
    }
  }

  function trackEvent(name, params) {
    var id = getGaId();
    if (!id || typeof window.gtag !== 'function') return;
    if (!inited) initAnalytics();
    try {
      var payload = params ? Object.assign({}, params) : {};
      window.gtag('event', name, payload);
      if (DEBUG) console.log('[GA4]', name, payload);
    } catch (e) {
      if (DEBUG) console.warn('[GA4] track error', e);
    }
  }

  function hashId(input) {
    if (!input || typeof input !== 'string') return undefined;
    var str = String(input).trim();
    if (!str) return undefined;

    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buffer) {
        var arr = new Uint8Array(buffer);
        var hex = '';
        for (var i = 0; i < arr.length; i++) hex += ('0' + arr[i].toString(16)).slice(-2);
        return hex.substring(0, 16);
      });
    }

    var h = 0;
    for (var j = 0; j < str.length; j++) {
      h = ((h << 5) - h) + str.charCodeAt(j);
      h = h & h;
    }
    var fallback = Math.abs(h).toString(16).substring(0, 16);
    return Promise.resolve(fallback);
  }

  window.initAnalytics = initAnalytics;
  window.trackEvent = trackEvent;
  window.hashId = hashId;

  if (getGaId()) initAnalytics();
})();
