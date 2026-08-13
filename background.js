// background.js — Service worker: badge updates + relay API requests for content scripts

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
