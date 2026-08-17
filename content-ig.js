// content-ig.js — Instagram post scraper v4
// Comments strategy (in order):
//   1. CAPTURE-FIRST: grab whatever comment UI the user already opened
//      (user clicks IG's comment button, then clicks Scrape Post)
//   2. Auto-click the Comment button once and re-extract (works logged in)
//   3. Permalink fallback: /p/{code}/ renders comments in the DOM even logged
//      out (verified live). A background tab hydrates them, clicks "Load more
//      comments", and hands the list back via chrome.storage.

(function () {
  'use strict';

  const API_BASE = 'https://staging.label-dex.com';
  console.log('[LD Scraper] content-ig v4 loaded on', location.pathname);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const storageGet = (keys) => new Promise(r => chrome.storage.local.get(keys, r));

  function getCurrentTrackId() {
    return storageGet(['activeTrackId']).then(res => res.activeTrackId || null);
  }

  async function sendToServer(data) {
    const token = (await storageGet(['scraperToken'])).scraperToken || '';
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

  // ============ COMMENTS ============

  const textOf = (el) => (el.textContent || '').replace(/[\u200b-\u200f\u202a-\u202e\uFEFF\u2060]/g, '').replace(/\s+/g, ' ').trim();

  // Non-comment strings that live inside comment units
  const JUNK_TEXT = new RegExp([
    '^(reply|hide replies.*)$',
    '^(view( all)? replies(\\s*\\(\\d+\\))?|view all \\d+ comments.*)$',
    '^(load more comments.*|show more comments.*)$',
    '^(see translation|see original)$',
    '^\\d+[smhdwy](\\s*ago)?$',
    '^(liked by .*|liked)$',
    '^(like|unlike|follow|following)$',
    '^(like\s*reply|reply\s*like|likereply)$',
    '^like(reply|comment)?s?$',
    '^[\\d.,]+[km]?\\s*(likes?|replies|views)?$',
    '^(log in to like or comment.*|sign up|log in)$',
  ].join('|'), 'i');

  function extractFromUnit(unit) {
    // Username: first profile-style anchor (/username/, not /p/ /reel/ /explore/...)
    let username = '';
    for (const a of unit.querySelectorAll('a[href^="/"]')) {
      const href = a.getAttribute('href') || '';
      if (/^\/(p|reel|reels|explore|accounts|stories|direct)\b/i.test(href)) continue;
      const m = href.match(/^\/([A-Za-z0-9._]+)\/?(?:[?#]|$)/);
      if (!m) continue;
      const t = textOf(a);
      if (t && t.length <= 40) { username = t.replace(/^@/, '').replace(/Verified$/, ''); break; }
    }

    // Text: leaf dir=auto spans outside anchors and buttons, minus junk
    const parts = [];
    for (const s of unit.querySelectorAll('span[dir="auto"]')) {
      if (s.closest('a') || s.closest('button')) continue;
      if (s.querySelector('span[dir="auto"]')) continue; // parent wrapper, not leaf
      const t = textOf(s);
      if (!t || JUNK_TEXT.test(t)) continue;
      parts.push(t);
    }
    let text = parts.join(' ').trim();

    // Fallback: whole unit text, minus junk tokens and username prefix
    if (!text) {
      const tokens = textOf(unit).split(/\s+/).filter(tok => !JUNK_TEXT.test(tok));
      text = tokens.join(' ').trim();
    }
    if (username && text.toLowerCase().startsWith(username.toLowerCase())) {
      text = text.slice(username.length).trim();
    }
    if (!text || text.length < 2 || text.length > 500) return null;
    return username ? `${username}: ${text}` : text;
  }

  function divCommentUnits() {
    // Logged-out /p/ variant: no ul/li roles at all — comments are plain
    // sibling DIVs, each holding a profile anchor + text
    // ("user 3d comment text Like Reply"). Find the container whose children
    // are mostly comment-like DIVs and return those children.
    const anchors = [...document.querySelectorAll('a[href^="/"]')]
      .filter(a => /^\/([A-Za-z0-9._]+)\/?$/.test(a.getAttribute('href') || ''));
    const candidates = [];
    for (const a of anchors) {
      let el = a;
      for (let depth = 0; depth < 6 && el.parentElement; depth++) {
        el = el.parentElement;
        const parent = el.parentElement;
        if (!parent) break;
        const kids = [...parent.children];
        if (kids.length < 3) continue;
        const anchored = kids.filter(k => k.querySelector('a[href^="/"]'));
        if (anchored.length >= Math.max(3, Math.ceil(kids.length * 0.6))) {
          candidates.push(kids);
        }
      }
    }
    let best = null;
    for (const set of candidates) {
      if (!best || set.length > best.length) best = set;
    }
    return best || [];
  }

  function commentUnits() {
    // Roots in priority order: an open comment dialog (Reels sheet / modal,
    // i.e. the user already clicked comments), the article comment list
    // (permalink page), then the whole document.
    const roots = [
      document.querySelector('div[role="dialog"]'),
      document.querySelector('article ul, ul[aria-label="Comments"], div[aria-label="Comments"]'),
      document,
    ].filter(Boolean);
    const all = [];
    for (const root of roots) {
      let units = root.querySelectorAll('li[role="listitem"], div[role="listitem"]');
      if (!units.length) units = root.querySelectorAll('ul > li');
      if (!units.length) continue;
      for (const u of units) {
        if (!u.querySelector('a[href^="/"]')) continue; // must look like a comment
        const c = extractFromUnit(u);
        if (c) all.push(c);
      }
      if (all.length) return all;
    }
    // Strategy 3: plain-DIV comment layout (logged-out /p/ variant)
    for (const u of divCommentUnits()) {
      if (!u.querySelector('a[href^="/"]')) continue;
      const c = extractFromUnit(u);
      if (c) all.push(c);
    }
    return all;
  }

  function extractComments(caption) {
    const out = [];
    const seen = new Set();
    const captionHead = caption ? caption.slice(0, 200).trim().toLowerCase() : null;
    for (const c of commentUnits()) {
      const body = c.includes(': ') ? c.slice(c.indexOf(': ') + 2) : c;
      if (captionHead && body.length > 15 &&
        (captionHead.includes(body) || body.includes(captionHead.slice(0, 60)))) continue; // caption echo
      const key = c.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
      if (out.length >= 30) break;
    }
    return out;
  }

  // Permalink fallback: /p/{code}/ hydrates comments client-side even when
  // logged out (verified on the live DOM). The background tab does the work
  // and posts the result to chrome.storage; we poll for it.
  async function scrapeViaPermalink(code) {
    const reqId = 'perm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    try {
      await chrome.storage.local.set({ pendingPermalink: { reqId, code, startedAt: Date.now() } });
      chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: `https://www.instagram.com/p/${code}/` });
    } catch (e) {
      console.log('[LD Scraper] Permalink fallback failed to start', e);
      return [];
    }
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      const res = (await storageGet(['permalinkResult'])).permalinkResult;
      if (res && res.reqId === reqId) {
        chrome.storage.local.remove('permalinkResult');
        return res.comments || [];
      }
    }
    return [];
  }

  // Runs on every IG page; only acts when a scrape is waiting on this code.
  async function permalinkWorker() {
    try {
      const pending = (await storageGet(['pendingPermalink'])).pendingPermalink;
      if (!pending) return;
      if (Date.now() - pending.startedAt > 60000) {
        chrome.storage.local.remove('pendingPermalink');
        return;
      }
      const m = location.pathname.match(/^\/p\/([A-Za-z0-9_-]+)/);
      if (!m || m[1] !== pending.code) return;

      // Wait for the comment list to hydrate (background tabs throttle timers,
      // so poll generously). Pass the caption so its echo gets filtered.
      const meta = document.querySelector('meta[property="og:description"]');
      let cap = null;
      if (meta) {
        cap = meta.content.trim();
        const m = cap.match(/^[\d,.]+\s*(?:likes?|comments?)[\s\S]*?:\s*"([\s\S]*)"\.?\s*$/i);
        if (m) cap = m[1].trim();
      }
      // Nudge lazy rendering (some hydration waits on scroll/visibility)
      window.scrollTo(0, 400);
      let comments = [];
      for (let i = 0; i < 24 && !comments.length; i++) {
        await sleep(750);
        comments = extractComments(cap);
        if (i % 4 === 3) window.scrollTo(0, 800);
      }
      // Pull additional batches (live page: ~14 initial, 24 total)
      for (let k = 0; k < 3; k++) {
        const more = [...document.querySelectorAll('button')]
          .find(b => /load more comments/i.test(textOf(b)));
        if (!more) break;
        more.click();
        await sleep(1800);
        comments = extractComments(cap);
      }
      await chrome.storage.local.set({ permalinkResult: { reqId: pending.reqId, comments } });
      chrome.runtime.sendMessage({ type: 'CLOSE_TAB' });
    } catch (e) {
      console.log('[LD Scraper] Permalink worker error', e);
    }
  }
  permalinkWorker();

  // ============ MAIN SCRAPE ============

  async function scrapePost() {
    await sleep(1500);

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
      () => { const m = altBlob.match(/([\d,.]+\s*[km]?)\s*comments?/i); return m ? parseCount(m[1]) : null; },
    ]);

    // ===== REPOSTS / SHARES =====
    data.shares = findAny([
      () => { const els = document.querySelectorAll('[aria-label]'); for (const el of els) { const m = (el.getAttribute('aria-label') || '').match(/([\d,.]+\s*[km]?)\s*(shares|reposts|sends)/i); if (m) return parseCount(m[1]); } return null; },
      () => { const m = altBlob.match(/([\d,.]+\s*[km]?)\s*(shares|reposts)/i); return m ? parseCount(m[1]) : null; },
    ]);

    data.views = findAny([
      () => { const els = document.querySelectorAll('[aria-label]'); for (const el of els) { const m = (el.getAttribute('aria-label') || '').match(/([\d,.]+\s*[km]?)\s*(views|plays)/i); if (m) return parseCount(m[1]); } return null; },
    ]);

    // ===== COMMENTS (text), 3 layers =====
    // Layer 1: capture whatever the user already opened (click comments, then Scrape)
    let comments = extractComments(data.caption);

    // Layer 2: auto-open the comment panel once (works when logged in)
    if (!comments.length) {
      const commentBtn = [...document.querySelectorAll('button')]
        .find(b => /^Comment\s*\d*/i.test(textOf(b)) || b.querySelector('img[alt="Comment"]'));
      if (commentBtn) {
        try { commentBtn.click(); await sleep(2500); } catch (e) { }
        comments = extractComments(data.caption);
      }
    }

    // Layer 3: permalink fallback (works even logged out)
    if (!comments.length) {
      const m = window.location.pathname.match(/\/reels?\/([A-Za-z0-9_-]+)/);
      if (m) comments = await scrapeViaPermalink(m[1]);
    }

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
      let data;
      try {
        data = await scrapePost();
      } catch (e) {
        console.log('[LD Scraper] scrape error', e);
        data = {};
      }
      const sent = await sendToServer(data);
      await saveLocal(data);
      const c = (data.comments || []).length;
      btn.style.background = c ? '#2ecc71' : '#e67e22';
      btn.textContent = c
        ? `✓ ${c} comments captured${sent ? '' : ' (saved locally)'}`
        : '⚠ 0 comments (see console)';
      console.log('[LD Scraper] result:', JSON.stringify(data, null, 2));
      setTimeout(() => { btn.style.background = '#0095f6'; btn.textContent = '📋 Scrape Post'; btn.disabled = false; }, 4000);
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
