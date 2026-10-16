# 0.1.0

- Rewrite as strict TypeScript with a build, tests, launch configuration, and VSIX packaging.
- Fix discovery on GitBucket versions missing authenticated list endpoints.
- Preserve installation paths and credentials on cancelled/failed connections.
- Support OS-trusted certificate roots on compatible runtimes, with TLS validation enabled.
- Add shared repository selection, remembered selection, filters, cached refresh, and connection status.
- Add pagination, timeouts, branch validation, command-palette support, and manual repository discovery.
- Wire supplied SVG view icons and toolbar command icons.

# Change Log

All notable changes to the "gitbucket-repos" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- No unreleased changes.

## [0.0.1] - 2026-06-25

- Added GitBucket connection flow with SecretStorage-backed credentials.
- Added support for both username/password and personal access token authentication.
- Added repository and branch browsing in the GitBucket activity bar view.
- Added repository creation with owner selection (user or organization).
- Added branch creation from selected source branches.
- Added issue and pull request browsing views with open-in-browser actions.
- Added clone URL copy and clone integration with VS Code Git API.
- Added unit tests for GitBucket client request behavior and endpoint coverage.
- Added VSIX packaging script.