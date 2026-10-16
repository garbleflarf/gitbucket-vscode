const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  GitBucketClient,
  normalizeBaseUrl,
  validateBranchName,
} = require("../dist/gitbucketClient");
const connection = {
  baseUrl: "https://git.example/gitbucket",
  authMode: "token",
  token: "test-only",
};
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const repo = (name) => ({
  id: name.length,
  full_name: name,
  name: name.split("/")[1],
  owner: { login: name.split("/")[0] },
});

test("normalizes bare hosts, installation paths, and pasted API roots", () => {
  assert.equal(normalizeBaseUrl("git.example"), "https://git.example");
  assert.equal(
    normalizeBaseUrl("https://git.example/gitbucket/api/v3/"),
    connection.baseUrl,
  );
  for (const bad of [
    "file:///tmp",
    "https://u:secret@git.example",
    "https://git.example/?token=secret",
  ])
    assert.throws(() => normalizeBaseUrl(bad));
});
test("preserves installation path and sends auth without placing secrets in URL", async () => {
  const client = new GitBucketClient(connection, async (url, options) => {
    assert.equal(String(url), "https://git.example/gitbucket/api/v3/user");
    assert.equal(options.headers.Authorization, "token test-only");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    return json({ login: "luigi" });
  });
  assert.equal((await client.getAuthenticatedUser()).login, "luigi");
});
test("older GitBucket discovery includes user, organization, and public repositories", async () => {
  const routes = {
    "/user/repos": [404, {}],
    "/user": [200, { login: "luigi" }],
    "/user/orgs": [404, {}],
    "/users/luigi/orgs": [200, [{ login: "team" }]],
    "/users/luigi/repos": [200, [repo("luigi/private")]],
    "/orgs/team/repos": [200, [repo("team/private")]],
    "/repositories": [200, [repo("public/example"), repo("luigi/private")]],
  };
  const client = new GitBucketClient(connection, async (url) => {
    const [status, body] = routes[
      url.pathname.replace("/gitbucket/api/v3", "")
    ] ?? [500, {}];
    return json(body, status);
  });
  assert.deepEqual(
    (await client.listRepositories()).map((repo) => repo.full_name),
    ["luigi/private", "public/example", "team/private"],
  );
});
test("authentication errors are not hidden by endpoint fallback", async () => {
  let requests = 0;
  const client = new GitBucketClient(connection, async () => {
    requests++;
    return json({}, 401);
  });
  await assert.rejects(client.listRepositories(), /HTTP 401/);
  assert.equal(requests, 1);
});
test("follows Link pagination and detects servers ignoring page parameters", async () => {
  let requests = 0;
  const client = new GitBucketClient(connection, async () => {
    requests++;
    return requests === 1
      ? json([repo("a/one")], 200, {
          link: '<https://git.example/gitbucket/api/v3/user/repos?page=2>; rel="next"',
        })
      : json([repo("a/two")]);
  });
  assert.equal((await client.listRepositories()).length, 2);
  requests = 0;
  const fullPage = Array.from({ length: 100 }, (_, i) =>
    repo(`owner/repo${i}`),
  );
  const older = new GitBucketClient(connection, async () => {
    requests++;
    return json(fullPage);
  });
  assert.equal((await older.listRepositories()).length, 100);
  assert.equal(requests, 2);
});
test("never forwards credentials to a foreign pagination URL", async () => {
  let requests = 0;
  const client = new GitBucketClient(connection, async () => {
    requests++;
    return json([repo("a/one")], 200, {
      link: '<https://other.example/api/v3/repos?page=2>; rel="next"',
    });
  });
  await assert.rejects(client.listRepositories(), /outside this server API/);
  assert.equal(requests, 1);
});
test("creates a branch using the source commit and validates names before requesting", async () => {
  const calls = [];
  const client = new GitBucketClient(connection, async (url, options) => {
    calls.push([url.pathname, options]);
    return json({ name: "main", commit: { sha: "abc" } });
  });
  await client.createBranchFromBranch(
    "a user",
    "a repo",
    "feature/new",
    "feature/base",
  );
  assert.match(calls[0][0], /a%20user\/a%20repo\/branches\/feature%2Fbase$/);
  assert.deepEqual(JSON.parse(calls[1][1].body), {
    ref: "refs/heads/feature/new",
    sha: "abc",
  });
  await assert.rejects(
    client.createBranchFromBranch("a", "b", "bad..name", "main"),
    /valid Git branch/,
  );
  assert.equal(calls.length, 2);
  for (const name of [
    "refs/heads/x",
    ".hidden",
    "x.lock",
    "bad name",
    "x//y",
    "x@{y",
    "-oops",
  ])
    assert.ok(validateBranchName(name), name);
  assert.equal(validateBranchName("feature/new"), undefined);
});
test("separates pull requests from issues and reports invalid JSON", async () => {
  const client = new GitBucketClient(connection, async () =>
    json([
      { number: 1, title: "PR", pull_request: {} },
      { number: 2, title: "Issue" },
    ]),
  );
  assert.deepEqual(
    (await client.listIssues("a", "b")).map((item) => item.number),
    [2],
  );
  const invalid = new GitBucketClient(
    connection,
    async () => new Response("<html>Login</html>"),
  );
  await assert.rejects(invalid.getAuthenticatedUser(), /invalid JSON/);
});
