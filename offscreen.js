"use strict";

let audioContext = null;
let currentSource = null;
let finishCurrentPlayback = null;

const clamp = (value, minimum, maximum, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback;
};

async function play(audioDataUrl, pan) {
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === "suspended") await audioContext.resume();
  const encodedAudio = await fetch(audioDataUrl).then((response) => response.arrayBuffer());
  const audioBuffer = await audioContext.decodeAudioData(encodedAudio);

  return new Promise((resolve, reject) => {
    const source = audioContext.createBufferSource();
    const panner = audioContext.createStereoPanner();
    source.buffer = audioBuffer;
    panner.pan.value = clamp(pan, -1, 1, 0);
    source.connect(panner).connect(audioContext.destination);
    currentSource = source;

    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      source.disconnect();
      panner.disconnect();
      if (currentSource === source) currentSource = null;
      if (finishCurrentPlayback === finish) finishCurrentPlayback = null;
      if (error) reject(error);
      else resolve();
    };
    finishCurrentPlayback = finish;
    source.addEventListener("ended", () => finish(), { once: true });
    try {
      source.start();
    } catch (error) {
      finish(error);
    }
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return;
  if (message.type === "stopAudio") {
    const source = currentSource;
    if (finishCurrentPlayback) finishCurrentPlayback();
    if (source) {
      try { source.stop(); } catch { /* すでに停止済み */ }
    }
    sendResponse({ ok: true });
    return;
  }
  if (message.type !== "playAudio") return;
  play(message.audioDataUrl, message.pan)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
