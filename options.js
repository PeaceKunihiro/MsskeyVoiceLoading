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
  customVoices: [],
  randomVoiceEnabled: false,
  randomVoiceStyles: [],
  voiceProfiles: {},
  maxConcurrentReads: 1
};

const complexFields = new Set(["customVoices", "randomVoiceStyles", "voiceProfiles"]);
const fields = Object.keys(DEFAULTS).filter((name) => !complexFields.has(name));
const form = document.querySelector("#settings");
const status = document.querySelector("#status");
const speakerSelect = document.querySelector("#speaker");
const testButton = document.querySelector("#test");
const loadSpeakersButton = document.querySelector("#loadSpeakers");
const customVoicesContainer = document.querySelector("#customVoices");
const addCustomVoiceButton = document.querySelector("#addCustomVoice");
const randomVoiceList = document.querySelector("#randomVoiceList");
let availableStyles = [];
let storedRandomVoiceStyles = [];
let storedVoiceProfiles = {};

function showStatus(message, kind = "") {
  status.value = message;
  status.dataset.kind = kind;
}

function validateEngineUrl() {
  const input = document.querySelector("#voicevoxUrl");
  try {
    const url = new URL(input.value.trim());
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    input.setCustomValidity("httpまたはhttpsのVOICEVOX ENGINE URLを入力してください。");
    return false;
  }
  input.setCustomValidity("");
  return true;
}

function readSettings() {
  const result = {};
  fields.forEach((name) => {
    const input = document.querySelector(`#${name}`);
    result[name] = input.type === "checkbox" ? input.checked :
      input.type === "number" || input.tagName === "SELECT" ? Number(input.value) : input.value.trim().replace(/\/$/, "");
  });
  const mappings = new Map();
  customVoicesContainer.querySelectorAll(".custom-voice-row").forEach((row) => {
    const rawUserId = row.querySelector(".custom-user-id").value.trim();
    if (!rawUserId) return;
    const userId = (rawUserId.startsWith("@") ? rawUserId : `@${rawUserId}`).toLowerCase();
    mappings.set(userId, { userId, speaker: Number(row.querySelector(".custom-speaker").value) });
  });
  result.customVoices = [...mappings.values()];
  const randomRows = [...randomVoiceList.querySelectorAll(".random-voice-row")];
  if (randomRows.length) {
    result.randomVoiceStyles = [];
    result.voiceProfiles = {};
    for (const row of randomRows) {
      if (!row.querySelector(".random-enabled").checked) continue;
      const styleId = Number(row.dataset.styleId);
      const volumeScale = Math.min(2, Math.max(0, Number(row.querySelector(".profile-volume").value)));
      const pan = Math.min(1, Math.max(-1, Number(row.querySelector(".profile-pan").value)));
      result.randomVoiceStyles.push(styleId);
      result.voiceProfiles[String(styleId)] = { volumeScale, pan };
    }
    storedRandomVoiceStyles = [...result.randomVoiceStyles];
    storedVoiceProfiles = { ...result.voiceProfiles };
  } else {
    result.randomVoiceStyles = [...storedRandomVoiceStyles];
    result.voiceProfiles = { ...storedVoiceProfiles };
  }
  return result;
}

