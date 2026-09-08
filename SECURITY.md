# Security Policy

## Supported versions

TIRAI is currently evolving as a single active CLI/product line. Security fixes target the latest code on `main` and the latest published release unless a release note states otherwise.

## Reporting a vulnerability

Please do **not** open a public issue for vulnerabilities that could expose credentials, arbitrary code execution, unsafe package installation, malicious source ingestion, or sensitive project data.

Use GitHub's private security reporting / Security Advisory flow when available for this repository. If that channel is unavailable, contact the repository owner privately through GitHub before publishing details.

Include enough information to reproduce the issue safely:

- affected TIRAI version or commit;
- operating system and Node.js version;
- affected command or connector;
- reproduction steps;
- expected vs actual behavior;
- impact assessment;
- minimal sanitized proof of concept.

Never include real API keys, customer documents, proprietary specifications, production URLs with credentials, or other secrets.

## Security boundaries

TIRAI is designed around several intentional safety properties:

- provider secrets are environment-owned and should not be persisted in TIRAI artifacts;
- trusted E2E and Unit mappings fail closed when missing, ambiguous, invalid, or stale;
- generated test code is deterministic and not runtime-AI-authored;
- application source is not modified as a normal side effect of execution;
- release installers verify SHA256 when checksum assets are published;
- execution outcomes come from real runners and canonical result mapping.

A report showing a bypass of any of these boundaries is security-relevant even if no credential exposure occurs.

## Disclosure

Please allow maintainers reasonable time to investigate, patch, validate, and release a fix before public disclosure.
