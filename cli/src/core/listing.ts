// Checks a live App Store listing from the outside: no repo needed.
// Reads the product page's embedded data (privacy label, links, EU trader details), then fetches the
// privacy policy, support page and developer website. Uses only `fetch`, so the Cloudflare Worker behind
// shelfready.dev/check runs the same code as `shelf listing`. Import types only from other modules here.
import type { KnowledgeEntry } from "./knowledge.js";

export interface ListingFacts {
  id: string;
  url: string;
  title: string;
  seller: string;
  /** EU trader status as the listing shows it; null when the page has no EU provider section. */
  trader: boolean | null;
  traderDetails: { address?: string; phone?: string; email?: string; duns?: string };
  price: number | null;
  currency: string | null;
  inAppPurchases: boolean;
  /** Privacy label: DATA_USED_TO_TRACK_YOU, DATA_LINKED_TO_YOU, DATA_NOT_LINKED_TO_YOU or DATA_NOT_COLLECTED, with categories. */
  privacy: { type: string; categories: string[] }[];
  privacyPolicyURL?: string;
  supportURL?: string;
  websiteURL?: string;
}

export type ListingLevel = "ok" | "warn" | "error" | "info";
export interface ListingFinding {
  level: ListingLevel;
  rule: string;
  title: string;
  detail?: string;
  fix?: string;
}
export interface ListingReport {
  app: ListingFacts;
  findings: ListingFinding[];
  passed: number;
  total: number;
  checkedAt: string;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const CATEGORY_TITLE: Record<string, string> = {
  CONTACT_INFO: "Contact Info", HEALTH_AND_FITNESS: "Health & Fitness", FINANCIAL_INFO: "Financial Info", LOCATION: "Location",
  SENSITIVE_INFO: "Sensitive Info", CONTACTS: "Contacts", USER_CONTENT: "User Content", BROWSING_HISTORY: "Browsing History",
  SEARCH_HISTORY: "Search History", IDENTIFIERS: "Identifiers", PURCHASES: "Purchases", USAGE_DATA: "Usage Data",
  DIAGNOSTICS: "Diagnostics", OTHER: "Other Data",
};

/** Privacy manifest data types → the App Privacy label category they fall under. */
const TYPE_CATEGORY: Record<string, string> = {
  Name: "CONTACT_INFO", EmailAddress: "CONTACT_INFO", PhoneNumber: "CONTACT_INFO", PhysicalAddress: "CONTACT_INFO", OtherUserContactInfo: "CONTACT_INFO",
  Health: "HEALTH_AND_FITNESS", Fitness: "HEALTH_AND_FITNESS",
  PaymentInfo: "FINANCIAL_INFO", CreditInfo: "FINANCIAL_INFO", OtherFinancialInfo: "FINANCIAL_INFO",
  PreciseLocation: "LOCATION", CoarseLocation: "LOCATION", SensitiveInfo: "SENSITIVE_INFO", Contacts: "CONTACTS",
  EmailsOrTextMessages: "USER_CONTENT", PhotosorVideos: "USER_CONTENT", AudioData: "USER_CONTENT", GameplayContent: "USER_CONTENT",
  CustomerSupport: "USER_CONTENT", OtherUserContent: "USER_CONTENT", BrowsingHistory: "BROWSING_HISTORY", SearchHistory: "SEARCH_HISTORY",
  UserID: "IDENTIFIERS", DeviceID: "IDENTIFIERS", PurchaseHistory: "PURCHASES",
  ProductInteraction: "USAGE_DATA", AdvertisingData: "USAGE_DATA", OtherUsageData: "USAGE_DATA",
  CrashData: "DIAGNOSTICS", PerformanceData: "DIAGNOSTICS", OtherDiagnosticData: "DIAGNOSTICS", OtherDataTypes: "OTHER",
};
export const categoryOfType = (t: string) => TYPE_CATEGORY[t.replace(/^NSPrivacyCollectedDataType/, "")];

/** Names that are ordinary words; only match them with their vendor in front. */
const SDK_MATCH_OVERRIDES: Record<string, RegExp> = {
  "analytics-swift": /\b(Twilio Segment|Segment\.io|segment\.com)\b/,
  "realm-swift": /\bRealm (Swift|Database|Sync)\b|\bMongoDB Realm\b/,
  "lottie-ios": /\bLottie\b/,
  swiftsdk: /\bTelemetryDeck\b/,
};

/** An App Store link or a bare numeric ID → the app's ID. */
export function appIdFrom(input: string): string | null {
  const s = input.trim();
  if (/^\d{5,12}$/.test(s)) return s;
  const m = s.match(/(?:^|[/=])id(\d{5,12})(?:\b|$)/);
  if (m && /apple\.com|^id\d/i.test(s)) return m[1]!;
  return null;
}

/** The German storefront shows the EU trader section; English text keeps parsing language-independent enough. */
export const listingURL = (id: string, storefront = "de") => `https://apps.apple.com/${storefront}/app/id${id}?l=en-GB`;

type Json = Record<string, any>;

function serverData(html: string): Json {
  const m = html.match(/<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("This page has no App Store listing data.");
  const parsed = JSON.parse(m[1]!) as Json;
  const d = parsed?.data?.[0]?.data;
  if (!d?.shelfMapping) throw new Error("The App Store listing data has an unexpected shape.");
  return d;
}

function jsonLd(html: string): Json[] {
  return [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => {
    try {
      return [JSON.parse(m[1]!) as Json];
    } catch {
      return [];
    }
  });
}

/** Facts from an App Store product page's HTML. Throws when the page has no listing data. */
export function parseListing(html: string, id: string): ListingFacts {
  const d = serverData(html);
  const sm = d.shelfMapping as Json;
  const product = jsonLd(html).find((x) => x.offers || x["@type"] === "SoftwareApplication") ?? {};

  const info: Json[] = sm.information?.items ?? [];
  const texts = (i: Json): string[] => (i.items ?? []).filter((x: Json) => x.linkableText).map((x: Json) => String(x.linkableText.styledText?.rawText ?? ""));
  const provider = info.find((i) => texts(i).some((t) => /identified itself as a trader|als Händler/i.test(t)));
  let trader: boolean | null = null;
  const traderDetails: ListingFacts["traderDetails"] = {};
  if (provider) {
    const all = texts(provider);
    trader = !all.some((t) => /has not identified itself as a trader|nicht als Händler/i.test(t));
    for (const t of all) {
      const m = t.match(/^\*\*([^*]+)\*\*\n([\s\S]+)$/);
      if (!m) continue;
      const label = m[1]!.toLowerCase();
      const value = m[2]!.trim();
      if (/address|adresse/.test(label)) traderDetails.address = value;
      else if (/phone|telefon/.test(label)) traderDetails.phone = value;
      else if (/mail/.test(label)) traderDetails.email = value;
      else if (/duns/.test(label)) traderDetails.duns = value;
    }
  }

  const policy = Object.values((sm.privacyHeader?.items?.[0]?.bodyText?.linkedSubstrings ?? {}) as Record<string, Json>).map((a) => a?.url).find(Boolean);
  const devLinks: string[] = (sm.description?.items?.[0]?.developerLinks ?? []).map((l: Json) => l?.clickAction?.url).filter(Boolean);
  const offer = product.offers ?? {};
  const price = typeof offer.price === "number" ? offer.price : offer.price != null ? Number(offer.price) : null;

  return {
    id,
    url: String(d.canonicalURL ?? listingURL(id)).replace(/\?l=en-GB$/, ""),
    title: String(d.title ?? product.name ?? ""),
    seller: String(provider?.summary ?? product.author?.name ?? ""),
    trader,
    traderDetails,
    price: Number.isFinite(price) ? price : null,
    currency: offer.priceCurrency ?? null,
    inAppPurchases: info.some((i) => /In-App Purchases|In-App-Käufe/i.test(String(i.title ?? ""))),
    privacy: (sm.privacyTypes?.items ?? []).map((t: Json) => ({ type: String(t.identifier), categories: (t.categories ?? []).map((c: Json) => String(c.identifier)) })),
    ...(policy ? { privacyPolicyURL: String(policy) } : {}),
    ...(devLinks[0] ? { websiteURL: devLinks[0] } : {}),
    ...(devLinks[1] ? { supportURL: devLinks[1] } : {}),
  };
}

interface Page {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
  html?: string;
  text?: string;
}

const UA = "ShelfReady listing check (+https://shelfready.dev/check/)";

/** Only public http(s) URLs: no credentials, no local or private addresses. */
export function isPublicURL(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return false;
  if (/^(10|127|0)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return false;
  if (h.includes(":")) return false; // IPv6 literals
  return true;
}

async function getPage(fetch: Fetch, url: string): Promise<Page> {
  if (!isPublicURL(url)) return { url, ok: false, error: "not a public web address" };
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
    const type = res.headers.get("content-type") ?? "";
    let html: string | undefined;
    if (res.ok && /html|text\/plain/.test(type)) {
      const body = await res.text();
      html = body.slice(0, 1_500_000);
    }
    return { url, ok: res.ok, status: res.status, ...(html ? { html, text: htmlText(html) } : {}) };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" || e.name === "AbortError" ? "timed out after 8 seconds" : e.message) : String(e);
    return { url, ok: false, error: msg };
  }
}

export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

const EU_DE_AT = /\b(Germany|Deutschland|Austria|Österreich)\s*$/i;
const DATE = /(\b\d{1,2}[./]\s?\d{1,2}[./]\s?\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\.?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Januar|Februar|März|Mai|Juni|Juli|Oktober|Dezember)\s+\d{4}\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b)/i;

/** SDKs from the knowledge base that the text names, with the label categories their manifests imply. */
export function sdksMentioned(text: string, kb: KnowledgeEntry[]): { entry: KnowledgeEntry; categories: string[] }[] {
  const out: { entry: KnowledgeEntry; categories: string[] }[] = [];
  for (const e of kb) {
    const re = SDK_MATCH_OVERRIDES[e.identity] ?? new RegExp(`\\b${e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (!re.test(text)) continue;
    const categories = [...new Set(e.products.flatMap((p) => p.collects.map((c) => categoryOfType(c.type))).filter((c): c is string => !!c))];
    out.push({ entry: e, categories });
  }
  return out;
}

/** Run every check on a live listing. `fetch` is injected so tests (and the Worker) control the network. */
export async function checkListing(input: string, opts: { fetch: Fetch; kb?: KnowledgeEntry[]; storefront?: string }): Promise<ListingReport> {
  const id = appIdFrom(input);
  if (!id) throw new Error("Paste an App Store link (apps.apple.com/…/id123456789) or the app's numeric ID.");
  let res: Response;
  try {
    res = await opts.fetch(listingURL(id, opts.storefront), { headers: { "user-agent": UA, "accept-language": "en-GB,en;q=0.8" }, signal: AbortSignal.timeout(10000) });
  } catch {
    throw new Error("Couldn't reach the App Store. Try again in a minute.");
  }
  if (res.status === 404) throw new Error(`No app with ID ${id} on the ${(opts.storefront ?? "de").toUpperCase()} App Store. It may not be released there yet.`);
  if (!res.ok) throw new Error(`The App Store answered ${res.status}. Try again in a minute.`);
  const app = parseListing(await res.text(), id);
  const findings: ListingFinding[] = [];
  const add = (f: ListingFinding) => findings.push(f);

  // Privacy policy
  const [policy, support, website] = await Promise.all([
    app.privacyPolicyURL ? getPage(opts.fetch, app.privacyPolicyURL) : Promise.resolve(undefined),
    app.supportURL ? getPage(opts.fetch, app.supportURL) : Promise.resolve(undefined),
    app.websiteURL && app.trader && EU_DE_AT.test(app.traderDetails.address ?? "") ? getPage(opts.fetch, app.websiteURL) : Promise.resolve(undefined),
  ]);
  if (!app.privacyPolicyURL) {
    add({ level: "error", rule: "policy.missing", title: "No privacy policy link on the listing", fix: "Add a privacy policy URL in App Store Connect › App Privacy. Apple requires one for every app." });
  } else if (!policy?.ok) {
    add({ level: "error", rule: "policy.unreachable", title: "Privacy policy doesn't load", detail: `${app.privacyPolicyURL}: ${policy?.error ?? `HTTP ${policy?.status}`}`, fix: "Fix the page or the URL in App Store Connect. A broken link is a common rejection reason." });
  } else {
    add({ level: "ok", rule: "policy.live", title: "Privacy policy loads", detail: app.privacyPolicyURL });
    if (!app.privacyPolicyURL.startsWith("https://")) add({ level: "warn", rule: "policy.http", title: "Privacy policy isn't served over HTTPS", fix: "Serve the page over HTTPS." });
    const text = policy.text ?? "";
    if (text.length < 400) add({ level: "warn", rule: "policy.thin", title: "Privacy policy page has very little text", detail: "It may be rendered by JavaScript, or be a placeholder.", fix: "Make sure the policy is readable without JavaScript." });
    if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text) || /contact|kontakt/i.test(text)) add({ level: "ok", rule: "policy.contact", title: "Privacy policy says how to reach you" });
    else add({ level: "warn", rule: "policy.contact", title: "Privacy policy gives no contact", fix: "The GDPR asks for the controller's contact details. Add an email address." });
    if (/(last updated|updated on|effective|stand|zuletzt|aktualisiert|version)/i.test(text) && DATE.test(text)) add({ level: "ok", rule: "policy.date", title: "Privacy policy is dated" });
    else add({ level: "warn", rule: "policy.date", title: "Privacy policy has no date", fix: "Add a \"Last updated\" date so readers know which version they agreed to." });
  }

  // Support page
  if (!app.supportURL) add({ level: "error", rule: "support.missing", title: "No support link on the listing", fix: "Add a support URL in App Store Connect › App Information." });
  else if (!support?.ok) add({ level: "error", rule: "support.unreachable", title: "Support page doesn't load", detail: `${app.supportURL}: ${support?.error ?? `HTTP ${support?.status}`}`, fix: "Fix the page or the URL in App Store Connect." });
  else add({ level: "ok", rule: "support.live", title: "Support page loads", detail: app.supportURL });

  // EU trader status
  const charges = (app.price ?? 0) > 0 || app.inAppPurchases;
  if (app.trader === null) {
    add({ level: "info", rule: "trader.unknown", title: "No EU trader information on the listing", detail: "The app may not be offered in the EU." });
  } else if (app.trader) {
    const missing = (["address", "phone", "email"] as const).filter((k) => !app.traderDetails[k]);
    if (missing.length) add({ level: "warn", rule: "trader.incomplete", title: "Trader details are incomplete", detail: `Missing: ${missing.join(", ")}.`, fix: "App Store Connect › Business › Compliance: add the missing details." });
    else add({ level: "ok", rule: "trader.declared", title: "Declared as an EU trader, with address, phone and email" });
  } else if (charges) {
    add({ level: "warn", rule: "trader.charging", title: `Not declared as a trader, but the app ${app.inAppPurchases ? "has in-app purchases" : "costs money"}`, detail: "Selling to EU consumers usually makes you a trader under the Digital Services Act.", fix: "Check your status and update it in App Store Connect › Business. Not legal advice." });
  } else {
    add({ level: "ok", rule: "trader.non-trader", title: "Declared as a non-trader, which fits a free app" });
  }

  // Impressum for German and Austrian traders
  if (website) {
    const hasImpressum = /impressum|imprint|legal notice|legal-notice/i.test(website.html ?? "");
    if (hasImpressum) add({ level: "ok", rule: "impressum.web", title: "Website links an Impressum" });
    else add({ level: "warn", rule: "impressum.web", title: "No Impressum on the developer website", detail: app.websiteURL, fix: "German and Austrian traders need an Impressum one click away, on the web and inside the app. `shelf pages` writes one." });
  }

  // Privacy label vs what the policy names
  const label = new Set(app.privacy.flatMap((p) => p.categories));
  const notCollected = app.privacy.some((p) => p.type === "DATA_NOT_COLLECTED");
  if (!app.privacy.length) add({ level: "warn", rule: "label.missing", title: "No App Privacy label shown", fix: "Answer the App Privacy questions in App Store Connect." });
  else add({ level: "ok", rule: "label.present", title: notCollected ? "App Privacy label: Data Not Collected" : `App Privacy label lists ${label.size} categor${label.size === 1 ? "y" : "ies"}`, detail: [...label].map((c) => CATEGORY_TITLE[c] ?? c).join(", ") || undefined });
  if (app.privacy.some((p) => p.type === "DATA_USED_TO_TRACK_YOU")) add({ level: "info", rule: "label.tracking", title: "The label declares tracking", detail: "The app must ask for permission with App Tracking Transparency before tracking." });
  if (policy?.text && opts.kb?.length) {
    for (const { entry, categories } of sdksMentioned(policy.text, opts.kb)) {
      const missing = categories.filter((c) => !label.has(c));
      if (!categories.length) continue;
      if (missing.length) {
        add({
          level: "warn",
          rule: "label.sdk",
          title: `The policy names ${entry.name}, but the label doesn't list ${missing.map((c) => CATEGORY_TITLE[c] ?? c).join(", ")}`,
          detail: `${entry.name}'s own privacy manifest declares data in ${categories.map((c) => CATEGORY_TITLE[c] ?? c).join(", ")}. See shelfready.dev/sdks/${entry.identity}/`,
          fix: "If the app ships this SDK, update App Privacy in App Store Connect. `shelf store` derives the answers from your manifests.",
        });
      } else {
        add({ level: "ok", rule: "label.sdk", title: `The label covers what ${entry.name} declares` });
      }
    }
  }

  const scored = findings.filter((f) => f.level !== "info");
  return { app, findings, passed: scored.filter((f) => f.level === "ok").length, total: scored.length, checkedAt: new Date().toISOString() };
}
