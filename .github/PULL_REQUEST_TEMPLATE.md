## Summary

<!-- What changed and why? Keep this focused. -->

## User / product impact

<!-- What becomes possible, safer, clearer, or more correct for users? -->

## Architecture impact

Check all that apply:

- [ ] Source ingestion / connector
- [ ] Semantic / canonical IR
- [ ] Trusted mapping boundary
- [ ] Playwright generation
- [ ] Vitest generation
- [ ] Execution / result semantics
- [ ] CLI / release / installation
- [ ] Documentation only

Explain any impact to canonical models, mapping authority, deterministic generation, or fail-closed behavior:

## Validation

<!-- Include exact commands/tests/acceptance evidence. -->

```text
npm run ...
```

## Safety checklist

- [ ] No raw secrets or customer/private specification data are included.
- [ ] Missing/ambiguous/stale authority still fails closed where applicable.
- [ ] No selector/symbol guessing was introduced across the trusted mapping boundary.
- [ ] User-facing behavior changes include documentation updates.
- [ ] Unrelated cleanup was kept out of this PR.
