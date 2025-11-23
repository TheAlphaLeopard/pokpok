document.getElementById('set').addEventListener('click', async ()=>{
  const text = document.getElementById('text').value || '';
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs[0]) return alert('No active tab');
  chrome.tabs.sendMessage(tabs[0].id, { type: 'setTTS', text }, (resp)=>{
    if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError.message);
    // optional: show response
  });
});

document.getElementById('play').addEventListener('click', async ()=>{
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs[0]) return alert('No active tab');
  chrome.tabs.sendMessage(tabs[0].id, { type: 'playTTS' }, (resp)=>{
    if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError.message);
  });
});

document.getElementById('setSpeak').addEventListener('click', async ()=>{
  const text = document.getElementById('text').value || '';
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs[0]) return alert('No active tab');
  const tabId = tabs[0].id;

  // Send setTTS, then on success send playTTS
  chrome.tabs.sendMessage(tabId, { type: 'setTTS', text }, (resp) => {
    if (chrome.runtime.lastError) {
      console.warn('setTTS error:', chrome.runtime.lastError.message);
      return;
    }
    // small delay to ensure audio element loads, but also trigger play immediately
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { type: 'playTTS' }, (r2) => {
        if (chrome.runtime.lastError) console.warn('playTTS error:', chrome.runtime.lastError.message);
      });
    }, 200);
  });
});

// Send bundled `download.wav` from extension package to the page for testing
document.getElementById('test').addEventListener('click', async ()=>{
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs[0]) return alert('No active tab');
  const tabId = tabs[0].id;

  try{
    const url = chrome.runtime.getURL('download.wav');
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch download.wav: ' + res.status);
    const blob = await res.blob();
    chrome.tabs.sendMessage(tabId, { type: 'setTTSBlob', blob }, (resp) => {
      if (chrome.runtime.lastError) console.warn('setTTSBlob error', chrome.runtime.lastError.message);
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { type: 'playTTS' }, (r2) => {
          if (chrome.runtime.lastError) console.warn('playTTS error:', chrome.runtime.lastError.message);
        });
      }, 200);
    });
  } catch (e){
    console.error('Could not send test audio', e);
    alert('Could not send test audio: ' + e.message);
  }
});