function permissionPattern(value) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}/*`;
}

async function ensureEnginePermission() {
  if (!validateEngineUrl() || !form.reportValidity()) return false;
  const settings = readSettings();
  const url = new URL(settings.voicevoxUrl);
  if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "50021") return true;
  const origins = [permissionPattern(settings.voicevoxUrl)];
  const granted = await chrome.permissions.request({ origins });
  if (!granted) showStatus("指定したVOICEVOX ENGINEへのアクセス権限が必要です。", "error");
  return granted;
}

function populateSpeakerSelect(select, selectedId) {
  select.textContent = "";
  for (const style of availableStyles) {
      const option = document.createElement("option");
      option.value = style.id;
      option.textContent = `${style.characterName} / ${style.name}（${style.id}）`;
      select.append(option);
  }
  if (![...select.options].some((option) => Number(option.value) === Number(selectedId))) {
    const option = document.createElement("option");
    option.value = selectedId;
    option.textContent = `保存済みスタイル ID ${selectedId}（現在利用不可）`;
    select.append(option);
  }
  select.value = String(selectedId);
}

function populateSpeakers(speakers, selectedId) {
  availableStyles = speakers.flatMap((character) =>
    (character.styles || []).map((style) => ({ ...style, characterName: character.name }))
  );
  populateSpeakerSelect(speakerSelect, selectedId);
  customVoicesContainer.querySelectorAll(".custom-speaker").forEach((select) => {
    populateSpeakerSelect(select, select.value);
  });
  renderRandomVoices();
}

function renderRandomVoices() {
  randomVoiceList.textContent = "";
  const selected = new Set(storedRandomVoiceStyles.map(Number));
  const globalVolume = Number(document.querySelector("#volumeScale").value) || 1;
  for (const style of availableStyles) {
    const profile = storedVoiceProfiles[String(style.id)] || {};
    const row = document.createElement("div");
    row.className = "random-voice-row";
    row.dataset.styleId = style.id;

    const enabledLabel = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "random-enabled";
    checkbox.checked = selected.has(Number(style.id));
    enabledLabel.append(checkbox, `${style.characterName} / ${style.name}（${style.id}）`);

    const volumeLabel = document.createElement("label");
    volumeLabel.textContent = "音量倍率";
    const volume = document.createElement("input");
    volume.type = "number";
    volume.className = "profile-volume";
    volume.min = "0";
    volume.max = "2";
    volume.step = "0.05";
    volume.value = profile.volumeScale ?? globalVolume;
    volumeLabel.append(volume);

    const panLabel = document.createElement("label");
    panLabel.textContent = "ステレオ";
    const pan = document.createElement("input");
    pan.type = "number";
    pan.className = "profile-pan";
    pan.min = "-1";
    pan.max = "1";
    pan.step = "0.05";
    pan.value = profile.pan ?? 0;
    panLabel.append(pan);

    row.append(enabledLabel, volumeLabel, panLabel);
    randomVoiceList.append(row);
  }
}

function addCustomVoiceRow(mapping = { userId: "", speaker: speakerSelect.value || 3 }) {
  const row = document.createElement("div");
  row.className = "custom-voice-row";

  const userInput = document.createElement("input");
  userInput.className = "custom-user-id";
  userInput.type = "text";
  userInput.placeholder = "@user または @user@host";
  userInput.value = mapping.userId || "";
  userInput.required = true;

  const select = document.createElement("select");
  select.className = "custom-speaker";
  select.required = true;
  populateSpeakerSelect(select, mapping.speaker);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "削除";
  removeButton.addEventListener("click", () => row.remove());

  row.append(userInput, select, removeButton);
  customVoicesContainer.append(row);
}

async function loadSpeakers() {
  if (!await ensureEnginePermission()) return false;
  loadSpeakersButton.disabled = true;
  showStatus("VOICEVOX ENGINEへ接続しています…");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "getSpeakers",
      voicevoxUrl: readSettings().voicevoxUrl
    });
    if (!response?.ok) throw new Error(response?.error || "話者一覧を取得できませんでした");
    const selected = speakerSelect.value;
    populateSpeakers(response.speakers, selected);
    showStatus("話者一覧を取得しました。", "success");
    return true;
  } catch (error) {
    showStatus(`VOICEVOX ENGINEへ接続できません。\nVOICEVOXが起動していることを確認してください。\n${error.message}`, "error");
    return false;
  } finally {
    loadSpeakersButton.disabled = false;
  }
}

async function restore() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  fields.forEach((name) => {
    const input = document.querySelector(`#${name}`);
    if (input.type === "checkbox") input.checked = settings[name];
    else if (name === "speaker") {
      if (![...input.options].some((option) => Number(option.value) === Number(settings[name]))) {
        const option = document.createElement("option");
        option.value = settings[name];
        option.textContent = `保存済みスタイル ID ${settings[name]}`;
        input.append(option);
      }
      input.value = String(settings[name]);
    } else input.value = settings[name];
  });
  customVoicesContainer.textContent = "";
  for (const mapping of settings.customVoices || []) addCustomVoiceRow(mapping);
  storedRandomVoiceStyles = Array.isArray(settings.randomVoiceStyles) ? settings.randomVoiceStyles : [];
  storedVoiceProfiles = settings.voiceProfiles && typeof settings.voiceProfiles === "object"
    ? settings.voiceProfiles
    : {};
  validateEngineUrl();
}

document.querySelector("#voicevoxUrl").addEventListener("input", validateEngineUrl);
document.querySelector("#enabled").addEventListener("change", async (event) => {
  await chrome.storage.sync.set({ enabled: event.target.checked });
  showStatus(event.target.checked ? "読み上げをONにしました。" : "読み上げをOFFにしました。", "success");
});
loadSpeakersButton.addEventListener("click", loadSpeakers);
addCustomVoiceButton.addEventListener("click", () => addCustomVoiceRow());

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!await ensureEnginePermission()) return;
  await chrome.storage.sync.set(readSettings());
  showStatus("保存しました。", "success");
});

testButton.addEventListener("click", async () => {
  if (!document.querySelector("#enabled").checked) {
    showStatus("テスト読み上げを行うには読み上げをONにしてください。", "error");
    return;
  }
  if (!await ensureEnginePermission()) return;
  await chrome.storage.sync.set(readSettings());
  showStatus("音声を生成しています…");
  testButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "testSpeak",
      text: "Misskey Readerの接続テストです"
    });
    if (!response?.ok) throw new Error(response?.error || "不明なエラー");
    showStatus("テスト読み上げに成功しました。", "success");
  } catch (error) {
    showStatus(`VOICEVOX ENGINEへ接続できません。\nVOICEVOXが起動していることを確認してください。\n${error.message}`, "error");
  } finally {
    testButton.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.enabled) {
    document.querySelector("#enabled").checked = Boolean(changes.enabled.newValue);
  }
});

restore();
