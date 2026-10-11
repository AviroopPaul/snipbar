# Snipbar

Select text on any website and a small bar appears right under it with four actions: **Copy**, **Beautify**, **Search**, and **Ask**.

Most of the time you select text because you are about to copy it or look it up. Snipbar removes the trip to the right-click menu or the address bar.

![Snipbar under a selection](docs/assets/shot-bar-hover.png)

Landing page: https://snipbar.vercel.app/

## What it does

- **Copy** puts the selected text on the clipboard and shows a brief "Copied" confirmation.
- **Beautify** fixes grammar, spelling and punctuation and smooths the wording without changing the tone. It never uses em dashes. In a textarea, input or rich-text editor it replaces the selection in place (undo with Cmd+Z). On page text it shows the result in a small card with a Copy button. It is hidden in password fields.
- **Search** opens the selection in a new tab on your search engine. Google by default, or DuckDuckGo, Bing, Brave.
- **Ask** opens the selection as a prompt in ChatGPT (`chatgpt.com/?q=`). Claude and Perplexity are also available.

It works on every site, inside iframes, in textareas and inputs, with mouse or keyboard selections. The bar flips above the selection when there is no room below, follows the text while you scroll, and goes away on Escape, on click, or as soon as the selection is gone.

Settings live in the toolbar popup: pick a search engine and an assistant. They sync through your Chrome profile. There is no tracking and no analytics. The only network request is Beautify: it sends the selected text (up to 4000 characters) to `snipbar.vercel.app/api/beautify`, which forwards it to Google Gemini and returns the result. Snipbar keeps no copy.

## Install

Chrome Web Store listing is not up yet, so load it unpacked:

1. Download `snipbar.zip` from the [latest release](https://github.com/AviroopPaul/snipbar/releases/latest/download/snipbar.zip) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.
4. Select some text on any page.

Works in Chrome, Edge, Brave, Arc and other Chromium browsers.

## Develop

```sh
npm install          # Playwright for tests and icon generation
npm run verify       # headed Chromium with the extension loaded, 35 checks
npm run icons        # rasterize docs/assets/logo.svg into icons/
npm run capture      # marketing screenshots into docs/assets/
npm run zip          # snipbar.zip for a release
```

The Beautify proxy is a Vercel function and needs `GEMINI_API_KEY` set on the Vercel project. `GEMINI_MODEL` is optional (default `gemini-3.1-flash-lite`).

Layout:

- `manifest.json` MV3, content script on `<all_urls>`, host permission for the Beautify proxy only.
- `background.js` service worker that calls the Beautify proxy, so the request carries the extension origin.
- `providers.js` the search engine and assistant URL tables, shared by content script and popup.
- `content.js` selection tracking, placement, actions. The bar lives in a shadow root on a `<snipbar-host>` element.
- `popup.html` / `popup.js` engine and assistant pickers backed by `chrome.storage.sync`.
- `api/beautify.js` Vercel function: checks the origin and length, calls Gemini with the polish prompt, strips any long dashes.
- `docs/` the landing page, deployed to Vercel (static, see `vercel.json`).
- `test/verify.mjs` the Playwright suite, `test/fixture.html` the page it drives.

## License

MIT
