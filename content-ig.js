// content-ig.js — Instagram post scraper v3
// Relays API requests through background script to avoid CORS

(function () {
  'use strict';

  const API_BASE = 'https://staging.label-dex.com';

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
        if (result) return result;
      } catch (e) { }
    }
    return null;
  }

  function extractComments() {
    const comments = [];
    // Strategy 1: Standard comment selectors
    const selectors = [
      'ul div[role="listitem"] span[dir="auto"]',
      '[data-testid="post-comment"]',
      'article ul li span[dir="auto"]',
      'article ul li div[class*="comment"] span[dir="auto"]',
      // IG Reels comment layout
      'div[class*="comment"] span[dir="auto"]',
      // Fallback: any visible comment-like text blocks
      'article ul li a[href*="/"] + span',
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        els.forEach((el, i) => {
          const text = el.textContent.trim();
          if (text && text.length > 2 && text.length < 500 && i < 30) {
            const parent = el.closest('li, [role="listitem"], div[class*="comment"]');
            let username = '';
            if (parent) {
              const userEl = parent.querySelector('a[href*="/"] span, a[role="link"], a[href*="/"]');
              if (userEl) username = userEl.textContent.trim();
            }
            // Avoid duplicating the caption as a comment
            if (text.length > 2) {
              comments.push(username ? `${username}: ${text}` : text);
            }
          }
        });
        if (comments.length) break;
      }
    }
    return comments;
  }

  async function scrapePost() {
    await new Promise(r => setTimeout(r, 1500));

    const data = {
      platform: 'Instagram',
      url: window.location.href,
      scrapedAt: new Date().toISOString(),
    };

    const altBlob = document.querySelector('meta[property="og:description"]')?.content
      || document.querySelector('h1')?.textContent || '';

    data.username = findAny([
      () => { const a = document.querySelector('article header a, section main header a'); if (a) { const m = (a.getAttribute('href') || '').match(/^\/([^/]+)/); return m ? m[1] : null; } },
      () => { const el = document.querySelector('article header a span, header a[href*="/"] span'); return el ? el.textContent.trim() : null; },
      () => { const links = document.querySelectorAll('a[href^="/"]'); for (const l of links) { const m = (l.getAttribute('href') || '').match(/^\/([a-z0-9._]+)\/(p|reel|reels)\//i); if (m) return m[1]; } return null; },
      () => { const meta = document.querySelector('meta[property="og:title"]'); if (meta) { const m = meta.content.match(/@([a-z0-9._]+)/i); if (m) return m[1]; } return null; },
    ]);

    data.caption = findAny([
      () => { const h1 = document.querySelector('h1'); if (h1 && h1.textContent.length > 10) return h1.textContent.trim().slice(0, 2000); return null; },
      () => { const el = document.querySelector('article div[dir="auto"] span[dir="auto"], [data-testid="post-caption"]'); return el ? el.textContent.trim().slice(0, 2000) : null; },
      () => { const meta = document.querySelector('meta[property="og:description"]'); return meta ? meta.content.trim().slice(0, 2000) || null : null; },
    ]);
    if (data.caption) {
      const m = data.caption.match(/^[\d,.]+\s*(?:likes?|comments?)[\s\S]*?:\s*"([\s\S]*)"\.?\s*$/i);
      if (m) data.caption = m[1].trim();
    }

    data.likes = findAny([
      () => { const el = document.querySelector('a[href*="liked_by"], section a[href*="/liked_by/"]'); return el ? parseCount(el.textContent) : null; },
      () => { const els = document.querySelectorAll('[aria-label]'); for (const el of els) { const m = (el.getAttribute('aria-label') || '').match(/([\d,.]+\s*[km]?)\s*likes?/i); if (m) return parseCount(m[1]); } return null; },
      () => { const m = altBlob.match(/([\d,.]+\s*[km]?)\s*likes?/i); return m ? parseCount(m[1]) : null; },
    ]);

    data.commentCount = findAny([
      () => { const els = document.querySelectorAll('article a, article button, article span'); for (const el of els) { const m = el.textContent.match(/([\d,.]+\s*[km]?)\s*comments?/i); if (m) return parseCount(m[1]); } return null; },
      () => { const c = extractComments(); return c.length > 0 ? c.length : null; },
    ]);

    data.views = findAny([
      () => { const els = document.querySelectorAll('[aria-label]'); for (const el of els) { const m = (el.getAttribute('aria-label') || '').match(/([\d,.]+\s*[km]?)\s*(views|plays)/i); if (m) return parseCount(m[1]); } return null; },
    ]);

    const comments = extractComments();
    if (comments.length) data.comments = comments;

    const timeEl = document.querySelector('time, [datetime], [data-testid="timestamp"]');
    if (timeEl) data.postDate = timeEl.getAttribute('datetime') || timeEl.getAttribute('title') || timeEl.textContent.trim();

    if (data.caption) {
      const hashtags = data.caption.match(/#[\w]+/g);
      if (hashtags) data.hashtags = hashtags;
    }

    return data;
  }

  function injectButton() {
    if (document.getElementById('ld-scraper-btn')) return;
    const isPost = /\/(p|reel|reels)\//.test(window.location.pathname);
    if (!isPost) return;

    const btn = document.createElement('button');
    btn.id = 'ld-scraper-btn';
    btn.textContent = '📋 Scrape Post';
    btn.style.cssText = `position:fixed;bottom:20px;right:20px;z-index:99999;background:#0095f6;color:white;border:none;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,0.3);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;`;
    btn.onmouseenter = () => (btn.style.background = '#1877f2');
    btn.onmouseleave = () => (btn.style.background = '#0095f6');

    btn.onclick = async () => {
      btn.textContent = '⏳ Scraping...';
      btn.disabled = true;
      const data = await scrapePost();
      await sendToServer(data);
      await saveLocal(data);
      btn.style.background = '#2ecc71';
      btn.textContent = '✓ Scraped!';
      setTimeout(() => { btn.style.background = '#0095f6'; btn.textContent = '📋 Scrape Post'; btn.disabled = false; }, 2000);
    };

    document.body.appendChild(btn);
  }

  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      const old = document.getElementById('ld-scraper-btn');
      if (old) old.remove();
      setTimeout(injectButton, 1500);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(injectButton, 2500);
})();
