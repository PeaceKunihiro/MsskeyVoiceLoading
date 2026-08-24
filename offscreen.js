"use strict";

let currentAudio = null;
let finishCurrentPlayback = null;

function play(audioDataUrl) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(audioDataUrl);
    currentAudio = audio;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (currentAudio === audio) currentAudio = null;
      if (finishCurrentPlayback === finish) finishCurrentPlayback = null;
      if (error) reject(error);
      else resolve();
    };
    finishCurrentPlayback = finish;
    audio.addEventListener("ended", () => {
      finish();
    }, { once: true });
    audio.addEventListener("error", () => {
      finish(new Error("VOICEVOXのWAV音声を再生できませんでした"));
    }, { once: true });
    audio.play().catch((error) => finish(error));
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return;
  if (message.type === "stopAudio") {
    const audio = currentAudio;
    if (finishCurrentPlayback) finishCurrentPlayback();
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    sendResponse({ ok: true });
    return;
  }
  if (message.type !== "playAudio") return;
  play(message.audioDataUrl)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
