/* global browser */
"use strict";
const busyTabs = new Set();
// Clipboard is global: serialize operations from different windows/tabs.
let clipboardQueue = Promise.resolve();
const queueClipboard = fn => {
  const next = clipboardQueue.then(fn, fn);
  clipboardQueue = next.catch(() => {});
  return next;
};
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;

async function status(tabId, badge, title, error = false) {
  await Promise.all([
    browser.browserAction.setBadgeText({ tabId, text: badge }),
    browser.browserAction.setBadgeBackgroundColor({ tabId, color: error ? "#a33a28" : "#175b49" }),
    browser.browserAction.setTitle({ tabId, title })
  ]);
}
async function notify(title, message) {
  try { await browser.notifications.create({ type: "basic", iconUrl: browser.runtime.getURL("icon.svg"), title, message }); }
  catch { /* Toolbar status remains available if OS notifications are disabled. */ }
}
async function imageData(source) {
  if (!/^https?:|^blob:|^data:image\/(png|jpeg|gif|webp);/i.test(source)) throw new Error("Unsupported image URL");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(source, { credentials: "include", signal: controller.signal });
    if (!response.ok) throw new Error("Image request failed");
    if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) throw new Error("Image too large");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error("Image too large"); }
      chunks.push(value);
    }
    const blob = new Blob(chunks, { type: response.headers.get("content-type")?.split(";")[0] || "application/octet-stream" });
    if (!/^image\/(png|jpeg|gif|webp|avif|svg\+xml)$/.test(blob.type)) throw new Error("Not an image");
    const bitmap = await createImageBitmap(blob);
    try {
      if (bitmap.width * bitmap.height > 16000000) throw new Error("Image dimensions too large");
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      return canvas.toDataURL("image/png");
    } finally { bitmap.close(); }
  } finally { clearTimeout(timer); }
}
async function writeRich(html, text) {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" })
      })]);
      return;
    } catch { /* Older Firefox builds can use the extension document's copy event. */ }
  }
  let handled = false;
  const listener = event => {
    event.preventDefault();
    event.clipboardData.setData("text/html", html);
    event.clipboardData.setData("text/plain", text);
    handled = true;
  };
  document.addEventListener("copy", listener);
  try {
    if (!document.execCommand("copy") || !handled) throw new Error("Clipboard write failed. Try clicking the toolbar button again.");
  } finally { document.removeEventListener("copy", listener); }
}
async function assemble(tab, textOnly) {
  const results = await browser.tabs.executeScript(tab.id, { file: "extract.js", allFrames: true, matchAboutBlank: true, runAt: "document_idle" });
  const frames = results.filter(r => r && (r.text || r.images.length));
  if (!frames.length) throw new Error("No readable content found. Right-click the toolbar button and choose Copy visible page as image.");
  const warnings = new Set(frames.flatMap(f => f.warnings));
  const article = document.createElement("article");
  const heading = document.createElement("h1");
  heading.textContent = tab.title || "Copied page";
  article.append(heading);
  const source = document.createElement("p");
  source.textContent = "Source: " + tab.url;
  article.append(source);
  let totalBytes = 0;
  let imageCount = 0;
  let failedImages = 0;
  const cache = new Map();
  const seen = new Set();
  const texts = [];
  for (const frame of frames) {
    // Only deduplicate identical content from the same document, not repeated prose.
    const key = frame.url + "\n" + frame.html;
    if (seen.has(key)) continue;
    seen.add(key);
    texts.push(frame.text);
    const section = document.createElement("section");
    // extract.js reconstructs an allowlisted, inert tree; no original page HTML is used.
    const parsed = new DOMParser().parseFromString(frame.html, "text/html");
    section.append(...parsed.body.childNodes);
    const placeholders = [...section.querySelectorAll("img[data-clip-image]")];
    for (let offset = 0; offset < placeholders.length; offset += 4) {
      await Promise.all(placeholders.slice(offset, offset + 4).map(async img => {
        const meta = frame.images[Number(img.getAttribute("data-clip-image"))];
        img.removeAttribute("data-clip-image");
        if (textOnly) { img.replaceWith(document.createTextNode(`[Image: ${meta.alt}]`)); return; }
        try {
          if (totalBytes >= MAX_TOTAL_BYTES) throw new Error("Clipboard size limit reached");
          let data = meta.embedded;
          if (!data) {
            if (!cache.has(meta.source)) cache.set(meta.source, imageData(meta.source));
            data = await cache.get(meta.source);
          }
          if (!/^data:image\/png;base64,/.test(data) || data.length > MAX_IMAGE_BYTES || totalBytes + data.length > MAX_TOTAL_BYTES) throw new Error("Clipboard size limit reached");
          totalBytes += data.length;
          img.src = data;
          img.style.maxWidth = "100%";
          imageCount++;
        } catch {
          failedImages++;
          img.replaceWith(document.createTextNode(`[Image unavailable: ${meta.alt}]`));
        }
      }));
    }
    article.append(section);
  }
  if (failedImages) warnings.add(`${failedImages} image(s) could not be embedded. Try Copy visible page as image.`);
  const text = `${tab.title || "Copied page"}\nSource: ${tab.url}\n\n${texts.join("\n\n")}`.trim();
  return { article, text, warnings, imageCount };
}
async function copyPage(tab, textOnly) {
  const { article, text, warnings, imageCount } = await assemble(tab, textOnly);
  await queueClipboard(() => textOnly ? navigator.clipboard.writeText(text) : writeRich(article.outerHTML, text));
  const summary = `Copied ${text.length.toLocaleString()} characters${textOnly ? "" : ` and ${imageCount} images`}.`;
  await status(tab.id, warnings.size ? "!" : "OK", summary + (warnings.size ? " " + [...warnings].join(" ") : ""));
  if (warnings.size) await notify("Copied with omissions", [...warnings].join(" "));
}
// Hand the assembled, inert article to our own reader page, which has none of the
// source site's print-blocking CSS or beforeprint handlers, so printing captures everything.
const pendingDocs = new Map();
async function openPrintable(tab) {
  const { article, text, warnings, imageCount } = await assemble(tab, false);
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  pendingDocs.set(token, { html: article.outerHTML, text, title: tab.title || "Extracted page", url: tab.url, warnings: [...warnings] });
  // Drop the payload if the reader never claims it (tab closed, navigation blocked).
  setTimeout(() => pendingDocs.delete(token), 5 * 60 * 1000);
  await browser.tabs.create({ url: browser.runtime.getURL("reader.html") + "#" + token });
  const summary = `Opened a printable page with ${text.length.toLocaleString()} characters and ${imageCount} images. Use Print / Save as PDF there.`;
  await status(tab.id, warnings.size ? "!" : "OK", summary + (warnings.size ? " " + [...warnings].join(" ") : ""));
  if (warnings.size) await notify("Printable page opened with omissions", [...warnings].join(" "));
}
async function copyScreenshot(tab) {
  const active = (await browser.tabs.query({ active: true, windowId: tab.windowId }))[0];
  if (active?.id !== tab.id) throw new Error("Select the page again before copying its image.");
  const data = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const bytes = await (await fetch(data)).arrayBuffer();
  await queueClipboard(() => browser.clipboard.setImageData(bytes, "png"));
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
// The reader page requests its payload by token once it loads.
browser.runtime.onMessage?.addListener?.((msg) => {
  if (msg?.type !== "getDoc") return;
  const doc = pendingDocs.get(msg.token) || null;
  pendingDocs.delete(msg.token);
  return Promise.resolve(doc);
});
browser.browserAction.onClicked.addListener(tab => run(tab));
browser.contextMenus.create({ id: "copy-rich", title: "Copy text and images", contexts: ["browser_action"] });
browser.contextMenus.create({ id: "copy-text", title: "Copy text only", contexts: ["browser_action"] });
browser.contextMenus.create({ id: "print-pdf", title: "Open printable page (Save as PDF)", contexts: ["browser_action"] });
browser.contextMenus.create({ id: "copy-image", title: "Copy visible page as image", contexts: ["browser_action"] });
browser.contextMenus.onClicked.addListener((info, tab) => run(tab, info.menuItemId === "copy-image" ? "image" : info.menuItemId === "copy-text" ? "text" : info.menuItemId === "print-pdf" ? "print" : "rich"));
