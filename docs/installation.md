# Install TIRAI

TIRAI CLI requires Node.js 20 or newer and npm.

## Linux / macOS

For a public repository/release:

```bash
curl -fsSL https://raw.githubusercontent.com/truongnat/TIRAI/main/install.sh | bash
```

This repository is currently private. Authenticate before running the installer:

```bash
export GITHUB_TOKEN="<token-with-repository-read-access>"
curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://raw.githubusercontent.com/truongnat/TIRAI/main/install.sh | bash
```

Install a specific version:

```bash
TIRAI_VERSION=1.0.0 bash install.sh
```

## Windows CMD

Download `install.cmd` from the repository, then from Command Prompt:

```cmd
set GITHUB_TOKEN=<token-with-repository-read-access>
install.cmd
```

For a public repository/release, the token is not required.

Specific version:

```cmd
set TIRAI_VERSION=1.0.0
install.cmd
```

`install.cmd` uses Windows PowerShell internally for GitHub API/download/checksum operations, while remaining directly invokable from `cmd.exe`.

## What the installer does

1. Requires Node.js >= 20 and npm.
2. Resolves the latest GitHub Release (or `TIRAI_VERSION`).
3. Downloads the `tirai-cli-*.tgz` release asset.
4. Verifies its `.sha256` release asset when present.
5. Installs the package with `npm install --global`.
6. Verifies `tirai --version`.

The installer never stores `GITHUB_TOKEN` in TIRAI configuration.

## Publishing a release

The `Release TIRAI CLI` GitHub Actions workflow runs on tags matching `v*`. It verifies the CLI, runs `npm pack`, creates a SHA256 checksum, and attaches both files to a GitHub Release.

The tag version must match `tools/intelligent/tirai-cli/package.json`.

Example for version `1.0.0`:

```bash
git tag v1.0.0
git push origin v1.0.0
```

After the workflow succeeds, `install.sh` / `install.cmd` can install that release.
