import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createRenderWebServer } from "./server.mjs";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function reservePort() {
  const probe = http.createServer();
  const url = await listen(probe);
  await close(probe);
  return Number(new URL(url).port);
}

async function listenOnPort(server, port) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${port}`;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function withProxy(upstreamHandler, callback) {
  const upstream = http.createServer(upstreamHandler);
  const backendUrl = await listen(upstream);
  const appPort = await reservePort();
  const appUrl = `http://127.0.0.1:${appPort}`;
  const app = createRenderWebServer({
    env: {
      NODE_ENV: "test",
      PUBLIC_APP_ORIGIN: appUrl,
      TASKFLOW_BACKEND_URL: backendUrl,
    },
  });
  await listenOnPort(app, appPort);

  try {
    await callback({ appUrl, backendUrl, origin: appUrl, upstream });
  } finally {
    await close(app);
    await close(upstream);
  }
}

function sameOriginHeaders(origin, headers = {}) {
  return {
    Origin: origin,
    ...headers,
  };
}

test("proxies Auth.js requests and preserves cookies without trusting forwarded headers", async () => {
  let upstreamRequest;

  await withProxy((request, response) => {
    upstreamRequest = request;
    response.setHeader("Set-Cookie", [
      "__Secure-authjs.csrf-token=test-token; Path=/; HttpOnly; Secure; SameSite=Lax",
      "authjs.callback-url=https%3A%2F%2Ftask-flow-six-rouge.vercel.app%2F; Path=/; HttpOnly; Secure; SameSite=Lax",
    ]);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ credentials: { type: "credentials" } }));
  }, async ({ appUrl, backendUrl, origin }) => {
    const response = await fetch(`${appUrl}/api/auth/providers?check=proxy`, {
      headers: sameOriginHeaders(origin, {
        Cookie: "authjs.session-token=session-value",
        "X-Forwarded-For": "203.0.113.99",
        "X-Forwarded-Host": "attacker.example",
        "X-Forwarded-Proto": "http",
        "X-Vercel-Id": "untrusted",
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      credentials: { type: "credentials" },
    });
    assert.deepEqual(response.headers.getSetCookie(), [
      "__Secure-authjs.csrf-token=test-token; Path=/; HttpOnly; Secure; SameSite=Lax",
      "authjs.callback-url=https%3A%2F%2Ftask-flow-six-rouge.vercel.app%2F; Path=/; HttpOnly; Secure; SameSite=Lax",
    ]);
    assert.equal(upstreamRequest.url, "/api/auth/providers?check=proxy");
    assert.equal(upstreamRequest.headers.host, new URL(backendUrl).host);
    assert.equal(upstreamRequest.headers.origin, origin);
    assert.equal(upstreamRequest.headers.cookie, "authjs.session-token=session-value");
    assert.equal(upstreamRequest.headers["x-forwarded-for"], undefined);
    assert.equal(upstreamRequest.headers["x-forwarded-host"], undefined);
    assert.equal(upstreamRequest.headers["x-forwarded-proto"], undefined);
    assert.equal(upstreamRequest.headers["x-vercel-id"], undefined);
  });
});

