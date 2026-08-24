"use strict";

(() => {
  const LOG = "[MisskeyReader]";
  const seenIds = new Set();
  const seenElements = new WeakSet();
  const pendingRoots = new Set();
  let ready = false;
  let enabled = true;
  let initialNoteCount = 5;
  let maxReadLength = 64;
  let removeUrls = true;

  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" &&
      style.opacity !== "0" && element.getClientRects().length > 0;
  };

  function noteRootFrom(node) {
    if (!(node instanceof Element)) return null;
    const anchor = node.matches("[data-scroll-anchor]")
      ? node
      : node.closest("[data-scroll-anchor]");
    if (anchor?.querySelector(":scope article")) return anchor;
    const article = node.matches("article") ? node : node.closest("article");
    return article?.closest("[data-scroll-anchor]") || article;
  }

  function isTimelineNote(root) {
    const article = root.matches("article") ? root : root.querySelector(":scope article");
    if (!article || article.closest("aside, nav, header, [role='dialog'], [role='complementary']")) return false;
    const main = document.querySelector("main, [role='main']");
    if (main) return main.contains(article);
    const rect = article.getBoundingClientRect();
    return rect.width > 200 && rect.left < innerWidth * 0.78 && rect.right > innerWidth * 0.18;
  }

  function textCandidates(article) {
    return [...article.querySelectorAll("._selectable, [style*='white-space: pre-wrap'], [style*='white-space:pre-wrap']")]
      .filter((element) => element.closest("article") === article)
      .filter((element) => !element.closest("button, time, nav, [role='button'], [aria-label]"))
      .filter((element) => !element.querySelector("article"))
      .filter((element) => {
        const text = element.textContent.trim();
        return text && !/^@\S+$/.test(text) && !/^\d+[秒分時間日]前$/.test(text);
      });
  }

  function cleanText(element) {
    const copy = element.cloneNode(true);
    copy.querySelectorAll("img, svg, video, audio, button, time, [aria-hidden='true']").forEach((node) => node.remove());
    return copy.textContent
      .replace(/:[a-zA-Z0-9_+.-]+:/g, "")
      .replace(/[ \t\u00a0]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim();
  }

  function formatSpeechText(text) {
    let result = text;
    if (removeUrls) {
      result = result.replace(/https?:\/\/[^\s<>"'）】」』、。！？]+/giu, "");
    }
    result = result
      .replace(/[ \t\u00a0]{2,}/g, " ")
      .replace(/[ \t\u00a0]+\n/g, "\n")
      .replace(/\n[ \t\u00a0]+/g, "\n")
      .trim();
    return [...result].slice(0, maxReadLength).join("");
  }

  function extractBody(root) {
    const article = root.matches("article") ? root : root.querySelector(":scope article");
    if (!article) return { text: "" };
    const candidates = textCandidates(article);
    const hidden = candidates.filter((element) => !visible(element));

    // 折り畳まれたCW本文がDOMにあっても読み上げない。
    if (hidden.some((element) => cleanText(element))) return { text: "", cw: true };

    const shown = candidates.filter(visible).map((element) => ({
      element,
      text: cleanText(element)
    })).filter(({ text }) => text);
    if (!shown.length) return { text: "" };

    // 本文は通常 pre-wrap。複数なら上位DOM（引用より前）の最初を優先する。
    shown.sort((a, b) => {
      const aPre = getComputedStyle(a.element).whiteSpace === "pre-wrap" ? 1 : 0;
      const bPre = getComputedStyle(b.element).whiteSpace === "pre-wrap" ? 1 : 0;
      return bPre - aPre;
    });
    return { text: formatSpeechText(shown[0].text) };
  }

  function identity(root) {
    return root.getAttribute("data-scroll-anchor") || "";
  }

  function markSeen(root) {
    const id = identity(root);
    if (id) seenIds.add(id);
    seenElements.add(root);
  }

  function wasSeen(root) {
    const id = identity(root);
    return seenElements.has(root) || (id && seenIds.has(id));
  }

  function processNote(root, initial = false) {
    if (!root || !isTimelineNote(root)) return;
    if (!initial && wasSeen(root)) {
      console.debug(`${LOG} skipped duplicate`);
      return;
    }
    markSeen(root);
    const id = identity(root) || "(unknown)";
    console.debug(`${LOG} new note: ${id}`);
    if (!enabled) return;

    const result = extractBody(root);
    if (result.cw) {
      console.debug(`${LOG} skipped CW`);
      return;
    }
    if (!result.text) return;
    console.debug(`${LOG} speak: ${JSON.stringify(result.text)}`);
    chrome.runtime.sendMessage({ type: "speak", text: result.text }).then((response) => {
      if (!response?.ok) console.error(`${LOG} VOICEVOX connection error`, response?.error || "unknown error");
    }).catch(() => console.error(`${LOG} VOICEVOX connection error`));
  }

  function rootsWithin(node) {
    if (!(node instanceof Element)) return [];
    const roots = new Set();
    const own = noteRootFrom(node);
    if (own) roots.add(own);
    node.querySelectorAll("[data-scroll-anchor] > article, article").forEach((article) => {
      const root = article.closest("[data-scroll-anchor]") || article;
      roots.add(root);
    });
    return roots;
  }

  function initialize() {
    const loadedRoots = [];
    const uniqueRoots = new Set();
    document.querySelectorAll("[data-scroll-anchor] > article, article").forEach((article) => {
      const root = article.closest("[data-scroll-anchor]") || article;
      if (isTimelineNote(root) && !uniqueRoots.has(root)) {
        uniqueRoots.add(root);
        loadedRoots.push(root);
        markSeen(root);
      }
    });
    console.info(`${LOG} timeline detected`);
    ready = true;

    if (enabled && initialNoteCount > 0) {
      // MisskeyのタイムラインDOMは上側が新しいため、先頭N件を逆順で読む。
      loadedRoots.slice(0, initialNoteCount).reverse().forEach((root) => processNote(root, true));
    }
    pendingRoots.forEach(processNote);
    pendingRoots.clear();
  }

  chrome.storage.sync.get({
    enabled: true,
    initialNoteCount: 5,
    maxReadLength: 64,
    removeUrls: true
  }).then((settings) => {
    enabled = settings.enabled;
    initialNoteCount = Math.max(0, Math.floor(Number(settings.initialNoteCount) || 0));
    maxReadLength = Math.max(1, Math.floor(Number(settings.maxReadLength) || 64));
    removeUrls = settings.removeUrls;
    initialize();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.enabled) enabled = changes.enabled.newValue;
    if (area === "sync" && changes.initialNoteCount) initialNoteCount = Math.max(0, Math.floor(Number(changes.initialNoteCount.newValue) || 0));
    if (area === "sync" && changes.maxReadLength) maxReadLength = Math.max(1, Math.floor(Number(changes.maxReadLength.newValue) || 64));
    if (area === "sync" && changes.removeUrls) removeUrls = changes.removeUrls.newValue;
  });

  const observer = new MutationObserver((mutations) => {
    const roots = new Set();
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => rootsWithin(node).forEach((root) => roots.add(root)));
    }
    if (!ready) {
      roots.forEach((root) => pendingRoots.add(root));
      return;
    }
    // requestAnimationFrameは背景タブで停止するため、microtaskで同一DOM更新後に読む。
    if (roots.size) queueMicrotask(() => roots.forEach(processNote));
  });

  observer.observe(document.body, { childList: true, subtree: true });
  console.info(`${LOG} initialized`);
})();
