/* global chrome */
"use strict";
// Offscreen document for the Chromium (MV3) build. Runs in a real, hidden DOM so it can do
// the work the service worker cannot: parse the inert tree with DOMParser, rasterize and
// embed images on a canvas, and write to the clipboard. This mirrors the DOM logic in the
// Firefox/Zen background page (extension/background.js); keep the two in sync. The service
// worker (background.js) collects the frames and sends them here.
const api = globalThis.chrome;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;

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
    } catch { /* Fall back to a copy event, which works without document focus in an offscreen doc. */ }
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

async function writeImage(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try { await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]); return; }
    catch { /* Fall back to selecting the image and copying it via a copy event. */ }
  }
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  const img = document.createElement("img");
  img.src = dataUrl;
  holder.append(img);
  document.body.append(holder);
  try {
    await img.decode().catch(() => {});
    const range = document.createRange();
    range.selectNode(img);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand("copy")) throw new Error("The image could not be copied.");
    selection.removeAllRanges();
  } finally { holder.remove(); }
}

// Build an inert article from the frames the content script produced, embedding images.
async function assemble({ frames, title, url }, textOnly) {
  const warnings = new Set(frames.flatMap(f => f.warnings));
  if (textOnly) {
    const seen = new Set();
    const texts = frames.filter(frame => {
      const key = frame.url + "\n" + frame.text;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(frame => frame.text);
    return { html: "", text: `${title || "Copied page"}\nSource: ${url}\n\n${texts.join("\n\n")}`.trim(), warnings: [...warnings], imageCount: 0 };
  }
  const article = document.createElement("article");
  const heading = document.createElement("h1");
  heading.textContent = title || "Copied page";
  article.append(heading);
  const source = document.createElement("p");
  source.textContent = "Source: " + url;
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
    let nextImage = 0;
    await Promise.all(Array.from({ length: Math.min(4, placeholders.length) }, async () => {
      while (nextImage < placeholders.length) {
        const img = placeholders[nextImage++];
        const meta = frame.images[Number(img.getAttribute("data-clip-image"))];
        img.removeAttribute("data-clip-image");
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
      }
    }));
    article.append(section);
  }
  if (failedImages) warnings.add(`${failedImages} image(s) could not be embedded. Try Copy visible page as image.`);
  const text = `${title || "Copied page"}\nSource: ${url}\n\n${texts.join("\n\n")}`.trim();
  return { html: article.outerHTML, text, warnings: [...warnings], imageCount };
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return;
  (async () => {
    try {
      if (msg.type === "copy") {
        const res = await assemble(msg.payload, msg.textOnly);
        await (msg.textOnly ? navigator.clipboard.writeText(res.text) : writeRich(res.html, res.text));
        sendResponse({ text: res.text, warnings: res.warnings, imageCount: res.imageCount });
      } else if (msg.type === "assemble") {
        sendResponse(await assemble(msg.payload, false));
      } else if (msg.type === "image") {
        await writeImage(msg.dataUrl);
        sendResponse({ ok: true });
      }
    } catch (error) {
      sendResponse({ error: error.message || "Clipboard operation failed." });
    }
  })();
  return true; // Keep the message channel open for the async response.
});
