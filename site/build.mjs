// Builds shelfready.dev into ./dist from the same checklist items the CLI uses.
//   cd ../cli && npm ci && npm run build && cd ../site && npm ci && node build.mjs
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ITEMS, knowledgeBase } from "../cli/dist/index.js";
import { writeSdkPages } from "./sdk-pages.mjs";
import { CHECK_CSS, HERO_FORM, writeCheckPage } from "./check-page.mjs";

const SITE = "https://shelfready.dev";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
mkdirSync(join(dist, "fonts"), { recursive: true });
copyFileSync(join(here, "node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2"), join(dist, "fonts/archivo.woff2"));
copyFileSync(join(here, "node_modules/@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-normal.woff2"), join(dist, "fonts/source-serif-4.woff2"));
copyFileSync(join(here, "node_modules/@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-italic.woff2"), join(dist, "fonts/source-serif-4-italic.woff2"));

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Inline Markdown from the CLI texts: `code` and bare URLs.
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(https:\/\/[^\s)]+)/g, (u) => `<a href="${u}">${u.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, "")}</a>`);

// A generic EU paid app, so every item applies.
const facts = {
  version: 2,
  app: { name: "your app", bundleIdentifiers: [] },
  publisher: { brand: "", voice: "we", name: "", country: "DE", email: "", trader: true, address: { street: "", city: "", country: "" } },
  data: { tracking: false, collected: [], accessedAPIs: [], packages: [] },
  privacyNotes: [],
  support: { replyTime: "", askFor: "", faq: [] },
  pages: { baseURL: "https://example.com/app/", policyUpdated: "" },
};
const ctx = { facts, scan: { purposeStrings: {}, privacyManifests: [], packages: [] }, findings: [] };

const WHY = {
  "Code and privacy": "Apple reads these from your build. Get them wrong and the upload or the review stops.",
  Pages: "App Store Connect wants a privacy policy and a support URL. In Germany and Austria, a paid app also needs an Impressum, on the web and inside the app.",
  Legal: "One-off paperwork. The EU trader status decides whether your address appears on the store page.",
  "App Store Connect": "Forms you fill in once per app, and again when something changes.",
  Release: "The last mile.",
};

const groups = [...new Set(ITEMS.map((i) => i.group))];
const checklistHTML = groups
  .map((g) => {
    const items = ITEMS.filter((i) => i.group === g)
      .map((i) => {
        const auto = Boolean(i.auto);
        return `<li class="item${auto ? " auto" : ""}">
          <input type="checkbox" id="c-${i.id}" data-id="${i.id}">
          <label for="c-${i.id}"><span class="title">${esc(i.title)}</span>${auto ? `<span class="stamp" title="shelf check verifies this">checked by shelf</span>` : ""}
          <span class="how">${inline(i.how(ctx))}</span></label>
        </li>`;
      })
      .join("\n");
    return `<section class="group" aria-labelledby="g-${g.replace(/\W+/g, "-")}">
      <h3 id="g-${g.replace(/\W+/g, "-")}">${esc(g)}</h3>
      <p class="why">${esc(WHY[g] ?? "")}</p>
      <ul>${items}</ul>
    </section>`;
  })
  .join("\n");

