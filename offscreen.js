"use strict";

let currentAudio = null;

function play(audioDataUrl) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(audioDataUrl);
    currentAudio = audio;
    audio.addEventListener("ended", () => {
      if (currentAudio === audio) currentAudio = null;
      resolve();
    }, { once: true });
    audio.addEventListener("error", () => {
      if (currentAudio === audio) currentAudio = null;
      reject(new Error("VOICEVOXのWAV音声を再生できませんでした"));
    }, { once: true });
    audio.play().catch(reject);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen" || message?.type !== "playAudio") return;
  play(message.audioDataUrl)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
