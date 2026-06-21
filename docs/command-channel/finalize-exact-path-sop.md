# Finalize Exact-Path SOP

Standard operating procedure for `approved_finalize` jobs and the local helper `scripts/joa-finalize-reviewed.js`. The helper **does not expand globs** and **does not ignore no-op paths** — every allowlist and ignore entry must match **exact pending paths** from `git status`.

## Why finalize jobs fail on retry

Common rejection messages from the helper:

| Error | Cause |
|-------|-------|
| `allowlisted paths have no pending changes` | Path on allowlist but not modified (typo, stale path, or glob like `docs/**`) |
| `ignored paths have no pending changes` | `--ignore` entry for a path that is not dirty |
| `unexpected modified paths outside allowlist/ignore list` | Dirty file not listed in allowlist or ignore |
| `paths cannot be both allowlisted and ignored` | Same path in both lists |

The worker forwards job `allowlist_paths` and `ignore_paths` verbatim to the helper. **Wrong paths in the job payload fail before git runs.**

## Step 1 — Collect exact pending paths

In the target workspace (e.g. `C:\projects\TimOS-Agent` for JOA):

```powershell
git status --short
```

Use the path column only (after the two-letter status). Examples:

```text
 M config/workspaces.json
 M lib/command-channel-status.js
?? docs/command-channel/new-doc.md
```

For renames, use the **destination** path (`git status --short` shows `old -> new`; the helper uses `new`).

Normalize mentally:

- Forward slashes in job JSON are fine (`lib/foo.js`)
- No `./` prefix
- No directory globs (`docs/**`, `*.md`, `lib/*`)

## Step 2 — Build allowlist_paths

**Rule:** Every path you intend to commit must appear **exactly** in `allowlist_paths` and must be **present in git status** as modified or untracked.

```json
"allowlist_paths": [
  "lib/command-channel-status.js",
  "docs/command-channel/no-paste-worker-loop-v0.md"
]
```

Do **not** include:

- Clean / unchanged files
- Glob patterns
- Parent directories instead of files (`docs/command-channel` when only one file changed)

## Step 3 — Build ignore_paths (only when needed)

**Rule:** List **only** paths that are **actually dirty** and must **not** be committed.

Typical use: another task left unrelated local edits (e.g. `config/workspaces.json` dirty but out of scope for this finalize).

```json
"ignore_paths": [
  "config/workspaces.json"
]
```

Do **not** include:

- Paths that are clean (helper fails: `ignored paths have no pending changes`)
- Paths already on the allowlist
- Wildcards or “just in case” entries

If nothing unrelated is dirty, use `"ignore_paths": []` or omit the field.

## Step 4 — Verify exact coverage

Pending set must equal **allowlist ∪ ignore** (as sets of normalized paths):

```text
pending = allowlist_paths + ignore_paths   (every pending path accounted for)
allowlist ∩ ignore = ∅                       (no overlap)
```

Quick local preview before submitting the job:

```powershell
node scripts/joa-finalize-reviewed.js `
  --allowlist lib/command-channel-status.js `
  --ignore config/workspaces.json `
  --message "Preview only — do not approve yet"
```

Preview mode performs the same path validation without `git add/commit/push`.

## Step 5 — Batch unrelated changes separately

If git status mixes **unrelated** work (feature A + feature B + local config drift):

1. **Do not** one-shot finalize everything.
2. Split into separate `approved_finalize` jobs with disjoint allowlists.
3. Put out-of-scope dirty paths on `ignore_paths` **only for that job** if they must stay dirty locally.
4. Or clean / stash / commit unrelated work before finalize.

One finalize job = one reviewed change set.

## Job payload checklist

Before approving `approved_finalize`:

- [ ] `workspace_ref` matches profile contract (JOA → `C:\projects\TimOS-Agent`)
- [ ] `repo_ref` matches profile contract (JOA → `TimOS-Agent`)
- [ ] `allowlist_paths` copied from current `git status --short` (exact files)
- [ ] No glob or directory-only entries
- [ ] `ignore_paths` lists only **dirty** excluded paths (or empty)
- [ ] No path appears in both lists
- [ ] `message` is the commit message (required)
- [ ] `no_source_control_actions: true` on implement jobs; finalize jobs **intentionally** perform git ops via helper after approval

## Example — good vs bad

**Good** (two doc files changed, workspaces.json dirty but excluded):

```json
{
  "allowlist_paths": [
    "docs/command-channel/no-paste-worker-loop-v0.md",
    "docs/command-channel/finalize-exact-path-sop.md"
  ],
  "ignore_paths": ["config/workspaces.json"],
  "message": "docs: no-paste worker loop and finalize path SOP"
}
```

**Bad** — glob on allowlist:

```json
"allowlist_paths": ["docs/command-channel/*"]
```

**Bad** — ignore for clean file:

```json
"ignore_paths": ["gsync/something-not-modified.js"]
```

**Bad** — allowlist missing a dirty file:

```json
"allowlist_paths": ["lib/foo.js"]
```

when `git status` also shows `M lib/bar.js` → helper reports unexpected modified paths.

## Assistant workflow for finalize jobs

1. Run `git status --short` in the job's `workspace_ref` (or ask Tim for job id after implement completes).
2. Construct exact `allowlist_paths` / `ignore_paths` from output.
3. Submit or update finalize job payload before Tim approves.
4. After worker runs, read `result.approved_finalize` and `result.summary` via command-channel — no terminal paste ([`no-paste-worker-loop-v0.md`](./no-paste-worker-loop-v0.md)).

## Implementation reference

Validation logic: `scripts/joa-finalize-reviewed.js` (`analyzePendingPaths`, `assertValidPendingPaths`).

Worker invocation: `scripts/command-channel-worker.js` (`runApprovedFinalizeForJob`).
