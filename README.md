# Page to Clipboard — Zen / Firefox

Click the toolbar button to copy the currently loaded page's text and images together. Paste into Word, OneNote, a rich-text editor, or another app that accepts HTML. Plain-text destinations receive text plus image descriptions. Some destinations strip embedded images; use the image mode for those apps.

You can also open the extracted content as a **clean printable page** with a **Copy** button and a **Print / Save as PDF** button that actually captures the whole chapter — not just the heading. See "Printing and Save as PDF" below.

## Install in Zen now

Use a current Zen release based on Firefox 142 or newer.

1. Open `about:debugging#/runtime/this-firefox` in Zen.
2. Click **Load Temporary Add-on…**.
3. Select `extension/manifest.json` in this folder.
4. Pin **Page to Clipboard** from the extensions menu to the toolbar.
5. Open your textbook through its normal signed-in launch flow, wait for the chapter to load, and click the extension button (or press **Alt+Shift+C**).
6. Paste with **Ctrl+V**.

Temporary add-ons are removed when Zen restarts. Reload using the same steps. The ZIP in `dist/` is an **unsigned development package**, not a permanently installable, signed release. For permanent distribution, submit the extension to Mozilla for signing (unlisted/self-distributed is an option). No browser security preferences need to be changed for temporary installation.

## Controls

- **Click toolbar button:** copy formatted text and images from loaded content across accessible frames.
- **Right-click toolbar button → Copy text only:** plain text without fetching images.
- **Right-click toolbar button → Open printable page (Save as PDF):** open a clean tab containing the extracted chapter with **Print / Save as PDF** and **Copy all** buttons.
- **Right-click toolbar button → Copy visible page as image:** copy a PNG of the current viewport, including canvas-rendered or otherwise inaccessible content. This is an image, not OCR or editable text.
- **Alt+Shift+C:** same as the toolbar click. Remap it through Manage Extension Shortcuts if another extension uses it.

The badge shows `…` while working, `OK` on success, `!` for omissions, `ERR` for failure, and `PNG` for a screenshot. Hover over the icon for details. Partial copies and failures also produce a notification if your OS permits it. Clipboard operations from multiple tabs are serialized.

## Printing and Save as PDF

Textbook readers block printing in ways that make the browser's own Print produce a blank page or just the chapter heading: a `@media print` stylesheet that hides the body, a `beforeprint` handler that clears the content, or content rendered inside frames that the top page's Print ignores.

This extension sidesteps all of that. **Right-click the toolbar button → Open printable page (Save as PDF)** extracts the rendered chapter exactly the way the copy feature does, then opens it in a new tab that is a page owned by the extension itself. That page has none of the source site's CSS or scripts, so:

- **Print / Save as PDF** runs the browser's normal print dialog against the clean page. Choose "Save to PDF" / "Microsoft Print to PDF" as the destination to get a PDF of the whole extracted chapter, with images, laid out for reading. The toolbar buttons are automatically hidden from the printout, and figures and tables avoid awkward page breaks.
- **Copy all** copies the same formatted text and images to the clipboard, the same as the toolbar copy.

The printable page only ever contains the content that was already loaded and extractable (see the limits below). It does not turn pages or fetch the rest of the book. The content is held briefly in memory and handed to the new tab once; if the tab is closed before it loads, extract the page again.

## McGraw Hill and other textbook readers

The extension reads the rendered document directly and writes from its own extension context. Page-level `copy` event blockers, CSS `user-select: none`, disabled context menus, and disabled print commands do not participate in that process. It attempts extraction in all permitted frames, including cross-origin and `about:srcdoc` frames, which many EPUB readers use.

The supplied McGraw Hill URL returned **401 / session timed out** during development. Its authenticated textbook content has **not been tested**. Launch the book normally through your course or McGraw Hill account, then use the button on the loaded chapter. A copied session-expired message means you must reopen the book first.

This copies **currently loaded content**, which may be an entire loaded chapter rather than just the viewport. It does not turn pages, fetch an entire book, defeat encryption, or unlock content your session cannot access. Reader implementations that use closed shadow roots, inaccessible canvases, proprietary renderers, or unloaded virtual pages may require the screenshot mode. There is no OCR. CSS background pictures and external references within inline SVG diagrams are not extracted; inline SVG is sanitized and rasterized. Separate frames are appended; a publisher's exact cross-frame reading order is not guaranteed. Site-specific navigation may also appear if no content landmark is available.

Images are copied as embedded PNGs when possible. Already loaded images are rasterized in-page first; if that fails, the extension attempts to fetch that image URL with browser-managed credentials. Authentication or cookie partitioning can still prevent those requests. Unavailable images are labeled and reported. Limits: 100 images and 100,000 nodes per frame, 16 megapixels per raster image, 12 MiB per fetched image, and about 48 MiB total embedded image data. Large figures can be omitted with a warning.

## Privacy and permissions

Everything is processed locally. No analytics, remote extraction service, account, external script, or clipboard-reading permission is included. The only outgoing requests made by the extension are for images referenced by the page you chose to copy.

- `activeTab`: operate on the tab you clicked; capture its visible viewport.
- `<all_urls>`: access nested textbook frames and image hosts, including cross-origin ones. This is broad browser access, but there are **no automatically running content scripts**: extraction happens only when you click or use the shortcut/menu.
- `clipboardWrite`: write copied material, including formatted text and PNGs.
- `contextMenus`: alternative copy modes on the toolbar button.
- `notifications`: explain failed or partial copies.

## Development and verification

Requires Node.js 22+.

```powershell
npm ci
npx playwright install chromium
npm test
npm run lint
npm run build
```

Tests run the real extractor in Chromium against copy-blocked pages, frames, images, canvas, SVG, and shadow DOM. Background integration tests use mocked WebExtension APIs and the browser's real clipboard. These tests do not substitute for a signed-in McGraw Hill or full Zen extension-runtime test.

Verification in this workspace: browser tests passed, Mozilla's extension linter reported zero errors/warnings, and the development ZIP was built. A separate headless Zen smoke test was attempted, but the environment prevented Zen from launching its page subprocesses. The extension has not been installed into your personal Zen profile. Dependency installation reported three high-severity development dependency advisories; subsequent `npm audit` requests failed, so those advisories could not be inspected. No npm dependencies are shipped in the extension.

No build step or runtime dependencies are needed to load `extension/manifest.json`. Development dependencies are used only for tests, manifest linting, and packaging.

References: [Zen extensions](https://docs.zen-browser.app/user-manual/extensions), [Mozilla clipboard APIs](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Interact_with_the_clipboard), [temporary add-on installation](https://firefox-source-docs.mozilla.org/devtools-user/about_colon_debugging/index.html).
"# textbook-extractor" 
