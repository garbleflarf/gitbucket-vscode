import * as vscode from "vscode";
import { Branch, Issue, PullRequest, Repository } from "./types";

export class RepositoryTreeItem extends vscode.TreeItem {
  constructor(readonly repository: Repository) {
    super(repository.full_name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "repository";
    this.description = repository.private ? "private" : undefined;
    this.tooltip = `${repository.full_name}\n${repository.description ?? ""}\nDefault branch: ${repository.default_branch ?? "none"}`;
    this.iconPath = new vscode.ThemeIcon(repository.private ? "lock" : "repo");
    this.command = {
      command: "gitbucket-repos.selectRepository",
      title: "Select Repository",
      arguments: [this],
    };
  }
}
export class BranchTreeItem extends vscode.TreeItem {
  constructor(
    readonly repository: Repository,
    readonly branch: Branch,
  ) {
    super(branch.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "branch";
    this.description =
      branch.name === repository.default_branch
        ? "default"
        : branch.commit.sha.slice(0, 7);
    this.tooltip = `${branch.name}\n${branch.commit.sha}`;
    this.iconPath = new vscode.ThemeIcon("git-branch");
    this.command = {
      command: "gitbucket-repos.openBranch",
      title: "Open Branch",
      arguments: [this],
    };
  }
}
export class IssueTreeItem extends vscode.TreeItem {
  constructor(
    readonly repository: Repository,
    readonly issue: Issue,
  ) {
    super(
      `#${issue.number} ${issue.title}`,
      vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = "issue";
    this.description = issue.state;
    this.tooltip = `${issue.title}\n${issue.state}${issue.user ? ` · ${issue.user.login}` : ""}`;
    this.iconPath = new vscode.ThemeIcon(
      issue.state === "open" ? "issues" : "issue-closed",
    );
    this.command = {
      command: "gitbucket-repos.openIssue",
      title: "Open Issue",
      arguments: [this],
    };
  }
}
export class PullRequestTreeItem extends vscode.TreeItem {
  constructor(
    readonly repository: Repository,
    readonly pullRequest: PullRequest,
  ) {
    super(
      `#${pullRequest.number} ${pullRequest.title}`,
      vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = "pullRequest";
    this.description = pullRequest.state;
    this.tooltip = `${pullRequest.title}\n${pullRequest.head?.ref ?? "?"} → ${pullRequest.base?.ref ?? "?"}`;
    this.iconPath = new vscode.ThemeIcon("git-pull-request");
    this.command = {
      command: "gitbucket-repos.openPullRequest",
      title: "Open Pull Request",
      arguments: [this],
    };
  }
}
export class InfoTreeItem extends vscode.TreeItem {
  constructor(label: string, detail?: string, command?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "info";
    this.tooltip = detail ?? label;
    this.iconPath = new vscode.ThemeIcon("info");
    if (command) this.command = { command, title: label };
  }
}
export type TreeNode =
  | RepositoryTreeItem
  | BranchTreeItem
  | IssueTreeItem
  | PullRequestTreeItem
  | InfoTreeItem;
