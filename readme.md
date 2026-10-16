# GitBucket Repos

Browse GitBucket repositories, branches, issues, and pull requests in VS Code. This folder contains the TypeScript rewrite of the recovered extension.

## Install and connect

Install `gitbucket-repos-0.1.0.vsix` using **Extensions > ... > Install from VSIX**, then open the GitBucket activity bar view and select **Connect to GitBucket**.

Enter your server URL, choose a personal access token or username/password, and enter your credentials. Bare hostnames use HTTPS. URLs with an installation path, such as `https://host/gitbucket`, and pasted `/api/v3` URLs are supported. Credentials are stored in VS Code SecretStorage after verification. Cancelling or failing verification preserves the previous working credentials.

Use **GitBucket: Clear Stored Credentials** to disconnect. The status bar shows your connection and selected repository; click it to change connection.

## Browse and create

- Select a repository to populate Issues and Pull Requests. Expand it to inspect branches. Selection is remembered per workspace and server.
- Use the filter button for open, closed, or all items. Refresh keeps your selection without prompting again.
- Repository context menus offer branch creation, clone, copy clone URL, and open in browser. Commands also work from the command palette.
- **Create Repository** offers personal or organization ownership, visibility, and README initialization. Use **Other organization...** if discovery omits an organization. The server checks permissions.
- **Create Branch** works from a repository, branch, or command palette. Empty repositories need an initial commit first.
- **Add Repository by Name** (`owner/repository`) includes private collaborator repositories omitted by older APIs. Added names are remembered per workspace and server and checked against your current permissions.

## Compatibility

Some GitBucket versions return 404 for `GET /api/v3/user/repos` and `/user/orgs` even with valid credentials. Authentication uses `/user`. Repository discovery tries `/user/repos`, then your account repositories, organization repositories, and `/repositories` (public only). Organization discovery falls back to `/users/{login}/orgs`. Authentication and permission errors are reported rather than treated as unsupported endpoints.

Lists follow pagination links or numbered pages. Repeated pages from servers ignoring pagination are detected. Installation paths are preserved. Requests time out after 20 seconds; errors identify endpoints without exposing credentials or arbitrary response bodies.

HTTPS uses Node certificate roots plus OS-trusted roots when the runtime supports `tls.getCACertificates` (Node 22.15+). Certificate verification remains enabled. On older runtimes, update VS Code or configure `NODE_EXTRA_CA_CERTS` before launching it. Redirects are rejected; enter the final server URL.

The supplied SVGs in `icns/` are wired into the activity bar and views. Toolbar commands have theme-aware icons. Settings provide a default URL for the next connection and a preferred authentication mode.

The extension browses data and creates repositories/branches. It does not edit issues, merge pull requests, or manage branch protection. Unsupported write endpoints are reported as server errors.

## Development

Use Node.js 22+ for development tools. Open this folder in VS Code, run `npm install`, then F5 to launch an Extension Development Host. The launch task compiles TypeScript.

```text
npm run check          Type-check without emitting
npm test               Compile and run regression tests
npm run watch          Recompile while editing
npm run package:vsix   Compile and package an installable VSIX
```

Source lives in `src/`; compiled JavaScript and maps live in `dist/`. Tests use mocked APIs and local HTTP servers, never stored credentials. Packages exclude source, tests, development dependencies, and source maps.

## Validation

Read-only checks against the supplied instance verified authentication, discovery of 11 repositories, organization discovery, and branch/issue/pull-request reads for one repository. No remote repositories, branches, issues, or settings were created or changed. Creation requests are tested with mocks. UI behavior is checked with VS Code API mocks; a real Extension Development Host visual and interaction pass remains necessary.
