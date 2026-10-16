const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { fetchWithSystemTrust } = require("../dist/transport");

test("native transport sends JSON, handles 204, refuses redirects and supports cancellation", async (t) => {
  let forwarded = false;
  const server = http.createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/target" });
      response.end();
      return;
    }
    if (request.url === "/target") forwarded = true;
    if (request.url === "/empty") {
      response.writeHead(204);
      response.end();
      return;
    }
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          method: request.method,
          body,
          authorization: request.headers.authorization,
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetchWithSystemTrust(`${base}/json`, {
    method: "POST",
    body: '{"name":"test"}',
    headers: { Authorization: "token test-only" },
  });
  assert.deepEqual(await response.json(), {
    method: "POST",
    body: '{"name":"test"}',
    authorization: "token test-only",
  });
  assert.equal((await fetchWithSystemTrust(`${base}/empty`)).status, 204);
  await assert.rejects(fetchWithSystemTrust(`${base}/redirect`), /redirected/);
  assert.equal(forwarded, false);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchWithSystemTrust(`${base}/json`, { signal: controller.signal }),
    { name: "AbortError" },
  );
});
