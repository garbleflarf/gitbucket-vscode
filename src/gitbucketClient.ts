import {
  Account,
  Branch,
  Connection,
  Issue,
  PullRequest,
  Repository,
  RepositoryInput,
  RepositoryOwner,
} from "./types";
import { fetchWithSystemTrust } from "./transport";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
  ) {
    const hint =
      status === 401
        ? "Check your credentials or token."
        : status === 403
          ? "Your account may lack permission for this operation."
          : status === 404
            ? "This endpoint may be unsupported by your GitBucket version, or the resource may be unavailable."
            : "Check the server and try again.";
    super(`GitBucket returned HTTP ${status} for ${endpoint}. ${hint}`);
  }
}

export function normalizeBaseUrl(input: string): string {
  const url = new URL(
    /^[a-z][a-z\d+.-]*:\/\//i.test(input.trim())
      ? input.trim()
      : `https://${input.trim()}`,
  );
  if (
    !["https:", "http:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Enter an HTTP or HTTPS server URL without credentials, query parameters, or a fragment.",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/api\/v3$/i, "");
  return url.toString().replace(/\/$/, "");
}

export function validateBranchName(name: string): string | undefined {
  if (!name || name.trim() !== name)
    return "Enter a branch name without surrounding whitespace.";
  if (
    name === "@" ||
    name.startsWith("refs/") ||
    /[\s~^:?*\[\\\x00-\x1f\x7f]/.test(name) ||
    name.includes("..") ||
    name.includes("@{") ||
    name.includes("//") ||
    name.endsWith(".") ||
    name
      .split("/")
      .some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))
  ) {
    return "Enter a valid Git branch name, such as feature/my-change.";
  }
  if (name.startsWith("-")) return "A branch name cannot start with a dash.";
  return undefined;
}

