# ADR 0005: Diff-aware local validation

Status: Accepted

## Context

Roundhouse's first product milestone is developing Roundhouse itself through a
safe, supervised loop. Dreamwidth is the heterogeneous execution-boundary
proof, not the critical path for that bootstrap milestone.

The Dreamwidth container spike proved that a complete repository formatting
pass is a poor default for an iterative agent loop. On Cloudflare
`standard-1`, the full formatting check took about four minutes even after its
parallelism was aligned with the half-vCPU instance. Repeating that work after
every small edit would dominate feedback time.

Some repository tools, including `tidyall`, can cache successful checks. These
caches are useful when a workspace is reused and file metadata remains stable,
but a fresh checkout may invalidate an mtime-based cache. Cache availability
therefore cannot be required for correctness or acceptable basic performance.

## Decision

Fast local validation is diff-aware by default.

Each implementation attempt records its exact base commit and computes the
changed-file inventory from tracked changes, staged changes, and untracked
files. Repository profiles map those files to applicable formatters, static
checks, compile checks, and targeted tests. Commands receive only the relevant
changed paths when the underlying tool supports path selection.

Validation has three explicit levels:

- `quick`: changed-file formatting and the cheapest relevant checks, used
  during implementation iterations;
- `full`: the repository's complete local validation profile, used at an
  approval or publication gate when policy requires it; and
- `release`: authoritative CI or repository-defined release validation,
  normally delegated to GitHub Actions in V1.

Repository profiles may declare cache directories. The execution backend may
restore or retain caches keyed by repository, profile version, toolchain, and
trust boundary. A cache miss must change performance only, never the validation
result. Cache contents are not evidence; command inputs, outputs, exit status,
and hashes remain the evidence.

For Dreamwidth, normal development validation will pass the changed-file set to
`tidyall`. A full formatting pass remains available for explicit full
validation and CI. For Roundhouse dogfooding, Prettier and other path-capable
tools will receive changed paths, while repository-wide TypeScript or test
commands may still run when dependency impact or policy requires them.

## Consequences

- Small self-development changes receive substantially faster feedback.
- The execution contract must include `baseCommit`, changed files, validation
  level, selected commands, and cache metadata.
- Profiles need a safe changed-file-to-command mapping; filenames remain data
  and are passed without shell interpolation.
- Renames, deletions, generated files, and changes to global configuration or
  dependency manifests require conservative escalation to broader checks.
- GitHub Actions remains the authoritative full validation gate, preventing a
  narrow local selection from silently replacing repository-wide confidence.
- Dreamwidth-specific optimization pauses unless it blocks the Roundhouse
  self-development loop or reveals a general execution requirement.
