// popup.js — LabelDex Scraper popup v3
// Shows scrape queue from LabelDex, local scrapes, settings for API token

const API_BASE = 'https://staging.label-dex.com';

let activeTab = 'queue';
let queueData = []; // array of track objects (each has .promoLinks)
let localScrapes = [];

function load() {
  chrome.storage.local.get(['scraperToken', 'activeTrackId', 'localScrapes'], (res) => {
    document.getElementById('token').value = res.scraperToken || '';
    localScrapes = res.localScrapes || [];
    if (res.scraperToken) {
      loadQueue(res.scraperToken);
    } else {
      render();
    }
  });
}

async function loadQueue(token) {
  const listEl = document.getElementById('queueList');
  listEl.innerHTML = '<div class="empty">Loading queue…</div>';

  try {
    const resp = await fetch(`${API_BASE}/api/social-proof/queue?token=${encodeURIComponent(token)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();

    // API returns { success: true, tracks: [...] }
    if (json && Array.isArray(json.tracks)) {
      queueData = json.tracks;
    } else if (Array.isArray(json)) {
      // fallback: direct array
      queueData = json;
    } else {
      console.error('[LabelDex] Unexpected queue response shape:', json);
      queueData = [];
    }
    render();
  } catch (e) {
    console.error('[LabelDex] Queue load failed:', e);
    listEl.innerHTML = '<div class="empty">Failed to load queue. Check your token in Settings.</div>';
    document.getElementById('queueCount').textContent = '0';
  }
}

function render() {
  // Count total promo links across all tracks for the badge
  const totalLinks = queueData.reduce((sum, t) => sum + (t.promoLinks?.length || 0), 0);
  document.getElementById('queueCount').textContent = totalLinks;
  document.getElementById('localCount').textContent = localScrapes.length;

  if (activeTab === 'queue') renderQueue();
  else if (activeTab === 'local') renderLocal();
}

function renderQueue() {
  const el = document.getElementById('queueList');

  if (queueData.length === 0) {
    el.innerHTML = '<div class="empty">No tracks in queue yet.</div>';
    return;
  }

  let html = '';
  for (const track of queueData) {
    const links = track.promoLinks || [];
    if (links.length === 0) continue;

    html += `<div class="track-card">
      <div class="track-card-header">
        <div class="track-card-icon">♪</div>
        <div class="track-card-info">
          <div class="track-card-title">${escapeHtml(track.trackTitle || 'Untitled')}</div>
          <div class="track-card-artist">${escapeHtml(track.artistName || 'Unknown artist')}</div>
        </div>
        <span class="track-badge">${links.length}</span>
      </div>`;

    for (const link of links) {
      const scraped = link.scraped || link.status === 'scraped';
      const platform = detectPlatform(link.url);
      html += `<div class="link-row ${scraped ? 'link-row--done' : ''}">
        <span class="link-platform platform-${platform}">${platform}</span>
        <span class="link-url" title="${escapeAttr(link.url)}">${escapeHtml(shortenUrl(link.url))}</span>
        ${scraped
          ? '<span class="link-status link-status--done">✓</span>'
          : `<button class="link-go" data-url="${escapeAttr(link.url)}" data-track-id="${escapeAttr(track.trackId || '')}">Open →</button>`
        }
      </div>`;
    }

    html += '</div>';
  }
  el.innerHTML = html || '<div class="empty">No promo links in queue.</div>';

  // Attach handlers
  el.querySelectorAll('.link-go').forEach(btn => {
    btn.onclick = () => {
      const url = btn.dataset.url;
      const trackId = btn.dataset.trackId;
      chrome.storage.local.set({ activeTrackId: trackId }, () => {
        chrome.tabs.create({ url });
      });
    };
  });
}

function detectPlatform(url) {
  const u = (url || '').toLowerCase();
  if (u.includes('instagram.com')) return 'IG';
  if (u.includes('tiktok.com')) return 'TT';
  return 'LINK';
}

function shortenUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.length > 25 ? parsed.pathname.slice(0, 23) + '…' : parsed.pathname;
  } catch {
    return url.length > 32 ? url.slice(0, 30) + '…' : url;
  }
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
    const caption = item.caption ? item.caption.slice(0, 80) + (item.caption.length > 80 ? '…' : '') : '';
    const stats = [
      item.likes != null ? `${item.likes.toLocaleString()} likes` : '',
      item.commentCount != null ? `${item.commentCount.toLocaleString()} comments` : '',
      item.views != null ? `${item.views.toLocaleString()} views` : '',
    ].filter(Boolean).join(' · ');

    return `<div class="scrape-card">
      <div class="scrape-top">
        <span class="link-platform platform-${platform === 'Instagram' ? 'IG' : platform === 'TikTok' ? 'TT' : 'LINK'}">${platform}</span>
        ${item.username ? `<span class="scrape-user">@${escapeHtml(item.username)}</span>` : ''}
      </div>
      ${caption ? `<div class="scrape-caption">${escapeHtml(caption)}</div>` : ''}
      ${stats ? `<div class="scrape-stats">${stats}</div>` : ''}
    </div>`;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
  a.download = `labeldex-scraper-${new Date().toISOString().slice(0, 10)}.csv`;
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
    btn.textContent = '✓ Saved';
    btn.classList.add('btn-saved');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('btn-saved'); }, 1500);
    if (token) loadQueue(token);
  });
};

document.getElementById('export').addEventListener('click', exportCSV);
document.getElementById('clear').addEventListener('click', clearAll);

load();
