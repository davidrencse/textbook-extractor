const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { chromium } = require('@playwright/test');
const extractor = fs.readFileSync('extension/extract.js', 'utf8');
const background = fs.readFileSync('extension/background.js', 'utf8');
let server, browser, context, base;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/image.png') { res.setHeader('Content-Type', 'image/png'); res.end(png); return; }
    if (req.url === '/missing.png') { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Clipboard test</title><body></body>');
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  base = `http://localhost:${server.address().port}`;
  browser = await chromium.launch();
  context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });
async function pageWith(html) {
  const page = await context.newPage();
  await page.goto(base);
  await page.setContent(html);
  return page;
}
test('extracts blocked text, tables and images without running page copy handlers', async () => {
  const page = await pageWith(`<style>body{user-select:none} .hidden{display:none}</style>
    <nav>Navigation noise</nav><main><h1>Biology</h1><p>${'Photosynthesis converts light to energy. '.repeat(5)}</p>
    <table><tr><th>Stage</th><th>Product</th></tr><tr><td>Light reactions</td><td>ATP</td></tr></table>
    <img src="${base}/image.png" alt="Chloroplast"><p class="hidden">Secret hidden text</p><input value="private input"></main>
    <script>document.addEventListener('copy',e=>{e.preventDefault();window.copyCalled=true});</script>`);
  const result = await page.evaluate(extractor);
  assert.match(result.text, /Photosynthesis/);
  assert.match(result.text, /Stage\tProduct/);
  assert.doesNotMatch(result.text, /Navigation noise|Secret hidden|private input/);
  assert.equal(result.images.length, 1);
  assert.match(result.images[0].embedded, /^data:image\/png/);
  assert.equal(await page.evaluate(() => window.copyCalled), undefined);
  await page.close();
});
test('keeps safe formatting and links, removes active markup and hidden roots', async () => {
  const page = await pageWith(`<div hidden><main>${'Hidden chapter '.repeat(30)}</main></div>
    <article><header><h1>Chapter title</h1></header><p onclick="alert(1)">${'Visible content '.repeat(20)}</p>
    <a href="javascript:alert(1)">Unsafe link</a><a href="/chapter">Next</a><iframe srcdoc="secret"></iframe></article>`);
  const result = await page.evaluate(extractor);
  assert.match(result.text, /Chapter title/);
  assert.doesNotMatch(result.text, /Hidden chapter/);
  assert.doesNotMatch(result.html, /onclick|javascript:|iframe|<script/);
  assert.match(result.html, new RegExp(`${base}/chapter`));
  await page.close();
});
test('extracts open shadow roots, canvas and inline SVG diagrams', async () => {
  const page = await pageWith('<div id="host"></div><canvas width="20" height="20"></canvas><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>');
  await page.evaluate(() => {
    document.querySelector('#host').attachShadow({ mode: 'open' }).innerHTML = '<p>Shadow chapter</p>';
    document.querySelector('canvas').getContext('2d').fillRect(0, 0, 20, 20);
  });
  const result = await page.evaluate(extractor);
  assert.match(result.text, /Shadow chapter/);
  assert.equal(result.images.length, 2);
  assert.ok(result.images.every(i => i.embedded.startsWith('data:image/png')));
  await page.close();
});
test('separate same-origin, srcdoc and cross-origin frames expose their reading content', async () => {
  const page = await pageWith(`<p>Reader shell</p><iframe srcdoc="<p>Srcdoc chapter</p>"></iframe><iframe src="http://127.0.0.1:${server.address().port}/frame"></iframe>`);
  await page.frames()[2].waitForLoadState();
  await page.frames()[2].evaluate(() => { document.body.textContent = 'Cross-origin chapter'; });
  const results = await Promise.all(page.frames().map(frame => frame.evaluate(extractor)));
  assert.ok(results.some(r => r.text.includes('Srcdoc chapter')));
  assert.ok(results.some(r => r.text.includes('Cross-origin chapter')));
  await page.close();
});
async function loadBackground(page, results) {
  await page.evaluate(({ results }) => {
    window.testState = { badges: [], titles: [], notifications: [], writes: [], opened: [] };
    window.browser = {
      browserAction: {
        setBadgeText: async x => testState.badges.push(x.text),
        setBadgeBackgroundColor: async () => {},
        setTitle: async x => testState.titles.push(x.title),
        onClicked: { addListener: fn => { window.clickExtension = fn; } }
      },
      tabs: { executeScript: async () => results, create: async x => { testState.opened.push(x.url); return { id: 99 }; } },
      contextMenus: { create: () => {}, onClicked: { addListener: fn => { window.menuClick = fn; } } },
      notifications: { create: async x => testState.notifications.push(x) },
      runtime: { getURL: x => x, onMessage: { addListener: fn => { window.docHandler = fn; } } }
    };
  }, { results });
  await page.addScriptTag({ content: background });
}
test('writes actual HTML and plain text clipboard formats with embedded images', async () => {
  const page = await pageWith(`<p>Textbook paragraph</p><img src="${base}/image.png" alt="diagram">`);
  const result = await page.evaluate(extractor);
  await loadBackground(page, [result]);
  await page.evaluate(async base => { await clickExtension({ id: 1, title: 'Biology', url: base }); }, base);
  const data = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return { html: await (await items[0].getType('text/html')).text(), text: await (await items[0].getType('text/plain')).text(), state: testState };
  });
  assert.match(data.text, /Textbook paragraph/);
  assert.match(data.html, /data:image\/png;base64/);
  assert.equal(data.state.badges.at(-1), 'OK');
  await page.close();
});
test('reports failed image fetches while preserving copied text', async () => {
  const page = await pageWith(`<p>Available prose</p><img src="${base}/missing.png" alt="missing figure">`);
  const result = await page.evaluate(extractor);
  await loadBackground(page, [result]);
  await page.evaluate(async base => { await clickExtension({ id: 1, title: 'Chapter', url: base }); }, base);
  const state = await page.evaluate(() => testState);
  assert.equal(state.badges.at(-1), '!');
  assert.match(state.notifications[0].message, /1 image\(s\) could not be embedded/);
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Available prose/);
  await page.close();
});
test('copy fallback writes both formats', async () => {
  const page = await pageWith('<p>Fallback chapter</p>');
  const result = await page.evaluate(extractor);
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'write', { value: undefined }); });
  await loadBackground(page, [result]);
  await page.evaluate(async base => { await clickExtension({ id: 1, title: 'Chapter', url: base }); }, base);
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Fallback chapter/);
  const html = await page.evaluate(async () => (await (await navigator.clipboard.read())[0].getType('text/html')).text());
  assert.match(html, /Fallback chapter/);
  await page.evaluate(async base => { await menuClick({ menuItemId: 'copy-text' }, { id: 1, title: 'Chapter', url: base }); }, base);
  assert.equal(await page.evaluate(() => testState.badges.at(-1)), 'OK');
  await page.close();
});
test('text-only mode never fetches referenced images', async () => {
  const page = await pageWith(`<p>Text-only chapter</p><img src="${base}/missing.png" alt="figure">`);
  const result = await page.evaluate(extractor);
  await loadBackground(page, [result]);
  await page.evaluate(() => { window.fetch = () => { throw new Error('Image fetch must not run'); }; });
  await page.evaluate(async base => { await menuClick({ menuItemId: 'copy-text' }, { id: 1, title: 'Chapter', url: base }); }, base);
  assert.equal(await page.evaluate(() => testState.badges.at(-1)), 'OK');
  assert.equal(await page.evaluate(() => testState.notifications.length), 0);
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Text-only chapter/);
  await page.close();
});
test('screenshot mode sends PNG bytes to Firefox clipboard API and rejects a stale tab', async () => {
  const page = await pageWith('');
  await loadBackground(page, []);
  await page.evaluate(data => {
    browser.tabs.query = async () => [{ id: 1 }];
    browser.tabs.captureVisibleTab = async () => data;
    browser.clipboard = { setImageData: async (bytes, format) => { testState.image = { bytes: [...new Uint8Array(bytes)], format }; } };
  }, `data:image/png;base64,${png.toString('base64')}`);
  await page.evaluate(async () => { await menuClick({ menuItemId: 'copy-image' }, { id: 1, windowId: 1 }); });
  const state = await page.evaluate(() => testState);
  assert.deepEqual(state.image.bytes, [...png]);
  assert.equal(state.image.format, 'png');
  assert.equal(state.badges.at(-1), 'PNG');
  await page.evaluate(async () => { await menuClick({ menuItemId: 'copy-image' }, { id: 2, windowId: 1 }); });
  assert.equal(await page.evaluate(() => testState.badges.at(-1)), 'ERR');
  await page.close();
});
test('printable mode opens the reader page and hands over the assembled doc once', async () => {
  const page = await pageWith(`<p>Printable paragraph</p><img src="${base}/image.png" alt="diagram">`);
  const result = await page.evaluate(extractor);
  await loadBackground(page, [result]);
  await page.evaluate(async base => { await menuClick({ menuItemId: 'print-pdf' }, { id: 1, title: 'Biology', url: base }); }, base);
  const opened = await page.evaluate(() => testState.opened);
  assert.equal(opened.length, 1);
  assert.match(opened[0], /reader\.html#.+/);
  assert.equal(await page.evaluate(() => testState.badges.at(-1)), 'OK');
  const token = opened[0].split('#')[1];
  const doc = await page.evaluate(async token => docHandler({ type: 'getDoc', token }), token);
  assert.match(doc.html, /Printable paragraph/);
  assert.match(doc.html, /data:image\/png;base64/);
  assert.match(doc.text, /Printable paragraph/);
  // The payload is single-use: a second claim for the same token returns nothing.
  assert.equal(await page.evaluate(async token => docHandler({ type: 'getDoc', token }), token), null);
  await page.close();
});
test('empty pages fail explicitly without overwriting clipboard', async () => {
  const page = await pageWith('');
  await page.evaluate(() => navigator.clipboard.writeText('Keep my clipboard'));
  await loadBackground(page, [null]);
  await page.evaluate(async base => { await clickExtension({ id: 1, title: 'Empty', url: base }); }, base);
  assert.equal(await page.evaluate(() => testState.badges.at(-1)), 'ERR');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Keep my clipboard');
  await page.close();
});
