<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Accelerated POC development evidence

This record covers only the development deployment authorized by
`roundhouse-accelerated-poc-dev-manifest.md`. It is evidence of POC behavior,
not a production security claim.

## Merged slices

- PR #37 accepted ADR 0008 and recorded the exact development envelope.
- PR #38 added the low-risk issue-to-draft-PR fast path.
- PR #39 added interactive qualification, clarification, and exact replanning.
- PR #40 preserved failed retry candidates, added plan-compliance evidence and
  the exact review surface, and accelerated Miniflare contracts.
- PR #41 retained existing development Worker and Container observability.

Every slice passed GitHub CI before merge. Copilot review was deferred after
the operator identified an apparent service outage; no Copilot finding was
silently ignored.

## Exact development release

The dogfood run used source commit
`3223a8f6e534e8fb00e3a2c5b3d4e1bef78439c0`, Worker version
`7b4d5f5e-fe37-42dc-adbb-5f6bad40309f`, and Container image
`roundhouse-release:3223a8f6e534e8fb00e3a2c5b3d4e1bef78439c0` at digest
`sha256:36469a45fe8bedf8dd92b48e2fe9d64728624942ec45a809abeef1b236d53213`.
The existing Worker, D1, Queue and dead-letter Queue, R2 bucket, Container
application, Access hostname, and scheduled trigger were retained. Production
was not deployed. An initial public `/rh start` on issue #42 was routed to the
existing production GitHub App and created a proposed plan there; it was not
approved, implemented, or published. The development demonstration then used
only the signed dev webhook.

## Development dogfood

Issue [#43](https://github.com/zorkian/roundhouse/issues/43) was delivered
directly to the existing signed development webhook so that the production
GitHub App could not consume the development demonstration. Roundhouse created
run `run_8b1ce72d128a662676bc5288a5741fc24b0e9f06` on exact base
`3223a8f6e534e8fb00e3a2c5b3d4e1bef78439c0`.

The first Queue delivery was stranded without a lease during closely spaced
development rollouts. The five-minute scheduler recorded
`lease_less_run_requeued` at `2026-07-14T07:25:37.633Z`; the replay was harmless
and the run completed at revision 7. Container lifecycle logs recorded checkout,
credential installation, a 32,029 ms agent stage, a 2,540 ms validation stage,
credential cleanup, and Container teardown.

The final patch changed only
`docs/dogfood/accelerated-poc-smoke.md`, contained 780 bytes, and had SHA-256
`6e234b5bbf21366da0a8f006e21739970ef13f94f94d5f7ecb5865e0dc723bd5`.
Plan compliance, diff check, formatting, Apache-2.0 licensing, typechecking, and
tests all passed. Network evidence recorded only the reviewed GitHub checkout
and model-transport hosts, disabled agent-tool and validation Internet, and
successful denied HTTP and TCP probes.

Immutable implementation evidence is retained at
`runs/run_8b1ce72d128a662676bc5288a5741fc24b0e9f06/attempts/run_8b1ce72d128a662676bc5288a5741fc24b0e9f06-prepare-1/trusted-implementation.json`.
Independent retrieval produced 4,578 bytes and SHA-256
`66e489f88c2785eeb47478b3e03ee6e3e1a04066779defcbf6986c9b717ef86b`,
matching the D1 approval binding.

The verified publication created commit
`baaa2d0043488c78a5cb4b0639e744974e8625c2` and draft PR
[#44](https://github.com/zorkian/roundhouse/pull/44). GitHub CI passed. Independent
review `review_cfc45592952d784ab3c93d42a1e524cf31594610` completed with zero
findings; its 1,339-byte evidence object is bound by SHA-256
`78ffab80d763aa19a1bffb8e20229fc43221f0a5abd561bf21ccad77ae3d06d8`.
PR #44 was then merged by the external authorized POC operator; deployed
Roundhouse itself retained no merge operation or default-branch write path.

## Known limitations

- Ordinary repository webhook delivery currently goes to the production App;
  development demonstrations require the signed dev webhook or an explicit
  routing design.
- A trusted execution lease remains 40 minutes to cover the bounded agent and
  validation budgets. Container-aware early abandonment would improve POC
  recovery latency without weakening exclusivity.
- The Access JWT available to this unattended session had expired, so durable
  demonstration inspection used read-only Wrangler queries and independently
  retrieved R2 bytes. Browser-authenticated status links remain the operator
  surface.
- The development model credentials remain the explicitly accepted temporary
  POC exception, not the production credential architecture.
