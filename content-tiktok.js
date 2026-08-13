// content-tiktok.js — TikTok post scraper v2
// Resilient selectors using aria labels, text patterns, and structural traversal

(function () {
  'use strict';

  const API_BASE = 'https://staging.label-dex.com';
  let scraped = [];

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
      const resp = await fetch(`${API_BASE}/api/social-proof/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      return json.ok === true;
    } catch (e) {
      console.log('[Social Scraper] Send failed, saving locally', e);
      return false;
    }
  }

  function saveLocal(data) {
    scraped.push(data);
    chrome.storage.local.set({ localScrapes: scraped });
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
      } catch (e) { /* try next */ }
    }
    return null;
  }

  function extractComments() {
    const comments = [];

    // Strategy 1: data-e2e comment elements
    const selectors = [
      '[data-e2e="comment-desc"]',
      '[data-e2e="browse-comment-desc"]',
      '[class*="CommentContent"]',
      '[class*="comment-content"]',
      // Comment list items with text
      '[data-e2e="comment-list"] span',
      '[data-e2e="browse-comment-list"] span',
    ];

    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        els.forEach((el, i) => {
          const text = el.textContent.trim();
          if (text && text.length > 2 && i < 30) {
            // Try to find username sibling
            const parent = el.closest('[data-e2e="comment-item"], [class*="CommentItem"], li, div');
            let username = '';
            if (parent) {
              const userEl = parent.querySelector('a[href*="/@"], [data-e2e="comment-user-uniqueid"], [class*="UserName"]');
              if (userEl) username = userEl.textContent.trim().replace(/^@/, '');
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
    // Wait for dynamic content
    await new Promise(r => setTimeout(r, 2000));

    const data = {
      platform: 'TikTok',
      url: window.location.href,
      scrapedAt: new Date().toISOString(),
    };

    // ===== USERNAME =====
    data.username = findAny([
      () => {
        const el = document.querySelector('[data-e2e="video-author-uniqueid"], [data-e2e="browse-username"]');
        return el ? el.textContent.trim().replace(/^@/, '') : null;
      },
      () => {
        const el = document.querySelector('a[href*="/@"]');
        if (el) {
          const m = el.getAttribute('href').match(/\/@([\w.]+)/);
          return m ? m[1] : null;
        }
        return null;
      },
      () => {
        const m = window.location.pathname.match(/\/@([\w.]+)/);
        return m ? m[1] : null;
      },
      () => {
        const meta = document.querySelector('meta[property="og:title"]');
        if (meta) {
          const m = meta.content.match(/@([\w.]+)/);
          return m ? m[1] : null;
        }
        return null;
      },
    ]);

    // ===== CAPTION =====
    data.caption = findAny([
      () => {
        const el = document.querySelector('[data-e2e="video-desc"], [data-e2e="browse-video-desc"]');
        return el ? el.textContent.trim().slice(0, 2000) : null;
      },
      () => {
        const el = document.querySelector('h1');
        if (el && el.textContent.length > 5) return el.textContent.trim().slice(0, 2000);
        return null;
      },
      () => {
        const meta = document.querySelector('meta[property="og:description"]');
        return meta ? meta.content.trim().slice(0, 2000) : null;
      },
    ]);

    // ===== LIKES =====
    data.likes = findAny([
      () => {
        const el = document.querySelector('[data-e2e="like-count"], [data-e2e="browse-like-count"]');
        return el ? parseCount(el.textContent) : null;
      },
      () => {
        const els = document.querySelectorAll('[aria-label]');
        for (const el of els) {
          const label = el.getAttribute('aria-label') || '';
          const m = label.match(/([\d,.]+\s*[km]?)\s*likes?/i);
          if (m) return parseCount(m[1]);
        }
        return null;
      },
      () => {
        // Like button container with count
        const btn = document.querySelector('[data-e2e="like-icon"] ~ span, [data-e2e="browse-like-icon"] ~ span, button[data-e2e="like-button"] span');
        return btn ? parseCount(btn.textContent) : null;
      },
    ]);

    // ===== COMMENT COUNT =====
    data.commentCount = findAny([
      () => {
        const el = document.querySelector('[data-e2e="comment-count"], [data-e2e="browse-comment-count"]');
        return el ? parseCount(el.textContent) : null;
      },
      () => {
        const els = document.querySelectorAll('[aria-label]');
        for (const el of els) {
          const label = el.getAttribute('aria-label') || '';
          const m = label.match(/([\d,.]+\s*[km]?)\s*comments?/i);
          if (m) return parseCount(m[1]);
        }
        return null;
      },
      () => {
        // Count from icon sibling
        const btn = document.querySelector('[data-e2e="comment-icon"] ~ span, [data-e2e="browse-comment-icon"] ~ span');
        return btn ? parseCount(btn.textContent) : null;
      },
    ]);

    // ===== SHARES =====
    data.shares = findAny([
      () => {
        const el = document.querySelector('[data-e2e="share-count"], [data-e2e="browse-share-count"]');
        return el ? parseCount(el.textContent) : null;
      },
      () => {
        const btn = document.querySelector('[data-e2e="share-icon"] ~ span, [data-e2e="browse-share-icon"] ~ span');
        return btn ? parseCount(btn.textContent) : null;
      },
    ]);

    // ===== SAVES / BOOKMARKS =====
    data.saves = findAny([
      () => {
        const btn = document.querySelector('[data-e2e="undefined-count"], [data-e2e="browse-undefined-count"]');
        return btn ? parseCount(btn.textContent) : null;
      },
      () => {
        const els = document.querySelectorAll('[aria-label]');
        for (const el of els) {
          const label = el.getAttribute('aria-label') || '';
          const m = label.match(/([\d,.]+\s*[km]?)\s*(saves|bookmarks|favorites)/i);
          if (m) return parseCount(m[1]);
        }
        return null;
      },
    ]);

    // ===== VIEWS / PLAYS =====
    data.views = findAny([
      () => {
        const el = document.querySelector('[data-e2e="video-views"], [data-e2e="browse-video-views"]');
        return el ? parseCount(el.textContent) : null;
      },
      () => {
        const els = document.querySelectorAll('[aria-label]');
        for (const el of els) {
          const label = el.getAttribute('aria-label') || '';
          const m = label.match(/([\d,.]+\s*[km]?)\s*(views|plays)/i);
          if (m) return parseCount(m[1]);
        }
        return null;
      },
      () => {
        // Text-based search
        const text = document.body.textContent || '';
        const m = text.match(/([\d,.]+\s*[km]?)\s*views/i);
        if (m && !m[1].includes('\n')) return parseCount(m[1]);
        return null;
      },
    ]);

    // ===== COMMENTS (text) =====
    // Try clicking "View X comments" to load them first
    const viewCommentsBtn = document.querySelector('[data-e2e="scroll-comment"], [data-e2e="browse-comment"]');
    if (viewCommentsBtn && data.commentCount > 0 && data.commentCount <= 50) {
      try {
        viewCommentsBtn.click();
        await new Promise(r => setTimeout(r, 1500));
      } catch (e) { /* continue anyway */ }
    }

    const comments = extractComments();
    if (comments.length) data.comments = comments;

    // ===== POST DATE =====
    data.postDate = findAny([
      () => {
        const el = document.querySelector('[data-e2e="video-create-time"]');
        return el ? el.textContent.trim() : null;
      },
      () => {
        const el = document.querySelector('time, [datetime]');
        return el ? (el.getAttribute('datetime') || el.textContent.trim()) : null;
      },
    ]);

    // ===== HASHTAGS =====
    if (data.caption) {
      const hashtags = data.caption.match(/#[\w]+/g);
      if (hashtags) data.hashtags = hashtags;
    }

    return data;
  }

  function injectButton() {
    if (document.getElementById('tiktok-scraper-btn')) return;

    // Only on video pages
    const isVideo = /\/video\//.test(window.location.pathname) || /\/@[\w.]+\/video\//.test(window.location.pathname);
    if (!isVideo) return;

    const btn = document.createElement('button');
    btn.id = 'tiktok-scraper-btn';
    btn.textContent = '📋 Scrape Post';
    btn.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 99999;
      background: #fe2c55;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 10px 18px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      transition: background 0.2s;
    `;
    btn.onmouseenter = () => (btn.style.background = '#e0244a');
    btn.onmouseleave = () => (btn.style.background = '#fe2c55');

    btn.onclick = async () => {
      btn.textContent = '⏳ Scraping...';
      btn.disabled = true;

      const data = await scrapePost();
      const sent = await sendToServer(data);
      saveLocal(data);

      btn.style.background = sent ? '#2ecc71' : '#f39c12';
      btn.textContent = sent ? '✓ Sent to LabelDex!' : '✓ Saved locally';
      setTimeout(() => {
        btn.style.background = '#fe2c55';
        btn.textContent = '📋 Scrape Post';
        btn.disabled = false;
      }, 2000);

      chrome.runtime.sendMessage({ type: 'SCRAPED', count: scraped.length });
    };

    document.body.appendChild(btn);
  }

  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      const old = document.getElementById('tiktok-scraper-btn');
      if (old) old.remove();
      setTimeout(injectButton, 2000);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(injectButton, 2500);
})();
