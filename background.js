"use strict";

const DEFAULTS = {
  enabled: true,
  voicevoxUrl: "http://127.0.0.1:50021",
  speaker: 3,
  speedScale: 1.0,
  pitchScale: 0.0,
  intonationScale: 1.0,
  volumeScale: 1.0
};

const speechQueue = [];
let processingQueue = false;
let creatingOffscreenDocument = null;

function normalizeEngineUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("VOICEVOX ENGINE URLはhttpまたはhttpsを指定してください");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

async function voicevoxFetch(baseUrl, path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${normalizeEngineUrl(baseUrl)}${path}`, {
      ...options,
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`VOICEVOX APIエラー (${response.status})${detail ? `: ${detail}` : ""}`);
    }
    return response;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("VOICEVOX ENGINEへの接続がタイムアウトしました");
    if (error instanceof TypeError) throw new Error("VOICEVOX ENGINEへ接続できません");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function synthesize(text, settings) {
  const speaker = Number(settings.speaker);
  console.info("[MisskeyReader] VOICEVOX request");
  const queryParams = new URLSearchParams({ text, speaker: String(speaker) });
  const queryResponse = await voicevoxFetch(
    settings.voicevoxUrl,
    `/audio_query?${queryParams}`,
    { method: "POST" }
  );
  const query = await queryResponse.json();
  query.speedScale = Number(settings.speedScale);
  query.pitchScale = Number(settings.pitchScale);
  query.intonationScale = Number(settings.intonationScale);
  query.volumeScale = Number(settings.volumeScale);

  const synthesisParams = new URLSearchParams({ speaker: String(speaker) });
  const audioResponse = await voicevoxFetch(
    settings.voicevoxUrl,
    `/synthesis?${synthesisParams}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query)
    }
  );
  console.info("[MisskeyReader] synthesis complete");
  return audioResponse.arrayBuffer();
}

function arrayBufferToDataUrl(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

async function hasOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });
    return contexts.length > 0;
  }
  const clientsList = await clients.matchAll();
  return clientsList.some((client) => client.url === offscreenUrl);
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "VOICEVOXが生成した新着ノートの音声を順番に再生するため"
    }).finally(() => { creatingOffscreenDocument = null; });
  }
  await creatingOffscreenDocument;
}

async function playAudio(buffer) {
  await ensureOffscreenDocument();
  console.info("[MisskeyReader] playback started");
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "playAudio",
    audioDataUrl: arrayBufferToDataUrl(buffer)
  });
  if (!response?.ok) throw new Error(response?.error || "音声を再生できませんでした");
  console.info("[MisskeyReader] playback finished");
}

async function speakNow(text, ignoreEnabled) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  if (!settings.enabled && !ignoreEnabled) return;
  try {
    const audio = await synthesize(text, settings);
    console.info("[MisskeyReader] VOICEVOX connected");
    await playAudio(audio);
  } catch (error) {
    console.error("[MisskeyReader] VOICEVOX connection error", error.message);
    throw error;
  }
}

function enqueueSpeech(text, ignoreEnabled = false) {
  return new Promise((resolve, reject) => {
    speechQueue.push({ text, ignoreEnabled, resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  if (processingQueue) return;
  processingQueue = true;
  while (speechQueue.length) {
    const item = speechQueue.shift();
    try {
      await speakNow(item.text, item.ignoreEnabled);
      item.resolve();
    } catch (error) {
      item.reject(error);
    }
  }
  processingQueue = false;
}

async function getSpeakers(voicevoxUrl) {
  const response = await voicevoxFetch(voicevoxUrl, "/speakers");
  return response.json();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target === "offscreen") return;
  if (message?.type === "getSpeakers" && typeof message.voicevoxUrl === "string") {
    getSpeakers(message.voicevoxUrl)
      .then((speakers) => sendResponse({ ok: true, speakers }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  const isTest = message?.type === "testSpeak";
  if ((!isTest && message?.type !== "speak") || typeof message.text !== "string") return;
  enqueueSpeech(message.text, isTest)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
