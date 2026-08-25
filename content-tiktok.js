// content-tiktok.js — TikTok post scraper v3
// Relays API requests through background script to avoid CORS

(function () {
  'use strict';

  const API_BASE = 'https://staging.label-dex.com';
  const VERSION = '3.4.5'; // shown on the button so stale loads are obvious
  console.log('[LD Scraper] tiktok content v' + VERSION + ' loaded on', location.pathname);

  function getCurrentTrackId() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['activeTrackId'], (res) => resolve(res.activeTrackId || null));
    });
  }

  async function sendToServer(data) {
    const token = await new Promise(r => chrome.storage.local.get(['scraperToken'], res => r(res.scraperToken || '')));
    const trackId = await getCurrentTrackId();
    const payload = { ...data, trackId };

    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'API_REQUEST',
          url: `${API_BASE}/api/social-proof/submit`,
          options: {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          },
        }, resolve);
      });
      if (!resp || !resp.ok) {
        console.log('[LD Scraper] Submit failed:', resp?.status, resp?.body);
        return false;
      }
      const json = JSON.parse(resp.body);
      return json.success === true || json.ok === true;
    } catch (e) {
      console.log('[LD Scraper] Send failed', e);
      return false;
    }
  }

  function saveLocal(data) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['localScrapes'], (res) => {
        const scraped = res.localScrapes || [];
        scraped.push(data);
        chrome.storage.local.set({ localScrapes: scraped }, () => resolve(scraped.length));
      });
    });
  }

  function parseCount(text) {
    if (!text) return null;
    const cleaned = String(text).trim().toLowerCase().replace(/,/g, '');
    const match = cleaned.match(/([\d.]+)\s*([km])?/);
    if (!match) return null;
    let num = parseFloat(match[1]);
    if (match[2] === 'k') num *= 1000;
    if (match[2] === 'm') num *= 1000000;
    return Math.round(num);
  }

  function findAny(strategies) {
    for (const fn of strategies) {
      try {
        const result = fn();
        if (result !== null && result !== undefined && result !== '') return result;
      } catch (e) { }
    }
    return null;
  }

  function extractComments() {
    const comments = [];
    const selectors = [
      '[data-e2e="comment-desc"]',
      '[data-e2e="browse-comment-desc"]',
      '[class*="CommentContent"]',
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        els.forEach((el, i) => {
          let text = el.textContent.trim();
          if (text && text.length > 2 && i < 30) {
            const parent = el.closest('[data-e2e="comment-item"], li, div');
            let username = '';
            if (parent) {
              const userEl = parent.querySelector('a[href*="/@"], [data-e2e="comment-user-uniqueid"]');
              if (userEl) username = userEl.textContent.trim().replace(/^@/, '');
            }
            // Light cleanup: strip trailing timestamp + Reply + likes count
            text = text.replace(/\d+[hmds]+\s*ago\s*Reply\s*\d*$/i, '').trim();
            text = text.replace(/\s*Reply\s*\d*$/i, '').trim();
            // Strip duplicated username prefix if present
            if (username && text.toLowerCase().startsWith(username.toLowerCase())) {
              text = text.slice(username.length);
            }
            comments.push(username ? `${username}: ${text}` : text);
          }
        });
        if (comments.length) break;
      }
    }
    return comments;
  }

  async function scrapePost() {
    await new Promise(r => setTimeout(r, 2000));

    // Real post URL: in logged-in modal views the address bar stays on the
    // profile/feed URL, so prefer an in-page anchor to the actual post.
    const postUrl = (() => {
      if (/\/(video|photo)\//.test(window.location.pathname)) return window.location.href.split('?')[0];
      const a = document.querySelector('a[href*="/photo/"], a[href*="/video/"]');
      if (a) {
        try { return new URL(a.getAttribute('href'), location.origin).href; } catch (e) { }
      }
      return window.location.href;
    })();

    const data = {
      platform: 'TikTok',
      url: postUrl,
      scrapedAt: new Date().toISOString(),
    };

    data.username = findAny([
      () => { const el = document.querySelector('[data-e2e="video-author-uniqueid"], [data-e2e="browse-username"]'); return el ? el.textContent.trim().replace(/^@/, '') : null; },
      () => { const el = document.querySelector('a[href*="/@"]'); if (el) { const m = el.getAttribute('href').match(/\/@([\w.]+)/); return m ? m[1] : null; } return null; },
      () => { const m = window.location.pathname.match(/\/@([\w.]+)/); return m ? m[1] : null; },
    ]);

    data.caption = findAny([
      () => { const el = document.querySelector('[data-e2e="video-desc"], [data-e2e="browse-video-desc"]'); return el ? el.textContent.trim().slice(0, 2000) : null; },
      () => { const el = document.querySelector('h1'); return (el && el.textContent.length > 5) ? el.textContent.trim().slice(0, 2000) : null; },
    ]);

    data.likes = findAny([
      () => { const el = document.querySelector('[data-e2e="like-count"], [data-e2e="browse-like-count"]'); return el ? parseCount(el.textContent) : null; },
      () => { const els = document.querySelectorAll('[aria-label]'); for (const el of els) { const m = (el.getAttribute('aria-label') || '').match(/([\d,.]+\s*[km]?)\s*likes?/i); if (m) return parseCount(m[1]); } return null; },
    ]);

    data.commentCount = findAny([
      () => { const el = document.querySelector('[data-e2e="comment-count"], [data-e2e="browse-comment-count"]'); return el ? parseCount(el.textContent) : null; },
      () => { const els = document.querySelectorAll('[aria-label]'); for (const el of els) { const m = (el.getAttribute('aria-label') || '').match(/([\d,.]+\s*[km]?)\s*comments?/i); if (m) return parseCount(m[1]); } return null; },
    ]);

    data.shares = findAny([
      () => { const el = document.querySelector('[data-e2e="share-count"], [data-e2e="browse-share-count"]'); return el ? parseCount(el.textContent) : null; },
    ]);

    data.views = findAny([
      () => { const el = document.querySelector('[data-e2e="video-views"], [data-e2e="browse-video-views"]'); return el ? parseCount(el.textContent) : null; },
      () => { const els = document.querySelectorAll('[aria-label]'); for (const el of els) { const m = (el.getAttribute('aria-label') || '').match(/([\d,.]+\s*[km]?)\s*(views|plays)/i); if (m) return parseCount(m[1]); } return null; },
    ]);

    // Open the comment panel by clicking the comments button
    const commentBtn = document.querySelector('[data-e2e="scroll-comment"], [data-e2e="browse-comment"], [data-e2e="comment-icon"]');
    if (commentBtn) {
      try {
        commentBtn.click();
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) { }
    }

    const comments = extractComments();
    if (comments.length) data.comments = comments;

    data.postDate = findAny([
      () => { const el = document.querySelector('[data-e2e="video-create-time"]'); return el ? el.textContent.trim() : null; },
      () => { const el = document.querySelector('time, [datetime]'); return el ? (el.getAttribute('datetime') || el.textContent.trim()) : null; },
    ]);

    if (data.caption) {
      const hashtags = data.caption.match(/#[\w]+/g);
      if (hashtags) data.hashtags = hashtags;
    }

    return data;
  }

  function injectButton() {
    if (document.getElementById('ld-scraper-btn')) return;
    // Inject wherever a post's action rail exists — path-based checks miss
    // photo carousels opened as profile/feed modals (URL stays /@user).
    const onPostPath = /\/(video|photo)\//.test(window.location.pathname);
    const hasPostUI =
      !!document.querySelector('[data-e2e="like-count"], [data-e2e="browse-like-count"]') &&
      !!document.querySelector('[data-e2e="comment-count"], [data-e2e="browse-comment-count"]');
    if (!onPostPath && !hasPostUI) return;

    const btn = document.createElement('button');
    btn.id = 'ld-scraper-btn';
    btn.textContent = `📋 Scrape Post v${VERSION}`;
    btn.style.cssText = `position:fixed;bottom:20px;right:20px;z-index:2147483645;background:#fe2c55;color:white;border:none;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,0.3);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;`;
    btn.onmouseenter = () => (btn.style.background = '#e0244a');
    btn.onmouseleave = () => (btn.style.background = '#fe2c55');

    btn.onclick = async () => {
      btn.textContent = '⏳ Scraping...';
      btn.disabled = true;
      let data;
      try {
        data = await scrapePost();
      } catch (e) {
        console.log('[LD Scraper] scrape error', e);
        data = {};
      }
      const sent = await sendToServer(data);
      await saveLocal(data);
      btn.style.background = sent ? '#2ecc71' : '#e67e22';
      btn.textContent = sent ? '✓ Sent!' : '⚠ Saved locally (not sent — check token)';
      console.log('[LD Scraper] result:', JSON.stringify(data, null, 2), '| sent:', sent);
      setTimeout(() => { btn.style.background = '#fe2c55'; btn.textContent = `📋 Scrape Post v${VERSION}`; btn.disabled = false; }, 3500);
    };

    // documentElement, not body: TikTok re-renders body children on route
    // changes and can orphan a body-appended button.
    document.documentElement.appendChild(btn);
  }

  // Self-healing injection: TikTok's re-renders can remove the button at any
  // time; re-inject whenever it's missing (cheap id check).
  setInterval(() => {
    try { injectButton(); } catch (e) { }
  }, 2000);

  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      console.log('[LD Scraper] SPA nav ->', location.pathname);
      const old = document.getElementById('ld-scraper-btn');
      if (old) old.remove();
      setTimeout(injectButton, 2000);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(injectButton, 2500);
})();
