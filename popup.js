// popup.js — UI logic for the Social Scraper popup

const STORAGE_KEY = 'social_scraper_data';
let scraped = [];

function load() {
  chrome.storage.local.get([STORAGE_KEY], (res) => {
    scraped = res[STORAGE_KEY] || [];
    render();
  });
}

function render() {
  const countEl = document.getElementById('count');
  const listEl = document.getElementById('dataList');
  countEl.textContent = `${scraped.length} scraped`;

  if (scraped.length === 0) {
    listEl.innerHTML = '<div class="empty">No posts scraped yet. Go scrape something!</div>';
    return;
  }

  // Show most recent first
  const reversed = [...scraped].reverse();
  listEl.innerHTML = reversed.map((item) => {
    const platform = item.platform || 'Unknown';
    const caption = item.caption ? item.caption.slice(0, 80) + (item.caption.length > 80 ? '...' : '') : '';
    const stats = [
      item.likes != null ? `${item.likes.toLocaleString()} likes` : '',
      item.commentCount != null ? `${item.commentCount.toLocaleString()} comments` : '',
      item.views != null ? `${item.views.toLocaleString()} views` : '',
    ].filter(Boolean).join(' · ');

    return `
      <div class="data-item">
        <span class="platform platform-${platform}">${platform}</span>
        ${item.username ? `<strong>@${item.username}</strong>` : ''}
        ${caption ? `<div class="caption">${caption}</div>` : ''}
        ${stats ? `<div class="stats">${stats}</div>` : ''}
      </div>
    `;
  }).join('');
}

function escapeCSV(str) {
  if (str == null) return '';
  const s = String(str);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function exportCSV() {
  if (scraped.length === 0) return;

  const headers = [
    'platform', 'username', 'url', 'caption', 'likes', 'commentCount', 'views',
    'shares', 'saves', 'postDate', 'hashtags', 'comments', 'scrapedAt'
  ];

  const rows = scraped.map((item) => [
    escapeCSV(item.platform),
    escapeCSV(item.username),
    escapeCSV(item.url),
    escapeCSV(item.caption),
    item.likes ?? '',
    item.commentCount ?? '',
    item.views ?? '',
    item.shares ?? '',
    item.saves ?? '',
    escapeCSV(item.postDate),
    escapeCSV((item.hashtags || []).join(' ')),
    escapeCSV((item.comments || []).join(' | ')),
    escapeCSV(item.scrapedAt),
  ].join(','));

  const csv = headers.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `social-scraper-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function copyJSON() {
  if (scraped.length === 0) return;
  const text = JSON.stringify(scraped, null, 2);
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

function clearAll() {
  if (!confirm(`Delete all ${scraped.length} scraped posts?`)) return;
  scraped = [];
  chrome.storage.local.set({ [STORAGE_KEY]: [] });
  chrome.runtime.sendMessage({ type: 'CLEAR' });
  render();
}

document.getElementById('export').addEventListener('click', exportCSV);
document.getElementById('copy').addEventListener('click', copyJSON);
document.getElementById('clear').addEventListener('click', clearAll);

load();
