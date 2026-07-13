<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Proposed Roundhouse production bootstrap manifest

This manifest is intentionally unapplied. It is the human approval gate for
the production half of the two-environment self-hosting cutover. Secret values,
tokens, credential paths, and private keys must never be committed or printed.

## Existing development resources retained

- Worker `roundhouse-dev-control-plane`;
- D1 database `roundhouse-dev-coordination`;
- Queues `roundhouse-dev-runs` and `roundhouse-dev-runs-dlq`;
- R2 bucket `roundhouse-dev-evidence`;
- Container application `roundhouse-dev-execution`;
- hostname `roundhouse-dev.rm-rf.rip` and its existing Access applications;
- development GitHub App `roundhouse-dev` (App `4281837`, installation
  `146147681`) with Checks read/write enabled;
- all retained development rows, evidence, secrets, and deployment history.

Merged `main` releases may update these existing resources only through the
reviewed development deployment workflow. No development resource is renamed,
deleted, or reused as production.

## Production resources to create

| Resource              | Exact name                             | Initial limit or behavior                   |
| --------------------- | -------------------------------------- | ------------------------------------------- |
| Worker                | `roundhouse-prod-control-plane`        | Scheduled recovery every five minutes       |
| D1                    | `roundhouse-prod-coordination`         | Fresh schema; additive migrations only      |
| Queue                 | `roundhouse-prod-runs`                 | One-message consumer batches; three retries |
| Dead-letter Queue     | `roundhouse-prod-runs-dlq`             | Retained for inspection                     |
| R2                    | `roundhouse-prod-evidence`             | Immutable run, review, and release evidence |
| Container application | `roundhouse-prod-execution`            | `standard-1`, `max_instances: 1`            |
| Custom hostname       | `roundhouse.rm-rf.rip`                 | Worker custom domain in the existing zone   |
| Access application    | `Roundhouse production control plane`  | Protect all production paths                |
| Access application    | `Roundhouse production GitHub webhook` | Exact `/v1/github/webhook` bypass only      |

The custom-domain operation may create the normal Cloudflare-managed DNS
record for `roundhouse.rm-rf.rip`. No other hostname, DNS record, route,
certificate, Access application, or policy may be changed.

Provisioned on 2026-07-13 from this approved manifest:

- D1 `roundhouse-prod-coordination` (`4dad8f65-56ed-4925-8333-7b0c0c59cd66`);
- Queue `roundhouse-prod-runs` (`602a122c996d4cea879e29933faed1f6`);
- dead-letter Queue `roundhouse-prod-runs-dlq`
  (`dc8f4e5dce7a4c3f90ad03b28c448a62`);
- R2 bucket `roundhouse-prod-evidence`.

The Worker, Container application, custom hostname, managed DNS record, and
Access applications remain unapplied until their deployable configuration and
access policies pass review.

## Production runtime configuration

- `ROUNDHOUSE_ENVIRONMENT=production`;
- `ROUNDHOUSE_PUBLIC_ORIGIN=https://roundhouse.rm-rf.rip`;
- `ROUNDHOUSE_REPOSITORY=zorkian/roundhouse`;
- `ROUNDHOUSE_WORKER_ID=roundhouse-prod-control-plane`;
- production GitHub App ID `4290654` and installation ID `146381255`, installed
  only on `zorkian/roundhouse`;
- Access team and production application audience identifiers assigned during
  creation;
- the same bounded execution and independent-review modes used by development.

The final D1, Queue, Worker, Container, Access, and deployment identifiers are
recorded after creation. An identifier differing from the exact named resource
above stops the bootstrap.

## Production secrets

Create encrypted Worker bindings only after their names and destinations are
verified:

- `ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY`;
- `ROUNDHOUSE_GITHUB_WEBHOOK_SECRET`;
- `ROUNDHOUSE_CODEX_AUTH_JSON`;
- `ROUNDHOUSE_CLAUDE_AUTH_JSON`.

The production GitHub App is distinct from the development App. Its callback,
user authorization, device flow, setup URL, organization permissions,
Administration, Environments, Secrets, Workflows, and Deployments permissions
remain disabled. Its repository permissions are Metadata read, Actions read,
Commit statuses read, Contents read/write, Issues read/write, Pull requests
read/write, and Checks read/write. Its subscribed events are Issues, Issue
comment, Pull request, Pull request review, Pull request review comment, Check
run, Check suite, Push, and Workflow run.

The two model secrets use the explicitly accepted bootstrap exception from ADR 0007. Each is supplied independently to production; promotion never copies or
reads a secret from development. The GitHub and Cloudflare credentials never
enter an execution Container.

## GitHub deployment environments

Create two GitHub environments:

- `roundhouse-development`, used automatically only by a successful `main`
  release workflow;
- `roundhouse-production`, requiring human approval and accepting only an
  exact development deployment evidence identity.

Each environment contains its own `CLOUDFLARE_API_TOKEN` secret and
`CLOUDFLARE_ACCOUNT_ID` variable. The tokens are separate, restricted to the
one Cloudflare account, and carry only permissions Wrangler proves necessary
for Worker scripts, Containers, D1 migrations, Queues, and R2 bindings. Current
Cloudflare token scope is account-level rather than per-Worker; the GitHub
environment and reviewed workflow are therefore part of the security boundary.
No token is available to pull-request jobs or Roundhouse agent Containers.

## Release and promotion sequence

1. CI passes for the exact merged commit.
2. Build and push one commit-tagged Container image; resolve its immutable
   digest.
3. Bundle Worker code once and hash the exact bundle.
4. Record the release manifest and its SHA-256.
5. Apply the exact additive migration set to development.
6. Upload a development Worker version binding that bundle hash and image
   digest, deploy it, and record its Cloudflare version ID.
7. Run authenticated health, storage, Container, model-transport, and
   no-credential-retention smoke checks against development.
8. Record immutable development deployment evidence.
9. Require human promotion approval bound to the release manifest and
   development evidence hashes and version ID.
10. Apply the same migration hashes to production.
11. Upload the exact Worker bundle for production bindings and the same image
    digest, then deploy and smoke-test the resulting production version.
12. Record immutable production deployment evidence.

Promotion never rebuilds source or the Container image. Cloudflare necessarily
creates a distinct production Worker version because bindings and Worker names
differ; the release contract verifies identical Worker bundle bytes.

## GitHub webhook cutover

The production App is configured with
`https://roundhouse.rm-rf.rip/v1/github/webhook` and an independent webhook
secret. After production health and Access checks pass, verify its signed ping,
then disable live webhook delivery on the development App before accepting a
production issue command. Keep the development App installed for bounded
acceptance work, but do not deliver duplicate live issue commands to it.

## Cost and retention

The bootstrap may incur at most USD 20 of incremental Cloudflare usage. Both
environments retain D1 audit rows, R2 evidence, deployment manifests, Worker
versions, and bounded demonstration evidence. Only temporary local build files
and failed unpublished image tags may be cleaned up automatically.

## Rollback

Before each deployment, record the currently active Worker version and
Container image digest. A failed development deployment rolls development back
without affecting production. A failed production smoke test immediately
deploys the previously recorded production Worker version and image digest.
D1 migrations are not reversed. The GitHub webhook returns to development only
through a separate explicit human decision; an automated rollback must not
move webhook authority between environments.

No retained database, Queue, R2 object, Worker, Access application, DNS record,
or secret is deleted by rollback.
