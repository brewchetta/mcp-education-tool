import assert from "node:assert/strict";
import { test } from "node:test";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { createOwnerVerifier, issuerFor } from "../src/auth";
import { SERVER_INFO, registerAll } from "../src/server";

// Exercises the same stack as app/api/mcp/route.ts (mcp-handler + v2 server + owner-only auth) without the
// network or a database: tokens are signed with a locally generated key and only DB-free methods are called.

const ISSUER = issuerFor("https://abcdefgh.supabase.co");
const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const URL_ = "https://app.example/api/mcp";

const { publicKey, privateKey } = await generateKeyPair("ES256");
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: "ES256", use: "sig", kid: "k1" }] });

const handler = withMcpAuth(
  createMcpHandler(registerAll, { serverInfo: SERVER_INFO }),
  createOwnerVerifier({ issuer: ISSUER, ownerUserId: OWNER, keys: jwks }),
  { required: true, resourceMetadataPath: "/.well-known/oauth-protected-resource" },
);

const sign = (sub: string) =>
  new SignJWT({ client_id: "test-client" })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setSubject(sub).setIssuer(ISSUER).setAudience("authenticated").setIssuedAt().setExpirationTime("1h")
    .sign(privateKey);

let nextId = 1;
async function rpc(method: string, params: unknown, token?: string) {
  const res = await handler(
    new Request(URL_, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }),
  );
  const text = await res.text();
  // The transport may answer with plain JSON or a single SSE event.
  const payload = res.headers.get("content-type")?.includes("event-stream")
    ? text.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim() ?? ""
    : text;
  let json: any;
  try { json = JSON.parse(payload); } catch { json = undefined; }
  return { res, json, text };
}

const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } };

test("no token -> 401 with a WWW-Authenticate challenge pointing at the resource metadata", async () => {
  const { res } = await rpc("initialize", INIT);
  assert.equal(res.status, 401);
  const challenge = res.headers.get("www-authenticate") ?? "";
  assert.match(challenge, /^Bearer/i);
  assert.match(challenge, /resource_metadata="https:\/\/app\.example\/\.well-known\/oauth-protected-resource"/);
});

test("garbage token -> 401", async () => {
  assert.equal((await rpc("initialize", INIT, "garbage")).res.status, 401);
});

test("a valid token for someone other than the owner -> 401", async () => {
  assert.equal((await rpc("initialize", INIT, await sign(STRANGER))).res.status, 401);
});

test("owner token: initialize reports the server", async () => {
  const { res, json } = await rpc("initialize", INIT, await sign(OWNER));
  assert.equal(res.status, 200);
  assert.equal(json?.result?.serverInfo?.name, "mcp-education");
});

test("owner token: tools/list exposes all 13 tools, quiz tools carry the UI resource", async () => {
  const { res, json } = await rpc("tools/list", {}, await sign(OWNER));
  assert.equal(res.status, 200);
  const tools: any[] = json.result.tools;
  assert.equal(tools.length, 13);
  for (const name of ["save_quiz", "get_quiz"]) {
    assert.equal(tools.find((t) => t.name === name)?._meta?.ui?.resourceUri, "ui://education/quiz.html");
  }
  assert.equal(tools.find((t) => t.name === "prepare_quiz")?._meta?.ui, undefined);
});

test("owner token: the quiz view is served as an MCP App resource", async () => {
  const token = await sign(OWNER);
  const list = await rpc("resources/list", {}, token);
  assert.ok(list.json.result.resources.some((r: any) => r.uri === "ui://education/quiz.html"));

  const { json } = await rpc("resources/read", { uri: "ui://education/quiz.html" }, token);
  const content = json.result.contents[0];
  assert.equal(content.mimeType, "text/html;profile=mcp-app");
  assert.ok(content.text.startsWith("<!doctype html>"));
  assert.ok(!/<script[^>]+src=/i.test(content.text), "view must be self-contained");
});

test("owner token: invalid tool arguments are rejected before any database access", async () => {
  const { json } = await rpc(
    "tools/call",
    { name: "save_quiz", arguments: { topic: "x", title: "t", questions: [{ question: "q", choices: ["a", "b"], correct_index: 9 }] } },
    await sign(OWNER),
  );
  const result = json.result ?? {};
  const message = JSON.stringify(json.error ?? result.content ?? "");
  assert.ok(json.error || result.isError, "expected an error");
  assert.match(message, /correct_index/);
});
