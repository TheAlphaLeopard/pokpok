// Inject in-page script so it runs in page context
// Ask the background worker to inject the in-page script into the MAIN world.
// This avoids CSP/inline/script-src failures because chrome.scripting.executeScript
// runs the function directly in the page's JS context.
chrome.runtime.sendMessage({ type: 'ensureInjected' }, (resp) => {
  if (!resp || !resp.ok) console.warn('Injection failed or not confirmed', resp);
});


// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'setTTS'){
    // Request the background to fetch the TTS audio (avoids page CSP). Background returns ArrayBuffer.
    try{
      const text = msg.text || '';
      chrome.runtime.sendMessage({ type: 'fetchTTS', text }, (resp) => {
        if (!resp || !resp.ok){
          console.error('fetchTTS failed', resp);
          sendResponse({ ok: false, error: resp && resp.error });
          return;
        }
        try{
          let arr = resp.data; // expected ArrayBuffer
          const origType = typeof arr;

          // Normalize possible shapes (structured clone may vary across contexts)
          if (arr && typeof arr === 'object' && !(arr instanceof ArrayBuffer)){
            // If it's a Uint8Array-like (has data or numeric keys), try to build an ArrayBuffer
            if (arr.data && arr.data instanceof ArrayBuffer){
              arr = arr.data;
            } else if (Array.isArray(arr)){
              arr = (new Uint8Array(arr)).buffer;
            } else {
              // attempt to convert object with numeric keys
              try{
                const vals = Object.keys(arr).map(k => arr[k]);
                if (vals.length && typeof vals[0] === 'number') arr = (new Uint8Array(vals)).buffer;
              }catch(e){}
            }
          }

          if (!(arr instanceof ArrayBuffer)){
            console.warn('TTS response data not an ArrayBuffer (type:', origType, '). Attempting fallback.');
          }

          const mime = resp.mime || 'audio/mpeg';

          // Create Blob and do a quick canPlayType test before forwarding to page
          const blob = new Blob([arr], { type: mime });
          try{
            const testAudio = document.createElement('audio');
            const testUrl = URL.createObjectURL(blob);
            testAudio.src = testUrl;
            const can = testAudio.canPlayType(mime || 'audio/mpeg');
            console.log('TTS blob mime:', mime, 'canPlayType =>', can);
            URL.revokeObjectURL(testUrl);
            if (!can){
              console.warn('Browser reports it may not play this MIME type. Retrying with audio/mpeg fallback.');
              // Try forcing audio/mpeg
              const blob2 = new Blob([arr], { type: 'audio/mpeg' });
              window.postMessage({ direction: 'from-extension', type: 'setTTS', blob: blob2 }, '*');
              sendResponse({ ok: true, note: 'forwarded with fallback mime' });
              return;
            }
          } catch (e){
            console.warn('TTS test playback check failed', e);
          }

          // Forward the blob to the page; injected script will create an object URL from it.
          window.postMessage({ direction: 'from-extension', type: 'setTTS', blob }, '*');
          sendResponse({ ok: true });
        } catch (e){
          console.error('Failed to forward TTS blob', e);
          sendResponse({ ok: false, error: String(e) });
        }
      });
    } catch (e){
      console.error('Failed to request fetchTTS', e);
      sendResponse({ ok: false, error: String(e) });
    }
    // indicate async response
    return true;
  }
  if (msg.type === 'setTTSBlob'){
    try{
      const blob = msg.blob;
      if (!blob) return sendResponse({ ok: false, error: 'no blob' });
      window.postMessage({ direction: 'from-extension', type: 'setTTS', blob }, '*');
      sendResponse({ ok: true });
    } catch (e){
      console.error('Failed to forward TTS blob from popup', e);
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }
  if (msg.type === 'playTTS'){
    window.postMessage({ direction: 'from-extension', type: 'playTTS' }, '*');
    sendResponse({ ok: true });
  }
});
