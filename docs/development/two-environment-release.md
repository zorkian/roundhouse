<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Two-environment self-hosting operations

Roundhouse production receives authoritative GitHub webhooks and coordinates
work against the isolated development deployment. A merged `main` commit is
built once, deployed to development, and retained as an immutable release
artifact. Production promotion reuses the exact Worker bundle and Container
digest after a human GitHub-environment approval; it never rebuilds them.

## GitHub environments

Create `roundhouse-development` with no required reviewer. Define:

- secret `CLOUDFLARE_API_TOKEN` for the development deployment;
- variable `CLOUDFLARE_ACCOUNT_ID`;
- variable `CLOUDFLARE_D1_DATABASE_ID` set to
  `87a4098a-a829-4e0b-80c6-43e2eaf34ddc`;
- variable `CLOUDFLARE_ACCESS_AUD` set to the existing development Access
  application audience.

Create `roundhouse-production` with `zorkian` as a required reviewer and allow
deployments only from `main`. Define an independent Cloudflare token plus the
same three variables, using production D1
`4dad8f65-56ed-4925-8333-7b0c0c59cd66` and the production Access audience.

Neither token is available to pull-request CI, Roundhouse, or an execution
Container. GitHub environment protection is part of the bootstrap security
boundary because Cloudflare API tokens cannot be restricted to one Worker.

## Development release

`Release development` runs after each merge to `main`:

1. run repository checks;
2. build one `linux/amd64` image tagged with the exact source commit;
3. push it once and resolve its registry digest;
4. bundle the Worker once and create the release manifest;
5. apply the manifest's ordered additive migrations to development;
6. upload and deploy that exact Worker bundle with the immutable image;
7. smoke-test `/health` and retain the manifest, bundle, smoke response, and
   exact deployment evidence as one GitHub Actions artifact.

The artifact and successful workflow-run ID are the production promotion
input. A development failure does not affect production.

## Production promotion

Run `Promote production` manually with the successful development workflow-run
ID. The protected `roundhouse-production` environment pauses before any secret
or deployment capability becomes available. Approval records the GitHub actor
and binds the exact release-manifest bytes, development evidence bytes,
development Worker version, Worker bundle, Container digest, and migration set.

After approval, the workflow checks out the manifest's source commit, verifies
the bindings, applies the same additive migrations, uploads the retained Worker
bundle without rebuilding it, references the same Container digest, deploys,
smoke-tests, and retains production evidence.

Rollback redeploys a previously retained Worker version and image digest. It
never reverses D1 migrations or automatically moves webhook authority.

## GitHub-native feedback

An authorized reviewer can request a bounded follow-up from a pull-request
review, review comment, or pull-request conversation comment:

```text
/rh revise RUN_ID REVISION EXACT_HEAD_SHA

Describe the requested change here.
```

Roundhouse accepts this only from `zorkian`, only for the exact published pull
request, current run revision, and current head commit. Feedback is untrusted
input and cannot widen allowed paths, validation, credentials, network access,
approval, or publication authority. The new patch follows the ordinary exact
evidence and human approval path.

## Bootstrap cutover

Before the first production issue command:

1. install the four approved production Worker secrets directly in Cloudflare;
2. create and verify the production Access applications;
3. complete one development release and approved production promotion;
4. verify the signed production GitHub App ping and authenticated dashboard;
5. disable webhook delivery on the development App;
6. enable production App delivery and run one bounded issue-based task.

Development remains installed for acceptance testing, but both Apps must never
deliver the same live issue command.