const autoCount = ITEMS.filter((i) => i.auto).length;
const kb = knowledgeBase().slice().sort((a, b) => a.name.localeCompare(b.name));
const sdkNames = kb.map((e) => e.name);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ShelfReady: the App Store go-live checklist for indie iOS apps</title>
<meta name="description" content="Everything between “code done” and “live on the App Store”: privacy manifests, App Privacy answers, privacy policy, Impressum, EU trader status. ${autoCount} of ${ITEMS.length} steps checked automatically by the shelf CLI.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='3' y='6' width='26' height='20' rx='2' fill='%23C8A574'/%3E%3Cpath d='M9 16l5 5 9-10' stroke='%231C2740' stroke-width='3.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<style>
@font-face { font-family: "Archivo"; src: url(/fonts/archivo.woff2) format("woff2"); font-weight: 100 900; font-stretch: 62% 125%; font-display: swap; }
@font-face { font-family: "Source Serif"; src: url(/fonts/source-serif-4.woff2) format("woff2"); font-weight: 200 900; font-display: swap; }
@font-face { font-family: "Source Serif"; src: url(/fonts/source-serif-4-italic.woff2) format("woff2"); font-weight: 200 900; font-style: italic; font-display: swap; }
:root {
  --paper: #F3F5F7; --kraft: #C8A574; --kraft-deep: #A9844F; --ink: #1C2740; --stamp: #2E7D5B; --muted: #5E6A82; --slip: #FFFFFF; --rule: #D9DEE6; --alarm: #B42318;
  --sans: "Archivo", system-ui, sans-serif; --serif: "Source Serif", Georgia, serif;
}
@media (prefers-color-scheme: dark) {
  :root { --paper: #141B2B; --slip: #1C2538; --ink: #E8ECF3; --muted: #A3AEC2; --rule: #2E3950; --stamp: #5BBF8E; --kraft: #B8945F; --kraft-deep: #D5B482; --alarm: #F97066; }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 1.0625rem/1.65 var(--serif); }
a { color: inherit; text-decoration-color: var(--kraft-deep); text-underline-offset: 3px; }
a:hover { text-decoration-thickness: 2px; }
:focus-visible { outline: 3px solid var(--stamp); outline-offset: 3px; border-radius: 3px; }
code { font: 500 0.88em/1 ui-monospace, "SF Mono", Menlo, monospace; background: color-mix(in srgb, var(--kraft) 18%, transparent); padding: 0.12em 0.35em; border-radius: 4px; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; }

header.top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px 24px; padding: 22px 0; font: 600 0.95rem var(--sans); }
.mark { display: inline-flex; gap: 10px; align-items: center; text-decoration: none; font-stretch: 112%; letter-spacing: 0.01em; }
.mark svg { width: 26px; height: 26px; }
nav { display: flex; flex-wrap: wrap; gap: 6px 20px; }
nav a { text-decoration: none; color: var(--muted); white-space: nowrap; }
nav a:hover { color: var(--ink); }

.hero { display: grid; grid-template-columns: 1fr; gap: 40px; padding: 40px 0 64px; align-items: start; }
@media (min-width: 900px) { .hero { grid-template-columns: 1.05fr 1fr; gap: 64px; padding-top: 64px; } }
h1 { font: 850 clamp(2.6rem, 6.2vw, 4.6rem)/0.98 var(--sans); font-stretch: 125%; letter-spacing: -0.02em; margin: 0 0 24px; }
.lede { font-size: 1.25rem; line-height: 1.55; max-width: 34em; margin: 0 0 28px; }
.lede em { font-style: italic; }
.install { font: 500 0.95rem var(--sans); color: var(--muted); }
.install code { font-size: 0.95em; color: var(--ink); }

/* The packing slip */
.slip { background: var(--slip); border-radius: 6px; box-shadow: 0 1px 0 var(--rule), 0 18px 40px -24px rgba(28, 39, 64, 0.45); position: relative; overflow: hidden; }
.slip::before { content: ""; display: block; height: 14px; background: repeating-linear-gradient(90deg, var(--kraft) 0 18px, var(--kraft-deep) 18px 20px); }
.slip-head { display: flex; justify-content: space-between; gap: 16px; padding: 18px 22px 14px; border-bottom: 2px dashed var(--rule); font: 600 0.9rem var(--sans); }
.slip-head .count { font-variant-numeric: tabular-nums; color: var(--muted); font-weight: 500; }
.preview { list-style: none; margin: 0; padding: 10px 22px 20px; font: 500 0.98rem/1.35 var(--sans); }
.preview li { display: flex; gap: 12px; align-items: baseline; padding: 9px 0; border-bottom: 1px solid var(--rule); }
.preview li:last-child { border-bottom: 0; }
.box { flex: none; width: 18px; height: 18px; border: 2px solid var(--ink); border-radius: 3px; transform: translateY(3px); position: relative; }
.preview li.done .box { background: var(--stamp); border-color: var(--stamp); }
.preview li.done .box::after { content: ""; position: absolute; left: 4px; top: 0px; width: 5px; height: 10px; border: solid #fff; border-width: 0 2.5px 2.5px 0; transform: rotate(45deg); }
.preview .by { margin-left: auto; color: var(--stamp); font-size: 0.8rem; font-weight: 600; white-space: nowrap; }

section.block { padding: 56px 0; border-top: 1px solid var(--rule); }
h2 { font: 800 clamp(1.8rem, 3.6vw, 2.5rem)/1.08 var(--sans); font-stretch: 118%; letter-spacing: -0.01em; margin: 0 0 14px; }
.intro { max-width: 38em; color: var(--muted); margin: 0 0 32px; }
.tools { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; margin: -12px 0 28px; font: 500 0.92rem var(--sans); color: var(--muted); }
.tools button { font: 600 0.9rem var(--sans); color: var(--ink); background: none; border: 1.5px solid var(--rule); border-radius: 999px; padding: 6px 14px; cursor: pointer; }
.tools button:hover { border-color: var(--ink); }

.checklist { display: grid; gap: 40px; }
@media (min-width: 900px) { .checklist { grid-template-columns: 1fr 1fr; column-gap: 56px; } }
.group { min-width: 0; }
.item label { min-width: 0; }
.item .how, .steps p, .lede { overflow-wrap: anywhere; }
.group h3 { font: 750 1.2rem var(--sans); font-stretch: 110%; margin: 0 0 4px; }
.group .why { margin: 0 0 12px; color: var(--muted); font-size: 0.98rem; max-width: 36em; }
.group ul { list-style: none; margin: 0; padding: 0; }
.item { display: flex; gap: 14px; padding: 14px 0; border-top: 1px solid var(--rule); }
.item input { appearance: none; flex: none; width: 22px; height: 22px; margin: 2px 0 0; border: 2px solid var(--ink); border-radius: 4px; background: var(--slip); cursor: pointer; position: relative; }
.item input:checked { background: var(--stamp); border-color: var(--stamp); }
.item input:checked::after { content: ""; position: absolute; left: 5px; top: 1px; width: 6px; height: 12px; border: solid #fff; border-width: 0 3px 3px 0; transform: rotate(45deg); }
.item label { cursor: pointer; display: grid; gap: 4px; }
.item .title { font: 600 1.02rem/1.35 var(--sans); }
.item input:checked + label .title { text-decoration: line-through; text-decoration-color: var(--muted); color: var(--muted); }
.item .how { font-size: 0.97rem; color: var(--muted); }
.stamp { justify-self: start; font: 700 0.74rem/1 var(--sans); font-stretch: 112%; color: var(--stamp); border: 1.5px solid var(--stamp); border-radius: 4px; padding: 4px 7px 3px; transform: rotate(-2deg); margin-top: 2px; }

.steps { list-style: none; counter-reset: step; margin: 0; padding: 0; display: grid; gap: 28px; }
@media (min-width: 900px) { .steps { grid-template-columns: repeat(3, 1fr); gap: 40px; } }
.steps li { counter-increment: step; }
.steps li::before { content: counter(step); display: block; font: 850 2.6rem/1 var(--sans); font-stretch: 125%; color: var(--kraft-deep); margin-bottom: 10px; }
.steps h3 { font: 700 1.15rem var(--sans); margin: 0 0 6px; }
.steps p { margin: 0 0 10px; color: var(--muted); }
.sdks { margin-top: 36px; max-width: 46em; color: var(--muted); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
${CHECK_CSS}
.get { margin: 32px 0 0; font: 500 0.95rem/1.5 var(--sans); color: var(--muted); }
.get code { font-size: 0.95em; color: var(--ink); }

.agents { display: grid; gap: 32px; align-items: start; }
@media (min-width: 900px) { .agents { grid-template-columns: 1fr 1.1fr; gap: 64px; } }
.agents .intro { margin-bottom: 20px; }
.ask { font: 750 clamp(1.3rem, 2.4vw, 1.6rem)/1.25 var(--sans); font-stretch: 110%; margin: 0 0 20px; max-width: 22em; }
.ask::before { content: "“"; color: var(--kraft-deep); }
.ask::after { content: "”"; color: var(--kraft-deep); }
.agents ul.does { margin: 0; padding-left: 1.1em; color: var(--muted); }
.agents ul.does li { margin: 0 0 6px; }
.cmds { background: var(--slip); border-radius: 6px; box-shadow: 0 1px 0 var(--rule), 0 18px 40px -24px rgba(28, 39, 64, 0.45); overflow: hidden; min-width: 0; }
.cmds::before { content: ""; display: block; height: 14px; background: repeating-linear-gradient(90deg, var(--kraft) 0 18px, var(--kraft-deep) 18px 20px); }
.cmds dl { margin: 0; padding: 6px 22px 10px; }
.cmds dt { font: 650 0.95rem var(--sans); padding-top: 16px; }
.cmds dd { margin: 6px 0 0; padding-bottom: 16px; border-bottom: 1px solid var(--rule); }
.cmds dd:last-of-type { border-bottom: 0; }
.cmds dd > code { display: block; background: none; padding: 0; font-size: 0.86rem; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.cmds dd p { margin: 6px 0 0; font: 500 0.88rem/1.45 var(--sans); color: var(--muted); }
.sdk { padding: 32px 0 24px; }
.crumb { font: 600 0.9rem var(--sans); margin: 0 0 12px; }
.crumb a { color: var(--muted); }
.sdk-title { font: 850 clamp(2.2rem, 5vw, 3.6rem)/1 var(--sans); font-stretch: 125%; letter-spacing: -0.02em; margin: 0 0 20px; }
.basis { font: 500 0.95rem/1.5 var(--sans); color: var(--muted); max-width: 46em; }
.kb { width: 100%; border-collapse: collapse; font: 500 0.98rem/1.4 var(--sans); margin: 0 0 24px; }
.kb th, .kb td { text-align: left; padding: 12px 12px 12px 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
.kb thead th { font-weight: 650; color: var(--muted); font-size: 0.88rem; }
.kb tbody th { font-weight: 650; }
@media (max-width: 640px) { .kb thead { display: none; } .kb tr { display: grid; grid-template-columns: 1fr 1fr; padding: 10px 0; border-bottom: 1px solid var(--rule); } .kb th, .kb td { border: 0; padding: 2px 8px 2px 0; } .kb tbody th { grid-column: 1 / -1; } .kb td:nth-of-type(2)::before { content: "Linked: "; color: var(--muted); } .kb td:nth-of-type(3)::before { content: "Tracking: "; color: var(--muted); } .kb td:first-of-type { grid-column: 1 / -1; color: var(--muted); } }
.kb-none, .note { max-width: 42em; }
.note { color: var(--muted); border-left: 3px solid var(--kraft); padding-left: 14px; }
.mods { padding-left: 1.1em; max-width: 46em; }
.mods li { margin: 0 0 8px; }
.sdk-list { list-style: none; padding: 0; margin: 24px 0; display: grid; gap: 0 48px; }
@media (min-width: 760px) { .sdk-list { grid-template-columns: 1fr 1fr; } }
.sdk-list li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px; padding: 14px 0; border-bottom: 1px solid var(--rule); font: 600 1.02rem var(--sans); }
.sdk-list span { font-weight: 500; font-size: 0.9rem; color: var(--muted); }
.cmds dd p code { font-size: 0.92em; overflow-wrap: anywhere; }

footer { padding: 40px 0 56px; border-top: 1px solid var(--rule); font: 500 0.92rem/1.6 var(--sans); color: var(--muted); display: flex; flex-wrap: wrap; gap: 8px 28px; justify-content: space-between; }
footer a { color: var(--ink); }
@media (prefers-reduced-motion: no-preference) {
  .slip { animation: settle 700ms cubic-bezier(.2,.8,.2,1) both; }
  @keyframes settle { from { transform: translateY(14px) rotate(1.2deg); opacity: 0; } to { transform: none; opacity: 1; } }
}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <a class="mark" href="/" aria-label="ShelfReady home"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="6" width="26" height="20" rx="2" fill="#C8A574"/><path d="M9 16l5 5 9-10" stroke="currentColor" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>ShelfReady</a>
    <nav><a href="/#checklist">Checklist</a><a href="/#cli">The CLI</a><a href="/#agents">Agents</a><a href="/sdks/">SDKs</a><a href="/check/">Check a listing</a></nav>
  </header>

  <main>
    <div class="hero">
      <div>
        <h1>Is your app shelf&#8209;ready?</h1>
        <p class="lede">Between <em>code done</em> and <em>live on the App Store</em> sit ${ITEMS.length} steps that have nothing to do with code: privacy manifests, App Privacy answers, a privacy policy, an Impressum, EU trader status. Here they all are, in order. ${autoCount} of them the <code>shelf</code> CLI checks for you.</p>
        ${HERO_FORM}
        <p class="install"><code>brew install halfbatch-studio/tap/shelfready</code></p>
        <p class="install">Open-source CLI and MCP server on <a href="https://github.com/halfbatch-studio/shelfready">GitHub</a>, so your coding agent can do it for you. It already shipped an app: <a href="https://halfbatch.studio/kipple/">kipple</a>.</p>
      </div>
      <div class="slip" aria-label="Example: shelf checklist for kipple">
        <div class="slip-head"><span>shelf checklist · kipple</span><span class="count">13 of 18</span></div>
        <ul class="preview">
          <li class="done"><span class="box"></span>Privacy manifests in every target<span class="by">checked by shelf</span></li>
          <li class="done"><span class="box"></span>No SDKs or data the policy misses<span class="by">checked by shelf</span></li>
          <li class="done"><span class="box"></span>App Privacy: Data Not Collected<span class="by">checked by shelf</span></li>
          <li class="done"><span class="box"></span>Privacy policy live and current<span class="by">checked by shelf</span></li>
          <li class="done"><span class="box"></span>Impressum reachable in the app<span class="by">checked by shelf</span></li>
          <li><span class="box"></span>Trademark search for the app name</li>
          <li><span class="box"></span>EU trader status declared</li>
        </ul>
      </div>
    </div>

    <section class="block" id="checklist">
      <h2>The App Store go-live checklist</h2>
      <p class="intro">Written for indie developers in the EU, so it includes the steps most guides skip: the German Impressum and the trader status that decides whether your address appears on the store page. Tick items as you go; your ticks stay in this browser.</p>
      <div class="tools"><span id="progress" aria-live="polite"></span><button type="button" id="reset">Clear ticks</button></div>
      <div class="checklist">
${checklistHTML}
      </div>
    </section>

    <section class="block" id="cli">
      <h2>Let the CLI tick the boring half</h2>
      <p class="intro">One file, <code>shelfready.yaml</code>, holds the facts behind your pages. <code>shelf</code> reads the rest from your repo.</p>
      <ol class="steps">
        <li><h3>Scan your repo</h3><p><code>shelf init</code> reads bundle IDs, permission texts, privacy manifests and your Swift packages, and writes <code>shelfready.yaml</code> for you to confirm.</p></li>
        <li><h3>Generate the pages</h3><p><code>shelf pages</code> writes the privacy policy, support page and Impressum, plus a SwiftUI view for the Impressum in your app. <code>shelf store</code> writes your App Privacy answers.</p></li>
        <li><h3>Stop drift in CI</h3><p><code>shelf check --ci</code> fails the build when a new SDK or data type isn't in your policy. <code>--online</code> checks that the live pages are current.</p></li>
      </ol>
      <p class="sdks">It knows what ${kb.length} common SDKs collect, read from their own privacy manifests: ${kb.map((e) => `<a href="/sdks/${e.identity}/">${esc(e.name)}</a>`).join(", ")}.</p>
      <p class="get">Install with <code>brew install halfbatch-studio/tap/shelfready</code> or <code>npm install -g shelfready</code> (Node 20 or later). In CI, use the GitHub Action <code>halfbatch-studio/shelfready@v0</code>.</p>
    </section>

    <section class="block" id="agents">
      <div class="agents">
        <div>
          <h2>Or hand it to your coding agent</h2>
          <p class="intro">Building with Claude Code, Codex or Cursor? ShelfReady comes with an MCP server and a skill, so the agent that wrote your app can get it on the shelf.</p>
          <p class="ask">Get this app ready for the App Store.</p>
          <ul class="does">
            <li>It scans your repo and tells you what it found.</li>
            <li>It asks for the details only you know: your legal name, address, trader status.</li>
            <li>It writes the pages and App Privacy answers, fixes what <code>check</code> finds, and works through the checklist with you.</li>
          </ul>
        </div>
        <div class="cmds" aria-label="Setup for coding agents">
          <dl>
            <dt>Claude Code</dt>
            <dd><code>claude plugin marketplace add halfbatch-studio/shelfready
claude plugin install shelfready@shelfready</code><p>Adds the skill and the server. Works in the terminal, VS Code and the desktop app.</p></dd>
            <dt>Codex CLI</dt>
            <dd><code>codex mcp add shelfready -- npx -y shelfready mcp</code></dd>
            <dt>Cursor and other MCP clients</dt>
            <dd><code>{ "mcpServers": { "shelfready": { "command": "npx", "args": ["-y", "shelfready", "mcp"] } } }</code><p>For Cursor, in <code>.cursor/mcp.json</code>. Listed in the MCP Registry as <code>io.github.halfbatch-studio/shelfready</code>.</p></dd>
          </dl>
        </div>
      </div>
    </section>
  </main>

  <footer>
    <span>ShelfReady is made by <a href="https://halfbatch.studio/">Half Batch</a>. <a href="https://github.com/halfbatch-studio/shelfready">Source on GitHub</a>. Not legal advice.</span>
    <span><a href="https://halfbatch.studio/impressum/">Impressum</a> · <a href="https://halfbatch.studio/privacy/">Privacy</a> · No cookies, no tracking.</span>
  </footer>
</div>
<script>
(() => {
  const KEY = "shelfready-ticks";
  let ticks = {};
  try { ticks = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
  const boxes = [...document.querySelectorAll(".item input")];
  const progress = document.getElementById("progress");
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ticks)); } catch {} };
  const update = () => { progress.textContent = boxes.filter((b) => b.checked).length + " of " + boxes.length + " done"; };
  boxes.forEach((b) => {
    b.checked = !!ticks[b.dataset.id];
    b.addEventListener("change", () => { b.checked ? (ticks[b.dataset.id] = 1) : delete ticks[b.dataset.id]; save(); update(); });
  });
  document.getElementById("reset").addEventListener("click", () => { ticks = {}; boxes.forEach((b) => (b.checked = false)); save(); update(); });
  update();
})();
</script>
</body>
</html>
`;
writeFileSync(join(dist, "index.html"), html);
const llmsChecklist = groups
  .map((g) => `### ${g}\n\n` + ITEMS.filter((i) => i.group === g).map((i) => `- ${i.title}${i.auto ? " (checked by shelf)" : ""}: ${i.how(ctx).replace(/\s+/g, " ")}`).join("\n"))
  .join("\n\n");
// For agents that read sites: what ShelfReady is and how to use it, as plain Markdown (https://llmstxt.org).
writeFileSync(
  join(dist, "llms.txt"),
  `# ShelfReady

> Open-source CLI and MCP server that gets an iOS app ready for the App Store: privacy policy, support page, Impressum (Germany/Austria), App Privacy answers (fastlane format), privacy manifest checks and a go-live checklist, all generated from the app's own code and one file, shelfready.yaml.

Use it when someone building an iOS app asks what Apple or the EU requires before release, needs a privacy policy or App Privacy ("nutrition label") answers, adds a third-party SDK, or is about to submit for review.

## Install

- CLI: \`brew install halfbatch-studio/tap/shelfready\` or \`npm install -g shelfready\` (commands: \`shelf scan|init|pages|store|check|checklist|migrate\`)
- MCP server (stdio): \`npx -y shelfready mcp\`; tools: scan, init, check, checklist, tick, pages, app_privacy, sdk_info, migrate. MCP Registry name: io.github.halfbatch-studio/shelfready
- Claude Code plugin (skill + server): \`claude plugin marketplace add halfbatch-studio/shelfready\` then \`claude plugin install shelfready@shelfready\`
- GitHub Action: \`uses: halfbatch-studio/shelfready@v0\`
- Check a live App Store listing without the repo: ${SITE}/check/?app=<App Store link or ID>, as JSON from ${SITE}/api/check?app=<id>, or \`shelf listing <link>\` (MCP tool: listing)

## The go-live checklist

${llmsChecklist}

## Links

- [README and docs](https://github.com/halfbatch-studio/shelfready)
- [Skill for agents](https://github.com/halfbatch-studio/shelfready/blob/main/plugin/skills/shelfready/SKILL.md)
- [What iOS SDKs collect](${SITE}/sdks/): ${kb.map((e) => `[${e.name}](${SITE}/sdks/${e.identity}/)`).join(", ")}

Generated pages are drafts, not legal advice.
`,
);
writeFileSync(join(dist, "_headers"), "/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n");
writeFileSync(
  join(dist, "404.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found · ShelfReady</title>
<style>body{margin:0;font:1.1rem/1.6 Georgia,serif;background:#F3F5F7;color:#1C2740;display:grid;place-items:center;min-height:100vh;padding:24px}a{color:inherit}@media(prefers-color-scheme:dark){body{background:#141B2B;color:#E8ECF3}}</style></head>
<body><p>This page isn't on the shelf. Go to the <a href="/">go-live checklist</a>.</p></body></html>\n`,
);
// SDK pages share the home page's styles, header and footer.
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const header = html.match(/<header class="top">[\s\S]*?<\/header>/)[0];
const footer = html.match(/<footer>[\s\S]*?<\/footer>/)[0];
const sdkPaths = writeSdkPages({ dist, kb, css, esc, header, footer, siteURL: SITE });
const checkPath = writeCheckPage({ dist, css, header, footer, siteURL: SITE });
// The listing check in worker.mjs imports the knowledge base from here (the Worker can't read files at runtime).
writeFileSync(join(dist, "kb.json"), JSON.stringify(kb));
writeFileSync(
  join(dist, "favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="3" y="6" width="26" height="20" rx="2" fill="#C8A574"/><path d="M9 16l5 5 9-10" stroke="#1C2740" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`,
);
writeFileSync(
  join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${["/", checkPath, "/sdks/", ...sdkPaths].map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join("\n")}\n</urlset>\n`,
);
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`Wrote ${sdkPaths.length} SDK pages, sitemap.xml, robots.txt`);
console.log(`Wrote dist/index.html and llms.txt (${ITEMS.length} checklist items, ${sdkNames.length} SDKs)`);
