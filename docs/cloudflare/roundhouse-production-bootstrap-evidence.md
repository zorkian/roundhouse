<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Roundhouse production bootstrap evidence

This report records the first immutable Roundhouse promotion from development
to production. Secret values, credentials, and temporary local artifacts are
intentionally omitted.

## Immutable release identity

| Evidence                 | Identity                                                                  |
| ------------------------ | ------------------------------------------------------------------------- |
| Source commit            | `2c509543cd555667596df602c134a6f26dd2eb12`                                |
| Release manifest SHA-256 | `b457ced828cf78c755dd28d3960fcf1055cdda6acb8ac24f237c7a8b2b25063b`        |
| Worker bundle SHA-256    | `3de652fdb230415afa4a557b0f25942a6fd3d2d7c5113882c0504078c038439c`        |
| Container digest         | `sha256:9914015d0e3fa477a20bf7e95f5896cbeab3ad6ef28316edb88e30817221ad15` |

Production promotion reused the exact reviewed Worker bundle and immutable
Container digest deployed to development; neither artifact was rebuilt.

## Environment evidence

| Evidence               | Development                                                        | Production                                                         |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Workflow run           | `29295353087`                                                      | `29296250101` (successful attempt 3)                               |
| Worker version         | `8414e9af-d4e3-4aba-86f3-06d873626f19`                             | `aec91194-81ce-43f2-90f7-b45dfa76e4d1`                             |
| Smoke evidence SHA-256 | `36fdad2870f3e7e3ae2cec8d0ed39a3a51e486c150274e903f214084c8e8a16f` | `333d6a0a044749937d3984ad71ee6c30b4d3e21b4854523e6d894bd1dfd54066` |

Authenticated smoke checks passed in both environments. The authenticated
health response was `{"schemaVersion":1,"ok":true}`.

The Worker version IDs are environment-specific deployment identities because
the Worker names and bindings differ. They are distinct from the immutable
release identity above, whose reviewed Worker bundle bytes and Container digest
were identical in both environments.

## Production secret bindings

The production Worker uses these encrypted binding names; no secret values are
recorded here:

- `ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY`;
- `ROUNDHOUSE_GITHUB_WEBHOOK_SECRET`;
- `ROUNDHOUSE_CODEX_AUTH_JSON`;
- `ROUNDHOUSE_CLAUDE_AUTH_JSON`.
