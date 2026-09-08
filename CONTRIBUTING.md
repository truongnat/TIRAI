# Contributing to TIRAI

Thanks for contributing to TIRAI.

TIRAI is specification-first and canonical-IR-driven. Please preserve the core trust model when proposing or implementing changes.

## Before you start

1. Search existing issues and pull requests.
2. For large changes, open a feature proposal first.
3. Keep changes focused and evidence-based.
4. Do not weaken fail-closed behavior just to make a scenario pass.

## Core invariants

Please preserve these boundaries unless the project explicitly changes direction:

- Source formats describe **what** should be tested.
- Canonical JSON is the intermediate product truth.
- Trusted mappings determine **where/how** TestCases bind to real projects.
- Missing, ambiguous, unsupported, or stale authority must fail closed.
- Generated Playwright/Vitest code is deterministic.
- Test execution uses real runners.
- Result truth comes from canonical execution results, not AI judgment.
- Do not introduce selector/symbol guessing into the trusted mapping boundary.
- Do not persist raw provider secrets.
- Do not mutate application source as a side effect of normal TIRAI execution.

## Development setup

Requirements:

- Node.js 20+
- npm

```bash
git clone https://github.com/truongnat/TIRAI.git
cd TIRAI
npm install
```

Useful checks:

```bash
npm run build:all
npm run typecheck:all
npm run lint:all
npm test --workspaces --if-present
```

For CLI-only changes:

```bash
npm run check --workspace=tools/intelligent/tirai-cli
```

## Pull requests

A good PR should include:

- a focused problem statement;
- the root cause or motivation;
- the implementation approach;
- tests or acceptance evidence;
- compatibility impact, if any;
- documentation updates when user-facing behavior changes.

Avoid unrelated cleanup in feature PRs.

## Source connectors

New source connectors should converge into the existing canonical context/semantic pipeline rather than branching downstream logic by source type.

## Test framework adapters

New framework support should consume canonical TestCases through a clear adapter boundary. Avoid embedding source-specific behavior into generators.

## Security

Do not include credentials, tokens, customer data, private specs, or secrets in issues, commits, fixtures, reports, or generated artifacts.

For vulnerabilities, follow [SECURITY.md](SECURITY.md).

## Commit style

Prefer concise conventional-style messages, for example:

```text
feat(source-ingestion): add example connector
fix(cli): fail on empty test discovery
docs: improve installation guide
test(generator): cover stale mapping behavior
```

## License

By contributing, you agree that your contributions may be distributed under the repository's MIT license.
