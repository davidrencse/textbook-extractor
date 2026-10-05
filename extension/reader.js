/* global browser */
"use strict";
// Renders the content the background page extracted from the source tab. The markup is
// already an allowlisted, inert tree (no scripts, no event handlers) built by extract.js,
// so this page carries none of the source site's print-blocking CSS or beforeprint handlers.
(async () => {
  const content = document.getElementById("content");
  const statusEl = document.getElementById("status");
  const copyBtn = document.getElementById("copy");
  const printBtn = document.getElementById("print");
  const setStatus = text => { statusEl.textContent = text; };
  const fail = text => {
    setStatus(text);
    copyBtn.disabled = true;
    printBtn.disabled = true;
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = text;
    content.replaceChildren(p);
  };

  const token = location.hash.slice(1);
  if (!token) { fail("No content token. Reopen the printable page from the extension button."); return; }

  let doc;
  try {
    doc = await browser.runtime.sendMessage({ type: "getDoc", token });
  } catch {
    fail("Could not reach the extension. Reopen the printable page from the toolbar button.");
    return;
  }
  if (!doc) { fail("This page's content has expired or was already opened. Extract it again."); return; }

  // Parse the serialized article into real nodes without innerHTML assignment.
  const parsed = new DOMParser().parseFromString(doc.html, "text/html");
  content.replaceChildren(...parsed.body.childNodes);
  document.title = doc.title || "Printable page";
  const warn = Array.isArray(doc.warnings) && doc.warnings.length ? ` (${doc.warnings.join(" ")})` : "";
  setStatus(`Ready — ${doc.text.length.toLocaleString()} characters.${warn}`);

  async function copyAll() {
    const previous = statusEl.textContent;
    setStatus("Copying…");
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([doc.html], { type: "text/html" }),
          "text/plain": new Blob([doc.text], { type: "text/plain" })
        })]);
      } else {
        let handled = false;
        const listener = event => {
          event.preventDefault();
          event.clipboardData.setData("text/html", doc.html);
          event.clipboardData.setData("text/plain", doc.text);
          handled = true;
        };
        document.addEventListener("copy", listener);
        try {
          if (!document.execCommand("copy") || !handled) throw new Error("copy command rejected");
        } finally { document.removeEventListener("copy", listener); }
      }
      setStatus("Copied text and images to the clipboard.");
    } catch {
      setStatus("Copy was blocked. Select the text manually, or use Print / Save as PDF.");
      return;
    }
    setTimeout(() => { if (statusEl.textContent.startsWith("Copied")) setStatus(previous); }, 4000);
  }

  copyBtn.addEventListener("click", copyAll);
  printBtn.addEventListener("click", () => window.print());
})();
