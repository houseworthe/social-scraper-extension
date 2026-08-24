// background.js — Service worker: badge updates + relay API requests + tab helpers

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SCRAPED') {
    chrome.action.setBadgeText({ text: String(msg.count) });
    chrome.action.setBadgeBackgroundColor({ color: '#0095f6' });
  }
  if (msg.type === 'CLEAR') {
    chrome.action.setBadgeText({ text: '' });
  }

  // Relay fetch requests from content scripts (which can't do cross-origin).
  // Locked to a fixed allowlist so this can't be used as an open fetch proxy
  // if a content-script context is ever compromised (e.g. XSS on the host page).
  if (msg.type === 'IG_META') {
    // Fetch the post's server-rendered page (with the user's IG cookies via
    // host_permissions) and pull og: meta tags. Content scripts can't fetch
    // instagram.com cross-origin, so they relay through here.
    const code = String(msg.code || '');
    if (!/^[A-Za-z0-9_-]+$/.test(code)) { sendResponse({ ok: false, err: 'bad code' }); return; }
    const decodeEntities = (s) => String(s)
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
      .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ''; } })
      .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    fetch(`https://www.instagram.com/p/${code}/`, { credentials: 'include' })
      .then(async (resp) => {
        const html = await resp.text();
        const pick = (prop) => {
          const re1 = new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`, 'i');
          const re2 = new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="${prop}"`, 'i');
          const mm = html.match(re1) || html.match(re2);
          return mm ? decodeEntities(mm[1]) : null;
        };
        sendResponse({ ok: resp.ok, ogDescription: pick('og:description'), ogTitle: pick('og:title') });
      })
      .catch((err) => sendResponse({ ok: false, err: String(err) }));
    return true; // async sendResponse
  }

  if (msg.type === 'API_REQUEST') {
    const ALLOWED_ORIGIN = 'https://staging.label-dex.com';
    const ALLOWED_ENDPOINTS = new Set([
      'GET /api/social-proof/queue',
      'POST /api/social-proof/submit',
    ]);
    const ALLOWED_HEADERS = new Set(['content-type', 'authorization']);

    let url;
    try { url = new URL(msg.url); } catch { url = null; }
    const method = (msg.options?.method || 'GET').toUpperCase();
    const headers = msg.options?.headers || {};
    const headersOk = Object.keys(headers).every(h => ALLOWED_HEADERS.has(h.toLowerCase()));

    if (!url || url.origin !== ALLOWED_ORIGIN || !ALLOWED_ENDPOINTS.has(`${method} ${url.pathname}`) || !headersOk) {
      sendResponse({ ok: false, status: 0, body: 'blocked: request not on allowlist' });
      return;
    }

    fetch(url.toString(), { method, headers, body: msg.options?.body })
      .then(async (resp) => {
        const body = await resp.text();
        sendResponse({ ok: resp.ok, status: resp.status, body });
      })
      .catch((err) => {
        sendResponse({ ok: false, status: 0, body: String(err) });
      });
    return true; // keep channel open for async sendResponse
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
});

console.log('[LD Scraper] background v4 loaded');
