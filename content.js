"use strict";

(() => {
  const LOG = "[MisskeyReader]";
  const seenIds = new Set();
  const seenElements = new WeakSet();
  let ready = false;
  let enabled = true;

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
    return { text: shown[0].text };
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

  function processNote(root) {
    if (!root || !isTimelineNote(root)) return;
    if (wasSeen(root)) {
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
      if (!response?.ok) console.error(`${LOG} websocket error`, response?.error || "unknown error");
    }).catch(() => console.error(`${LOG} websocket error`));
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
    document.querySelectorAll("[data-scroll-anchor] > article, article").forEach((article) => {
      const root = article.closest("[data-scroll-anchor]") || article;
      if (isTimelineNote(root)) markSeen(root);
    });
    console.info(`${LOG} timeline detected`);
    ready = true;
  }

  chrome.storage.sync.get({ enabled: true }).then((settings) => { enabled = settings.enabled; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.enabled) enabled = changes.enabled.newValue;
  });

  const observer = new MutationObserver((mutations) => {
    if (!ready) return;
    const roots = new Set();
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => rootsWithin(node).forEach((root) => roots.add(root)));
    }
    // Misskeyがノートを段階的に構築するため、同一バッチの描画完了後に読む。
    if (roots.size) requestAnimationFrame(() => roots.forEach(processNote));
  });

  observer.observe(document.body, { childList: true, subtree: true });
  initialize();
  console.info(`${LOG} initialized`);
})();
