// content-ig.js — Instagram post scraper v2
// Resilient selectors using multiple strategies: aria labels, text patterns, structural traversal

(function () {
  'use strict';

  const API_BASE = 'https://staging.label-dex.com';
  let scraped = [];

  function getCurrentTrackId() {
    // The extension popup sets this in storage when user picks from queue
    return new Promise((resolve) => {
      chrome.storage.local.get(['activeTrackId'], (res) => resolve(res.activeTrackId || null));
    });
  }

  async function sendToServer(data) {
    const token = await new Promise(r => chrome.storage.local.get(['scraperToken'], res => r(res.scraperToken || '')));
    const trackId = await getCurrentTrackId();

    const payload = { ...data, trackId };
    try {
      const resp = await fetch(`${API_BASE}/api/social-proof/submit?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        console.log('[Social Scraper] Submit failed:', resp.status, await resp.text());
        return false;
      }
      const json = await resp.json();
      return json.ok === true;
    } catch (e) {
      console.log('[Social Scraper] Send failed, saving locally', e);
      return false;
    }
  }

  function saveLocal(data) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['localScrapes'], (res) => {
        scraped = res.localScrapes || [];
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

  // Wait for element to appear (IG loads everything dynamically)
  function waitForEl(selectorFn, timeout = 8000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const result = selectorFn();
        if (result) return resolve(result);
        if (Date.now() - start > timeout) return resolve(null);
        setTimeout(check, 300);
      };
      check();
    });
  }

  // Try multiple strategies to find an element
  function findAnyStrategies(strategies) {
    for (const fn of strategies) {
      try {
        const result = fn();
        if (result) return result;
      } catch (e) { /* try next */ }
    }
    return null;
  }

  function extractComments() {
    const comments = [];
    // Strategy 1: Explicit comment list items
    const selectors = [
      'ul div[role="listitem"]',
      '[data-testid="post-comment"]',
      'article ul li span[dir="auto"]',
      // v2 layout: comment blocks with username + text
      'article ul li div[class*="comment"] span[dir="auto"]',
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        els.forEach((el, i) => {
          const text = el.textContent.trim();
          if (text && text.length > 2 && i < 30) {
            // Try to get username + comment together
            const parent = el.closest('li, [role="listitem"]');
            let username = '';
            if (parent) {
              const userEl = parent.querySelector('a[href*="/"] span, a[role="link"]');
              if (userEl) username = userEl.textContent.trim();
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
    // Wait for page to settle
    await new Promise(r => setTimeout(r, 1500));

    const data = {
      platform: 'Instagram',
      url: window.location.href,
      scrapedAt: new Date().toISOString(),
    };

    // ===== USERNAME =====
    data.username = findAnyStrategies([
      () => {
        // Article header link
        const a = document.querySelector('article header a, section main header a');
        if (a) {
          const href = a.getAttribute('href') || '';
          const m = href.match(/^\/([^/]+)/);
          return m ? m[1] : null;
        }
      },
      () => {
        // Span inside header link
        const el = document.querySelector('article header a span, header a[href*="/"] span');
        return el ? el.textContent.trim() : null;
      },
      () => {
        // Username visible anywhere in a link matching /username/
        const links = document.querySelectorAll('a[href^="/"]');
        for (const l of links) {
          const href = l.getAttribute('href') || '';
          const m = href.match(/^\/([a-z0-9._]+)\/(p|reel|reels)\//i);
          if (m) return m[1];
        }
        return null;
      },
      () => {
        // meta tag
        const meta = document.querySelector('meta[property="og:title"]');
        if (meta) {
          const m = meta.content.match(/@([a-z0-9._]+)/i);
          if (m) return m[1];
        }
        return null;
      },
    ]);

    // Reels often only expose counts via IG's alt-text blob:
    // "215 likes, 22 comments - user on August 11, 2026: "actual caption""
    const altBlob = document.querySelector('meta[property="og:description"]')?.content
      || document.querySelector('h1')?.textContent
      || '';

    // ===== CAPTION =====
    data.caption = findAnyStrategies([
      () => {
        // h1 is sometimes caption on Reels
        const h1 = document.querySelector('h1');
        if (h1 && h1.textContent.length > 10) return h1.textContent.trim().slice(0, 2000);
        return null;
      },
      () => {
        // Article caption span
        const el = document.querySelector('article div[dir="auto"] span[dir="auto"], [data-testid="post-caption"]');
        return el ? el.textContent.trim().slice(0, 2000) : null;
      },
      () => {
        // meta description (usually contains caption text)
        const meta = document.querySelector('meta[property="og:description"]');
        return meta ? meta.content.trim().slice(0, 2000) || null : null;
      },
    ]);
    if (data.caption) {
      // IG alt-text format: '215 likes, 22 comments - user on date: "actual caption".'
      // Strip the leading count/date prefix and the wrapping quotes + trailing period.
      const m = data.caption.match(/^[\d,.]+\s*(?:likes?|comments?)[\s\S]*?:\s*"([\s\S]*)"\.?\s*$/i);
      if (m) data.caption = m[1].trim();
    }

    // ===== LIKES =====
    data.likes = findAnyStrategies([
      () => {
        // "X likes" link
        const el = document.querySelector('a[href*="liked_by"], section a[href*="/liked_by/"]');
        if (el) return parseCount(el.textContent);
        return null;
      },
      () => {
        // aria-label with likes
        const els = document.querySelectorAll('[aria-label]');
        for (const el of els) {
          const label = el.getAttribute('aria-label') || '';
          const m = label.match(/([\d,.]+\s*[km]?)\s*likes?/i);
          if (m) return parseCount(m[1]);
        }
        return null;
      },
      () => {
        // "X likes" text anywhere in article
        const text = document.querySelector('article')?.textContent || '';
        const m = text.match(/([\d,.]+\s*[km]?)\s*likes?/i);
        if (m && !m[1].includes('\n')) return parseCount(m[1]);
        return null;
      },
      () => {
        // Fallback: alt-text blob (Reels), "215 likes"
        const m = altBlob.match(/([\d,.]+\s*[km]?)\s*likes?/i);
        return m ? parseCount(m[1]) : null;
      },
    ]);

    // ===== COMMENT COUNT =====
    data.commentCount = findAnyStrategies([
      () => {
        // "View X comments" or "X comments" link
        const els = document.querySelectorAll('article a, article button, article span');
        for (const el of els) {
          const text = el.textContent;
          const m = text.match(/([\d,.]+\s*[km]?)\s*comments?/i);
          if (m) return parseCount(m[1]);
        }
        return null;
      },
      () => {
        // Count visible comment elements
        const comments = extractComments();
        if (comments.length > 0) return comments.length;
        return null;
      },
    ]);

    // ===== VIEWS (Reels) =====
    data.views = findAnyStrategies([
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
        const text = document.querySelector('article')?.textContent || '';
        const m = text.match(/([\d,.]+\s*[km]?)\s*views/i);
        if (m) return parseCount(m[1]);
        return null;
      },
    ]);

    // ===== COMMENTS (text) =====
    const comments = extractComments();
    if (comments.length) data.comments = comments;

    // ===== POST DATE =====
    const timeEl = document.querySelector('time, [datetime], [data-testid="timestamp"]');
    if (timeEl) {
      data.postDate = timeEl.getAttribute('datetime') || timeEl.getAttribute('title') || timeEl.textContent.trim();
    }

    // ===== HASHTAGS =====
    if (data.caption) {
      const hashtags = data.caption.match(/#[\w]+/g);
      if (hashtags) data.hashtags = hashtags;
    }

    return data;
  }

  function injectButton() {
    if (document.getElementById('ig-scraper-btn')) return;

    // Only inject on post/reel pages
    const isPost = /\/(p|reel|reels)\//.test(window.location.pathname);
    if (!isPost) return;

    const btn = document.createElement('button');
    btn.id = 'ig-scraper-btn';
    btn.textContent = '📋 Scrape Post';
    btn.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 99999;
      background: #0095f6;
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
    btn.onmouseenter = () => (btn.style.background = '#1877f2');
    btn.onmouseleave = () => (btn.style.background = '#0095f6');

    btn.onclick = async () => {
      btn.textContent = '⏳ Scraping...';
      btn.disabled = true;

      const data = await scrapePost();

      // Send to Firestore via API
      const sent = await sendToServer(data);
      const count = await saveLocal(data);

      btn.style.background = sent ? '#2ecc71' : '#f39c12';
      btn.textContent = sent ? '✓ Sent to LabelDex!' : '✓ Saved locally';
      setTimeout(() => {
        btn.style.background = '#0095f6';
        btn.textContent = '📋 Scrape Post';
        btn.disabled = false;
      }, 2000);

      chrome.runtime.sendMessage({ type: 'SCRAPED', count });
    };

    document.body.appendChild(btn);
  }

  // Re-inject on SPA navigation
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      const old = document.getElementById('ig-scraper-btn');
      if (old) old.remove();
      setTimeout(injectButton, 1500);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(injectButton, 2500);
})();
