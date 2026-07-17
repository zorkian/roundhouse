<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Two-environment self-hosting operations

Roundhouse production and development both receive GitHub webhooks. Each
deployment accepts only its own command family, so a webhook for the other
deployment is acknowledged and ignored. A merged `main` commit is
built once, deployed to development, and retained as an immutable release
artifact. Production promotion reuses the exact Worker bundle and Container
digest after a human GitHub-environment approval; it never rebuilds them.

## GitHub environments

Create `roundhouse-development` with no required reviewer. Define:

- secret `CLOUDFLARE_API_TOKEN` for the development deployment;
- secrets `CLOUDFLARE_ACCESS_CLIENT_ID` and
  `CLOUDFLARE_ACCESS_CLIENT_SECRET` for a development-only Access service token;
- variable `CLOUDFLARE_ACCOUNT_ID`;
- variable `CLOUDFLARE_D1_DATABASE_ID` set to
  `87a4098a-a829-4e0b-80c6-43e2eaf34ddc`;
- variable `CLOUDFLARE_ACCESS_AUD` set to the existing development Access
  application audience.

Create `roundhouse-production` with `zorkian` as a required reviewer and allow
deployments only from `main`. Define an independent Cloudflare token plus the
same two Access secrets and three variables, using a production-only Access
service token and production D1
`4dad8f65-56ed-4925-8333-7b0c0c59cd66` and the production Access audience.

Neither token is available to pull-request CI, Roundhouse, or an execution
Container. GitHub environment protection is part of the bootstrap security
boundary because Cloudflare API tokens cannot be restricted to one Worker.

## Development release

For V1 maintainer acceptance, Roundhouse's product responsibility ends with the
merged pull request and closed issue. The release and deployment evidence
described here is Roundhouse engineering evidence, not a product responsibility
or maintainer acceptance requirement.

`Release development` runs after each merge to `main`:

1. run repository checks;
2. build one `linux/amd64` image tagged with the exact source commit;
3. push it once and resolve its registry digest;
4. bundle the Worker once and create the release manifest;
5. apply the manifest's ordered additive migrations to development;
6. upload and deploy that exact Worker bundle with the immutable image using a
   staged Container rollout;
7. authenticate with the environment-specific Access service token and run a
   unique credential-free Container canary that must report the exact image
   commit;
8. verify D1 readiness and outer Worker health; and
9. retain the manifest, bundle, canary, readiness, smoke response, and exact
   deployment evidence as one GitHub Actions artifact.

The artifact and successful workflow-run ID are the production promotion
input. A development failure does not affect production.

## Production promotion

Every successful `Release development` run automatically starts a `Promote
production` workflow with the exact successful run ID. The protected
`roundhouse-production` environment pauses before any secret or deployment
capability becomes available; the operator only reviews and approves or rejects
the pending deployment. Manual dispatch with a development run ID remains an
emergency fallback. Approval records the actual GitHub environment reviewer and
binds the exact release-manifest bytes, development evidence bytes, development
Worker version, Worker bundle, Container digest, and migration set.

After approval, the workflow checks out the manifest's source commit, verifies
the bindings, applies the same additive migrations, uploads the retained Worker
bundle without rebuilding it, references the same Container digest, deploys,
performs the same exact-image Container canary, readiness and health checks, and
retains production evidence.

Both environments permit up to ten distinct execution attempts concurrently.
Queue concurrency is matched to that ceiling. New attempts move immediately to
the new image. Already-running attempts remain on their original image and are
protected for the existing 40-minute whole-attempt budget; their normal command
and lease timeouts remain authoritative. Cloudflare then permits up to 15
minutes for the runner to drain after `SIGTERM`. The runner refuses new work
and drains on `SIGTERM`; normal completed attempts stop gracefully, while
explicit cancellation may still destroy a failed instance immediately. See the
[graceful rollout manifest](../cloudflare/roundhouse-graceful-rollout-manifest.md).

Rollback redeploys a previously retained Worker version and image digest. It
never reverses D1 migrations or changes either App's webhook subscription.

## GitHub-native feedback

Use `/rhd` (or `/roundhouse-dev`) for development and `/rh` (or
`/roundhouse`) for production. Every follow-up command emitted by Roundhouse
uses the same command family as the environment that created the plan or run.
The environment is also retained in GitHub task source metadata, idempotency
identity, publication branch name, and mutable GitHub comment markers. This
keeps the two Apps from consuming, publishing, or overwriting each other's
work while they are installed on the same repository.

An authorized reviewer can request a bounded follow-up from a pull-request
review, review comment, or pull-request conversation comment:

```text
/rh revise

Describe the requested change here.
```

Roundhouse accepts this only from `zorkian`, only for the exact published pull
request and its single current run and head. Feedback is untrusted
input and cannot widen allowed paths, validation, credentials, network access,
approval, or publication authority. The new patch follows the ordinary exact
evidence and human approval path.

## Bootstrap cutover

Before the first production issue command:

1. install the four approved production Worker secrets directly in Cloudflare;
2. create and verify the production Access applications;
3. complete one development release and approved production promotion;
4. verify the signed production GitHub App ping and authenticated dashboard;
5. enable webhook delivery on both GitHub Apps;
6. verify `/rhd status` is ignored by production and `/rh status` is ignored
   by development;
7. run one bounded issue-based task in each environment.

Development remains the normal dogfood path. Production remains available as a
fallback when development is unhealthy.
