// content-tiktok.js — TikTok post scraper
// Injects a "Scrape" button on TikTok videos, extracts engagement data.

(function () {
  'use strict';

  const STORAGE_KEY = 'social_scraper_data';
  let scraped = [];

  chrome.storage.local.get([STORAGE_KEY], (res) => {
    scraped = res[STORAGE_KEY] || [];
  });

  function save() {
    chrome.storage.local.set({ [STORAGE_KEY]: scraped });
  }

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

  function scrapePost() {
    const data = {
      platform: 'TikTok',
      url: window.location.href,
      scrapedAt: new Date().toISOString(),
    };

    // Caption / description
    const captionEl = document.querySelector('[data-e2e="video-desc"], [data-e2e="browse-video-desc"], h1');
    if (captionEl) data.caption = captionEl.textContent.trim().slice(0, 2000);

    // Username
    const usernameEl = document.querySelector('[data-e2e="video-author-uniqueid"], [data-e2e="browse-username"] a, a[href*="/@"]');
    if (usernameEl) {
      data.username = usernameEl.textContent.trim().replace(/^@/, '');
    }
    if (!data.username) {
      const match = window.location.pathname.match(/\/@([\w.]+)/);
      if (match) data.username = match[1];
    }

    // Likes
    const likesEl = document.querySelector('[data-e2e="like-count"], [data-e2e="browse-like-count"]');
    if (likesEl) data.likes = parseCount(likesEl.textContent);

    // Comments count
    const commentsCountEl = document.querySelector('[data-e2e="comment-count"], [data-e2e="browse-comment-count"]');
    if (commentsCountEl) data.commentCount = parseCount(commentsCountEl.textContent);

    // Shares / bookmarks
    const sharesEl = document.querySelector('[data-e2e="share-count"], [data-e2e="browse-share-count"]');
    if (sharesEl) data.shares = parseCount(sharesEl.textContent);

    const savesEl = document.querySelector('[data-e2e="undefined-count"]');
    if (savesEl) data.saves = parseCount(savesEl.textContent);

    // Views / plays
    const viewsEl = document.querySelector('[data-e2e="video-views"], [data-e2e="browse-video-views"]');
    if (viewsEl) data.views = parseCount(viewsEl.textContent);

    // Get visible comments
    const commentEls = document.querySelectorAll('[data-e2e="comment-desc"], [data-e2e="browse-comment-desc"], [class*="CommentText"]');
    const comments = [];
    commentEls.forEach((el, i) => {
      const text = el.textContent.trim();
      if (text && text.length > 1 && i < 50) comments.push(text);
    });
    if (comments.length) data.comments = comments;

    // Date
    const dateEl = document.querySelector('[data-e2e="video-create-time"], time');
    if (dateEl) {
      data.postDate = dateEl.getAttribute('datetime') || dateEl.textContent.trim();
    }

    // Hashtags
    if (data.caption) {
      const hashtags = data.caption.match(/#[\w]+/g);
      if (hashtags) data.hashtags = hashtags;
    }

    return data;
  }

  function injectButton() {
    if (document.getElementById('tiktok-scraper-btn')) return;

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

    btn.onclick = () => {
      const data = scrapePost();
      scraped.push(data);
      save();

      btn.style.background = '#2ecc71';
      btn.textContent = '✓ Scraped!';
      setTimeout(() => {
        btn.style.background = '#fe2c55';
        btn.textContent = '📋 Scrape Post';
      }, 1500);

      chrome.runtime.sendMessage({ type: 'SCRAPED', count: scraped.length });
    };

    document.body.appendChild(btn);
  }

  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      setTimeout(injectButton, 1000);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(injectButton, 2000);
})();
