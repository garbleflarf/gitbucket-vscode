import * as vscode from "vscode";
import { GitBucketClient, normalizeBaseUrl } from "./gitbucketClient";
import { Connection } from "./types";

const keys = [
  "gitbucket.baseUrl",
  "gitbucket.authMode",
  "gitbucket.username",
  "gitbucket.password",
  "gitbucket.token",
] as const;
export class ConnectionManager {
  private current?: Connection;
  constructor(private readonly context: vscode.ExtensionContext) {}
  get connection(): Connection | undefined {
    return this.current;
  }
  async restore(): Promise<void> {
    const [baseUrl, authMode, username, password, token] = await Promise.all(
      keys.map((key) => this.context.secrets.get(key)),
    );
    if (baseUrl && authMode === "token" && token)
      this.current = { baseUrl, authMode, token };
    else if (baseUrl && authMode === "basic" && username && password)
      this.current = { baseUrl, authMode, username, password };
  }
  async connect(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration("gitbucketRepos");
    const previous = this.current;
    const baseUrl = await vscode.window.showInputBox({
      title: "Connect to GitBucket · 1/3",
      prompt:
        "Server URL (include any installation path, for example https://host/gitbucket)",
      value: previous?.baseUrl ?? config.get<string>("baseUrl", ""),
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value.trim()) return "Enter your GitBucket server URL.";
        try {
          normalizeBaseUrl(value);
          return undefined;
        } catch (error) {
          return (error as Error).message;
        }
      },
    });
    if (!baseUrl) return false;
    const preferred =
      previous?.authMode ?? config.get<string>("preferredAuthMode", "token");
    const modes = [
      { label: "Personal access token", mode: "token" as const },
      { label: "Username and password", mode: "basic" as const },
    ].sort(
      (a, b) => Number(b.mode === preferred) - Number(a.mode === preferred),
    );
    const selected = await vscode.window.showQuickPick(modes, {
      title: "Connect to GitBucket · 2/3",
      placeHolder: "Choose authentication",
      ignoreFocusOut: true,
    });
    if (!selected) return false;
    let candidate: Connection;
    const normalized = normalizeBaseUrl(baseUrl);
    if (selected.mode === "token") {
      const token = await vscode.window.showInputBox({
        title: "Connect to GitBucket · 3/3",
        prompt: "Personal access token (stored securely in VS Code)",
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) =>
          value.trim() ? undefined : "Enter your token.",
      });
      if (!token) return false;
      candidate = {
        baseUrl: normalized,
        authMode: "token",
        token: token.trim(),
      };
    } else {
      const username = await vscode.window.showInputBox({
        title: "GitBucket username",
        ignoreFocusOut: true,
        value: previous?.authMode === "basic" ? previous.username : "",
        validateInput: (value) =>
          value.trim() ? undefined : "Enter your username.",
      });
      if (!username) return false;
      const password = await vscode.window.showInputBox({
        title: "GitBucket password",
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => (value ? undefined : "Enter your password."),
      });
      if (!password) return false;
      candidate = {
        baseUrl: normalized,
        authMode: "basic",
        username: username.trim(),
        password,
      };
    }
    const user = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Verifying GitBucket connection…",
      },
      () => new GitBucketClient(candidate).getAuthenticatedUser(),
    );
    // A cancelled or failed verification never deletes a working connection.
    await this.context.secrets.store(keys[0], candidate.baseUrl);
    await this.context.secrets.store(keys[1], candidate.authMode);
    if (candidate.authMode === "token") {
      await this.context.secrets.store(keys[4], candidate.token);
      await Promise.all([
        this.context.secrets.delete(keys[2]),
        this.context.secrets.delete(keys[3]),
      ]);
    } else {
      await this.context.secrets.store(keys[2], candidate.username);
      await this.context.secrets.store(keys[3], candidate.password);
      await this.context.secrets.delete(keys[4]);
    }
    this.current = candidate;
    void vscode.window.showInformationMessage(
      `Connected to GitBucket as ${user.login}.`,
    );
    return true;
  }
  async clear(): Promise<void> {
    await Promise.all(keys.map((key) => this.context.secrets.delete(key)));
    this.current = undefined;
  }
}
