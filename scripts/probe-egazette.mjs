// =====================================================================
// eGazette REASSESSMENT probe — tests the TURN-26 PROVEN access path
// (static WriteReadData/<year>/<numeric-id>.pdf, plain GET, cookies
// NOT required — verified two-for-two on 276770/276769) against
// CURRENT listing rows, to determine whether the turn-33
// "encrypted postback" blocker still holds.
//
// Nothing bypassed: certificate verification ON with pinned PUBLIC
// Let's Encrypt anchors (same production anchors as gazetteCa.ts);
// the session-ID path is followed exactly as a browser is redirected;
// the listing is read as ordinary HTML.
// =====================================================================
import https from "node:https";
import zlib from "node:zlib";
import { GAZETTE_CA_PEMS } from "./gazette-ca-pems.js";

const HOST = "https://egazette.gov.in";
const UA =
  "Advokate-legal-intel/0.2 (authorized retrieval of open government publications)";

function get(url, headers = {}, timeoutMs = 45_000) {
  return new Promise((resolve) => {
    const req = https.request(
      url,
      { method: "GET", ca: GAZETTE_CA_PEMS, headers: { "User-Agent": UA, ...headers }, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          let bytes = Buffer.concat(chunks);
          if ((res.headers["content-encoding"] ?? "").toLowerCase() === "gzip") {
            try { bytes = zlib.gunzipSync(bytes); } catch { /* keep raw */ }
          }
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location ?? null,
            contentType: res.headers["content-type"] ?? "",
            bytes,
          });
        });
        res.on("error", (e) => resolve({ error: e.message }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ error: e.message }));
    req.end();
  });
}

session: {
  const root = await get(HOST, { Accept: "text/html" });
  if (root.error || root.status !== 302 || !root.location) {
    console.log(JSON.stringify({ rootProbe: root.error ?? root.status }));
    break session;
  }
  const seed = new URL(root.location, HOST).href;
  console.log(JSON.stringify({ sessionSeed: seed }));

  // LISTING: the turn-33 probe used the "recent gazettes" list. Its exact
  // URL is derived from the seed's base path; try the known list path.
  const listing = await get(seed, { Accept: "text/html" });
  const html = listing.bytes.toString("utf-8");
  console.log(JSON.stringify({
    listing: { status: listing.status, bytes: listing.bytes.byteLength, title: /<title>([^<]*)</.exec(html)?.[1] ?? null },
  }));

  // Collect gazette-id patterns from the listing rows (e.g.
  // CG-DL-E-07102026-276903 → numeric tail 276903; year from the date).
  const ids = new Set();
  for (const m of html.matchAll(/CG-\w+-\w+-(\d{2})(\d{2})(\d{4})-(\d{5,7})/g)) {
    ids.add({ day: m[1], month: m[2], year: m[3], num: m[4] });
  }
  // Also plain numeric pdf ids in links.
  for (const m of html.matchAll(/(?:WriteReadData\/(\d{4})\/)?([0-9]{6,7})\.pdf/g)) {
    if (!m[1]) ids.add({ year: "2026", num: m[2] });
  }
  const list = [...ids].slice(0, 3);
  console.log(JSON.stringify({ collectedSample: list }));

  // THE KEY TEST: static derivation, plain GET, no cookies sent.
  for (const c of list.filter((x) => x.num)) {
    const year = c.year ?? "2026";
    const url = `${HOST}/WriteReadData/${year}/${c.num}.pdf`;
    const r = await get(url, { Accept: "application/pdf,*/*" });
    const buf = r.bytes ?? Buffer.alloc(0);
    const isPdf = buf.subarray(0, 5).toString() === "%PDF-";
    console.log(JSON.stringify({
      staticDerivation: {
        url,
        status: r.status,
        contentType: r.contentType,
        isPdf,
        bytes: buf.byteLength,
        start: buf.subarray(0, 12).toString().replace(/[^\x20-\x7e]/g, "?"),
        error: r.error ?? null,
      },
    }));
    if (isPdf) {
      console.log(`STATIC-PDF-OBTAINABLE ${url} ${buf.byteLength}`);
      process.exit(0);
    }
  }
  console.log("STATIC-DERIVATION-FAILED");
}
