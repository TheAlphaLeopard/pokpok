// Inject in-page script so it runs in page context
(function(){
  // Inject inpage script by fetching its source and inserting inline.
  // This avoids chrome-extension:// URL load failures and CSP blocking.
  const url = chrome.runtime.getURL('inpage.js');
  fetch(url).then(resp => resp.text()).then(code => {
    const s = document.createElement('script');
    s.textContent = code + '\n//# sourceURL=' + url;
    (document.documentElement || document.head || document.body).appendChild(s);
    // remove after injection
    s.parentNode && s.parentNode.removeChild(s);
  }).catch(err => {
    console.error('Failed to inject inpage script', err);
  });
})();

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
