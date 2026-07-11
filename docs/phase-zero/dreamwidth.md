# Dreamwidth Phase Zero inventory

Status: Complete

Inspected: 2026-07-11

Pinned repository commit: `371d8ac2917effea518e0c04bcc786cfcac2c422`
Pinned devcontainer digest: `sha256:19365e4d012402b280b20a18187f882feac676c40c2163de6f8ebb92e54cebcd`

## Repository baseline

- Upstream: `dreamwidth/dreamwidth`.
- A depth-one clone completed in 2.92 seconds in the observed WSL environment.
- The shallow checkout occupied approximately 155 MiB; its Git pack was 54.74 MiB.
- Primary implementation is Perl: approximately 870 `.pm`, 179 `.t`, and 54 `.pl` files in the inspected tree.
- The tree also contains JavaScript, SCSS/CSS, two Go modules (`src/devtool` and `src/dwtool`), and API-schema tooling.
- No Rust source, `Cargo.toml`, or `Cargo.lock` was present at the pinned commit. The V1 heterogeneous-runtime assumption should therefore describe Dreamwidth as Perl + JavaScript + Go unless a separate Rust component is identified.

## Maintained execution environment

Dreamwidth's devcontainer is also its GitHub Actions test image, making it the best initial execution baseline.

The published image contains:

- Ubuntu 22.04.
- Perl and CPAN dependencies installed under `/opt/dreamwidth-extlib`.
- MySQL, memcached, and optional Manticore Search.
- Node.js 20 with global Sass and esbuild.
- Go 1.22.2.
- Pre-built static assets under `/opt/dreamwidth-static`.
- A pre-populated MySQL seed under `/opt/dreamwidth-mysql`.

The editor devcontainer runs as root, bind-mounts the repository at `/workspaces/dreamwidth`, persists `/var/lib/mysql` in a named volume, disables SELinux labeling, and exposes the application only on a random loopback port.

Roundhouse should reuse the published image by immutable digest for the first container spike. It should not use the mutable `latest` reference recorded by `devcontainer.json`.

## Bootstrap and services

The complete `.devcontainer/setup.sh` is intended for interactive development and performs more work than an agent attempt needs. It updates schemas, loads text data, initializes tests, builds a Go utility, and seeds development content.

The fast CI workflow uses a smaller bootstrap:

1. Link the repository's development config.
2. Link pre-built static assets from the image.
3. Start MySQL.
4. Run `t/bin/initialize-db`.

The initial execution profile follows the CI bootstrap. Memcached, Manticore, and the Starman application process should be enabled only for tests or reproduction steps that require them.

## Validation ladder

The repository's current fast CI provides the initial authoritative commands:

- Formatting: changed Perl files through `tidyall`; full fallback is `tidyall --check-only --all --jobs 10`.
- Compilation: `prove -v t/00-compile.t`.
- Targeted validation: the curated request, Plack, cleaner, routing, rate-limit, authentication, posting, commenting, access-control, captcha, and settings tests in `.github/workflows/ci.yml`.
- Full validation: `prove t/*.t`, currently run nightly.

Observed GitHub Actions timings for the pinned commit:

| Operation                          |        Observed duration |
| ---------------------------------- | -----------------------: |
| Container initialization, fast CI  |               59 seconds |
| Fast CI environment setup          |               12 seconds |
| Formatting for the observed change |                2 seconds |
| Compile test                       |               29 seconds |
| Curated test groups                | approximately 98 seconds |
| Complete fast CI job               |     3 minutes 43 seconds |
| Container initialization, nightly  |               68 seconds |
| CPAN refresh, nightly              |               30 seconds |
| Full `t/*.t` suite                 |     8 minutes 17 seconds |
| Complete nightly job               |    10 minutes 13 seconds |

These are GitHub-hosted-runner measurements, not Cloudflare Container measurements.

Observed local Docker timings with the pinned image and container networking disconnected before bootstrap:

| Operation                             | Observed duration |
| ------------------------------------- | ----------------: |
| Cold image pull                       |     54.42 seconds |
| Container start with cached image     |      0.28 seconds |
| Shallow checkout inside container     |      5.68 seconds |
| Minimal CI bootstrap, including MySQL |      8.61 seconds |
| Full formatting check                 |      9.59 seconds |
| Compile test                          |     16.51 seconds |
| Curated 54-file test suite            |     59.16 seconds |

