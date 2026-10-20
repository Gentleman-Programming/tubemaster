import assert from "node:assert/strict";
import test from "node:test";
import { decryptToken, encryptToken } from "../token-crypto";

const SECRET = "test-nextauth-secret-value";

function replaceSegment(payload: string, index: number, mutate: (segment: string) => string) {
  const parts = payload.split(".");
  parts[index] = mutate(parts[index]);
  return parts.join(".");
}

function flipFirstChar(segment: string) {
  return (segment[0] === "A" ? "B" : "A") + segment.slice(1);
}

test("encryptToken round trips through decryptToken with a versioned payload", () => {
  const payload = encryptToken("access-token-123", SECRET);

  assert.match(payload, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(!payload.includes("access-token-123"));
  assert.equal(decryptToken(payload, SECRET), "access-token-123");
});

test("encryptToken uses a different IV for every call", () => {
  const first = encryptToken("same-token", SECRET);
  const second = encryptToken("same-token", SECRET);

  assert.notEqual(first, second);
  assert.notEqual(first.split(".")[1], second.split(".")[1]);
  assert.equal(decryptToken(first, SECRET), "same-token");
  assert.equal(decryptToken(second, SECRET), "same-token");
});

test("decryptToken rejects tampered ciphertext, tag and IV", () => {
  const payload = encryptToken("access-token-123", SECRET);

  for (const index of [1, 2, 3]) {
    assert.throws(
      () => decryptToken(replaceSegment(payload, index, flipFirstChar), SECRET),
      /Social token decryption failed/,
    );
  }
});

test("decryptToken rejects malformed payloads", () => {
  const payload = encryptToken("access-token-123", SECRET);

  assert.throws(() => decryptToken("v1.only-two", SECRET), /Social token decryption failed/);
  assert.throws(() => decryptToken(`${payload}.extra`, SECRET), /Social token decryption failed/);
  assert.throws(
    () => decryptToken(replaceSegment(payload, 2, (tag) => tag.slice(0, 8)), SECRET),
    /Social token decryption failed/,
  );
  assert.throws(
    () => decryptToken(replaceSegment(payload, 3, () => "not base64url!"), SECRET),
    /Social token decryption failed/,
  );
});

test("decryptToken rejects the wrong secret without leaking plaintext", () => {
  const payload = encryptToken("access-token-123", SECRET);

  assert.throws(
    () => decryptToken(payload, "another-secret"),
    (error: unknown) =>
      error instanceof Error &&
      /Social token decryption failed/.test(error.message) &&
      !error.message.includes("access-token-123") &&
      !error.message.includes("another-secret"),
  );
});

test("encryptToken and decryptToken reject a missing or empty secret", () => {
  const payload = encryptToken("access-token-123", SECRET);

  assert.throws(() => encryptToken("access-token-123", ""), /secret is required/);
  assert.throws(() => decryptToken(payload, ""), /secret is required/);
  assert.throws(
    () => encryptToken("access-token-123", undefined as unknown as string),
    /secret is required/,
  );
});

test("encryptToken rejects an empty plaintext token", () => {
  assert.throws(() => encryptToken("", SECRET), /non-empty string/);
});

test("decryptToken rejects an unknown payload version", () => {
  const payload = encryptToken("access-token-123", SECRET);

  assert.throws(
    () => decryptToken(replaceSegment(payload, 0, () => "v2"), SECRET),
    /Unsupported social token payload version/,
  );
  assert.throws(() => decryptToken("plaintext-token", SECRET), /Unsupported social token payload version/);
});
