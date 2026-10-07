/* global chrome */
"use strict";
// Chromium (MV3) service worker. A service worker has no DOM, so it cannot assemble HTML,
// rasterize images, or write to the clipboard itself. It orchestrates:
//   1. inject extract.js into every permitted frame (chrome.scripting),
//   2. capture the viewport for image mode (chrome.tabs.captureVisibleTab),
//   3. hand the collected frames to an offscreen document (offscreen.js), which owns a real
//      DOM and performs DOMParser assembly, image embedding, and clipboard writes.
// The Firefox/Zen build (extension/background.js) does all of this inline because its
// background page already has a DOM; the extraction (extract.js) and reader are shared.
const api = globalThis.chrome;
const busyTabs = new Set();

async function status(tabId, badge, title, error = false) {
  await Promise.all([
    api.action.setBadgeText({ tabId, text: badge }),
    api.action.setBadgeBackgroundColor({ tabId, color: error ? "#a33a28" : "#175b49" }),
    api.action.setTitle({ tabId, title })
  ]).catch(() => {});
}
async function notify(title, message) {
  try { await api.notifications.create({ type: "basic", iconUrl: api.runtime.getURL("icon.svg"), title, message }); }
  catch { /* Toolbar status remains available if OS notifications are disabled. */ }
}

// Offscreen documents are a singleton per extension; create on demand and reuse.
let creatingOffscreen = null;
async function ensureOffscreen() {
  if (api.runtime.getContexts) {
    const contexts = await api.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (contexts.length) return;
  }
  if (!creatingOffscreen) {
    creatingOffscreen = api.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["CLIPBOARD", "DOM_PARSER"],
      justification: "Assemble extracted page content and write it to the clipboard."
    }).catch(error => {
      // A concurrent request may have already created it; that specific race is safe to ignore.
      if (!/single offscreen/i.test(error?.message || "")) throw error;
    });
  }
  try { await creatingOffscreen; } finally { creatingOffscreen = null; }
}
async function callOffscreen(message) {
  await ensureOffscreen();
  const response = await api.runtime.sendMessage({ target: "offscreen", ...message });
  if (response?.error) throw new Error(response.error);
  return response;
}

async function extractFrames(tabId, textOnly = false) {
  await api.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: mode => { globalThis.__pageToClipboardTextOnly = mode; },
    args: [textOnly]
  });
  const results = await api.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["extract.js"]
  });
  return results.map(r => r.result).filter(r => r && (r.text || r.images.length));
}

async function copyPage(tab, textOnly) {
  const frames = await extractFrames(tab.id, textOnly);
  if (!frames.length) throw new Error("No readable content found. Right-click the toolbar button and choose Copy visible page as image.");
  const res = await callOffscreen({
    type: "copy", textOnly,
    payload: { frames, title: tab.title || "Copied page", url: tab.url }
  });
  const summary = `Copied ${res.text.length.toLocaleString()} characters${textOnly ? "" : ` and ${res.imageCount} images`}.`;
  await status(tab.id, res.warnings.length ? "!" : "OK", summary + (res.warnings.length ? " " + res.warnings.join(" ") : ""));
  if (res.warnings.length) await notify("Copied with omissions", res.warnings.join(" "));
}

async function openPrintable(tab) {
  const frames = await extractFrames(tab.id);
  if (!frames.length) throw new Error("No readable content found. Right-click the toolbar button and choose Copy visible page as image.");
  const res = await callOffscreen({
    type: "assemble",
    payload: { frames, title: tab.title || "Extracted page", url: tab.url }
  });
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  // storage.session survives a service-worker restart between here and the reader loading.
  await api.storage.session.set({ [token]: { html: res.html, text: res.text, title: tab.title || "Extracted page", url: tab.url, warnings: res.warnings } });
  // Drop the payload if the reader never claims it (tab closed, navigation blocked).
  setTimeout(() => api.storage.session.remove(token).catch(() => {}), 5 * 60 * 1000);
  await api.tabs.create({ url: api.runtime.getURL("reader.html") + "#" + token });
  const summary = `Opened a printable page with ${res.text.length.toLocaleString()} characters and ${res.imageCount} images. Use Print / Save as PDF there.`;
  await status(tab.id, res.warnings.length ? "!" : "OK", summary + (res.warnings.length ? " " + res.warnings.join(" ") : ""));
  if (res.warnings.length) await notify("Printable page opened with omissions", res.warnings.join(" "));
}

async function copyScreenshot(tab) {
  const active = (await api.tabs.query({ active: true, windowId: tab.windowId }))[0];
  if (active?.id !== tab.id) throw new Error("Select the page again before copying its image.");
  const dataUrl = await api.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  await callOffscreen({ type: "image", dataUrl });
  await status(tab.id, "PNG", "Visible page copied as an image (not editable text).");
}

async function run(tab, mode = "rich") {
  if (!tab?.id || busyTabs.has(tab.id)) return;
  busyTabs.add(tab.id);
  try {
    await status(tab.id, "…", mode === "print" ? "Building printable page…" : "Copying loaded page content…");
    if (mode === "image") await copyScreenshot(tab);
    else if (mode === "print") await openPrintable(tab);
    else await copyPage(tab, mode === "text");
  } catch (error) {
    const message = error.message || "Unable to copy this page.";
    await status(tab.id, "ERR", message, true).catch(() => {});
    await notify("Page could not be copied", message);
  } finally { busyTabs.delete(tab.id); }
}

api.action.onClicked.addListener(tab => run(tab));
// Context menus must be (re)created after install/update; duplicate ids throw on worker restart.
api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({ id: "copy-rich", title: "Copy text and images", contexts: ["action"] });
  api.contextMenus.create({ id: "copy-text", title: "Copy text only", contexts: ["action"] });
  api.contextMenus.create({ id: "print-pdf", title: "Open printable page (Save as PDF)", contexts: ["action"] });
  api.contextMenus.create({ id: "copy-image", title: "Copy visible page as image", contexts: ["action"] });
});
api.contextMenus.onClicked.addListener((info, tab) => run(tab, info.menuItemId === "copy-image" ? "image" : info.menuItemId === "copy-text" ? "text" : info.menuItemId === "print-pdf" ? "print" : "rich"));
