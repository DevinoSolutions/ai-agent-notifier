# Audit passes

Each repo-wide audit/improvement pass produces one JSON record in this directory, validated by [`schema.json`](schema.json).

- **File naming**: `YYYY-MM-DD-<slug>.json` (e.g. `2026-07-09-second-pass.json`)
- **Finding IDs are stable**: prefix by domain (`RT` runtime, `CL` CLI, `TC` tests/CI, `MD` meta/docs, `SN` observability) so later passes can reference earlier findings.
- **Every finding carries its resolution**: `fixed`, `deferred` (with a TODO at the code site), `wont_fix` (with reason), or `documented`. A finding without evidence (`file:line`) doesn't belong here.
- **Verification is part of the record**: what commands/tests proved the fix, and which verifications were blocked (missing envs/permissions) — never claim green without evidence.

Validate a record:

```bash
npx ajv-cli validate -s docs/audits/schema.json -d docs/audits/2026-07-09-second-pass.json
```

Process notes for future passes: rebuild the knowledge graph first (`/graphify . --update`), use it to guide naming/coupling/duplication decisions, run discovery with scoped subagents, act only on high-confidence verified findings, and deliver on one branch → one PR (every push triggers the paid live-CI suite).
