# Dreamwidth container spike resource review

Status: **proposed; not approved or deployed**

This review is the deployment gate required by
[ADR 0004](../decisions/0004-cloudflare-resource-governance.md). Preparing and
testing the local implementation does not authorize any Cloudflare mutation.

## Purpose

Prove that Roundhouse can start an isolated Dreamwidth environment at an exact
public commit and run the fixed Phase Zero verification action. This is an
execution-boundary spike, not an agent runtime or general-purpose shell API.

## Proposed Cloudflare resources

| Resource        | Proposed configuration                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| Worker          | `roundhouse-dev-dreamwidth-container-spike`                                                                        |
| Hostname        | Cloudflare-assigned `workers.dev` hostname only                                                                    |
| Container class | `DreamwidthContainer`                                                                                              |
| Durable Object  | Namespace created by the `DreamwidthContainer` migration                                                           |
| Container image | Cloudflare-managed registry image built from `containers/dreamwidth-spike/Dockerfile`                              |
| Base image      | Dreamwidth devcontainer pinned to digest `sha256:19365e4d012402b280b20a18187f882feac676c40c2163de6f8ebb92e54cebcd` |
| Instance type   | `standard-1`: 0.5 vCPU, 4 GiB memory, 8 GB disk                                                                    |
| Capacity        | At most one instance                                                                                               |
| Placement       | Western North America (`WNAM`)                                                                                     |
| Idle policy     | Sleep after five minutes                                                                                           |
| Secret          | New Worker-scoped `CONTAINER_SPIKE_API_TOKEN`; generated and stored outside the repository                         |
| Observability   | Worker observability enabled                                                                                       |

The derived image is expected to be large: the pinned base measured about 5.4
GB of local virtual size in Phase Zero. Uploading it will consume a material
portion of the account's managed-registry allowance and may make the first cold
start slower than a typical Cloudflare Container.

## Network and API boundary

- No custom domain, route, DNS record, Pages project, D1 database, R2 bucket,
  Queue, or Workflow is proposed.
- The public Worker health endpoint exposes only `{ "ok": true }`.
- Every instance endpoint requires the new bearer secret.
- Container internet access is disabled by default; only `github.com` is
  allowlisted so the container can fetch an exact public Dreamwidth commit.
- Inputs are restricted to a short instance identifier and a full lowercase
  40-character commit SHA.
- The container exposes only health and a fixed verification action. There is
  no arbitrary command, repository URL, image, or hostname input.
- The checkout is always created fresh inside the container; source embedded in
  the base image is never used for verification.

## Expected mutations if approved

1. Build the derived image locally and upload it to Cloudflare's managed
   registry.
2. Create or update the named Worker and Container application.
3. Apply the Durable Object migration for `DreamwidthContainer`.
4. Create and upload a new random `CONTAINER_SPIKE_API_TOKEN` secret.
5. Invoke one named instance with the pinned Dreamwidth commit and retain the
   verification result in local test notes only.

The existing `roundhouse-control-plane-spike`, its Workflow, D1 database, R2
bucket, and bearer secret will not be modified.

## Validation and success criteria

Before deployment, the repository must pass formatting, type checking, unit
tests, and a local syntax check of the container runner. A local image build and
health check should also pass when Docker Desktop is available.

The remote spike succeeds when:

1. the Worker health endpoint responds;
2. an unauthenticated instance request is rejected;
3. the container starts from the derived pinned image;
4. it checks out the requested commit from scratch;
5. the fixed format, compile, and curated tests complete and return bounded,
   hashed output metadata; and
6. a second request demonstrates the expected warm-instance behavior.

## Risks and cleanup

- The inherited Dreamwidth development image runs as root. This is acceptable
  only for this bounded spike and must be revisited before untrusted execution.
- The large image may make build, upload, storage, and cold-start behavior
  impractical. Functional proof comes before image optimization.
- The GitHub hostname allowlist must be verified against Git smart-HTTP behavior
  in the deployed environment. No broader egress should be added implicitly.
- The Worker has a public `workers.dev` address, although its execution API is
  bearer-protected. Authentication is deliberately minimal for this spike.

If the spike is rejected or complete, delete the Worker/Container deployment,
its Worker-scoped secret, managed image, and Durable Object namespace created
for this class. Confirm those resources are absent before considering cleanup
complete. The retained approval/persistence spike remains out of scope.

## Approval boundary

Approval of this document authorizes only the resources and one bounded test
described above. Any domain, route, DNS, extra egress, additional instance,
larger instance type, persistent storage, or integration with the retained
approval spike requires another explicit review.
