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
let activeAbortController = null;
let cancellationGeneration = 0;

class SpeechCancelledError extends Error {}

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

async function voicevoxFetch(baseUrl, path, options = {}, generation = cancellationGeneration) {
  const controller = new AbortController();
  activeAbortController = controller;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 30000);
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
    if (error.name === "AbortError" && generation !== cancellationGeneration) throw new SpeechCancelledError();
    if (error.name === "AbortError" && timedOut) throw new Error("VOICEVOX ENGINEへの接続がタイムアウトしました");
    if (error instanceof TypeError) throw new Error("VOICEVOX ENGINEへ接続できません");
    throw error;
  } finally {
    clearTimeout(timeout);
    if (activeAbortController === controller) activeAbortController = null;
  }
}

async function synthesize(text, settings, generation) {
  const speaker = Number(settings.speaker);
  console.info("[MisskeyReader] VOICEVOX request");
  const queryParams = new URLSearchParams({ text, speaker: String(speaker) });
  const queryResponse = await voicevoxFetch(
    settings.voicevoxUrl,
    `/audio_query?${queryParams}`,
    { method: "POST" },
    generation
  );
  if (generation !== cancellationGeneration) throw new SpeechCancelledError();
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
    },
    generation
  );
  if (generation !== cancellationGeneration) throw new SpeechCancelledError();
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

async function playAudio(buffer, generation) {
  if (generation !== cancellationGeneration) throw new SpeechCancelledError();
  await ensureOffscreenDocument();
  if (generation !== cancellationGeneration) throw new SpeechCancelledError();
  console.info("[MisskeyReader] playback started");
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "playAudio",
    audioDataUrl: arrayBufferToDataUrl(buffer)
  });
  if (generation !== cancellationGeneration) throw new SpeechCancelledError();
  if (!response?.ok) throw new Error(response?.error || "音声を再生できませんでした");
  console.info("[MisskeyReader] playback finished");
}

async function speakNow(text, generation) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  if (!settings.enabled || generation !== cancellationGeneration) return;
  try {
    const audio = await synthesize(text, settings, generation);
    console.info("[MisskeyReader] VOICEVOX connected");
    await playAudio(audio, generation);
  } catch (error) {
    if (error instanceof SpeechCancelledError) throw error;
    console.error("[MisskeyReader] VOICEVOX connection error", error.message);
    throw error;
  }
}

function enqueueSpeech(text) {
  return new Promise((resolve, reject) => {
    speechQueue.push({ text, generation: cancellationGeneration, resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  if (processingQueue) return;
  processingQueue = true;
  while (speechQueue.length) {
    const item = speechQueue.shift();
    try {
      await speakNow(item.text, item.generation);
      item.resolve();
    } catch (error) {
      if (error instanceof SpeechCancelledError) item.resolve();
      else item.reject(error);
    }
  }
  processingQueue = false;
}

async function getSpeakers(voicevoxUrl) {
  const response = await voicevoxFetch(voicevoxUrl, "/speakers");
  return response.json();
}

async function updateActionState(enabled) {
  await chrome.action.setBadgeText({ text: enabled ? "ON" : "OFF" });
  await chrome.action.setBadgeBackgroundColor({ color: enabled ? "#16803a" : "#b3261e" });
  await chrome.action.setTitle({ title: enabled ? "Misskey Reader：読み上げON" : "Misskey Reader：読み上げOFF" });
}

async function stopSpeech() {
  cancellationGeneration += 1;
  if (activeAbortController) activeAbortController.abort();
  while (speechQueue.length) speechQueue.shift().resolve();
  console.info("[MisskeyReader] queue cleared");

  if (await hasOffscreenDocument()) {
    await chrome.runtime.sendMessage({ target: "offscreen", type: "stopAudio" }).catch(() => {});
  }
  console.info("[MisskeyReader] playback stopped");
}

async function applyEnabledState(enabled) {
  await updateActionState(enabled);
  if (enabled) {
    console.info("[MisskeyReader] speech enabled");
  } else {
    console.info("[MisskeyReader] speech disabled");
    await stopSpeech();
  }
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
  enqueueSpeech(message.text)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.action.onClicked.addListener(async () => {
  const { enabled } = await chrome.storage.sync.get({ enabled: true });
  await chrome.storage.sync.set({ enabled: !enabled });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.enabled) applyEnabledState(Boolean(changes.enabled.newValue));
});

chrome.runtime.onStartup.addListener(async () => {
  const { enabled } = await chrome.storage.sync.get({ enabled: true });
  await applyEnabledState(enabled);
});

chrome.storage.sync.get({ enabled: true }).then(({ enabled }) => applyEnabledState(enabled));
