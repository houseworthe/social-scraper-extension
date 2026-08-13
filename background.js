// background.js — Service worker for badge updates and CSV export

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SCRAPED') {
    chrome.action.setBadgeText({ text: String(msg.count) });
    chrome.action.setBadgeBackgroundColor({ color: '#0095f6' });
  }
  if (msg.type === 'CLEAR') {
    chrome.action.setBadgeText({ text: '' });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
});
