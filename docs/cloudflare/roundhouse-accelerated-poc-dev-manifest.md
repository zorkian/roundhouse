<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Accelerated POC development manifest

Status: approved on 2026-07-13; unapplied by this commit.

## Trusted execution Workflow amendment

Approved on 2026-07-14. This amendment authorizes one development Cloudflare
Workflow named `roundhouse-dev-trusted-execution`, bound to the existing
`roundhouse-dev-control-plane` Worker. It may use only the existing development
D1 database, Queue, R2 bucket, Container application and image, credentials,
hostname, and Access boundary named below. Additive D1 migrations and a
development deployment are authorized with up to USD 5 of incremental usage.
No production resource or configuration may be changed.

The Workflow is the durable owner of long-running trusted implementation
attempts. Queue consumers only create an idempotently named Workflow instance
and acknowledge delivery; they do not wait for agent execution or validation.
The Workflow does not receive or persist credentials in its event parameters or
step results. The existing narrow Codex credential exception remains confined
to the disposable Container attempt.

This manifest records the complete external mutation envelope for implementing
ADR 0008 and demonstrating the accelerated POC workflow. It authorizes changes
only to the existing development deployment. Production is explicitly outside
the envelope.

## Existing development resources

Roundhouse may retain and update only:

- Worker `roundhouse-dev-control-plane`;
- D1 database `roundhouse-dev-coordination`;
- Queue `roundhouse-dev-runs` and its existing dead-letter Queue
  `roundhouse-dev-runs-dlq`;
- R2 bucket `roundhouse-dev-evidence`;
- Durable Object class `RoundhouseExecutionContainer` and its existing
  Container application;
- execution image `roundhouse-dev-execution` with `standard-1`, one maximum
  instance, and one active demonstration;
- hostname `roundhouse-dev.rm-rf.rip` and its existing Access applications;
- the existing five-minute scheduled trigger;
- existing Worker and Container observability with persisted invocation logs;
  and
- the existing development GitHub App installation for `zorkian/roundhouse`.

Allowed mutations are additive D1 migrations, development-only Worker and
Container versions, development-only Wrangler bindings, retained diagnostic
rows and evidence, and rollback to a previously healthy development version.
The incremental Cloudflare and model-usage ceiling is USD 20.

Except for the single Workflow authorized by the amendment above, no new
Worker, database, Queue, bucket, Durable Object class, Container application,
hostname, DNS record, route, Access application, service token, secret,
certificate, billing plan, or unrelated Cloudflare resource is authorized. No
production resource may be read as a test dependency or mutated, deployed,
promoted, or rolled back.

## Credential boundary

The existing encrypted `ROUNDHOUSE_CODEX_AUTH_JSON` and
`ROUNDHOUSE_CLAUDE_AUTH_JSON` development exceptions remain available only to
the trusted disposable Container agent during its bounded attempt. Model
transport remains host-allowlisted. Agent tools and repository commands remain
network-disabled.

GitHub App, Cloudflare, Access, deployment, webhook, and other control-plane
credentials remain outside the Container. No credential, authorization header,
webhook secret, service token, or known secret value may be committed, printed,
logged, stored in D1 or R2, retained as evidence, baked into an image, or survive
Container teardown.

## Lean POC policy

The development deployment may make draft pull requests the ordinary review
surface for low-risk work. A separate plan approval and patch/evidence hash
command is not required when deterministic repository policy classifies the
work as low risk. Internal hashes may remain for idempotency, retry, and safe
publication.

Pre-publication approval remains required for protected paths, dependencies or
lockfiles, migrations, repository or deployment configuration, credential or
security-policy changes, unusually large or cross-component patches, and
anything else required by repository policy.

The publication broker remains separate from the coding agent. It may create
work only in the enrolled repository and Roundhouse branch namespace and may
open only draft pull requests. The deployed Roundhouse application receives no
merge operation and no default-branch write path.

## GitHub demonstrations

Bounded development demonstrations may create and close clearly labeled issues,
branches, comments, checks, and draft pull requests in `zorkian/roundhouse`.
These are test artifacts, not outreach. No person or organization may be
contacted, no human reviewer may be requested, and no unrelated GitHub object
may be created.

## Deployment sequence

1. Verify the Wrangler configuration still names exactly the resources above.
2. Run formatting, Apache-2.0 validation, typechecking, and tests locally.
3. Apply only additive development D1 migrations.
4. Deploy the existing development Worker and execution image;
5. run authenticated development smoke and dogfood demonstrations; and
6. retain run IDs, version IDs, image digest, timings, and diagnostic links.

Rollback restores the previously healthy development Worker version and image.
Additive migrations, retained rows, and evidence remain. Destructive rollback
or cleanup is not authorized.
