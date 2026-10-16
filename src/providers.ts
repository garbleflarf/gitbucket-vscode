import * as vscode from "vscode";
import { GitBucketClient } from "./gitbucketClient";
import { Repository } from "./types";
import {
  BranchTreeItem,
  InfoTreeItem,
  IssueTreeItem,
  PullRequestTreeItem,
  RepositoryTreeItem,
  TreeNode,
} from "./treeItems";

export class DataProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable
{
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private generation = 0;
  private cache = new Map<string, Promise<TreeNode[]>>();
  constructor(
    readonly kind: "repositories" | "issues" | "pullRequests",
    private readonly client: () => GitBucketClient | undefined,
    private readonly selected: () => Repository | undefined,
    private readonly repositories: () => Promise<Repository[]>,
    private readonly state: () => string,
  ) {}
  refresh(): void {
    this.generation++;
    this.cache.clear();
    this.emitter.fire(undefined);
  }
  dispose(): void {
    this.emitter.dispose();
    this.cache.clear();
  }
  getTreeItem(item: TreeNode): vscode.TreeItem {
    return item;
  }
  async getChildren(item?: TreeNode): Promise<TreeNode[]> {
    if (item && !(item instanceof RepositoryTreeItem)) return [];
    const client = this.client();
    if (!client)
      return [
        new InfoTreeItem(
          "Connect to GitBucket",
          "Add your server and credentials to get started.",
          "gitbucket-repos.connect",
        ),
      ];
    const repository =
      item instanceof RepositoryTreeItem ? item.repository : this.selected();
    if (this.kind !== "repositories" && !repository)
      return [
        new InfoTreeItem(
          "Select a repository",
          "Choose a repository in the Repositories view.",
          "gitbucket-repos.selectRepository",
        ),
      ];
    const key =
      item instanceof RepositoryTreeItem
        ? item.repository.full_name
        : this.kind;
    const generation = this.generation;
    if (!this.cache.has(key))
      this.cache.set(key, this.load(client, repository, item));
    try {
      const result = await this.cache.get(key)!;
      return generation === this.generation ? result : this.getChildren(item);
    } catch (error) {
      if (generation !== this.generation) return this.getChildren(item);
      this.cache.delete(key);
      return [
        new InfoTreeItem(
          "Could not load data — click to retry",
          error instanceof Error ? error.message : String(error),
          `gitbucket-repos.${this.kind === "repositories" ? "refresh" : this.kind === "issues" ? "refreshIssues" : "refreshPullRequests"}`,
        ),
      ];
    }
  }
  private async load(
    client: GitBucketClient,
    repository: Repository | undefined,
    item?: TreeNode,
  ): Promise<TreeNode[]> {
    let nodes: TreeNode[];
    if (this.kind === "repositories") {
      nodes =
        item instanceof RepositoryTreeItem
          ? (
              await client.listBranches(
                item.repository.owner.login,
                item.repository.name,
              )
            ).map((branch) => new BranchTreeItem(item.repository, branch))
          : (await this.repositories()).map(
              (repo) => new RepositoryTreeItem(repo),
            );
    } else if (repository) {
      nodes =
        this.kind === "issues"
          ? (
              await client.listIssues(
                repository.owner.login,
                repository.name,
                this.state(),
              )
            ).map((issue) => new IssueTreeItem(repository, issue))
          : (
              await client.listPullRequests(
                repository.owner.login,
                repository.name,
                this.state(),
              )
            ).map((pr) => new PullRequestTreeItem(repository, pr));
    } else nodes = [];
    return nodes.length
      ? nodes
      : [
          new InfoTreeItem(
            item
              ? "No branches yet"
              : this.kind === "repositories"
                ? "No repositories found"
                : `No ${this.state()} ${this.kind === "issues" ? "issues" : "pull requests"}`,
          ),
        ];
  }
}
