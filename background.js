"use strict";

const DEFAULTS = {
  enabled: true,
  websocketUrl: "ws://localhost:55000/",
  speed: -1,
  volume: -1,
  pitch: -1,
  voice: 0
};

let socket = null;
let socketUrl = "";
let connecting = null;
let rejectConnecting = null;

function closeSocket() {
  const activeSocket = socket;
  if (rejectConnecting) rejectConnecting("WebSocket接続を中断しました");
  if (activeSocket) {
    activeSocket.onclose = null;
    activeSocket.onerror = null;
    activeSocket.close();
  }
  socket = null;
  socketUrl = "";
  connecting = null;
}

function connect(url) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return Promise.reject(new Error("WebSocket URLが正しくありません"));
  }
  if (!["ws:", "wss:"].includes(target.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
    return Promise.reject(new Error("WebSocket URLはlocalhostを指定してください"));
  }
  if (target.port === "50001") {
    return Promise.reject(new Error(
      "50001番は棒読みちゃん標準TCP用です。WebSocket Pluginのポート（通常55000）を指定してください"
    ));
  }
  if (socket?.readyState === WebSocket.OPEN && socketUrl === url) {
    return Promise.resolve(socket);
  }
  if (connecting && socketUrl === url) return connecting;

  closeSocket();
  socketUrl = url;
  connecting = new Promise((resolve, reject) => {
    let ws;
    let settled = false;
    const fail = (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (rejectConnecting === fail) {
        connecting = null;
        rejectConnecting = null;
      }
      if (socket === ws) socket = null;
      reject(new Error(message));
    };
    try {
      ws = new WebSocket(url);
    } catch (error) {
      connecting = null;
      reject(error);
      return;
    }
    socket = ws;
    rejectConnecting = fail;
    const timer = setTimeout(() => {
      ws.close();
      fail("WebSocket接続がタイムアウトしました");
    }, 3000);

    ws.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (rejectConnecting === fail) {
        connecting = null;
        rejectConnecting = null;
      }
      console.info("[MisskeyReader] websocket connected");
      resolve(ws);
    };
    ws.onerror = () => {
      console.error("[MisskeyReader] websocket error");
      fail("WebSocket Pluginへ接続できませんでした");
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      fail("WebSocket接続が閉じられました");
    };
  });
  return connecting;
}

function makeTalkCommand(text, settings) {
  return JSON.stringify({
    command: "talk",
    speed: Number(settings.speed),
    pitch: Number(settings.pitch),
    volume: Number(settings.volume),
    voiceType: Number(settings.voice),
    text
  });
}

async function speak(text, ignoreEnabled = false) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  if (!settings.enabled && !ignoreEnabled) return;

  const payload = makeTalkCommand(text, settings);
  let ws = await connect(settings.websocketUrl);
  try {
    ws.send(payload);
  } catch {
    // 接続確認直後に切断された場合は、1回だけ接続し直す。
    closeSocket();
    ws = await connect(settings.websocketUrl);
    ws.send(payload);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const isTest = message?.type === "testSpeak";
  if ((!isTest && message?.type !== "speak") || typeof message.text !== "string") return;
  speak(message.text, isTest)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.websocketUrl) closeSocket();
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
