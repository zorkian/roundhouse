<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# ADR 0006: Broker GitHub publication outside execution

Status: Accepted

## Context

Roundhouse must publish an approved agent patch without granting a coding
agent or execution Container access to repository credentials. A Git push from
the execution environment would collapse the control/execution boundary and
make agent compromise equivalent to repository write access.

## Decision

The control plane owns a GitHub gateway backed by a least-privilege GitHub App.
It mints short-lived installation tokens only after exact approval and evidence
verification. The execution Container emits an immutable publication manifest
containing bounded changed-file snapshots; the trusted runner proves that the
manifest and patch describe the same validated workspace state.

The publisher uses GitHub Git Data APIs to create blobs, a tree based on the
approved base commit, one commit, and a new `codex/dogfood-*` ref. It then
creates a draft pull request and independently reads the resulting commit and
tree back. The installation credential never crosses into execution, durable
state, evidence, or logs.

Issue content is untrusted input. Repository identity, exact base, profile,
allowed paths, validation, branch, and publication policy remain reviewed
Roundhouse configuration.

## Consequences

- Agent compromise does not grant GitHub write access.
- Publication can be retried and reconciled by immutable Git object identity.
- V1 publication is limited to bounded regular files represented by the
  trusted publication manifest. Mode changes, symlinks, submodules, and large
  or binary changes are deferred.
- A future gateway implementation can replace GitHub without changing the
  coordinator or execution contracts.
