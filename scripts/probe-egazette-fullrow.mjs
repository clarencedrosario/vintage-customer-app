// Full-row probe: fetch one RecentUploads row region, print the anchor
// + surrounding cell text verbatim, derive the static PDF URL from the
// gazette ID, and GET it. Evidence for whether a single listing row
// carries enough signal (subject, ministry, dates, gazette id) for the
// discovery pipeline to identity-check + validate without a viewer.
import https from "node:https";
import zlib from "node:zlib";
import { GAZETTE_CA_PEMS } from "./gazette-ca-pems.js";

const HOST = "https://egazette.gov.in";
const get = (url, h = {}) =>
  new Promise((res) => {
    const req = https.request(
      url,
      { ca: GAZETTE_CA_PEMS, headers: { "User-Agent": "Advokate-legal-intel/0.2", ...h } },
      (r) => {
        const cs = [];
        r.on("data", (c) => cs.push(c));
        r.on("end", () => {
          let b = Buffer.concat(cs);
          if ((r.headers["content-encoding"] ?? "").toLowerCase() === "gzip") {
            try { b = zlib.gunzipSync(b); } catch { /* keep raw */ }
          }
          res({ status: r.statusCode ?? 0, bytes: b });
        });
      },
    );
    req.on("error", (e) => res({ error: e.message }));
    req.end();
  });

const root = await get(HOST);
const seed = new URL(root.loc, HOST).href;
const seedBase = seed.replace(/default\.aspx$/, "");
const listing = await get(new URL("RecentUploads.aspx?Category=1", seedBase).href, {
  Referer: seed,
});
const realListing = listing.status === 302
  ? await get(listing.loc ?? listing.bytes.toString("utf-8").match(/href=\"([^\"]+)\"/)?.[1] ?? new URL("RecentUploads.aspx?Category=1", seedBase).href, { Referer: seed })
  : listing;
const html = (realListing.bytes ?? listing.bytes).toString("utf-8");

// Show one full row (from one gazette-id match to the next).
const idx = html.indexOf("CG-");
const next = html.indexOf("CG-", idx + 10);
const row = html.slice(Math.max(0, idx - 2000), next);
console.log("ROW-REGION-SNIPPET-START");
console.log(row.slice(0, 4000));
console.log("ROW-REGION-SNIPPET-END");

// The gazette id present in the row.
const m = /CG-[A-Z0-9]{2,6}-[A-Z]-\d{8}-\d{6}/.exec(html);
if (!m) { console.log("NO-ID"); process.exit(0); }
const mm = /CG-(?:[A-Z0-9]{2,6})-([A-Z])-(\d{2})(\d{2})(\d{4})-(\d{6})/.exec(m[0]);
// Static derivation (as verified).
const url = `${HOST}/WriteReadData/${mm[4]}/${mm[5]}.pdf`;
const pdf = await get(url, { Accept: "application/pdf" });
const buf = pdf.bytes ?? Buffer.alloc(0);
console.log(JSON.stringify({
  rowGazetteId: m[0],
  staticDerivation: {
    url,
    status: pdf.status,
    isPdf: buf.subarray(0, 5).toString() === "%PDF-",
    bytes: buf.byteLength,
  },
}));
