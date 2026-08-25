"use strict";

const DEFAULTS = {
  enabled: true,
  voicevoxUrl: "http://127.0.0.1:50021",
  speaker: 3,
  speedScale: 1.0,
  pitchScale: 0.0,
  intonationScale: 1.0,
  volumeScale: 1.0,
  initialNoteCount: 5,
  maxReadLength: 64,
  removeUrls: true,
  maxQueueSize: 10,
  maxNoteAgeSeconds: 300,
  customVoices: []
};

const speechQueue = [];
let processingQueue = false;
let creatingOffscreenDocument = null;
let activeAbortController = null;
let cancellationGeneration = 0;
let queueSequence = 0;
let queueStartTimer = null;
const speakerCache = new Map();
let queuePolicy = {
  maxQueueSize: DEFAULTS.maxQueueSize,
  maxNoteAgeSeconds: DEFAULTS.maxNoteAgeSeconds
};

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

async function synthesize(text, settings, generation, speaker) {
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

function normalizeUserId(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  return (trimmed.startsWith("@") ? trimmed : `@${trimmed}`).toLowerCase();
}

async function validSpeakerIds(voicevoxUrl) {
  const key = normalizeEngineUrl(voicevoxUrl);
  const cached = speakerCache.get(key);
  if (cached && Date.now() - cached.updatedAt < 5 * 60 * 1000) return cached.ids;
  const speakers = await getSpeakers(voicevoxUrl);
  const ids = new Set(speakers.flatMap((character) =>
    (character.styles || []).map((style) => Number(style.id)).filter(Number.isFinite)
  ));
  speakerCache.set(key, { ids, updatedAt: Date.now() });
  return ids;
}

async function selectSpeaker(settings, userId) {
  const fallback = Number(settings.speaker);
  const normalized = normalizeUserId(userId);
  if (!normalized || !Array.isArray(settings.customVoices)) return fallback;
  const mapping = settings.customVoices.find((entry) => normalizeUserId(entry?.userId) === normalized);
  const customSpeaker = Number(mapping?.speaker);
  if (!mapping || !Number.isInteger(customSpeaker) || customSpeaker < 0) return fallback;
  try {
    const ids = await validSpeakerIds(settings.voicevoxUrl);
    return ids.has(customSpeaker) ? customSpeaker : fallback;
  } catch {
    return fallback;
  }
}

async function speakNow(text, generation, userId) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  if (!settings.enabled || generation !== cancellationGeneration) return;
  try {
    const speaker = await selectSpeaker(settings, userId);
    if (generation !== cancellationGeneration) throw new SpeechCancelledError();
    const audio = await synthesize(text, settings, generation, speaker);
    console.info("[MisskeyReader] VOICEVOX connected");
    await playAudio(audio, generation);
  } catch (error) {
    if (error instanceof SpeechCancelledError) throw error;
    console.error("[MisskeyReader] VOICEVOX connection error", error.message);
    throw error;
  }
}

function checkFreshness(item, stage) {
  const now = Date.now();
  const maxNoteAgeSeconds = Math.max(0, Number(queuePolicy.maxNoteAgeSeconds) || 0);
  const hasTimestamp = Number.isFinite(item.postedAt);
  const ageSeconds = hasTimestamp ? (now - item.postedAt) / 1000 : null;
  let decision = "accepted";
  if (!hasTimestamp && maxNoteAgeSeconds > 0) decision = "timestamp-unavailable";
  else if (maxNoteAgeSeconds > 0 && ageSeconds > maxNoteAgeSeconds) decision = "stale";

  console.debug("[MisskeyReader] note freshness", {
    stage,
    noteId: item.noteId,
    rawTimeAttribute: item.rawTime,
    parsedPostedAt: hasTimestamp ? item.postedAt : null,
    now,
    ageSeconds,
    maxNoteAgeSeconds,
    decision
  });
  return decision === "accepted";
}

function enqueueSpeech(text, postedAt, noteId, rawTime, userId) {
  const numericTimestamp = postedAt === null || postedAt === undefined
    ? NaN
    : Number(postedAt);
  const candidate = {
    text,
    noteId: noteId || "(unknown)",
    userId: normalizeUserId(userId) || null,
    rawTime: rawTime || {},
    postedAt: Number.isFinite(numericTimestamp) ? numericTimestamp : NaN
  };
  if (!checkFreshness(candidate, "enqueue")) return Promise.resolve();

  return new Promise((resolve, reject) => {
    speechQueue.push({
      ...candidate,
      sequence: queueSequence++,
      generation: cancellationGeneration,
      resolve,
      reject
    });
    speechQueue.sort((a, b) => {
      const aTime = Number.isFinite(a.postedAt) ? a.postedAt : Infinity;
      const bTime = Number.isFinite(b.postedAt) ? b.postedAt : Infinity;
      return aTime - bTime || a.sequence - b.sequence;
    });

    const limit = Math.max(0, Math.floor(Number(queuePolicy.maxQueueSize) || 0));
    while (speechQueue.length > limit) {
      const dropped = speechQueue.shift();
      dropped.resolve();
      console.info("[MisskeyReader] dropped oldest queued note");
    }
    if (speechQueue.length && !processingQueue && !queueStartTimer) {
      // 同一DOM更新で届く複数ノートを集約してから投稿時刻順に処理する。
      queueStartTimer = setTimeout(() => {
        queueStartTimer = null;
        processQueue();
      }, 100);
    }
  });
}

async function processQueue() {
  if (processingQueue) return;
  processingQueue = true;
  while (speechQueue.length) {
    const item = speechQueue.shift();
    try {
      if (!checkFreshness(item, "before-playback")) {
        item.resolve();
        continue;
      }
      await speakNow(item.text, item.generation, item.userId);
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
  if (queueStartTimer) clearTimeout(queueStartTimer);
  queueStartTimer = null;
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
  enqueueSpeech(message.text, message.postedAt, message.noteId, message.rawTime, message.userId)
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
  if (area === "sync" && changes.maxQueueSize) {
    queuePolicy.maxQueueSize = changes.maxQueueSize.newValue;
    const limit = Math.max(0, Math.floor(Number(queuePolicy.maxQueueSize) || 0));
    while (speechQueue.length > limit) speechQueue.shift().resolve();
  }
  if (area === "sync" && changes.maxNoteAgeSeconds) {
    queuePolicy.maxNoteAgeSeconds = changes.maxNoteAgeSeconds.newValue;
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const { enabled } = await chrome.storage.sync.get({ enabled: true });
  await applyEnabledState(enabled);
});

chrome.storage.sync.get({ enabled: true }).then(({ enabled }) => applyEnabledState(enabled));
chrome.storage.sync.get({
  maxQueueSize: DEFAULTS.maxQueueSize,
  maxNoteAgeSeconds: DEFAULTS.maxNoteAgeSeconds
}).then((settings) => { queuePolicy = settings; });
