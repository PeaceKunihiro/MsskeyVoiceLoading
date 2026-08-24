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
  removeUrls: true
};

const fields = Object.keys(DEFAULTS);
const form = document.querySelector("#settings");
const status = document.querySelector("#status");
const speakerSelect = document.querySelector("#speaker");
const testButton = document.querySelector("#test");
const loadSpeakersButton = document.querySelector("#loadSpeakers");

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

function populateSpeakers(speakers, selectedId) {
  speakerSelect.textContent = "";
  for (const character of speakers) {
    for (const style of character.styles || []) {
      const option = document.createElement("option");
      option.value = style.id;
      option.textContent = `${character.name} / ${style.name}（${style.id}）`;
      speakerSelect.append(option);
    }
  }
  if ([...speakerSelect.options].some((option) => Number(option.value) === Number(selectedId))) {
    speakerSelect.value = String(selectedId);
  }
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
  validateEngineUrl();
}

document.querySelector("#voicevoxUrl").addEventListener("input", validateEngineUrl);
document.querySelector("#enabled").addEventListener("change", async (event) => {
  await chrome.storage.sync.set({ enabled: event.target.checked });
  showStatus(event.target.checked ? "読み上げをONにしました。" : "読み上げをOFFにしました。", "success");
});
loadSpeakersButton.addEventListener("click", loadSpeakers);

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
