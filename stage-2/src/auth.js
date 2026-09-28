"use strict";

// Password hashing for Tablekeeper Stage 1.
//
// Uses Node's built-in scrypt (no native binding, no network dependency).
// Stored form: `scrypt$N$r$p$<saltHex>$<hashHex>`. Verified with
// `crypto.timingSafeEqual` to keep comparison constant-time.

const crypto = require("crypto");

const SCRYPT_N = 1 << 14; // 16384
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

function genToken() {
  return crypto.randomBytes(32).toString("hex");
}

function genReservationId() {
  return "res_" + crypto.randomBytes(8).toString("hex");
}

const REF_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function genReference(used) {
  let ref;
  do {
    const bytes = crypto.randomBytes(8);
    ref = "";
    for (let i = 0; i < 8; i++) ref += REF_CHARS[bytes[i] % REF_CHARS.length];
  } while (used && used.has(ref));
  return ref;
}

const REFERENCE_RE = /^[A-Z0-9]{6,12}$/;

function hashPassword(password) {
  if (typeof password !== "string") {
    throw new TypeError("password must be a string");
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = hashScrypt(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function hashScrypt(password, salt) {
  return crypto.scryptSync(password, salt, HASH_BYTES, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
  });
}

function isStoredHash(value) {
  return typeof value === "string" &&
    /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/.test(value);
}

function verifyPassword(password, stored) {
  if (typeof password !== "string" || !isStoredHash(stored)) return false;
  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const N = +parts[1], r = +parts[2], p = +parts[3];
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  let hash;
  try {
    hash = crypto.scryptSync(password, salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  return crypto.timingSafeEqual(hash, expected);
}

module.exports = {
  hashPassword,
  verifyPassword,
  isStoredHash,
  genToken,
  genReservationId,
  genReference,
  REFERENCE_RE,
  SCRYPT_N,
  SCRYPT_R,
  SCRYPT_P,
};
