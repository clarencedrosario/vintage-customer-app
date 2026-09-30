/**
 * Pure-TypeScript SHA-256, SHA-1 and HMAC — the Convex mutation/query
 * sandbox has no node:crypto or WebCrypto, so hashing for invitation
 * tokens, recovery codes and TOTP is implemented here.
 */

type Word = number;

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: Word, n: number): Word {
  return (x >>> n) | (x << (32 - n));
}

function pad(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const withOne = data.length + 1;
  const total = Math.ceil((withOne + 8) / 64) * 64;
  const out = new Uint8Array(total);
  out.set(data);
  out[data.length] = 0x80;
  // 64-bit big-endian length (high 32 bits are zero for our sizes).
  const view = new DataView(out.buffer);
  view.setUint32(total - 4, bitLen >>> 0, false);
  view.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);
  return out;
}

/** SHA-256 of a byte array → 32 bytes. */
export function sha256Bytes(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const msg = pad(data);
  const view = new DataView(msg.buffer);

  for (let off = 0; off < msg.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [
      h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7],
    ];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i], false);
  return out;
}

/** SHA-256 of a UTF-8 string → lowercase hex. */
export function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text);
  return [...sha256Bytes(data)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * HMAC-SHA256 of a UTF-8 message with a UTF-8 key → lowercase hex.
 * Pure implementation (RFC 2104) built on sha256Bytes, so secure-link
 * token signing works inside the query/mutation sandbox without
 * node:crypto. Block size 64 bytes; keys longer than that are hashed
 * first.
 */
export function hmacSha256Hex(key: string, message: string): string {
  const enc = new TextEncoder();
  let keyBytes: Uint8Array = enc.encode(key);
  const blockSize = 64;
  if (keyBytes.length > blockSize) keyBytes = sha256Bytes(keyBytes);

  const padded = new Uint8Array(blockSize);
  padded.set(keyBytes);

  const msgBytes = enc.encode(message);
  const inner = new Uint8Array(blockSize + msgBytes.length);
  for (let i = 0; i < blockSize; i++) inner[i] = padded[i] ^ 0x36;
  inner.set(msgBytes, blockSize);

  const innerHash = sha256Bytes(inner);
  const outer = new Uint8Array(blockSize + innerHash.length);
  for (let i = 0; i < blockSize; i++) outer[i] = padded[i] ^ 0x5c;
  outer.set(innerHash, blockSize);

  return [...sha256Bytes(outer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------
// SHA-1 + HMAC-SHA1 (needed for TOTP per RFC 6238)
// ---------------------------------------------------------------------

function sha1Bytes(data: Uint8Array): Uint8Array {
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476,
    h4 = 0xc3d2e1f0;
  const bitLen = data.length * 8;
  const total = Math.ceil((data.length + 1 + 8) / 64) * 64;
  const msg = new Uint8Array(total);
  msg.set(data);
  msg[data.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(total - 4, bitLen >>> 0, false);
  view.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(80);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 80; i++) {
      w[i] = rotr(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: Word, k: Word;
      if (i < 20) {
        f = (b & c) | (~b & d); k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d; k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d; k = 0xca62c1d6;
      }
      const temp = (((rotr(a, 5) + f + e + k + w[i]) >>> 0)) >>> 0;
      e = d; d = c; c = rotr(b, 30); b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, h0, false); ov.setUint32(4, h1, false);
  ov.setUint32(8, h2, false); ov.setUint32(12, h3, false);
  ov.setUint32(16, h4, false);
  return out;
}

/** HMAC-SHA1 → 20 bytes. */
export function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  const k = key.length > blockSize ? sha1Bytes(key) : key;
  const padded = new Uint8Array(blockSize);
  padded.set(k);

  const inner = new Uint8Array(blockSize + message.length);
  const outer = new Uint8Array(blockSize + 20);
  for (let i = 0; i < blockSize; i++) {
    inner[i] = padded[i] ^ 0x36;
    outer[i] = padded[i] ^ 0x5c;
  }
  inner.set(message, blockSize);
  outer.set(sha1Bytes(inner), blockSize);
  return sha1Bytes(outer);
}

// ---------------------------------------------------------------------
// Base32 (RFC 4648) for TOTP secrets
// ---------------------------------------------------------------------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s.toUpperCase().replace(/=+$/, "")) {
    const idx = B32.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------
// Authenticated encryption for stored secrets (per-firm merchant
// credentials). The Convex sandbox has no WebCrypto, so this is an
// ENCRYPT-THEN-MAC stream construction on the primitives above:
//   key = HMAC(masterKey, "enc") | HMAC(masterKey, "mac")  (32+32 bytes)
//   ciphertext = plaintext XOR HMAC(key_enc, counter_block_n)
//   tag = HMAC(key_mac, associated_data || ciphertext)
// The HMAC-as-PRF counter construction is NIST SP 800-108 style; the
// tag covers the AD (context string) so ciphertexts cannot be moved
// between rows or contexts. Constant-time-ish tag comparison.
// ---------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s);
}

function base64ToBytes(s: string): Uint8Array {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const HKDF_INFO_ENC = "advokate-secret-enc-v1";
const HKDF_INFO_MAC = "advokate-secret-mac-v1";

function deriveKeys(masterKey: string): { enc: Uint8Array; mac: Uint8Array } {
  const enc = hexToBytes(hmacSha256Hex(masterKey, HKDF_INFO_ENC));
  const mac = hexToBytes(hmacSha256Hex(masterKey, HKDF_INFO_MAC));
  return { enc, mac };
}

function hmacBytesRaw(keyBytes: Uint8Array, message: Uint8Array): Uint8Array {
  // HMAC with binary key + binary message (RFC 2104), on sha256Bytes.
  const blockSize = 64;
  let key = keyBytes;
  if (key.length > blockSize) key = sha256Bytes(key);
  const padded = new Uint8Array(blockSize);
  padded.set(key);
  const inner = new Uint8Array(blockSize + message.length);
  for (let i = 0; i < blockSize; i++) inner[i] = padded[i]! ^ 0x36;
  inner.set(message, blockSize);
  const innerHash = sha256Bytes(inner);
  const outer = new Uint8Array(blockSize + innerHash.length);
  for (let i = 0; i < blockSize; i++) outer[i] = padded[i]! ^ 0x5c;
  outer.set(innerHash, blockSize);
  return sha256Bytes(outer);
}

/**
 * Encrypt a UTF-8 secret under a master key. Returns
 * base64(iv || ciphertext || tag). The context string binds the
 * ciphertext to its purpose/row (pass e.g. "orgMerchant:<id>:secret").
 */
export function encryptSecret(
  masterKey: string,
  context: string,
  plaintext: string,
): string {
  const { enc, mac } = deriveKeys(masterKey);
  const iv = sha256Bytes(
    new TextEncoder().encode(`${context}:${Date.now()}:${Math.random()}`),
  ).slice(0, 16);
  const msg = new TextEncoder().encode(plaintext);
  const ct = new Uint8Array(msg.length);
  let counter = 0;
  for (let off = 0; off < msg.length; off += 32) {
    const block = new Uint8Array(iv.length + 4);
    block.set(iv);
    new DataView(block.buffer).setUint32(iv.length, counter, false);
    const ks = hmacBytesRaw(enc, block);
    for (let i = 0; i < 32 && off + i < msg.length; i++) {
      ct[off + i] = msg[off + i]! ^ ks[i]!;
    }
    counter += 1;
  }
  const ad = new TextEncoder().encode(context);
  const macInput = new Uint8Array(2 + ad.length + 2 + ct.length);
  new DataView(macInput.buffer).setUint16(0, ad.length, false);
  macInput.set(ad, 2);
  new DataView(macInput.buffer).setUint16(2 + ad.length, ct.length, false);
  macInput.set(ct, 4 + ad.length);
  const tag = hmacBytesRaw(mac, macInput);
  const out = new Uint8Array(iv.length + ct.length + tag.length);
  out.set(iv);
  out.set(ct, iv.length);
  out.set(tag, iv.length + ct.length);
  return bytesToBase64(out);
}

/**
 * Decrypt a value produced by encryptSecret. Throws when the tag does
 * not verify (wrong key, tampered ciphertext, wrong context).
 */
export function decryptSecret(
  masterKey: string,
  context: string,
  blob: string,
): string {
  const { enc, mac } = deriveKeys(masterKey);
  const data = base64ToBytes(blob);
  if (data.length < 16 + 32) throw new Error("Corrupt secret blob.");
  const iv = data.slice(0, 16);
  const tag = data.slice(data.length - 32);
  const ct = data.slice(16, data.length - 32);
  const ad = new TextEncoder().encode(context);
  const macInput = new Uint8Array(2 + ad.length + 2 + ct.length);
  new DataView(macInput.buffer).setUint16(0, ad.length, false);
  macInput.set(ad, 2);
  new DataView(macInput.buffer).setUint16(2 + ad.length, ct.length, false);
  macInput.set(ct, 4 + ad.length);
  const expected = hmacBytesRaw(mac, macInput);
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= expected[i]! ^ tag[i]!;
  if (diff !== 0) throw new Error("Secret authentication failed.");
  const msg = new Uint8Array(ct.length);
  let counter = 0;
  for (let off = 0; off < ct.length; off += 32) {
    const block = new Uint8Array(iv.length + 4);
    block.set(iv);
    new DataView(block.buffer).setUint32(iv.length, counter, false);
    const ks = hmacBytesRaw(enc, block);
    for (let i = 0; i < 32 && off + i < ct.length; i++) {
      msg[off + i] = ct[off + i]! ^ ks[i]!;
    }
    counter += 1;
  }
  return new TextDecoder().decode(msg);
}
