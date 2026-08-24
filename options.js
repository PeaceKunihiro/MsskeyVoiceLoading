"use strict";

const DEFAULTS = {
  enabled: true,
  websocketUrl: "ws://localhost:55000/",
  speed: -1,
  volume: -1,
  pitch: -1,
  voice: 0
};

const fields = Object.keys(DEFAULTS);
const form = document.querySelector("#settings");
const status = document.querySelector("#status");
const testButton = document.querySelector("#test");

function validateWebSocketUrl() {
  const input = document.querySelector("#websocketUrl");
  let url;
  try {
    url = new URL(input.value.trim());
  } catch {
    input.setCustomValidity("正しいWebSocket URLを入力してください。");
    return false;
  }
  if (url.port === "50001") {
    input.setCustomValidity("50001番は標準TCP用です。WebSocket Pluginのポート（通常55000）を指定してください。");
    return false;
  }
  input.setCustomValidity("");
  return true;
}

document.querySelector("#websocketUrl").addEventListener("input", validateWebSocketUrl);

async function restore() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  fields.forEach((name) => {
    const input = document.querySelector(`#${name}`);
    if (input.type === "checkbox") input.checked = settings[name];
    else input.value = settings[name];
  });
  validateWebSocketUrl();
}

function readSettings() {
  const settings = {};
  fields.forEach((name) => {
    const input = document.querySelector(`#${name}`);
    settings[name] = input.type === "checkbox" ? input.checked :
      input.type === "number" ? Number(input.value) : input.value.trim();
  });
  return settings;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!validateWebSocketUrl() || !form.reportValidity()) return;
  await chrome.storage.sync.set(readSettings());
  status.value = "保存しました。";
  setTimeout(() => { status.value = ""; }, 2000);
});

testButton.addEventListener("click", async () => {
  if (!validateWebSocketUrl() || !form.reportValidity()) return;
  // 未保存のURLへ接続しないよう、テスト前にフォーム内容を保存する。
  await chrome.storage.sync.set(readSettings());
  status.value = "接続しています…";
  testButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "testSpeak",
      text: "Misskey Readerの接続テストです"
    });
    status.value = response?.ok ? "テスト文章を送信しました。" : `接続エラー: ${response?.error || "不明なエラー"}`;
  } catch (error) {
    status.value = `接続エラー: ${error.message}`;
  } finally {
    testButton.disabled = false;
  }
});

restore();