test("rejects cross-origin and originless writes, but forwards valid writes unchanged", async () => {
  let upstreamRequest;
  let requestCount = 0;
  let upstreamBody = "";

  await withProxy((request, response) => {
    requestCount += 1;
    upstreamRequest = request;
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      upstreamBody = Buffer.concat(chunks).toString("utf8");
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ created: true }));
    });
  }, async ({ appUrl, origin }) => {
    const crossOrigin = await fetch(`${appUrl}/api/register`, {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Student" }),
    });
    assert.equal(crossOrigin.status, 403);

    const originless = await fetch(`${appUrl}/api/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Test task" }),
    });
    assert.equal(originless.status, 403);
    assert.equal(requestCount, 0);

    const accepted = await fetch(`${appUrl}/api/tasks`, {
      method: "POST",
      headers: sameOriginHeaders(origin, {
        "Content-Type": "application/json",
        Cookie: "authjs.session-token=session-value",
        "X-Forwarded-Host": "attacker.example",
      }),
      body: JSON.stringify({ title: "Test task" }),
    });

    assert.equal(accepted.status, 201);
    assert.deepEqual(await accepted.json(), { created: true });
    assert.equal(requestCount, 1);
    assert.equal(upstreamRequest.method, "POST");
    assert.equal(upstreamRequest.headers.origin, origin);
    assert.equal(upstreamRequest.headers["x-forwarded-host"], undefined);
    assert.equal(upstreamRequest.headers.cookie, "authjs.session-token=session-value");
    assert.equal(upstreamBody, JSON.stringify({ title: "Test task" }));
  });
});

test("forwards authentication, registration, and task routes including query strings and bodies", async () => {
  const received = [];

  await withProxy((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const entry = {
        method: request.method,
        url: request.url,
        body: Buffer.concat(chunks).toString("utf8"),
        origin: request.headers.origin,
        cookie: request.headers.cookie ?? null,
        authReturnRedirect: request.headers["x-auth-return-redirect"] ?? null,
      };
      received.push(entry);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(entry));
    });
  }, async ({ appUrl, origin }) => {
    const cases = [
      { method: "GET", path: "/api/auth/providers" },
      { method: "GET", path: "/api/auth/csrf" },
      { method: "POST", path: "/api/auth/callback/credentials", body: "csrfToken=token&email=student%40example.com&password=example", form: true, redirect: true },
      { method: "GET", path: "/api/auth/session", cookie: "authjs.session-token=session" },
      { method: "POST", path: "/api/auth/signout", body: "csrfToken=token", form: true, redirect: true, cookie: "authjs.session-token=session" },
      { method: "POST", path: "/api/register", body: JSON.stringify({ name: "Student" }) },
      { method: "GET", path: "/api/tasks?page=3&limit=8&search=launch&status=Pending" },
      { method: "POST", path: "/api/tasks", body: JSON.stringify({ title: "Test task" }), cookie: "authjs.session-token=session" },
      { method: "PATCH", path: "/api/tasks/123", body: JSON.stringify({ title: "Updated task" }), cookie: "authjs.session-token=session" },
      { method: "DELETE", path: "/api/tasks/123", cookie: "authjs.session-token=session" },
    ];

    for (const testCase of cases) {
      const headers = sameOriginHeaders(origin);
      if (testCase.form) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      } else if (testCase.body) {
        headers["Content-Type"] = "application/json";
      }
      if (testCase.cookie) headers.Cookie = testCase.cookie;
      if (testCase.redirect) headers["X-Auth-Return-Redirect"] = "1";

      const response = await fetch(`${appUrl}${testCase.path}`, {
        method: testCase.method,
        headers,
        ...(testCase.body ? { body: testCase.body } : {}),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        method: testCase.method,
        url: testCase.path,
        body: testCase.body ?? "",
        origin,
        cookie: testCase.cookie ?? null,
        authReturnRedirect: testCase.redirect ? "1" : null,
      });
    }

    assert.equal(received.length, cases.length);
  });
});

test("preserves upstream redirect locations and serves SPA routes", async () => {
  await withProxy((_request, response) => {
    response.writeHead(302, {
      Location: "https://task-flow-six-rouge.vercel.app/",
    });
    response.end();
  }, async ({ appUrl, origin }) => {
    const redirected = await fetch(`${appUrl}/api/auth/signout`, {
      headers: sameOriginHeaders(origin),
      redirect: "manual",
    });
    assert.equal(redirected.status, 302);
    assert.equal(
      redirected.headers.get("location"),
      "https://task-flow-six-rouge.vercel.app/",
    );

    const page = await fetch(`${appUrl}/tasks?page=2`, {
      headers: {},
    });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<div id="root"><\/div>/);
  });
});

test("rejects an unexpected Host before serving files or proxying requests", async () => {
  await withProxy((_request, response) => {
    response.end("upstream should not be reached");
  }, async ({ appUrl }) => {
    const response = await new Promise((resolve, reject) => {
      const request = http.request(appUrl + "/api/auth/providers", {
        headers: { Host: "attacker.example" },
      }, (result) => {
        result.resume();
        result.on("end", () => resolve(result));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(response.statusCode, 421);
  });
});
