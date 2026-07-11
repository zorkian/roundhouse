# Spike 0001: Cloudflare approval and persistence path

Status: Passed
Date: 2026-07-11

## Question

Can a Cloudflare Worker create a durable Workflow, project state and append-only events into D1, wait for a revision-bound human approval, persist immutable evidence in R2, and resume without exposing account credentials to application code?

## Implementation

The disposable `apps/control-plane-spike` application provides:

- `POST /runs` with caller idempotency keys.
- `GET /runs/:id` with D1 projections, event history, artifact metadata, and Workflow status.
- `POST /runs/:id/approve` with exact plan-revision binding.
- `POST /runs/:id/cancel` with Workflow termination.
- A Workflow that durably waits for `plan_approved`, writes an approval artifact to R2, and completes the D1 projection.
- A bearer token required for every endpoint except `/health`. The token is a Worker secret and its local copy is outside the repository.

Development resources:

- Worker: `roundhouse-control-plane-spike`
- Workflow: `roundhouse-approval-spike`
- D1: `roundhouse-spike`
- R2: `roundhouse-spike-artifacts`

## Observations

- Worker startup reported 9-10 ms.
- Deployment uploaded approximately 570 KiB uncompressed and 86 KiB compressed.
- A new run reached `awaiting_plan_approval` with both creation and wait-state events in D1.
- Approval for the wrong plan revision returned HTTP 409 and did not resume the Workflow.
- Matching approval resumed the Workflow and produced a completed run, approval event, completion event, and R2 artifact.
- The approval-to-completion interval was under one second in the observed run.
- The downloaded artifact was 243 bytes and its computed SHA-256 exactly matched D1 metadata.
- Repeating the original start request returned the same run with `created: false`.
- A separate waiting run terminated successfully and reported Workflow status `terminated`.
- Unauthenticated run access returned HTTP 401; the locally stored bearer token succeeded.

## Decision

Go for the Workflow + D1 projection + R2 immutable-payload architecture. The spike demonstrates the central durable approval path required by V1.

The spike resources remain available for further experiments. After verification, the two disposable test runs, their D1 events and metadata, the R2 approval artifact, and the local downloaded copy were deleted. The D1 schema, authenticated Worker, Workflow, empty R2 bucket, and external local bearer token were retained.

## Known gaps before production use

- A D1 insert followed by a failed Workflow creation needs reconciliation or an outbox; the spike records failure but does not automatically recover it.
- Approval persistence and `sendEvent` are separate external effects. The endpoint is retryable, but production needs an explicit effect/outbox record and reconciliation.
- Cancellation termination and projection updates likewise require reconciliation after partial failure.
- Bearer authentication is intentionally minimal. GitHub-authenticated actor identity and authorization replace it in the walking skeleton.
- D1 event rows use the spike's reduced envelope rather than the complete V1 event envelope.
- Retention, redaction, budget enforcement, rate limits, and artifact access controls are not part of this spike.
- No conclusion about D1 index scale or Cloudflare Container suitability is implied.
