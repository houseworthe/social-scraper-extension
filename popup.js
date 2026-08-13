// popup.js — Social Scraper popup v2
// Shows scrape queue from Label-Dex, local scrapes, settings for API token

const API_BASE = 'https://staging.label-dex.com';

let activeTab = 'queue';
let queueData = [];
let localScrapes = [];

function load() {
  chrome.storage.local.get(['scraperToken', 'activeTrackId', 'localScrapes'], (res) => {
    document.getElementById('token').value = res.scraperToken || '';
    localScrapes = res.localScrapes || [];
    render();
    if (res.scraperToken) loadQueue(res.scraperToken);
  });
}

async function loadQueue(token) {
  try {
    const resp = await fetch(`${API_BASE}/api/social-proof/queue?token=${encodeURIComponent(token)}`);
    if (!resp.ok) throw new Error('Failed to load queue');
    queueData = await resp.json();
    render();
  } catch (e) {
    document.getElementById('queueList').innerHTML = `<div class="empty">Failed to load queue. Check your token in Settings.</div>`;
  }
}

function render() {
  // Update counts
  document.getElementById('queueCount').textContent = `${queueData.length} tracks`;
  document.getElementById('localCount').textContent = `${localScrapes.length} scraped`;

  // Render active tab
  if (activeTab === 'queue') renderQueue();
  else if (activeTab === 'local') renderLocal();
  else if (activeTab === 'settings') renderSettings();
}

function renderQueue() {
  const el = document.getElementById('queueList');
  if (queueData.length === 0) {
    el.innerHTML = '<div class="empty">No tracks with promo links yet. Producers can add promo links from their track vault.</div>';
    return;
  }

  let html = '';
  for (const track of queueData) {
    html += `<div class="track-group">
      <div class="track-title">${escapeHtml(track.trackTitle)} — <span class="artist">${escapeHtml(track.artistName)}</span></div>`;
    for (const link of track.promoLinks) {
      const status = link.scraped ? 'scraped' : 'pending';
      const statusClass = link.scraped ? 'status-scraped' : 'status-pending';
      html += `<div class="queue-item ${statusClass}" data-url="${escapeHtml(link.url)}" data-track-id="${track.trackId}">
        <span class="status-badge">${status}</span>
        <span class="queue-url">${escapeHtml(link.url)}</span>
        ${!link.scraped ? `<button class="go-btn" data-url="${escapeHtml(link.url)}" data-track-id="${track.trackId}">Go →</button>` : ''}
      </div>`;
    }
    html += '</div>';
  }
  el.innerHTML = html;

  // Attach click handlers
  el.querySelectorAll('.go-btn').forEach(btn => {
    btn.onclick = () => {
      const url = btn.dataset.url;
      const trackId = btn.dataset.trackId;
      chrome.storage.local.set({ activeTrackId: trackId }, () => {
        chrome.tabs.create({ url });
      });
    };
  });
}

function renderLocal() {
  const el = document.getElementById('localList');
  if (localScrapes.length === 0) {
    el.innerHTML = '<div class="empty">No posts scraped yet.</div>';
    return;
  }

  const reversed = [...localScrapes].reverse();
  el.innerHTML = reversed.map((item) => {
    const platform = item.platform || 'Unknown';
    const caption = item.caption ? item.caption.slice(0, 80) + (item.caption.length > 80 ? '...' : '') : '';
    const stats = [
      item.likes != null ? `${item.likes.toLocaleString()} likes` : '',
      item.commentCount != null ? `${item.commentCount.toLocaleString()} comments` : '',
      item.views != null ? `${item.views.toLocaleString()} views` : '',
    ].filter(Boolean).join(' · ');

    return `<div class="data-item">
      <span class="platform platform-${platform}">${platform}</span>
      ${item.username ? `<strong>@${escapeHtml(item.username)}</strong>` : ''}
      ${caption ? `<div class="caption">${escapeHtml(caption)}</div>` : ''}
      ${stats ? `<div class="stats">${stats}</div>` : ''}
    </div>`;
  }).join('');
}

function renderSettings() {
  // Settings tab is static HTML, just need save handler
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str || '');
  return div.innerHTML;
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
  if (localScrapes.length === 0) return;

  const headers = ['platform', 'username', 'url', 'caption', 'likes', 'commentCount', 'views', 'shares', 'saves', 'postDate', 'hashtags', 'comments', 'scrapedAt'];
  const rows = localScrapes.map((item) => [
    escapeCSV(item.platform), escapeCSV(item.username), escapeCSV(item.url),
    escapeCSV(item.caption), item.likes ?? '', item.commentCount ?? '',
    item.views ?? '', item.shares ?? '', item.saves ?? '',
    escapeCSV(item.postDate), escapeCSV((item.hashtags || []).join(' ')),
    escapeCSV((item.comments || []).join(' | ')), escapeCSV(item.scrapedAt),
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

function clearAll() {
  if (!confirm(`Delete all ${localScrapes.length} local scraped posts?`)) return;
  localScrapes = [];
  chrome.storage.local.set({ localScrapes: [] });
  chrome.runtime.sendMessage({ type: 'CLEAR' });
  render();
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;

    // Show/hide panels
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
    document.getElementById(activeTab + 'Panel').style.display = 'block';
    render();
  };
});

// Save token
document.getElementById('saveToken').onclick = () => {
  const token = document.getElementById('token').value.trim();
  chrome.storage.local.set({ scraperToken: token }, () => {
    const btn = document.getElementById('saveToken');
    const orig = btn.textContent;
    btn.textContent = '✓ Saved!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
    if (token) loadQueue(token);
  });
};

document.getElementById('export').addEventListener('click', exportCSV);
document.getElementById('clear').addEventListener('click', clearAll);

load();
