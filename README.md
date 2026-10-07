# Page to Clipboard — Chromium + Firefox/Zen

Click the toolbar button to copy the currently loaded page's text and images together. Paste into Word, OneNote, a rich-text editor, or another app that accepts HTML. Plain-text destinations receive text plus image descriptions. Some destinations strip embedded images; use the image mode for those apps.

You can also open the extracted content as a **clean printable page** with a **Copy** button and a **Print / Save as PDF** button that actually captures the whole chapter — not just the heading. See "Printing and Save as PDF" below.

## Which browsers are supported

There are two browser engines in the world of extensions, and this project ships a package for each. Between them they cover essentially every desktop browser that supports WebExtensions:

- **Chromium family — `dist/chrome/` (Manifest V3):** Google Chrome, Microsoft Edge, Brave, Opera, Vivaldi, Arc, and other Chromium-based browsers.
- **Gecko family — `extension/` (Manifest V2):** Firefox, Zen, LibreWolf, Floorp, Waterfox, and other Firefox-based browsers.

The content extraction (`extract.js`), the printable reader page (`reader.html` / `reader.js`), and the icon are **shared** between both builds. Only the background differs, because the two engines run it differently (see "How the two builds differ").

### Honest exceptions

- **DuckDuckGo browser:** the DuckDuckGo desktop browser does **not** support third-party browser extensions. There is no extension API to target, so this cannot run there. (This is a DuckDuckGo product decision, not a limitation of this extension.)
- **Safari:** Safari runs WebExtensions only after they are wrapped as a native macOS/iOS app via Xcode's `safari-web-extension-converter`, which also requires an Apple Developer account and a Mac to build. That native wrapper is out of scope for this Windows-built project. The shared `extract.js` / `reader.*` code would port, but the background would need Safari's own packaging. If you need Safari, say so and it can be set up on a Mac.

## Install in Chrome / Edge / Brave / Opera / Vivaldi

1. Build the Chromium package (produces `dist/chrome/`):

   ```bash
   npm install
   npm run build:chrome
   ```

2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`, etc.).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `dist/chrome` folder.
5. Pin **Page to Clipboard** to the toolbar.
6. Open your page, wait for it to load, and click the button (or press **Alt+Shift+C**).
7. Paste with **Ctrl+V**.

For permanent / shared distribution, upload `dist/page_to_clipboard-chrome-1.1.0.zip` to the Chrome Web Store (or your browser's add-on store) through its developer dashboard. "Load unpacked" installs are for development and are not shared between machines.

## Install in Zen / Firefox

Use a current Zen release based on Firefox 142 or newer.

1. Open `about:debugging#/runtime/this-firefox` in Zen (or Firefox).
2. Click **Load Temporary Add-on…**.
3. Select `extension/manifest.json` in this folder.
4. Pin **Page to Clipboard** from the extensions menu to the toolbar.
5. Open your textbook through its normal signed-in launch flow, wait for the chapter to load, and click the extension button (or press **Alt+Shift+C**).
6. Paste with **Ctrl+V**.

Temporary add-ons are removed when the browser restarts. Reload using the same steps. For permanent distribution, submit the extension to Mozilla for signing (`npm run build` produces the ZIP; unlisted/self-distributed is an option). No browser security preferences need to be changed for temporary installation.

## Controls

Identical on every supported browser:

- **Click toolbar button:** copy formatted text and images from loaded content across accessible frames.
- **Right-click toolbar button → Copy text only:** plain text without fetching images.
- **Right-click toolbar button → Open printable page (Save as PDF):** open a clean tab containing the extracted chapter with **Print / Save as PDF** and **Copy all** buttons.
- **Right-click toolbar button → Copy visible page as image:** copy a PNG of the current viewport, including canvas-rendered or otherwise inaccessible content. This is an image, not OCR or editable text.
- **Alt+Shift+C:** same as the toolbar click. Remap it through your browser's Manage Extension Shortcuts page if another extension uses it.

The badge shows `…` while working, `OK` on success, `!` for omissions, `ERR` for failure, and `PNG` for a screenshot. Hover over the icon for details. Partial copies and failures also produce a notification if your OS permits it. Clipboard operations from multiple tabs are serialized.

## Printing and Save as PDF

Textbook readers block printing in ways that make the browser's own Print produce a blank page or just the chapter heading: a `@media print` stylesheet that hides the body, a `beforeprint` handler that clears the content, or content rendered inside frames that the top page's Print ignores.

This extension sidesteps all of that. **Right-click the toolbar button → Open printable page (Save as PDF)** extracts the rendered chapter exactly the way the copy feature does, then opens it in a new tab that is a page owned by the extension itself. That page has none of the source site's CSS or scripts, so:

- **Print / Save as PDF** runs the browser's normal print dialog against the clean page. Choose "Save to PDF" / "Microsoft Print to PDF" as the destination to get a PDF of the whole extracted chapter, with images, laid out for reading. The toolbar buttons are automatically hidden from the printout, and figures and tables avoid awkward page breaks.
- **Copy all** copies the same formatted text and images to the clipboard, the same as the toolbar copy.

