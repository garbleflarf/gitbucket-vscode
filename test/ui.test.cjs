const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const handlers = new Map(),
  views = new Map(),
  input = [];
let quickPick;
class EventEmitter {
  listeners = [];
  event = (listener) => {
    this.listeners.push(listener);
    return { dispose() {} };
  };
  fire(value) {
    for (const listener of this.listeners) listener(value);
  }
  dispose() {
    this.listeners = [];
  }
}
const vscode = {
  TreeItem: class {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
  ThemeIcon: class {},
  EventEmitter,
  StatusBarAlignment: { Left: 1 },
  ProgressLocation: { Notification: 15 },
  window: {
    showInputBox: async () => input.shift(),
    showQuickPick: async (choices) => quickPick?.(choices),
    withProgress: async (_, action) => action(),
    showInformationMessage() {},
    showErrorMessage(message) {
      throw new Error(message);
    },
    createStatusBarItem: () => ({ show() {}, dispose() {} }),
    createTreeView: (id, options) => {
      const view = {
        ...options,
        onDidChangeSelection: new EventEmitter().event,
        dispose() {},
      };
      views.set(id, view);
      return view;
    },
  },
  commands: {
    registerCommand: (id, fn) => {
      handlers.set(id, fn);
      return { dispose() {} };
    },
    executeCommand: async () => {},
  },
  workspace: { getConfiguration: () => ({ get: (_, fallback) => fallback }) },
};
const load = Module._load;
let ConnectionManager, DataProvider, extension, RepositoryTreeItem;
try {
  Module._load = function (id, ...args) {
    return id === "vscode" ? vscode : load.call(this, id, ...args);
  };
  ({ ConnectionManager } = require("../dist/connection"));
  ({ DataProvider } = require("../dist/providers"));
  ({ RepositoryTreeItem } = require("../dist/treeItems"));
  extension = require("../dist/extension");
} finally {
  Module._load = load;
}
const { GitBucketClient } = require("../dist/gitbucketClient");
function context(initial = {}) {
  const stored = new Map(Object.entries(initial)),
    state = new Map();
  return {
    stored,
    subscriptions: [],
    secrets: {
      get: async (key) => stored.get(key),
      store: async (key, value) => {
        stored.set(key, value);
      },
      delete: async (key) => {
        stored.delete(key);
      },
    },
    workspaceState: {
      get: (key, fallback) => state.get(key) ?? fallback,
      update: async (key, value) => {
        state.set(key, value);
      },
    },
  };
}
test("failed verification and cancelled connection preserve existing credentials", async (t) => {
  const server = http.createServer((_, response) => {
    response.writeHead(401);
    response.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const initial = {
    "gitbucket.baseUrl": "https://old.example",
    "gitbucket.authMode": "token",
    "gitbucket.token": "old-test-token",
  };
  const ctx = context(initial),
    manager = new ConnectionManager(ctx);
  await manager.restore();
  quickPick = (choices) => choices.find((choice) => choice.mode === "token");
  input.push(`http://127.0.0.1:${server.address().port}`, "new-test-token");
  await assert.rejects(manager.connect(), /HTTP 401/);
  assert.deepEqual(Object.fromEntries(ctx.stored), initial);
  assert.equal(manager.connection.token, "old-test-token");
  input.push(undefined);
  assert.equal(await manager.connect(), false);
  assert.equal(manager.connection.token, "old-test-token");
});
test("refresh ignores stale provider responses and caches current results", async () => {
  const repository = {
    full_name: "user/repo",
    owner: { login: "user" },
    name: "repo",
  };
  let resolveFirst,
    calls = 0;
  const api = {
    listIssues: async () => {
      calls++;
      return calls === 1
        ? new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : [{ number: 2, title: "Fresh", state: "open" }];
    },
  };
  const provider = new DataProvider(
    "issues",
    () => api,
    () => repository,
    async () => [],
    () => "open",
  );
  const pending = provider.getChildren();
  provider.refresh();
  resolveFirst([{ number: 1, title: "Stale", state: "open" }]);
  assert.equal((await pending)[0].issue.number, 2);
  await provider.getChildren();
  assert.equal(calls, 2);
  provider.dispose();
});
test("manifest commands register and repository selection drives issues and PRs without prompts", async () => {
  const repository = {
    id: 1,
    full_name: "user/repo",
    owner: { login: "user" },
    name: "repo",
    html_url: "https://git.example/user/repo",
  };
  const ctx = context({
    "gitbucket.baseUrl": "https://git.example",
    "gitbucket.authMode": "token",
    "gitbucket.token": "test-token",
  });
  const originalIssues = GitBucketClient.prototype.listIssues,
    originalPulls = GitBucketClient.prototype.listPullRequests;
  GitBucketClient.prototype.listIssues = async () => [
    { number: 1, title: "Issue", state: "open" },
  ];
  GitBucketClient.prototype.listPullRequests = async () => [
    { number: 2, title: "PR", state: "open" },
  ];
  try {
    await extension.activate(ctx);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"),
    );
    for (const command of manifest.contributes.commands) {
      assert.ok(handlers.has(command.command), command.command);
      assert.ok(command.icon);
    }
    for (const view of manifest.contributes.views.gitbucketRepos)
      assert.ok(fs.existsSync(path.join(__dirname, "..", view.icon)));
    await handlers.get("gitbucket-repos.selectRepository")(
      new RepositoryTreeItem(repository),
    );
    quickPick = () => {
      throw new Error("A refresh must not prompt for a repository.");
    };
    assert.equal(
      (
        await views.get("gitbucketRepos.issues").treeDataProvider.getChildren()
      )[0].issue.number,
      1,
    );
    assert.equal(
      (
        await views
          .get("gitbucketRepos.pullRequests")
          .treeDataProvider.getChildren()
      )[0].pullRequest.number,
      2,
    );
    assert.match(views.get("gitbucketRepos.issues").description, /user\/repo/);
    await handlers.get("gitbucket-repos.clearCredentials")();
    assert.equal(
      (
        await views.get("gitbucketRepos.issues").treeDataProvider.getChildren()
      )[0].label,
      "Connect to GitBucket",
    );
  } finally {
    GitBucketClient.prototype.listIssues = originalIssues;
    GitBucketClient.prototype.listPullRequests = originalPulls;
    for (const disposable of ctx.subscriptions) disposable.dispose();
  }
});
