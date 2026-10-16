import * as vscode from "vscode";
import { ConnectionManager } from "./connection";
import { GitBucketClient } from "./gitbucketClient";
import { DataProvider } from "./providers";
import {
  pickRepositoryOwner,
  promptForBranchName,
  promptForRepository,
} from "./prompts";
import {
  BranchTreeItem,
  IssueTreeItem,
  PullRequestTreeItem,
  TreeNode,
} from "./treeItems";
import { Repository } from "./types";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const connections = new ConnectionManager(context);
  await connections.restore();
  let selected: Repository | undefined;
  let repositoryCache: Promise<Repository[]> | undefined;
  let state = context.workspaceState.get<string>("itemState", "open");
  let generation = 0;
  const client = () =>
    connections.connection
      ? new GitBucketClient(connections.connection)
      : undefined;
  const loadRepositories = (): Promise<Repository[]> => {
    if (!repositoryCache) {
      const api = client();
      if (!api) return Promise.resolve([]);
      const activeGeneration = generation;
      repositoryCache = (async () => {
        const discovered = await api.listRepositories();
        const manual = context.workspaceState.get<string[]>(
          `extraRepositories:${api.baseUrl}`,
          [],
        );
        const extras = await Promise.all(
          manual.map(async (fullName) => {
            const [owner, name] = fullName.split("/");
            if (discovered.some((repo) => repo.full_name === fullName))
              return undefined;
            try {
              return await api.getRepository(owner, name);
            } catch {
              return undefined;
            }
          }),
        );
        if (generation !== activeGeneration) return [];
        const repositories = [
          ...discovered,
          ...extras.filter((repo): repo is Repository => !!repo),
        ].sort((a, b) => a.full_name.localeCompare(b.full_name));
        const saved = context.workspaceState.get<string>(
          `selectedRepository:${api.baseUrl}`,
        );
        if (!selected && saved) {
          selected = repositories.find((repo) => repo.full_name === saved);
          updateViews();
          issues.refresh();
          pulls.refresh();
        }
        return repositories;
      })().catch((error) => {
        if (generation === activeGeneration) repositoryCache = undefined;
        throw error;
      });
    }
    return repositoryCache;
  };
  const repos = new DataProvider(
    "repositories",
    client,
    () => selected,
    loadRepositories,
    () => state,
  );
  const issues = new DataProvider(
    "issues",
    client,
    () => selected,
    loadRepositories,
    () => state,
  );
  const pulls = new DataProvider(
    "pullRequests",
    client,
    () => selected,
    loadRepositories,
    () => state,
  );
  const repoView = vscode.window.createTreeView("gitbucketRepos.repositories", {
    treeDataProvider: repos,
    showCollapseAll: true,
  });
  const issueView = vscode.window.createTreeView("gitbucketRepos.issues", {
    treeDataProvider: issues,
  });
  const pullView = vscode.window.createTreeView("gitbucketRepos.pullRequests", {
    treeDataProvider: pulls,
  });
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    20,
  );
  status.command = "gitbucket-repos.connect";
  status.show();
  context.subscriptions.push(
    repos,
    issues,
    pulls,
    repoView,
    issueView,
    pullView,
    status,
  );

  function updateViews(): void {
    const connection = connections.connection;
    status.text = connection
      ? `$(repo) GitBucket${selected ? `: ${selected.full_name}` : ""}`
      : "$(plug) Connect to GitBucket";
    status.tooltip = connection
      ? `${connection.baseUrl}\nClick to change connection`
      : "Connect to your GitBucket server";
    repoView.message = connection
      ? new URL(connection.baseUrl).host
      : undefined;
    issueView.description = selected
      ? `${selected.full_name} · ${state}`
      : undefined;
    pullView.description = selected
      ? `${selected.full_name} · ${state}`
      : undefined;
    void vscode.commands.executeCommand(
      "setContext",
      "gitbucketRepos.connected",
      !!connection,
    );
    void vscode.commands.executeCommand(
      "setContext",
      "gitbucketRepos.repositorySelected",
      !!selected,
    );
  }
  function refreshAll(): void {
    generation++;
    repositoryCache = undefined;
    repos.refresh();
    issues.refresh();
    pulls.refresh();
    updateViews();
  }
  async function select(repository: Repository): Promise<void> {
    selected = repository;
    if (connections.connection)
      await context.workspaceState.update(
        `selectedRepository:${new GitBucketClient(connections.connection).baseUrl}`,
        repository.full_name,
      );
    issues.refresh();
    pulls.refresh();
    updateViews();
  }
  function register(
    name: string,
    action: (item?: TreeNode) => unknown | Promise<unknown>,
  ): void {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        `gitbucket-repos.${name}`,
        async (item?: TreeNode) => {
          try {
            await action(item);
          } catch (error) {
            void vscode.window.showErrorMessage(
              error instanceof Error ? error.message : String(error),
            );
          }
        },
      ),
    );
  }
  async function requireClient(): Promise<GitBucketClient | undefined> {
    if (!connections.connection) {
      if (!(await connections.connect())) return;
      selected = undefined;
      refreshAll();
    }
    return client();
  }
  async function pickRepository(
    item?: TreeNode,
  ): Promise<Repository | undefined> {
    if (item && "repository" in item) return item.repository;
    if (!(await requireClient())) return;
    const repositories = await loadRepositories();
    if (!repositories.length) {
      void vscode.window.showInformationMessage(
        "No repositories found. Create a repository or use GitBucket: Add Repository by Name.",
      );
      return;
    }
    return (
      await vscode.window.showQuickPick(
        repositories.map((repository) => ({
          label: repository.full_name,
          description: repository.private ? "private" : "public",
          detail: repository.description,
          repository,
        })),
        {
          title: "Select GitBucket repository",
          matchOnDescription: true,
          matchOnDetail: true,
        },
      )
    )?.repository;
  }
  register("connect", async () => {
    if (await connections.connect()) {
      selected = undefined;
      refreshAll();
    }
  });
  register("clearCredentials", async () => {
    await connections.clear();
    selected = undefined;
    refreshAll();
    void vscode.window.showInformationMessage(
      "Disconnected from GitBucket. Stored credentials cleared.",
    );
  });
  register("refresh", () => refreshAll());
  register("refreshIssues", () => issues.refresh());
  register("refreshPullRequests", () => pulls.refresh());
  register("selectRepository", async (item) => {
    const repository = await pickRepository(item);
    if (repository) await select(repository);
  });
  for (const [name, view] of [
    ["showIssuesForRepository", "gitbucketRepos.issues"],
    ["showPullRequestsForRepository", "gitbucketRepos.pullRequests"],
  ] as const) {
    register(name, async (item) => {
      const repository = await pickRepository(item);
      if (repository) {
        await select(repository);
        await vscode.commands.executeCommand(`${view}.focus`);
      }
    });
  }
  register("filterItems", async () => {
    const choice = await vscode.window.showQuickPick(
      [
        { label: "Open", value: "open" },
        { label: "Closed", value: "closed" },
        { label: "All", value: "all" },
      ],
      { title: "Filter issues and pull requests" },
    );
    if (!choice) return;
    state = choice.value;
    await context.workspaceState.update("itemState", state);
    issues.refresh();
    pulls.refresh();
    updateViews();
  });
  register("addRepository", async () => {
    const api = await requireClient();
    if (!api) return;
    const fullName = await vscode.window.showInputBox({
      title: "Add a GitBucket repository",
      prompt:
        "owner/repository (use this for private collaborator repositories not listed by older servers)",
      validateInput: (value) =>
        /^[^/\s]+\/[^/\s]+$/.test(value)
          ? undefined
          : "Enter owner/repository.",
    });
    if (!fullName) return;
    const [owner, name] = fullName.split("/");
    const repository = await api.getRepository(owner, name);
    const key = `extraRepositories:${api.baseUrl}`;
    await context.workspaceState.update(key, [
      ...new Set([
        ...context.workspaceState.get<string[]>(key, []),
        repository.full_name,
      ]),
    ]);
    refreshAll();
    await select(repository);
  });
  register("createRepository", async () => {
    const api = await requireClient();
    if (!api) return;
    const owner = await pickRepositoryOwner(api);
    if (!owner) return;
    const input = await promptForRepository();
    if (!input) return;
    const repository = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Creating GitBucket repository…",
      },
      () => api.createRepository(input, owner),
    );
    refreshAll();
    await select(repository);
    void vscode.window.showInformationMessage(
      `Created ${repository.full_name}.`,
    );
  });
  register("createBranch", async (item) => {
    const api = await requireClient();
    if (!api) return;
    const repository =
      item && "repository" in item
        ? item.repository
        : (selected ?? (await pickRepository()));
    if (!repository) return;
    const branches = await api.listBranches(
      repository.owner.login,
      repository.name,
    );
    if (!branches.length) {
      void vscode.window.showInformationMessage(
        "This repository has no branches. Push an initial commit before creating a branch.",
      );
      return;
    }
    const preferred =
      item instanceof BranchTreeItem
        ? item.branch.name
        : repository.default_branch;
    branches.sort(
      (a, b) => Number(b.name === preferred) - Number(a.name === preferred),
    );
    const source = await vscode.window.showQuickPick(
      branches.map((branch) => ({
        label: branch.name,
        description:
          branch.name === repository.default_branch ? "default" : undefined,
      })),
      { title: `Source branch · ${repository.full_name}` },
    );
    if (!source) return;
    const name = await promptForBranchName();
    if (!name) return;
    if (branches.some((branch) => branch.name === name))
      throw new Error(`Branch ${name} already exists.`);
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Creating branch ${name}…`,
      },
      () =>
        api.createBranchFromBranch(
          repository.owner.login,
          repository.name,
          name,
          source.label,
        ),
    );
    refreshAll();
    void vscode.window.showInformationMessage(
      `Created ${name} from ${source.label}.`,
    );
  });
  async function open(url: string): Promise<void> {
    const uri = vscode.Uri.parse(url);
    if (!["http", "https"].includes(uri.scheme))
      throw new Error("The server returned an unsupported browser URL.");
    await vscode.env.openExternal(uri);
  }
  register("openRepository", async (item) => {
    const repository = await pickRepository(item);
    if (repository) await open(repository.html_url);
  });
  register("copyCloneUrl", async (item) => {
    const repository = await pickRepository(item);
    if (repository) {
      await vscode.env.clipboard.writeText(repository.clone_url);
      void vscode.window.showInformationMessage(
        `Copied clone URL for ${repository.full_name}.`,
      );
    }
  });
  register("cloneRepository", async (item) => {
    const repository = await pickRepository(item);
    if (repository)
      await vscode.commands.executeCommand("git.clone", repository.clone_url);
  });
  register("openBranch", async (item) => {
    if (item instanceof BranchTreeItem)
      await open(GitBucketClient.getBranchUrl(item.repository, item.branch));
  });
  register("openIssue", async (item) => {
    if (item instanceof IssueTreeItem)
      await open(GitBucketClient.getIssueUrl(item.repository, item.issue));
  });
  register("openPullRequest", async (item) => {
    if (item instanceof PullRequestTreeItem)
      await open(
        GitBucketClient.getPullRequestUrl(item.repository, item.pullRequest),
      );
  });
  context.subscriptions.push(
    repoView.onDidChangeSelection((event) => {
      const item = event.selection[0];
      if (item && "repository" in item) void select(item.repository);
    }),
  );
  updateViews();
}

export function deactivate(): void {}
