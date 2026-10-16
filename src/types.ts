export interface Account {
  login: string;
  type?: string;
}
export interface Repository {
  id: number;
  name: string;
  full_name: string;
  description?: string;
  private: boolean;
  default_branch?: string;
  owner: Account;
  html_url: string;
  clone_url: string;
}
export interface Branch {
  name: string;
  commit: { sha: string };
}
export interface Issue {
  number: number;
  title: string;
  state: string;
  html_url?: string;
  user?: Account;
  pull_request?: unknown;
}
export interface PullRequest extends Issue {
  head?: { ref: string };
  base?: { ref: string };
}
export type Connection = { baseUrl: string } & (
  | { authMode: "token"; token: string }
  | { authMode: "basic"; username: string; password: string }
);
export interface RepositoryInput {
  name: string;
  description: string;
  private: boolean;
  auto_init: boolean;
}
export interface RepositoryOwner {
  type: "user" | "org";
  owner: string;
}
