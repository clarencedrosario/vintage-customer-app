// Listing-shape probe v2 — same as the turn-32/33 sweep surface: follow
// the seed, load default.aspx (capturing its Set-Cookies if any), then
// GET RecentUploads.aspx WITH Referer, and test static derivations.
import https from "node:https";
import zlib from "node:zlib";
import { GAZETTE_CA_PEMS } from "./gazette-ca-pems.js";

const HOST = "https://egazette.gov.in";
const jar = new Map();

const get = (url, h = {}) =>
  new Promise((res) => {
    const req = https.request(
      url,
      {
        ca: GAZETTE_CA_PEMS,
        headers: {
          "User-Agent": "Advokate-legal-intel/0.2",
          Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
          ...h,
        },
      },
      (r) => {
        for (const line of r.headers["set-cookie"] ?? []) {
          const [pair] = line.split(";");
          const i = pair.indexOf("=");
          if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
        }
        const cs = [];
        r.on("data", (c) => cs.push(c));
        r.on("end", () => {
          let b = Buffer.concat(cs);
          if ((r.headers["content-encoding"] ?? "").toLowerCase() === "gzip") {
            try { b = zlib.gunzipSync(b); } catch { /* keep raw */ }
          }
          res({ status: r.statusCode ?? 0, loc: r.headers.location ?? null, bytes: b });
        });
      },
    );
    req.on("error", (e) => res({ error: e.message }));
    req.end();
  });

const root = await get(HOST);
let seed = root.loc ? new URL(root.loc, HOST).href : HOST;
console.log(JSON.stringify({ seed, cookies: [...jar.keys()] }));
const home = await get(seed + "/default.aspx", { Referer: HOST });
console.log(JSON.stringify({
  home: { status: home.status, len: (home.bytes ?? Buffer.alloc(0)).byteLength, cookiesAfterHome: [...jar.keys()] },
}));

const listing = await get(seed + "/RecentUploads.aspx?Category=1", { Referer: seed + "/default.aspx" });
const html = (listing.bytes ?? Buffer.alloc(0)).toString("utf-8");
console.log(JSON.stringify({
  listing: { status: listing.status, len: html.length, title: /<title>([^<]*)</.exec(html)?.[1] ?? null },
}));

const gidList = [...new Set([...html.matchAll(/CG-[A-Z0-9]{2,6}-[A-Z]-\d{8}-\d{6}/g)])].map((m) => m[0]).slice(0, 4);
console.log(JSON.stringify({ gazetteIds: gidList }));

// Static-derivation test, cookie-free GET (cookies influence nothing for
// static files; assert it explicitly by NOT sending the jar).
for (const gid of gidList) {
  const m = /CG-(?:[A-Z0-9]{2,6})-(?:[A-Z])-(\d{2})(\d{2})(\d{4})-(\d{6})/.exec(gid);
  if (!m) continue;
  const url = `${HOST}/WriteReadData/${m[3]}/${m[4]}.pdf`;
  const r = await get(url, { Accept: "application/pdf" });
  const buf = r.bytes ?? Buffer.alloc(0);
  console.log(JSON.stringify({
    staticTest: {
      url,
      status: r.status,
      contentType: r.contentType ?? "(n/a)",
      isPdf: buf.subarray(0, 5).toString() === "%PDF-",
      bytes: buf.byteLength,
      head: buf.subarray(0, 12).toString().replace(/[^\x20-\x7e]/g, "?"),
    },
  }));
  if (buf.subarray(0, 5).toString() === "%PDF-") {
    console.log("STATIC-PDF-OBTAINABLE:" + url + ":" + buf.byteLength);
    break;
  }
}
