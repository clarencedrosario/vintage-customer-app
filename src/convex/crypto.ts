// BRIDGE VERSION — temporary while @noble packages are installed.
// Replaced by the @noble AES-256-GCM implementation in the same change
// set; same public API (encryptSecret/decryptSecret take (context, plaintext)).
import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { hmac } from "@noble/hashes/hmac.js";
import { randomBytes, bytesToHex } from "@noble/hashes/utils.js";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}

/**
 * Byte-exact SHA-256 (lowercase hex) of raw bytes. Same value a browser
 * computes over the same bytes — used where a hash must match what
 * integrity verification re-computes over stored objects (unlike
 * sha256Hex(text), which hashes the TEXT's UTF-8 encoding).
 */
export function sha256HexBytes(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export function hmacSha256Hex(key: string, message: string): string {
  return bytesToHex(
    hmac(sha256, new TextEncoder().encode(key), new TextEncoder().encode(message)),
  );
}

export function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  return hmac(sha1, key, message);
}

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

const HKDF_SALT = "advokate-secret-enc-v1";
const MASTER_ENV = "SECRET_ENCRYPTION_KEY";

export function masterKeyConfigured(): boolean {
  return !!process.env[MASTER_ENV];
}

function masterKey(): string {
  const dedicated = process.env[MASTER_ENV];
  if (dedicated && dedicated.trim().length >= 32) return dedicated.trim();
  const legacy = process.env.RAZORPAY_KEY_SECRET;
  if (!legacy) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY is not configured — merchant credentials cannot be encrypted or read.",
    );
  }
  return legacy;
}

function b64uEncode(b: Uint8Array): string {
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uDecode(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function encryptSecret(context: string, plaintext: string): string {
  const enc = new TextEncoder();
  const key = hkdf(sha256, enc.encode(masterKey()), enc.encode(HKDF_SALT), enc.encode(context), 32);
  const nonce = randomBytes(12);
  const aes = gcm(key, nonce, enc.encode(context));
  const ct = aes.encrypt(enc.encode(plaintext));
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return b64uEncode(out);
}

export function decryptSecret(context: string, blob: string): string {
  const enc = new TextEncoder();
  const key = hkdf(sha256, enc.encode(masterKey()), enc.encode(HKDF_SALT), enc.encode(context), 32);
  const data = b64uDecode(blob);
  if (data.length < 12 + 16) throw new Error("Corrupt secret blob.");
  const nonce = data.slice(0, 12);
  const ct = data.slice(12);
  const aes = gcm(key, nonce, new TextEncoder().encode(context));
  return new TextDecoder().decode(aes.decrypt(ct));
}
