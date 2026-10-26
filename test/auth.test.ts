import assert from "node:assert/strict";
import { test } from "node:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";
import { createOwnerVerifier, issuerFor } from "../src/auth";

const SUPABASE_URL = "https://abcdefgh.supabase.co";
const ISSUER = issuerFor(SUPABASE_URL);
const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const req = new Request("https://app.example/api/mcp", { method: "POST" });

async function makeKeys(alg = "ES256") {
  const { publicKey, privateKey } = await generateKeyPair(alg);
  const jwk: JWK = { ...(await exportJWK(publicKey)), alg, use: "sig", kid: `${alg}-test` };
  return { privateKey, kid: jwk.kid!, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

interface Claims {
  sub?: string;
  iss?: string;
  aud?: string;
  exp?: string | number;
  client_id?: string;
}

async function token(privateKey: CryptoKey, kid: string, c: Claims = {}, alg = "ES256") {
  const jwt = new SignJWT({ client_id: c.client_id ?? "claude-test-client" })
    .setProtectedHeader({ alg, kid })
    .setSubject(c.sub ?? OWNER)
    .setIssuer(c.iss ?? ISSUER)
    .setAudience(c.aud ?? "authenticated")
    .setIssuedAt();
  jwt.setExpirationTime(c.exp ?? "1h");
  return jwt.sign(privateKey);
}

const keys = await makeKeys();
const verify = createOwnerVerifier({ issuer: ISSUER, ownerUserId: OWNER, keys: keys.jwks });

test("accepts a valid token for the owner and exposes the client id", async () => {
  const info = await verify(req, await token(keys.privateKey, keys.kid, { client_id: "my-client" }));
  assert.ok(info);
  assert.equal(info.clientId, "my-client");
  assert.deepEqual(info.extra, { userId: OWNER });
  assert.ok(info.expiresAt && info.expiresAt > Date.now() / 1000);
});

test("falls back to a placeholder client id for plain session tokens", async () => {
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keys.kid })
    .setSubject(OWNER).setIssuer(ISSUER).setAudience("authenticated").setIssuedAt().setExpirationTime("1h")
    .sign(keys.privateKey);
  assert.equal((await verify(req, jwt))?.clientId, "supabase-session");
});

test("rejects a valid token that belongs to someone other than the owner", async () => {
  assert.equal(await verify(req, await token(keys.privateKey, keys.kid, { sub: STRANGER })), undefined);
});

test("rejects a missing token", async () => {
  assert.equal(await verify(req, undefined), undefined);
  assert.equal(await verify(req, ""), undefined);
});

test("rejects garbage that is not a JWT", async () => {
  assert.equal(await verify(req, "not-a-jwt"), undefined);
});

test("rejects the wrong issuer", async () => {
  const t = await token(keys.privateKey, keys.kid, { iss: "https://evil.example/auth/v1" });
  assert.equal(await verify(req, t), undefined);
});

test("rejects the wrong audience", async () => {
  assert.equal(await verify(req, await token(keys.privateKey, keys.kid, { aud: "something-else" })), undefined);
});

test("rejects an expired token", async () => {
  const past = Math.floor(Date.now() / 1000) - 3600;
  assert.equal(await verify(req, await token(keys.privateKey, keys.kid, { exp: past })), undefined);
});

test("rejects a token signed by a different key", async () => {
  const other = await makeKeys();
  // Same kid as the trusted key, but signed with an attacker's private key.
  assert.equal(await verify(req, await token(other.privateKey, keys.kid)), undefined);
});

test("rejects a tampered payload", async () => {
  const [h, , s] = (await token(keys.privateKey, keys.kid)).split(".");
  const forged = Buffer.from(
    JSON.stringify({ sub: STRANGER, iss: ISSUER, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  assert.equal(await verify(req, `${h}.${forged}.${s}`), undefined);
});

test("rejects algorithms outside the allow-list (RS256 is allowed, HS256 is not)", async () => {
  const secret = new TextEncoder().encode("a-shared-secret-that-is-long-enough-for-hs256");
  const hs = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256", kid: keys.kid })
    .setSubject(OWNER).setIssuer(ISSUER).setAudience("authenticated").setExpirationTime("1h")
    .sign(secret);
  assert.equal(await verify(req, hs), undefined);

  const rsa = await makeKeys("RS256");
  const rsaVerify = createOwnerVerifier({ issuer: ISSUER, ownerUserId: OWNER, keys: rsa.jwks });
  assert.ok(await rsaVerify(req, await token(rsa.privateKey, rsa.kid, {}, "RS256")));
});

test("issuerFor normalises trailing slashes", () => {
  assert.equal(issuerFor("https://x.supabase.co/"), "https://x.supabase.co/auth/v1");
  assert.equal(issuerFor("https://x.supabase.co"), "https://x.supabase.co/auth/v1");
});