The printable page only ever contains the content that was already loaded and extractable (see the limits below). It does not turn pages or fetch the rest of the book. The content is held briefly and handed to the new tab once; if the tab is closed before it loads, extract the page again.

## McGraw Hill and other textbook readers

The extension reads the rendered document directly and writes from its own extension context. Page-level `copy` event blockers, CSS `user-select: none`, disabled context menus, and disabled print commands do not participate in that process. It attempts extraction in all permitted frames, including cross-origin and `about:srcdoc` frames, which many EPUB readers use.

This copies **currently loaded content**, which may be an entire loaded chapter rather than just the viewport. It does not turn pages, fetch an entire book, defeat encryption, or unlock content your session cannot access. Reader implementations that use closed shadow roots, inaccessible canvases, proprietary renderers, or unloaded virtual pages may require the screenshot mode. There is no OCR. CSS background pictures and external references within inline SVG diagrams are not extracted; inline SVG is sanitized and rasterized. Separate frames are appended; a publisher's exact cross-frame reading order is not guaranteed. Site-specific navigation may also appear if no content landmark is available.

Images are copied as embedded PNGs when possible. Already loaded images are rasterized in-page first; if that fails, the extension attempts to fetch that image URL with browser-managed credentials. Authentication or cookie partitioning can still prevent those requests. Unavailable images are labeled and reported. Limits: 100 images and 100,000 nodes per frame, 16 megapixels per raster image, 12 MiB per fetched image, and about 48 MiB total embedded image data. Large figures can be omitted with a warning.

## Privacy and permissions

Everything is processed locally. No analytics, remote extraction service, account, external script, or clipboard-reading permission is included. The only outgoing requests made by the extension are for images referenced by the page you chose to copy.

- `activeTab`: operate on the tab you clicked; capture its visible viewport.
- `<all_urls>` (listed as `host_permissions` in the Chromium build): access nested textbook frames and image hosts, including cross-origin ones. This is broad browser access, but there are **no automatically running content scripts**: extraction happens only when you click or use the shortcut/menu.
- `clipboardWrite`: write copied material, including formatted text and PNGs.
- `contextMenus`: alternative copy modes on the toolbar button.
- `notifications`: explain failed or partial copies.
- `scripting` (Chromium): inject the extractor into the clicked tab on demand.
- `storage` (Chromium): hold the printable-page payload in in-memory session storage so it survives a service-worker restart between opening the reader tab and that tab loading. Nothing is written to disk.
- `offscreen` (Chromium): give the service worker a hidden DOM for assembling HTML, rasterizing images, and writing the clipboard — things a service worker cannot do on its own.

## How the two builds differ

Both builds run the same extractor and the same reader page. The difference is the background:

- **Firefox/Zen (MV2, `extension/background.js`):** a persistent background *page* with its own DOM. It assembles the inert article, embeds images on a canvas, and writes the clipboard directly, and uses Firefox's `browser.clipboard.setImageData` for the screenshot mode.
- **Chromium (MV3, `chrome/background.js` + `chrome/offscreen.js`):** a *service worker* has no DOM, so it only orchestrates — it injects the extractor with `chrome.scripting`, captures the viewport, and hands the collected frames to an **offscreen document** (`offscreen.js`), which owns a real DOM and does the DOMParser assembly, image embedding, and clipboard writes. The printable payload is passed to the reader through `storage.session` instead of a message, so it survives the worker sleeping.

## Development and verification

Requires Node.js 22+.

```bash
npm ci
npx playwright install chromium
npm test            # extractor + Firefox background, real clipboard, in Chromium
npm run lint        # Mozilla extension linter on the Firefox build
npm run build       # Firefox/Zen ZIP via web-ext -> dist/
npm run build:chrome  # Chromium unpacked dir + ZIP -> dist/chrome, dist/*.zip
npm run build:all   # both
```

`npm test` runs the real extractor in Chromium against copy-blocked pages, frames, images, canvas, SVG, and shadow DOM, plus background integration tests for the Firefox build using mocked WebExtension APIs and the browser's real clipboard.

The Chromium build was additionally verified by loading the packaged `dist/chrome` extension into a real Chromium instance and driving it end to end: the rich-copy path injected the extractor, assembled and embedded the image in the offscreen document, and wrote HTML + plain text to the clipboard (verified by reading it back); the printable path stored the payload in `storage.session`, opened the reader, and rendered the chapter with its image. The screenshot/`captureVisibleTab` path is exercised by the Firefox test suite with mocks; it needs a visible rendered viewport, so it is not auto-verified in a headless run. None of this substitutes for a signed-in McGraw Hill or full in-browser extension-runtime test with your own content.

No build step or runtime dependencies are needed to load `extension/manifest.json` (Firefox) or `dist/chrome` (Chromium). Development dependencies are used only for tests, manifest linting, and packaging. No npm dependencies are shipped in either extension.

References: [Chrome offscreen documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen), [Chrome MV3 migration](https://developer.chrome.com/docs/extensions/develop/migrate), [Zen extensions](https://docs.zen-browser.app/user-manual/extensions), [Mozilla clipboard APIs](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Interact_with_the_clipboard), [temporary add-on installation](https://firefox-source-docs.mozilla.org/devtools-user/about_colon_debugging/index.html).
