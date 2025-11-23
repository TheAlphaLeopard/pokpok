// Inject in-page script so it runs in page context
// Ask the background worker to inject the in-page script into the MAIN world.
// This avoids CSP/inline/script-src failures because chrome.scripting.executeScript
// runs the function directly in the page's JS context.
chrome.runtime.sendMessage({ type: 'ensureInjected' }, (resp) => {
  if (!resp || !resp.ok) console.warn('Injection failed or not confirmed', resp);
});

  const s = document.createElement('script');
  s.textContent = code + '\n//# sourceURL=inpage.js';
  (document.documentElement || document.head || document.body).appendChild(s);
  s.parentNode && s.parentNode.removeChild(s);

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'setTTS'){
    // Forward the text to the in-page script; in-page will create an <audio> element
    try{
      const text = msg.text || '';
      window.postMessage({ direction: 'from-extension', type: 'setTTS', text }, '*');
      sendResponse({ ok: true });
    } catch (e){
      console.error('Failed to forward TTS text', e);
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }
  if (msg.type === 'playTTS'){
    window.postMessage({ direction: 'from-extension', type: 'playTTS' }, '*');
    sendResponse({ ok: true });
  }
});
