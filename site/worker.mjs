// shelfready.dev: static pages from ./dist, plus one API route for the listing check.
// /api/check?app=<App Store link or ID> runs the same check as `shelf listing` and returns JSON.
// Nothing is stored or logged; results are cached for an hour per app so repeated checks don't hit Apple.
import { appIdFrom, checkListing } from "../cli/dist/core/listing.js";
import kb from "./dist/kb.json";

const CACHE_SECONDS = 3600;
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": status === 200 ? `public, max-age=${CACHE_SECONDS}` : "no-store", ...extra },
  });

async function check(request, ctx) {
  const url = new URL(request.url);
  const input = url.searchParams.get("app") ?? "";
  const id = appIdFrom(input);
  if (!id) return json({ error: "Paste an App Store link (apps.apple.com/…/id123456789) or the app's numeric ID." }, 400);
  const cacheKey = new Request(`${url.origin}/api/check?app=${id}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit && !url.searchParams.has("fresh")) return hit;
  try {
    const report = await checkListing(id, { fetch: (u, init) => fetch(u, init), kb });
    const res = json(report);
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, /No app with ID/.test(message) ? 404 : 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/check") {
      if (request.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET" } });
      if (request.method !== "GET") return json({ error: "Use GET." }, 405);
      return check(request, ctx);
    }
    if (pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
};
