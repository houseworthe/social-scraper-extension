// background.js — Service worker: badge updates + relay API requests for content scripts

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SCRAPED') {
    chrome.action.setBadgeText({ text: String(msg.count) });
    chrome.action.setBadgeBackgroundColor({ color: '#0095f6' });
  }
  if (msg.type === 'CLEAR') {
    chrome.action.setBadgeText({ text: '' });
  }

  // Relay fetch requests from content scripts (which can't do cross-origin)
  if (msg.type === 'API_REQUEST') {
    fetch(msg.url, msg.options)
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
