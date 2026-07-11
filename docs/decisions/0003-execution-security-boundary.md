# ADR 0003: Separate agent, execution, and capability contracts

Status: Accepted

## Context

Agent runtimes, repository processes, and authorized external operations have different trust and lifecycle requirements. Combining them would let provider or container details leak into policy decisions.

## Decision

Define separate contracts for agent sessions, execution backends, and capability brokers. Execution environments receive short-lived, attempt-scoped capabilities and never receive long-lived control-plane or GitHub App credentials.

Repository execution is configured through a versioned, schema-validated YAML profile. Commands execute without an implicit shell unless a profile explicitly introduces a reviewed script.

## Consequences

- Agent providers and execution backends can be replaced independently.
- Authorization remains in the control plane and capability broker.
- Repository profiles become security-sensitive, versioned inputs.