The image is `linux/amd64`, as Cloudflare requires. Registry/image inspection reported 1.118 GB, while Docker's local cumulative virtual-size accounting reported 5.397 GB. After bootstrap and validation, the writable layer was approximately 422 MB. Major live directories were approximately 399 MB for MySQL, 284 MB for the Perl dependency tree, 159 MB for the checkout, and 84 MB for static assets.

An idle post-bootstrap container used approximately 510-544 MiB and 43 processes in the observed environment. These are steady-state samples rather than peak measurements.

Cloudflare currently provides 4 GB disk on `basic` and 8 GB on `standard-1`, with image size limited by instance disk. The maintained image therefore appears to require at least `standard-1`; a derived image should target `basic` by removing interactive tools, Manticore unless requested, duplicated source/static/database layers, and other build residue. See the [current Cloudflare Container limits](https://developers.cloudflare.com/containers/platform-details/limits/).

For the initial functional implementation, use `standard-1`. Image slimming and a possible move to `basic` are explicitly deferred until the end-to-end system works.

The test image's baked source is not an acceptable workspace. One resource-sampling attempt against baked source hit fixture-file failures, while the same curated suite passed against the exact fresh checkout. Every attempt must clone or mount its pinned repository commit over the image workspace.

## Representative reproduction

Historical issue 3452 was reproduced at its pre-fix commit and verified at its fixing commit using the real Template Toolkit template with an isolated mock user. The pre-fix template rendered an empty Gift-link `href`; the fixed template rendered the expected `gift_url`. The container network was disconnected during execution. See the [reproduction bundle](dreamwidth-issue-3452-reproduction.md).

## Network inventory

Runtime attempts using the pinned image and unchanged dependency manifests should need only:

- GitHub repository read access.
- GHCR image read access.

Building or refreshing the image additionally reaches:

- Ubuntu/Debian package repositories.
- Manticore's Debian repository.
- NodeSource.
- npm.
- CPAN/MetaCPAN through `cpm`'s `metadb` resolver and module source hosts.
- `go.dev` and potentially the Go module proxy/source repositories.
- Devcontainer Feature artifacts in GHCR.

Dependency-manifest changes must explicitly request the appropriate package-network capability; they must not silently widen ordinary attempt egress.

## Initial threat model

- Repository scripts, tests, migrations, fixtures, and issue-provided commands are untrusted execution inputs.
- The maintained image runs as root because it starts system services and initializes MySQL. Roundhouse must not equate container root with authorization and must expose no host or control-plane credentials.
- The interactive devcontainer disables SELinux labeling; that flag is not part of the Roundhouse execution profile and must not be assumed available on Cloudflare.
- The image contains local development database credentials and seeded data. These are non-production fixtures, but generated database contents and logs still require per-run isolation.
- The Dockerfile uses remote installation scripts and external package repositories. Rebuilding it is a higher-egress, supply-chain-sensitive operation distinct from running the pinned image.
- CPAN dependencies are named and partly version-constrained but do not have a complete content lock. Image digest pinning is therefore essential for reproducible attempts.
- The published `latest` tag changes regularly. Only the recorded digest is acceptable for a run.
- A repository change to `.devcontainer`, dependency manifests, migrations, configuration, or GitHub workflows raises the risk floor and requires plan approval.
- MySQL and optional services must listen only inside the attempt boundary. No attempt service port is publicly exposed by default.

## Open measurements and decisions

- Confirm that the public GHCR image can be pulled by Cloudflare Containers by immutable digest.
- Determine whether Cloudflare Containers permit the required root service initialization, process model, disk use, and startup duration.
- After functional V1, compare direct reuse of the devcontainer with a derived image that starts services as root and executes repository commands as an unprivileged user.
- Peak CPU and memory sampling is deferred; `standard-1` provides substantial headroom over the observed steady-state memory.
- Replace the curated shell command with a changed-file-to-test selector before production use.
- Verify which tests require memcached, Manticore, Starman, external network access, or additional fixtures.
- Select two additional historical fixtures: one unclear bug and one risky change. Issue 3452 is the clear-bug fixture.
