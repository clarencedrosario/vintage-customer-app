// Capture a live eGazette session ID (verification ON, pinned public
// anchors). Prints the 24-char id to stdout for scripts/probe-egazette.mjs.
import https from "node:https";
import { GAZETTE_CA_PEMS } from "./gazette-ca-pems.js";

const req = https.request(
  "https://egazette.gov.in",
  { method: "GET", ca: GAZETTE_CA_PEMS, timeout: 45_000 },
  (res) => {
    const loc = res.headers.location ?? "";
    const m = /\(S\(([a-z0-9]{24})\)\)/.exec(loc);
    console.log(m ? m[1] : "");
    res.resume();
  },
);
req.on("timeout", () => req.destroy(new Error("timeout")));
req.on("error", (e) => { console.error("sid-capture error:", e.message); console.log(""); });
req.end();