export class GitBucketClient {
  readonly baseUrl: string;
  constructor(
    private readonly connection: Connection,
    private readonly fetcher: typeof fetch = fetchWithSystemTrust,
  ) {
    this.baseUrl = normalizeBaseUrl(connection.baseUrl);
  }
  private async send(
    endpoint: string,
    method = "GET",
    body?: unknown,
  ): Promise<Response> {
    const url = new URL(`${this.baseUrl}/api/v3${endpoint}`);
    const authorization =
      this.connection.authMode === "token"
        ? `token ${this.connection.token}`
        : `Basic ${Buffer.from(`${this.connection.username}:${this.connection.password}`).toString("base64")}`;
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          "User-Agent": "vscode-gitbucket-repos",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const detail =
        code &&
        [
          "SELF_SIGNED_CERT_IN_CHAIN",
          "DEPTH_ZERO_SELF_SIGNED_CERT",
          "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          "CERT_HAS_EXPIRED",
          "ERR_TLS_CERT_ALTNAME_INVALID",
        ].includes(code)
          ? ` TLS certificate validation failed (${code}). Trust the issuing CA in your operating system and use a current VS Code release; older Node runtimes may need NODE_EXTRA_CA_CERTS.`
          : "";
      throw new Error(
        `Could not reach ${url.origin}${url.pathname}.${detail} Check the server URL, network, and whether the server redirects to another URL. Requests time out after 20 seconds.`,
      );
    }
    if (!response.ok) throw new ApiError(response.status, url.pathname);
    return response;
  }
  private async json<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch {
      throw new Error(
        "GitBucket returned an invalid JSON response. Check that the URL points to the GitBucket server, rather than a login page or reverse proxy.",
      );
    }
  }
  async request<T>(
    endpoint: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const response = await this.send(endpoint, method, body);
    return response.status === 204 ? (undefined as T) : this.json<T>(response);
  }
  private async list<T>(endpoint: string): Promise<T[]> {
    const result: T[] = [];
    const pages = new Set<string>();
    let next = new URL(`${this.baseUrl}/api/v3${endpoint}`);
    next.searchParams.set("per_page", "100");
    next.searchParams.set("page", "1");
    for (let page = 1; page <= 1000; page++) {
      const apiRoot = `${this.baseUrl}/api/v3`;
      if (!next.href.startsWith(`${apiRoot}/`))
        throw new Error(
          "GitBucket returned a pagination URL outside this server API.",
        );
      const response = await this.send(next.href.slice(apiRoot.length));
      const items = await this.json<T[]>(response);
      if (!Array.isArray(items))
        throw new Error("GitBucket returned an unexpected list response.");
      const signature = JSON.stringify(items);
      // Some GitBucket versions return the entire list and ignore pagination parameters.
      if (pages.has(signature) || items.length === 0) return result;
      pages.add(signature);
      result.push(...items);
      const link = response.headers.get("link");
      const nextLink = link
        ?.split(",")
        .map((part) => part.match(/<([^>]+)>\s*;\s*rel="?next"?/))
        .find(Boolean)?.[1];
      if (nextLink) {
        next = new URL(nextLink, next);
        continue;
      }
      if (link) return result;
      // Servers may cap page size below the requested per_page value.
      // Without Link metadata, continue until an empty or repeated page.
      next.searchParams.set(
        "page",
        String(Number(next.searchParams.get("page") ?? page) + 1),
      );
    }
    throw new Error(
      "GitBucket returned too many pages. Narrow the request and try again.",
    );
  }
  async getAuthenticatedUser(): Promise<Account> {
    const user = await this.request<Account>("/user");
    if (!user?.login)
      throw new Error(
        "The server did not return an authenticated user. Check your credentials.",
      );
    return user;
  }
  async listRepositories(): Promise<Repository[]> {
    let repositories: Repository[];
    try {
      repositories = await this.list<Repository>("/user/repos");
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      const user = await this.getAuthenticatedUser();
      const organizations = await this.listOrganizations();
      // /repositories only lists public repositories; include owned and organization repositories too.
      const sources = [
        `/users/${encodeURIComponent(user.login)}/repos`,
        ...organizations.map(
          (org) => `/orgs/${encodeURIComponent(org.login)}/repos`,
        ),
        "/repositories",
      ];
      repositories = (
        await Promise.all(
          sources.map((endpoint) => this.list<Repository>(endpoint)),
        )
      ).flat();
    }
    return [
      ...new Map(repositories.map((repo) => [repo.full_name, repo])).values(),
    ].sort((a, b) => a.full_name.localeCompare(b.full_name));
  }
  async listOrganizations(): Promise<Account[]> {
    try {
      return await this.list<Account>("/user/orgs");
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      const user = await this.getAuthenticatedUser();
      try {
        return await this.list<Account>(
          `/users/${encodeURIComponent(user.login)}/orgs`,
        );
      } catch (fallbackError) {
        if (fallbackError instanceof ApiError && fallbackError.status === 404)
          return [];
        throw fallbackError;
      }
    }
  }
  private repoPath(owner: string, name: string): string {
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  }
  getRepository(owner: string, name: string): Promise<Repository> {
    return this.request(this.repoPath(owner, name));
  }
  listBranches(owner: string, name: string): Promise<Branch[]> {
    return this.list<Branch>(`${this.repoPath(owner, name)}/branches`).then(
      (items) => items.sort((a, b) => a.name.localeCompare(b.name)),
    );
  }
  listIssues(owner: string, name: string, state = "open"): Promise<Issue[]> {
    return this.list<Issue>(
      `${this.repoPath(owner, name)}/issues?state=${state}`,
    ).then((items) =>
      items
        .filter((item) => !item.pull_request)
        .sort((a, b) => b.number - a.number),
    );
  }
  listPullRequests(
    owner: string,
    name: string,
    state = "open",
  ): Promise<PullRequest[]> {
    return this.list<PullRequest>(
      `${this.repoPath(owner, name)}/pulls?state=${state}`,
    ).then((items) => items.sort((a, b) => b.number - a.number));
  }
  createRepository(
    input: RepositoryInput,
    owner: RepositoryOwner,
  ): Promise<Repository> {
    return this.request(
      owner.type === "org"
        ? `/orgs/${encodeURIComponent(owner.owner)}/repos`
        : "/user/repos",
      "POST",
      input,
    );
  }
  async createBranchFromBranch(
    owner: string,
    name: string,
    branch: string,
    source: string,
  ): Promise<void> {
    const invalid = validateBranchName(branch);
    if (invalid) throw new Error(invalid);
    const base = this.repoPath(owner, name);
    const original = await this.request<Branch>(
      `${base}/branches/${encodeURIComponent(source)}`,
    );
    await this.request(`${base}/git/refs`, "POST", {
      ref: `refs/heads/${branch}`,
      sha: original.commit.sha,
    });
  }
  static getBranchUrl(repo: Repository, branch: Branch): string {
    return `${repo.html_url}/tree/${branch.name.split("/").map(encodeURIComponent).join("/")}`;
  }
  static getIssueUrl(repo: Repository, issue: Issue): string {
    return issue.html_url ?? `${repo.html_url}/issues/${issue.number}`;
  }
  static getPullRequestUrl(repo: Repository, pr: PullRequest): string {
    return pr.html_url ?? `${repo.html_url}/pull/${pr.number}`;
  }
}
