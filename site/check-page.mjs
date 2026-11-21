// shelfready.dev/check/: paste an App Store link, get the listing check (worker.mjs → /api/check).
// Everything the API returns comes from other people's pages, so the client renders it with textContent only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CHECK_CSS = `
.check { padding: 32px 0 24px; }
.check-form { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 12px; max-width: 46em; }
.check-form input { flex: 1 1 18em; min-width: 0; font: 500 1rem var(--sans); color: var(--ink); background: var(--slip); border: 2px solid var(--ink); border-radius: 6px; padding: 12px 14px; }
.check-form input:focus-visible, .check-form button:focus-visible { outline: 3px solid var(--kraft); outline-offset: 2px; }
.check-form button { font: 700 1rem var(--sans); color: var(--slip); background: var(--ink); border: 2px solid var(--ink); border-radius: 6px; padding: 12px 20px; cursor: pointer; }
.check-form button:disabled { opacity: 0.6; cursor: progress; }
.check-note { font: 500 0.9rem/1.5 var(--sans); color: var(--muted); max-width: 46em; margin: 0 0 32px; }
.check-status { font: 600 1rem var(--sans); margin: 0 0 20px; min-height: 1.5em; }
.check-status.error { color: var(--alarm); }
.report { max-width: 760px; }
.report .slip-head a { color: inherit; }
.report .preview li { display: grid; grid-template-columns: 18px 1fr; column-gap: 12px; align-items: baseline; }
.report .preview .what { font-weight: 600; }
.report .preview .detail, .report .preview .fix { grid-column: 2; font-weight: 500; font-size: 0.92rem; color: var(--muted); overflow-wrap: anywhere; margin-top: 3px; }
.report .preview .fix::before { content: "Fix: "; font-weight: 650; color: var(--ink); }
.preview li.warn .box { border-color: var(--kraft-deep); background: var(--kraft-deep); }
.preview li.warn .box::after { content: "!"; position: absolute; inset: -3px 0 0; text-align: center; color: #fff; font: 800 13px/18px var(--sans); }
.preview li.error .box { border-color: var(--alarm); background: var(--alarm); }
.preview li.error .box::after { content: "×"; position: absolute; inset: -3px 0 0; text-align: center; color: #fff; font: 800 15px/18px var(--sans); }
.preview li.info .box { border-style: dashed; }
.report-after { margin: 24px 0 0; font: 500 0.95rem/1.55 var(--sans); color: var(--muted); max-width: 46em; }
.report-after code { color: var(--ink); }
.hero-check { margin: 24px 0 8px; max-width: 34em; }
.hero-check label { display: block; font: 650 0.95rem var(--sans); margin: 0 0 8px; }
`;

const SCRIPT = `
(() => {
  const form = document.getElementById("check-form");
  const input = document.getElementById("app");
  const button = form.querySelector("button");
  const status = document.getElementById("check-status");
  const out = document.getElementById("report");
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  // Text with \`code\` spans, built from text nodes only.
  const rich = (tag, cls, text) => { const e = el(tag, cls); String(text).split("\`").forEach((part, i) => e.append(i % 2 ? el("code", null, part) : part)); return e; };
  const say = (text, isError) => { status.textContent = text; status.classList.toggle("error", !!isError); };

  function render(r) {
    out.replaceChildren();
    const slip = el("div", "slip report");
    const head = el("div", "slip-head");
    const name = el("span");
    const link = el("a", null, r.app.title + " · " + r.app.seller);
    link.href = r.app.url;
    link.rel = "noopener";
    name.append(link);
    head.append(name, el("span", "count", r.passed + " of " + r.total + " pass"));
    const list = el("ul", "preview");
    for (const f of r.findings) {
      const li = el("li", f.level === "ok" ? "done" : f.level);
      li.append(el("span", "box"), el("span", "what", f.title));
      if (f.detail) li.append(rich("span", "detail", f.detail));
      if (f.level !== "ok" && f.fix) li.append(rich("span", "fix", f.fix));
      list.append(li);
    }
    slip.append(head, list);
    const after = el("p", "report-after");
    after.append("This sees only the public listing. In your app's repo, ", el("code", null, "npx -y shelfready check"), " also compares your privacy manifests, permission texts and SDKs with your pages, and writes the fixes.");
    out.append(slip, after);
  }

  async function run(value) {
    if (!value.trim()) return;
    button.disabled = true;
    out.replaceChildren();
    say("Checking the listing, the privacy policy and the support page…");
    try {
      const res = await fetch("/api/check?app=" + encodeURIComponent(value.trim()));
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "The check failed. Try again in a minute.");
      say("");
      render(body);
    } catch (e) {
      say(e.message || String(e), true);
    } finally {
      button.disabled = false;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const u = new URL(location.href);
    u.searchParams.set("app", input.value.trim());
    history.replaceState(null, "", u);
    run(input.value);
  });
  const start = new URL(location.href).searchParams.get("app");
  if (start) { input.value = start; run(start); }
})();
`;

/** The hero form on the home page: a plain GET to /check/, so it works before any script loads. */
export const HERO_FORM = `<form class="hero-check check-form" action="/check/" method="get">
          <label for="hero-app">Already on the App Store? Check your listing.</label>
          <input id="hero-app" name="app" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="apps.apple.com/…/id123456789" required>
          <button type="submit">Check listing</button>
        </form>`;

export function writeCheckPage({ dist, css, header, footer, siteURL }) {
  mkdirSync(join(dist, "check"), { recursive: true });
  writeFileSync(
    join(dist, "check", "index.html"),
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Check an App Store listing: privacy policy, trader details, privacy label · ShelfReady</title>
<meta name="description" content="Paste an App Store link. ShelfReady checks the privacy policy and support page, the EU trader details, the Impressum for German and Austrian developers, and whether the privacy label covers the SDKs the policy names.">
<link rel="canonical" href="${siteURL}/check/">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${css}</style>
</head>
<body>
<div class="wrap">
${header}
<main class="check">
  <h1 class="sdk-title">Check an App Store listing</h1>
  <p class="lede">Paste your app's App Store link. ShelfReady reads the listing the way a reviewer would, then checks the privacy policy, the support page, your EU trader details and your privacy label.</p>
  <form id="check-form" class="check-form" action="/check/" method="get">
    <label class="visually-hidden" for="app">App Store link or app ID</label>
    <input id="app" name="app" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://apps.apple.com/…/id123456789" required>
    <button type="submit">Check listing</button>
  </form>
  <p class="check-note">Reads the German App Store, which shows the EU trader details. Nothing is stored; results are cached for an hour.</p>
  <p id="check-status" class="check-status" role="status" aria-live="polite"></p>
  <div id="report"></div>
</main>
${footer}
</div>
<script>${SCRIPT}</script>
</body>
</html>
`,
  );
  return "/check/";
}
