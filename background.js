// Service worker: makes the Beautify request on behalf of the content script.
// Fetching from here sends the extension's own Origin, which the proxy checks;
// a content script fetch would carry the page's origin instead.
const BEAUTIFY_URL = 'https://snipbar.vercel.app/api/beautify';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'beautify') return;
  beautify(msg.text).then(sendResponse);
  return true; // reply arrives asynchronously
});

async function beautify(text) {
  try {
    const res = await fetch(BEAUTIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && typeof data.text === 'string') return { text: data.text };
    return { error: data.error || `http_${res.status}` };
  } catch {
    return { error: 'offline' };
  }
}
