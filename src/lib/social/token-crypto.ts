import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const HKDF_SALT = "tubemaster/social-tokens";
const HKDF_INFO = "tubemaster/social-tokens/v1";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Error messages never include plaintext, ciphertext or the secret. */
export class SocialTokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialTokenCryptoError";
  }
}

function deriveKey(secret: string): Buffer {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new SocialTokenCryptoError("Social token encryption secret is required");
  }
  return Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, HKDF_INFO, KEY_LENGTH));
}

function decodeSegment(segment: string, expectedLength?: number): Buffer {
  if (!BASE64URL.test(segment)) throw new SocialTokenCryptoError("Social token decryption failed");
  const bytes = Buffer.from(segment, "base64url");
  if (bytes.length === 0 || (expectedLength !== undefined && bytes.length !== expectedLength)) {
    throw new SocialTokenCryptoError("Social token decryption failed");
  }
  return bytes;
}

/** Encrypts a token as `v1.<iv>.<tag>.<ciphertext>` (base64url segments, random 12-byte IV). */
export function encryptToken(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new SocialTokenCryptoError("Social token plaintext must be a non-empty string");
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  cipher.setAAD(Buffer.from(VERSION));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptToken(payload: string, secret: string): string {
  const key = deriveKey(secret);
  if (typeof payload !== "string") throw new SocialTokenCryptoError("Social token decryption failed");
  const parts = payload.split(".");
  if (parts[0] !== VERSION) {
    throw new SocialTokenCryptoError("Unsupported social token payload version");
  }
  if (parts.length !== 4) throw new SocialTokenCryptoError("Social token decryption failed");

  const iv = decodeSegment(parts[1], IV_LENGTH);
  const tag = decodeSegment(parts[2], TAG_LENGTH);
  const ciphertext = decodeSegment(parts[3]);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAAD(Buffer.from(VERSION));
    decipher.setAuthTag(tag);
    // final() authenticates before anything is returned, so partial plaintext never escapes.
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    throw new SocialTokenCryptoError("Social token decryption failed");
  }
}
