# Made with vibecoding ♥️
# Project NOX

A local-first notebook for Android and desktop browsers. Black and red, gothic by disposition.

Rich text notes, handwriting, mindmaps, PDFs, link notes and `[[wiki links]]` between notes — all
stored on your own device. There is no server, no account and no sync. It works with the network
cable pulled out.

---

## Get it

**Android app (APK)**
[`Project-NOX.apk`](https://github.com/shadow-abyss/Nox/raw/main/Project-NOX.apk) — download, tap to
install, allow installs from your browser when asked. If Play Protect warns ("unknown developer"),
tap **More details → Install anyway**. That warning means "not from the Play Store", not "unsafe".

Requires Android 7.0 or newer.

**Use it in the browser**
[shadow-abyss.github.io/Nox](https://shadow-abyss.github.io/Nox/) — nothing to install. In Chrome,
use **Install app** (or Add to Home screen) to get an icon that opens fullscreen and works offline.

---

## What it does

| | |
|---|---|
| **Notes** | Rich text — headings, lists, quotes, code blocks, highlights, links |
| **Handwriting** | Pressure-aware ink, four paper styles, undo, export to PNG |
| **Mindmaps** | Draggable SVG nodes, pan and zoom, export to SVG |
| **PDFs** | Imported into local storage and rendered offline with a bundled pdf.js |
| **Links** | A bookmark plus the reason you kept it |
| **Wiki links** | Type `[[Note title]]` to point at another note; backlinks show at the bottom |

Plus search across everything, tags, pinning, trash with restore, and JSON backup/import.

---

## Where your data lives

Everything sits in IndexedDB inside the app — on the device, under that origin. Nothing is
transmitted anywhere. Open DevTools → Network while using the web version and watch nothing leave.

Two consequences worth knowing:

- **Uninstalling the app, or clearing site data, deletes your notes.** Use *Settings → Export
  backup* now and then; the JSON carries notes and PDFs and imports back anywhere.
- Notes do not travel between devices by themselves. Export on one, import on the other.

---

## The Android build

The APK is a thin WebView wrapper around the same web app, with one deliberate detail: the assets
are served from `http://127.0.0.1:<random port>` by a tiny in-app HTTP server rather than loaded
over `file://`. A WebView on `file://` gets an opaque origin, where IndexedDB and service workers
are blocked — and then every note you wrote would vanish on close. Loopback counts as a secure
context, so storage and offline caching behave normally.

- Package: `ai.nox.notebook`
- minSdk 24 (Android 7.0), targetSdk 34
- Self-signed — installing a future build requires the same signing key

---

## Repo layout

```
index.html              app shell — every view lives here
manifest.webmanifest    PWA identity, icons, shortcuts
sw.js                   service worker, offline cache of the whole app
css/nox.css             the black/red theme, fully responsive
js/db.js                IndexedDB layer
js/util.js              ids, dates, modal, toast, file pickers
js/ink.js               handwriting engine
js/mind.js              mindmap engine
js/pdfview.js           PDF renderer on top of pdf.js
js/app.js               app logic: notes, editors, search, backup
vendor/                 pdf.js (Mozilla, Apache-2.0)
icons/                  app icons
```

## Editing it

It is a static site — no build step. Change a file, reload, done.

Two gotchas:

- Paths are **case-sensitive** on GitHub Pages. `js/` is not `Js/`.
- If you change the app shell, bump `CACHE_VERSION` in `sw.js` (`nox-v1` → `nox-v2`), or returning
  visitors keep the cached old build.

## Third-party

`vendor/pdf.min.js` and `vendor/pdf.worker.min.js` are [pdf.js](https://github.com/mozilla/pdf.js)
by Mozilla, Apache-2.0.
