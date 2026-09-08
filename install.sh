#!/usr/bin/env bash
set -euo pipefail

REPO="${TIRAI_REPO:-truongnat/TIRAI}"
VERSION="${TIRAI_VERSION:-latest}"
TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
API="https://api.github.com/repos/${REPO}"

log() { printf '[tirai] %s\n' "$*"; }
die() { printf '[tirai] ERROR: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js >= 20 is required. Install Node.js first."
command -v npm >/dev/null 2>&1 || die "npm is required. Install npm first."
command -v curl >/dev/null 2>&1 || die "curl is required."

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js >= 20 is required; found $(node --version)."

HEADERS=(-H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28')
if [ -n "$TOKEN" ]; then
  HEADERS+=(-H "Authorization: Bearer ${TOKEN}")
fi

if [ "$VERSION" = "latest" ]; then
  RELEASE_URL="${API}/releases/latest"
else
  TAG="$VERSION"
  case "$TAG" in v*) ;; *) TAG="v${TAG}" ;; esac
  RELEASE_URL="${API}/releases/tags/${TAG}"
fi

log "Resolving TIRAI release from ${REPO} (${VERSION})..."
RELEASE_JSON="$(curl -fsSL "${HEADERS[@]}" "$RELEASE_URL")" || die "Could not read GitHub release. For a private repository, set GITHUB_TOKEN (or GH_TOKEN) with repo read access."

ASSET_API_URL="$(printf '%s' "$RELEASE_JSON" | node -e '
let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{const r=JSON.parse(s); const a=(r.assets||[]).find(x=>/^tirai-cli-.*\.tgz$/.test(x.name)); if(!a) process.exit(2); process.stdout.write(a.url);});
')" || die "No tirai-cli-*.tgz asset found in the selected release."

ASSET_NAME="$(printf '%s' "$RELEASE_JSON" | node -e '
let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{const r=JSON.parse(s); const a=(r.assets||[]).find(x=>/^tirai-cli-.*\.tgz$/.test(x.name)); if(!a) process.exit(2); process.stdout.write(a.name);});
')"

SHA_API_URL="$(printf '%s' "$RELEASE_JSON" | node -e '
let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{const r=JSON.parse(s); const a=(r.assets||[]).find(x=>/\.sha256$/.test(x.name)); if(a) process.stdout.write(a.url);});
')"

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t tirai-install)"
trap 'rm -rf "$TMP_DIR"' EXIT
TGZ_PATH="${TMP_DIR}/${ASSET_NAME}"

log "Downloading ${ASSET_NAME}..."
curl -fsSL "${HEADERS[@]}" -H 'Accept: application/octet-stream' "$ASSET_API_URL" -o "$TGZ_PATH" || die "Failed to download release package."

if [ -n "$SHA_API_URL" ]; then
  SHA_FILE="${TMP_DIR}/tirai.sha256"
  curl -fsSL "${HEADERS[@]}" -H 'Accept: application/octet-stream' "$SHA_API_URL" -o "$SHA_FILE" || die "Failed to download checksum."
  EXPECTED="$(awk '{print $1}' "$SHA_FILE" | head -n 1)"
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL="$(sha256sum "$TGZ_PATH" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL="$(shasum -a 256 "$TGZ_PATH" | awk '{print $1}')"
  else
    ACTUAL="$(node -e 'const fs=require("fs"),c=require("crypto"); process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$TGZ_PATH")"
  fi
  [ "$EXPECTED" = "$ACTUAL" ] || die "SHA256 verification failed."
  log "SHA256 verified."
fi

log "Installing globally with npm..."
npm install --global "$TGZ_PATH"

command -v tirai >/dev/null 2>&1 || die "Installation completed but 'tirai' is not on PATH. Ensure your npm global bin directory is on PATH."

log "Installed $(tirai --version 2>/dev/null || printf 'TIRAI')"
log "Run: tirai --help"
