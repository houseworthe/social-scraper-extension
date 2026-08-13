// content-ig.js — Instagram post scraper
// Injects a "Scrape" button on IG posts and reels, extracts engagement data.

(function () {
  'use strict';

  const STORAGE_KEY = 'social_scraper_data';
  let scraped = [];

  // Load previously scraped data
  chrome.storage.local.get([STORAGE_KEY], (res) => {
    scraped = res[STORAGE_KEY] || [];
  });

  function save() {
    chrome.storage.local.set({ [STORAGE_KEY]: scraped });
  }

  // Extract numeric value from text like "1,234" or "12K" or "1.2M"
  function parseCount(text) {
    if (!text) return 0;
    const cleaned = text.trim().toLowerCase().replace(/,/g, '');
    const match = cleaned.match(/([\d.]+)\s*([km])?/);
    if (!match) return 0;
    let num = parseFloat(match[1]);
    if (match[2] === 'k') num *= 1000;
    if (match[2] === 'm') num *= 1000000;
    return Math.round(num);
  }

  // Extract data from a single IG post
  function scrapePost() {
    const data = {
      platform: 'Instagram',
      url: window.location.href,
      scrapedAt: new Date().toISOString(),
    };

    // Try to get caption
    const captionEl = document.querySelector('h1, [data-testid="post-caption"], article span[dir="auto"]');
    if (captionEl) data.caption = captionEl.textContent.trim().slice(0, 2000);

    // Try to get username
    const usernameEl = document.querySelector('article a[href*="/"] span, header a span, [data-testid="post-username"] a, a[role="link"] h2 span');
    if (usernameEl) data.username = usernameEl.textContent.trim();

    // Fallback username detection
    if (!data.username) {
      const headerLink = document.querySelector('article header a, section header a');
      if (headerLink) {
        const href = headerLink.getAttribute('href');
        if (href) data.username = href.replace(/^\//, '').replace(/\/.*$/, '');
      }
    }

    // Likes - try multiple selectors for different IG layouts
    const likesSelectors = [
      'section a[href*="/liked_by/"] span',
      '[data-testid="like-count"]',
      'a[href*="liked_by"]',
      'article section div span',
    ];
    for (const sel of likesSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent;
        const likesMatch = text.match(/([\d,.]+[km]?)\s*(likes|like)?/i);
        if (likesMatch) {
          data.likes = parseCount(likesMatch[1]);
          break;
        }
      }
    }

    // Views (for Reels)
    const viewsEl = document.querySelector('[data-testid="video-view-count"], video + div span, [aria-label*="views"], [aria-label*="plays"]');
    if (viewsEl) {
      const viewsMatch = viewsEl.textContent.match(/([\d,.]+[km]?)\s*(views|plays)?/i);
      if (viewsMatch) data.views = parseCount(viewsMatch[1]);
    }

    // Comments count
    const commentsEl = document.querySelector('[data-testid="comment-count"], a[href*="/comments/"]');
    if (commentsEl) {
      const text = commentsEl.textContent;
      const commentMatch = text.match(/([\d,.]+[km]?)\s*(comments|comment)?/i);
      if (commentMatch) data.commentCount = parseCount(commentMatch[1]);
    }

    // Get comments text (visible ones)
    const commentItems = document.querySelectorAll('[data-testid="post-comment"], ul div[role="listitem"] span[dir="auto"]');
    const comments = [];
    commentItems.forEach((item, i) => {
      const text = item.textContent.trim();
      if (text && text.length > 1 && i < 50) comments.push(text);
    });
    if (comments.length) data.comments = comments;

    // Timestamp
    const timeEl = document.querySelector('time, [data-testid="timestamp"], [datetime]');
    if (timeEl) {
      data.postDate = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
    }

    // Hashtags from caption
    if (data.caption) {
      const hashtags = data.caption.match(/#[\w]+/g);
      if (hashtags) data.hashtags = hashtags;
    }

    return data;
  }

  // Inject floating scrape button
  function injectButton() {
    if (document.getElementById('ig-scraper-btn')) return;

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

    btn.onclick = () => {
      const data = scrapePost();
      scraped.push(data);
      save();

      // Flash green
      btn.style.background = '#2ecc71';
      btn.textContent = '✓ Scraped!';
      setTimeout(() => {
        btn.style.background = '#0095f6';
        btn.textContent = '📋 Scrape Post';
      }, 1500);

      // Send to background for badge update
      chrome.runtime.sendMessage({ type: 'SCRAPED', count: scraped.length });
    };

    document.body.appendChild(btn);
  }

  // Re-inject on navigation (IG is a SPA)
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      setTimeout(injectButton, 1000);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial inject
  setTimeout(injectButton, 2000);
})();
