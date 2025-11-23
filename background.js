// Background service worker: inject in-page code into the tab's main world.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  // Background fetch for TTS audio (content_script will forward blob to the page)
  if (msg.type === 'fetchTTS'){
    (async () => {
      try{
        const text = msg.text || '';
        if (!text) return sendResponse({ ok: false, error: 'No text' });
        const q = encodeURIComponent(text);
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${q}&tl=en&client=tw-ob`;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) throw new Error('TTS fetch failed: ' + res.status);
        const buf = await res.arrayBuffer();
        const mime = res.headers.get('content-type') || 'audio/mpeg';
        // encode to base64 to avoid structured-clone ArrayBuffer issues across extension messaging
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes.subarray(i, i + chunkSize)));
        }
        const b64 = btoa(binary);
        sendResponse({ ok: true, dataBase64: b64, mime });
      } catch (e){
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg.type === 'ensureInjected'){
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) return;
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: function(){
        // This function runs in the page (MAIN) world.
        if (window.__tts_virtual_mic_injected) return;
        window.__tts_virtual_mic_injected = true;

        (function(){
          let audioCtx = null;
          let audioEl = null;
          let elementSource = null;
          let destination = null;
          let ttsStream = null;
          let ttsAudioBuffer = null; // decoded AudioBuffer for reliable playback
          let currentSource = null; // current AudioBufferSourceNode
          const _pokpok_fake_device_id = 'pokpok-tts-virtual-device';

          window.addEventListener('message', async (ev) => {
            const m = ev.data;
            if (!m || m.direction !== 'from-extension') return;
            try{
                if (m.type === 'setTTS'){
                // Accept either an ArrayBuffer (preferred), a Blob, or raw text (fallback).
                if (m.arrayBuffer){
                  console.log('Inpage received transferred arrayBuffer, mime=', m.mime, 'arrayBuffer instanceof ArrayBuffer=', m.arrayBuffer instanceof ArrayBuffer);
                  try{
                    if (!audioEl){
                      audioEl = document.createElement('audio');
                      audioEl.crossOrigin = 'anonymous';
                      audioEl.style.display = 'none';
                      document.body.appendChild(audioEl);
                    }
                    try{ if (audioEl._objectUrl) URL.revokeObjectURL(audioEl._objectUrl); }catch(e){}
                    const blob = new Blob([m.arrayBuffer], { type: m.mime || 'audio/mpeg' });
                    let objectUrl;
                    try{
                      objectUrl = URL.createObjectURL(blob);
                    } catch (e){
                      console.error('createObjectURL failed in page context', e, 'blob type=', blob.type);
                      throw e;
                    }
                    audioEl._objectUrl = objectUrl;
                    audioEl.src = objectUrl;
                    audioEl.load();
                    console.log('TTS audio element set from transferred ArrayBuffer, objectUrl=', objectUrl);
                    // Prepare audio context, decode ArrayBuffer into AudioBuffer and create destination
                    try{
                      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                      if (!destination){
                        destination = audioCtx.createMediaStreamDestination();
                        ttsStream = destination.stream;
                      }
                      // Decode into AudioBuffer for reliable playback and routing into destination
                      try{
                        // Some ArrayBuffer-like objects are transferable; make a copy if necessary
                        const raw = m.arrayBuffer.slice ? m.arrayBuffer.slice(0) : m.arrayBuffer;
                        ttsAudioBuffer = await audioCtx.decodeAudioData(raw).catch(err => { throw err; });
                        console.log('TTS Virtual Mic: decoded AudioBuffer, length=', ttsAudioBuffer.length);
                      } catch (e){
                        console.warn('decodeAudioData failed, falling back to media element source', e);
                      }
                      // If decode succeeded, we will play via AudioBufferSourceNode in playTTS; still create elementSource fallback
                      if (!elementSource){
                        try{
                          elementSource = audioCtx.createMediaElementSource(audioEl);
                          elementSource.connect(destination);
                        } catch (e){
                          console.warn('createMediaElementSource failed during setTTS (arrayBuffer)', e);
                        }
                      }
                      console.log('TTS Virtual Mic: prepared audioCtx/destination on setTTS (arrayBuffer)');
                    } catch (e){ console.warn('Failed to prepare audio context on setTTS (arrayBuffer)', e); }
                  } catch (e){ console.error('Failed to use transferred ArrayBuffer', e); }
                } else if (m.blob){
                  console.log('Inpage received m.blob, typeof=', typeof m.blob, 'm.blob instanceof Blob=', m.blob instanceof Blob);
                  if (!audioEl){
                    audioEl = document.createElement('audio');
                    audioEl.crossOrigin = 'anonymous';
                    audioEl.style.display = 'none';
                    document.body.appendChild(audioEl);
                  }
                  try{
                    if (audioEl._objectUrl) URL.revokeObjectURL(audioEl._objectUrl);
                  }catch(e){}
                  const objectUrl = URL.createObjectURL(m.blob);
                  audioEl._objectUrl = objectUrl;
                  audioEl.src = objectUrl;
                  audioEl.load();
                  console.log('TTS audio element set from blob');
                  try{
                    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    if (!destination){
                      destination = audioCtx.createMediaStreamDestination();
                      ttsStream = destination.stream;
                    }
                    // Try to decode blob to AudioBuffer for reliable routing
                    try{
                      const ab = await m.blob.arrayBuffer();
                      ttsAudioBuffer = await audioCtx.decodeAudioData(ab).catch(err => { throw err; });
                      console.log('TTS Virtual Mic: decoded AudioBuffer from blob');
                    } catch (e){
                      console.warn('decodeAudioData from blob failed, using media element fallback', e);
                    }
                    if (!elementSource){
                      try{
                        elementSource = audioCtx.createMediaElementSource(audioEl);
                        elementSource.connect(destination);
                      } catch (e){
                        console.warn('createMediaElementSource failed during setTTS (blob)', e);
                      }
                    }
                    console.log('TTS Virtual Mic: prepared audioCtx/destination on setTTS (blob)');
                  } catch (e){ console.warn('Failed to prepare audio context on setTTS (blob)', e); }
                } else {
                  const text = m.text || '';
                  if (!text) return;
                  const q = encodeURIComponent(text);
                  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${q}&tl=en&client=tw-ob`;
                  if (!audioEl){
                    audioEl = document.createElement('audio');
                    audioEl.crossOrigin = 'anonymous';
                    audioEl.style.display = 'none';
                    document.body.appendChild(audioEl);
                  }
                  audioEl.src = url;
                  audioEl.load();
                  console.log('TTS audio element set src', url);
                  try{
                    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    if (!destination){
                      destination = audioCtx.createMediaStreamDestination();
                      ttsStream = destination.stream;
                    }
                    if (!elementSource){
                      try{
                        elementSource = audioCtx.createMediaElementSource(audioEl);
                        elementSource.connect(destination);
                      } catch (e){
                        console.warn('createMediaElementSource failed during setTTS (text URL)', e);
                      }
                    }
                    console.log('TTS Virtual Mic: prepared audioCtx/destination on setTTS (text URL)');
                  } catch (e){ console.warn('Failed to prepare audio context on setTTS (text URL)', e); }
                }
              } else if (m.type === 'playTTS'){
                if (!audioEl && !ttsAudioBuffer) return console.warn('No audio prepared (no element or decoded buffer)');
                if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                try{ await audioCtx.resume(); } catch(e){}
                if (!destination){
                  destination = audioCtx.createMediaStreamDestination();
                  ttsStream = destination.stream;
                }

                // If we decoded an AudioBuffer, play it via an AudioBufferSourceNode (reliable for routing to destination)
                if (ttsAudioBuffer){
                  try{
                    if (currentSource){
                      try{ currentSource.stop(); } catch(e){}
                      currentSource = null;
                    }
                    currentSource = audioCtx.createBufferSource();
                    currentSource.buffer = ttsAudioBuffer;
                    currentSource.connect(destination);
                    // also connect to output so user can hear it locally if desired
                    try{ currentSource.connect(audioCtx.destination); } catch(e){}
                    currentSource.start(0);
                    console.log('Playing TTS audio buffer via AudioBufferSourceNode');
                  } catch (e){
                    console.warn('failed to play buffer source, falling back to media element', e);
                    try{ await audioEl.play(); console.log('Playing TTS audio element fallback'); } catch(err){ console.warn('audioEl.play() fallback failed', err); }
                  }
                } else {
                  // fallback to media element playback
                  if (!elementSource){
                    try{
                      elementSource = audioCtx.createMediaElementSource(audioEl);
                      elementSource.connect(destination);
                    } catch (e){
                      console.warn('createMediaElementSource failed', e);
                    }
                  }
                  try{
                    await audioEl.play();
                    console.log('Playing TTS audio element');
                  } catch (e){
                    console.warn('audioEl.play() failed, user interaction may be required', e);
                  }
                }
              }
            } catch (e){ console.error('Inpage handling error', e); }
          });

          try{
            if (navigator.mediaDevices){
              // Override enumerateDevices to advertise a fake audio input named "pokpok tts".
              try{
                const origEnumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
                navigator.mediaDevices.enumerateDevices = async function(){
                  const devices = await origEnumerate();
                  try{
                    devices.push({
                      deviceId: _pokpok_fake_device_id,
                      kind: 'audioinput',
                      label: 'pokpok tts',
                      groupId: ''
                    });
                  }catch(e){ /* ignore if device list is frozen */ }
                  return devices;
                };
                console.log('TTS Virtual Mic: enumerateDevices overridden');
              } catch (e){ console.warn('Could not override enumerateDevices', e); }

              if (navigator.mediaDevices.getUserMedia){
                const origGet = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                navigator.mediaDevices.getUserMedia = async function(constraints){
                  const wantsAudio = constraints && (constraints.audio === true || typeof constraints.audio === 'object');
                  let requestedDeviceId = null;
                  if (wantsAudio && typeof constraints.audio === 'object'){
                    const dev = constraints.audio.deviceId;
                    if (dev){
                      if (typeof dev === 'string') requestedDeviceId = dev;
                      else if (typeof dev === 'object' && (dev.exact || dev.ideal)) requestedDeviceId = dev.exact || dev.ideal;
                    }
                  }

                  // If the page explicitly requests the fake device, or wants audio but didn't request a different device,
                  // return our TTS MediaStream when available.
                  if (wantsAudio && (requestedDeviceId === _pokpok_fake_device_id || requestedDeviceId === null)){
                    if (ttsStream){
                      console.log('TTS Virtual Mic: returning TTS stream for getUserMedia', requestedDeviceId);
                      return ttsStream;
                    }
                  }
                  return origGet(constraints);
                };
                console.log('TTS Virtual Mic: navigator.mediaDevices.getUserMedia overridden');
              }
            }
          } catch (e){ console.warn('Could not override mediaDevices APIs', e); }

        })();
      }
    }).then(()=> sendResponse({ ok: true })).catch(err => sendResponse({ ok: false, error: String(err) }));
    // indicate async response
    return true;
  }
});
