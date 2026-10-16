import * as vscode from "vscode";
import { GitBucketClient, validateBranchName } from "./gitbucketClient";
import { RepositoryInput, RepositoryOwner } from "./types";

export async function promptForRepository(): Promise<
  RepositoryInput | undefined
> {
  const name = await vscode.window.showInputBox({
    title: "Create repository · 1/4",
    prompt: "Repository name",
    ignoreFocusOut: true,
    validateInput: (value) =>
      /^[A-Za-z0-9_.-]+$/.test(value.trim()) &&
      ![".", ".."].includes(value.trim())
        ? undefined
        : "Use letters, numbers, dots, underscores, and dashes.",
  });
  if (!name) return;
  const description = await vscode.window.showInputBox({
    title: "Create repository · 2/4",
    prompt: "Description (optional)",
    ignoreFocusOut: true,
  });
  if (description === undefined) return;
  const visibility = await vscode.window.showQuickPick(
    [
      { label: "Private", value: true },
      { label: "Public", value: false },
    ],
    {
      title: "Create repository · 3/4",
      placeHolder: "Who can see this repository?",
      ignoreFocusOut: true,
    },
  );
  if (!visibility) return;
  const initialize = await vscode.window.showQuickPick(
    [
      { label: "Initialize with a README", value: true },
      { label: "Empty repository", value: false },
    ],
    { title: "Create repository · 4/4", ignoreFocusOut: true },
  );
  if (!initialize) return;
  return {
    name: name.trim(),
    description: description.trim(),
    private: visibility.value,
    auto_init: initialize.value,
  };
}
export async function pickRepositoryOwner(
  client: GitBucketClient,
): Promise<RepositoryOwner | undefined> {
  const [user, organizations] = await Promise.all([
    client.getAuthenticatedUser(),
    client.listOrganizations(),
  ]);
  const choices = [
    {
      label: user.login,
      description: "Personal account",
      target: { type: "user" as const, owner: user.login },
    },
    ...organizations.map((org) => ({
      label: org.login,
      description: "Organization",
      target: { type: "org" as const, owner: org.login },
    })),
  ];
  const choice = await vscode.window.showQuickPick(
    [
      ...choices,
      {
        label: "Other organization…",
        description: "Enter an organization you can create repositories in",
        target: { type: "org" as const, owner: "" },
      },
    ],
    { title: "Repository owner", ignoreFocusOut: true },
  );
  if (!choice) return;
  if (choice.target.owner) return choice.target;
  const owner = await vscode.window.showInputBox({
    prompt: "Organization login",
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim() && !value.includes("/")
        ? undefined
        : "Enter an organization login.",
  });
  return owner?.trim() ? { type: "org", owner: owner.trim() } : undefined;
}
export function promptForBranchName(): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    title: "Create branch",
    prompt: "New branch name",
    ignoreFocusOut: true,
    validateInput: validateBranchName,
  });
}
