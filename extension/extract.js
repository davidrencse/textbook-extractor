/* Executed only on request, once per permitted frame. No page code is modified. */
(async () => {
  if (!document.body || document.visibilityState === "hidden") return null;
  try {
    if (window.frameElement && !window.frameElement.getClientRects().length) return null;
  } catch { /* A cross-origin parent cannot be inspected. */ }

  const MAX_NODES = 100000;
  const MAX_IMAGES = 100;
  const MAX_RASTER_PIXELS = 16000000;
  const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "FRAME", "HEAD", "NAV", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "DIALOG", "AUDIO", "VIDEO"]);
  const allowed = new Set("P DIV SPAN ARTICLE SECTION MAIN H1 H2 H3 H4 H5 H6 BR HR UL OL LI DL DT DD TABLE THEAD TBODY TFOOT TR TH TD CAPTION BLOCKQUOTE PRE CODE STRONG B EM I U S SUB SUP FIGURE FIGCAPTION A SMALL MARK".split(" "));
  const blockTags = new Set("P DIV ARTICLE SECTION MAIN H1 H2 H3 H4 H5 H6 BR HR UL OL LI DL DT DD TABLE TR BLOCKQUOTE PRE FIGURE FIGCAPTION".split(" "));
  const warnings = new Set();
  const images = [];
  let visited = 0;
  let embeddedBytes = 0;
  const out = document.implementation.createHTMLDocument("");
  const holder = out.createElement("div");
  const visible = el => {
    const style = getComputedStyle(el);
    return !el.hidden && el.getAttribute("aria-hidden") !== "true" && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0";
  };
  const visibleInTree = el => {
    for (let p = el; p; p = p.parentElement) if (!visible(p)) return false;
    return true;
  };
  const url = raw => {
    try {
      const u = new URL(raw, document.baseURI);
      return /^(https?:|blob:)$/.test(u.protocol) || /^data:image\/(png|jpeg|gif|webp);/i.test(u.href) ? u.href : "";
    } catch { return ""; }
  };
  function png(element) {
    const w = element.naturalWidth || element.width?.baseVal?.value || element.width || element.clientWidth;
    const h = element.naturalHeight || element.height?.baseVal?.value || element.height || element.clientHeight;
    if (!w || !h || w * h > MAX_RASTER_PIXELS) return "";
    try {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(element, 0, 0, w, h);
      return canvas.toDataURL("image/png");
    } catch { return ""; }
  }
  function addImage(parent, source, alt, embedded = "") {
    if (images.length >= MAX_IMAGES) { warnings.add("Image limit reached (100 per frame)."); return; }
    if (embedded.length > 12 * 1024 * 1024 || embeddedBytes + embedded.length > 24 * 1024 * 1024) embedded = "";
    embeddedBytes += embedded.length;
    if (!source && !embedded) { warnings.add("An image or canvas could not be read; try Copy visible page as image."); return; }
    const img = out.createElement("img");
    img.setAttribute("data-clip-image", String(images.length));
    img.alt = alt || "Page image";
    images.push({ source, embedded, alt: img.alt });
    parent.append(img);
  }
  async function walk(node, parent) {
    if (++visited > MAX_NODES) { warnings.add("Page is too large; some content was omitted."); return; }
    if (node.nodeType === Node.TEXT_NODE) { parent.append(out.createTextNode(node.textContent)); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node;
    const tag = el.tagName.toUpperCase();
    if (skip.has(tag) || !visible(el) || ["navigation", "toolbar", "menu"].includes(el.getAttribute("role"))) return;
    if (tag === "IMG") {
      addImage(parent, url(el.currentSrc || el.src || el.dataset.src || ""), el.alt, png(el));
      return;
    }
    if (tag === "CANVAS") { addImage(parent, "", el.getAttribute("aria-label"), png(el)); return; }
    if (tag === "SVG") {
      // Rendering a sanitized SVG as an image avoids active markup in the clipboard.
      const clone = el.cloneNode(true);
      clone.querySelectorAll("script,foreignObject,style,iframe,animate,set,animateTransform,image,use").forEach(n => n.remove());
      for (const n of [clone, ...clone.querySelectorAll("*")]) {
        for (const attr of [...n.attributes]) {
          if (/^on/i.test(attr.name) || /href|style/i.test(attr.name) || /url\(/i.test(attr.value)) n.removeAttribute(attr.name);
        }
      }
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const bounds = el.getBoundingClientRect();
      clone.setAttribute("width", Math.max(1, Math.ceil(bounds.width)));
      clone.setAttribute("height", Math.max(1, Math.ceil(bounds.height)));
      const image = new Image();
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
      let timer;
      try {
        await Promise.race([image.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("SVG timeout")), 1500); })]);
        addImage(parent, "", el.getAttribute("aria-label") || "Diagram", png(image));
      } catch { warnings.add("An SVG diagram could not be rendered."); }
      finally { clearTimeout(timer); }
      return;
    }
    const copy = out.createElement(allowed.has(tag) ? tag.toLowerCase() : "span");
    if (tag === "A") {
      const href = url(el.getAttribute("href") || "");
      if (/^https?:/.test(href)) copy.setAttribute("href", href);
    }
    for (const attr of ["colspan", "rowspan", "start"]) {
      if (/^\d{1,3}$/.test(el.getAttribute(attr) || "")) copy.setAttribute(attr, el.getAttribute(attr));
    }
    parent.append(copy);
    const children = tag === "SLOT" ? el.assignedNodes({ flatten: true }) : el.shadowRoot?.childNodes || el.childNodes;
    for (const child of children) {
      if (visited >= MAX_NODES) { warnings.add("Page is too large; some content was omitted."); break; }
      await walk(child, copy);
    }
  }
  // Prefer content landmarks, but only if they contain actual reading material.
  const candidates = [...document.querySelectorAll("main,[role='main'],article,[epub\\:type='chapter']")]
    .filter(el => visibleInTree(el) && ((el.innerText || "").trim().length > 120 || el.querySelector("img,canvas,svg")));
  const roots = candidates.filter(el => !candidates.some(other => other !== el && other.contains(el)));
  for (const root of roots.length ? roots : [document.body]) await walk(root, holder);

  function plain(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    if (node.tagName === "IMG") return `\n[Image: ${node.alt}]\n`;
    const content = [...node.childNodes].map(plain).join("");
    return blockTags.has(node.tagName) ? `\n${content}\n` : node.tagName === "TD" || node.tagName === "TH" ? content + "\t" : content;
  }
  const text = plain(holder).replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { html: holder.innerHTML, text, images, warnings: [...warnings], title: document.title, url: location.href, top: window === window.top };
})();
