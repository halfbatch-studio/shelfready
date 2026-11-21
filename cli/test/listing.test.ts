import { test } from "node:test";
import assert from "node:assert/strict";
import { appIdFrom, checkListing, isPublicURL, knowledgeBase, parseListing, sdksMentioned, type Fetch } from "../src/index.js";

import { appStorePage, type Opts } from "./fixtures/appstore.js";

const POLICY = `<html><body><h1>Privacy policy</h1><p>Last updated: 18 November 2026</p><p>${"We care about your privacy. ".repeat(20)}</p><p>Contact: hello@example.com</p></body></html>`;

function fakeFetch(pages: Record<string, { status?: number; body?: string; type?: string } | Error>): Fetch {
  return async (url) => {
    const key = Object.keys(pages).filter((k) => url.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    const p = key ? pages[key] : { status: 404, body: "not found" };
    if (p instanceof Error) throw p;
    return new Response(p!.body ?? "", { status: p!.status ?? 200, headers: { "content-type": p!.type ?? "text/html" } });
  };
}
const site = (extra: Record<string, { status?: number; body?: string } | Error> = {}, listing: Opts = {}) =>
  fakeFetch({ "https://apps.apple.com/": { body: appStorePage(listing) }, "https://example.com/privacy": { body: POLICY }, "https://example.com/support": { body: "<p>Support</p>" }, "https://example.com/": { body: '<a href="/impressum">Impressum</a>' }, ...extra });

const rule = (r: Awaited<ReturnType<typeof checkListing>>, name: string) => r.findings.filter((f) => f.rule === name);

test("listing: app IDs from links and numbers", () => {
  assert.equal(appIdFrom("https://apps.apple.com/de/app/things-3/id904237743?l=en-GB"), "904237743");
  assert.equal(appIdFrom("apps.apple.com/us/app/id1508732804"), "1508732804");
  assert.equal(appIdFrom(" 904237743 "), "904237743");
  assert.equal(appIdFrom("id904237743"), "904237743");
  assert.equal(appIdFrom("https://example.com/id904237743"), null);
  assert.equal(appIdFrom("things"), null);
});

test("listing: parses the product page", () => {
  const f = parseListing(appStorePage({ iap: true, price: 4.99, privacy: [{ type: "DATA_NOT_LINKED_TO_YOU", cats: ["DIAGNOSTICS"] }] }), "1234567890");
  assert.equal(f.title, "Example Notes");
  assert.equal(f.seller, "Example Apps GmbH");
  assert.equal(f.url, "https://apps.apple.com/de/app/example-notes/id1234567890");
  assert.equal(f.trader, true);
  assert.deepEqual(f.traderDetails, { address: "Musterstr. 1\n10115 Berlin\nGermany", phone: "+49 30 1234567", email: "hello@example.com" });
  assert.equal(f.price, 4.99);
  assert.equal(f.inAppPurchases, true);
  assert.deepEqual(f.privacy, [{ type: "DATA_NOT_LINKED_TO_YOU", categories: ["DIAGNOSTICS"] }]);
  assert.equal(f.privacyPolicyURL, "https://example.com/privacy");
  assert.equal(f.supportURL, "https://example.com/support");
  assert.equal(parseListing(appStorePage({ trader: "no" }), "1").trader, false);
  assert.equal(parseListing(appStorePage({ trader: "none" }), "1").trader, null);
  assert.throws(() => parseListing("<html>nothing</html>", "1"), /no App Store listing data/);
});

test("listing: a healthy German trader passes everything", async () => {
  const r = await checkListing("1234567890", { fetch: site(), kb: knowledgeBase() });
  assert.deepEqual(r.findings.filter((f) => f.level !== "ok"), []);
  assert.equal(r.passed, r.total);
  assert.ok(rule(r, "impressum.web").length, "checks the Impressum for a DE address");
});

test("listing: broken links and a thin policy", async () => {
  const r = await checkListing("1234567890", { fetch: site({ "https://example.com/privacy": { status: 404 }, "https://example.com/support": new Error("ECONNREFUSED") }) });
  assert.equal(rule(r, "policy.unreachable")[0]?.level, "error");
  assert.match(rule(r, "support.unreachable")[0]!.detail!, /ECONNREFUSED/);
  const thin = await checkListing("1234567890", { fetch: site({ "https://example.com/privacy": { body: "<p>We respect privacy.</p>" } }) });
  assert.deepEqual(["policy.thin", "policy.contact", "policy.date"].map((n) => rule(thin, n)[0]?.level), ["warn", "warn", "warn"]);
  const none = await checkListing("1234567890", { fetch: site({}, { policy: null, links: ["https://example.com/"] }) });
  assert.equal(rule(none, "policy.missing")[0]?.level, "error");
  assert.equal(rule(none, "support.missing")[0]?.level, "error");
});

test("listing: trader status against price and in-app purchases", async () => {
  const charging = await checkListing("1234567890", { fetch: site({}, { trader: "no", iap: true }) });
  assert.equal(rule(charging, "trader.charging")[0]?.level, "warn");
  const free = await checkListing("1234567890", { fetch: site({}, { trader: "no" }) });
  assert.equal(rule(free, "trader.non-trader")[0]?.level, "ok");
  assert.equal(rule(free, "impressum.web").length, 0, "no Impressum check without a DE/AT trader address");
  const us = await checkListing("1234567890", { fetch: site({}, { address: "1 Main St\nAustin Texas\nUnited States" }) });
  assert.equal(rule(us, "impressum.web").length, 0);
  const noImpressum = await checkListing("1234567890", { fetch: site({ "https://example.com/": { body: "<p>Home</p>" } }) });
  assert.equal(rule(noImpressum, "impressum.web")[0]?.level, "warn");
  // Impressum details on the Contact page count, as German courts accept a "Kontakt" link (the Things case).
  const onContact = await checkListing("1234567890", {
    fetch: site({
      "https://example.com/contact/": { body: "<p>Example Apps GmbH, Musterstr. 1, Berlin. Geschäftsführer: A. Example. VAT-ID: DE123456789, AG Berlin, HRB 12345</p>" },
      "https://example.com/": { body: '<a href="/features/">Features</a> <a href="/contact/">Contact</a> <a href="https://elsewhere.com/about">About them</a>' },
    }),
  });
  assert.equal(rule(onContact, "impressum.web")[0]?.level, "ok");
  assert.equal(rule(onContact, "impressum.web")[0]?.detail, "https://example.com/contact/");
  const offSite = await checkListing("1234567890", { fetch: site({ "https://example.com/": { body: '<a href="https://elsewhere.com/impressum">Impressum</a>' }, "https://elsewhere.com/impressum": { body: "<p>Impressum HRB 1</p>" } }) });
  assert.equal(rule(offSite, "impressum.web")[0]?.level, "ok", "a link labelled Impressum counts, wherever it points");
  const contactElsewhere = await checkListing("1234567890", { fetch: site({ "https://example.com/": { body: '<a href="https://elsewhere.com/contact">Contact</a>' }, "https://elsewhere.com/contact": { body: "<p>HRB 1, Geschäftsführer X</p>" } }) });
  assert.equal(rule(contactElsewhere, "impressum.web")[0]?.level, "warn", "only follows Contact/About links on the same site");
});

test("listing: the label must cover the SDKs the policy names", async () => {
  const policy = POLICY.replace("</body>", "<p>We use Sentry for crash reports.</p></body>");
  const r = await checkListing("1234567890", { fetch: site({ "https://example.com/privacy": { body: policy } }), kb: knowledgeBase() });
  const sdk = rule(r, "label.sdk")[0]!;
  assert.equal(sdk.level, "warn");
  assert.match(sdk.title, /Sentry.*Diagnostics/);
  const covered = await checkListing("1234567890", { fetch: site({ "https://example.com/privacy": { body: policy } }, { privacy: [{ type: "DATA_NOT_LINKED_TO_YOU", cats: ["DIAGNOSTICS", "IDENTIFIERS", "USAGE_DATA", "CONTACT_INFO", "USER_CONTENT", "OTHER"] }] }), kb: knowledgeBase() });
  assert.equal(rule(covered, "label.sdk")[0]?.level, "ok");
  assert.deepEqual(sdksMentioned("Customer segment analysis and realm of possibility", knowledgeBase()).map((x) => x.entry.identity), [], "common words don't match");
});

test("listing: not found and not public", async () => {
  await assert.rejects(checkListing("1234567890", { fetch: fakeFetch({ "https://apps.apple.com/": { status: 404 } }) }), /No app with ID 1234567890/);
  await assert.rejects(checkListing("hello", { fetch: site() }), /Paste an App Store link/);
  assert.equal(isPublicURL("https://example.com/privacy"), true);
  for (const u of ["http://localhost:3000", "http://192.168.1.2/", "http://10.0.0.1", "http://[::1]/", "file:///etc/passwd", "https://user:pw@example.com", "http://intranet/"]) assert.equal(isPublicURL(u), false, u);
  const r = await checkListing("1234567890", { fetch: site({}, { policy: "http://192.168.0.1/privacy" }) });
  assert.match(rule(r, "policy.unreachable")[0]!.detail!, /not a public web address/);
});

test("listing: App Store unreachable", async () => {
  await assert.rejects(checkListing("1234567890", { fetch: fakeFetch({ "https://apps.apple.com/": new Error("socket hang up") }) }), /Couldn't reach the App Store/);
});
