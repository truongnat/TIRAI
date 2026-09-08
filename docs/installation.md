# Install TIRAI

TIRAI CLI requires **Node.js 20+** and npm.

## Linux / macOS

Install the latest GitHub Release:

```bash
curl -fsSL https://raw.githubusercontent.com/truongnat/TIRAI/main/install.sh | bash
```

Install a specific version:

```bash
TIRAI_VERSION=1.0.0 bash install.sh
```

## Windows CMD

Download [`install.cmd`](../install.cmd) from the repository, then run:

```cmd
install.cmd
```

Install a specific version:

```cmd
set TIRAI_VERSION=1.0.0
install.cmd
```

`install.cmd` uses Windows PowerShell internally for GitHub API, download, and checksum operations while remaining directly invokable from `cmd.exe`.

## Private mirrors / forks

The installers also support authenticated GitHub repositories through `GITHUB_TOKEN` or `GH_TOKEN`.

Linux/macOS example:

```bash
export GITHUB_TOKEN="<token-with-repository-read-access>"
TIRAI_REPO="owner/private-fork" ./install.sh
```

Windows CMD example:

```cmd
set GITHUB_TOKEN=<token-with-repository-read-access>
set TIRAI_REPO=owner/private-fork
install.cmd
```

Tokens are read from the process environment and are not persisted into TIRAI workspace configuration.

## What the installer does

1. Verifies Node.js >= 20 and npm.
2. Resolves the latest GitHub Release, or the version supplied through `TIRAI_VERSION`.
3. Downloads the `tirai-cli-*.tgz` release asset.
4. Downloads and verifies the `.sha256` asset when available.
5. Installs TIRAI using `npm install --global`.
6. Verifies `tirai --version`.

## Publishing a release

The `Release TIRAI CLI` GitHub Actions workflow runs on tags matching `v*`.

```text
tag vX.Y.Z
   ↓
npm ci
   ↓
CLI verification
   ↓
npm pack
   ↓
SHA256
   ↓
GitHub Release
   ├── tirai-cli-X.Y.Z.tgz
   └── tirai-cli-X.Y.Z.tgz.sha256
```

The tag version must match `tools/intelligent/tirai-cli/package.json`.

Example for version `1.0.0`:

```bash
git tag v1.0.0
git push origin v1.0.0
```

After the release workflow succeeds, `install.sh` and `install.cmd` can install that release directly.
