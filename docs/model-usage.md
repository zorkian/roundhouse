<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Model usage provenance

The `/usage` dashboard is an accounting view of model calls made for the
repositories authorized to the current UI session. It includes both
conversations (including delivery-brief turns) and delivery-run attempts, but
never includes another repository merely because its run is recent.

## Flow

1. A repository profile supplies the conversation model; workflow nodes,
   reviewers, competition candidates, or profile defaults supply a delivery
   model and effort. These are the **requested** values.
2. The control plane asks the model broker to resolve that request. The broker
   checks its allowlist and model capabilities and returns the **resolved**
   route: provider, model, protocol, transport, normalized effort, and routing
   rule. Unsupported effort fails routing; it is never silently downgraded.
3. The route is saved on the delivery attempt or conversation turn, passed to
   the runner, and forwarded with every broker request. The runner and
   conversation adapters send the resolved effort using the protocol-specific
   SDK payload.
4. The broker calls either its provider-native gateway transport or the unified
   Workers AI transport. It returns the provider response and the resolved
   route headers, but does not treat a route as a provider report.
5. Response parsers retain provider response IDs, model IDs, response effort
   when a provider sends it, token categories, direct cost, latency, tool-call
   count, and terminal outcome. A recognized terminal provider response with a
   usable ID is recorded even when its HTTP status is non-successful; supplied
   usage is retained, while absent usage stays unknown. A transport failure or
   delivery response without a usable provider call ID remains unknown rather
   than becoming a fabricated token total. Conversation attempts retain their
   own generated request identifier when a provider omits one, with all absent
   token fields still left unknown.
6. D1 stores delivery rows in `model_usage` and conversation rows in
   `conversation_model_usage`. Their rolling-window union is filtered by the
   stable GitHub repository IDs in the UI session before dashboard aggregation.
   The dashboard groups by canonical **accounting model** and resolved effort.
   Every call without recorded resolved effort is in the `unknown` bucket, in
   both legacy-only and mixed windows; the effort filter uses that same bucket.
   Latency and reasoning metrics are independent of whether effort was
   recorded. A reasoning share is unavailable when its known output-token
   denominator is zero, never zero, NaN, or infinity. Totals are labelled
   partial whenever any included call lacks that metric.

## What the fields mean

| Field                            | Meaning                                                                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requested model / effort         | Profile or workflow selection before broker validation.                                                                                                         |
| Resolved model / effort          | The broker-approved route sent to the provider. It is not evidence that the provider used or echoed the value.                                                  |
| Provider-reported model / effort | A literal value present in the provider response. It is unavailable when that response does not include one.                                                    |
| Accounting model                 | Canonical provider-reported model when available; otherwise the resolved model. This preserves grouping and pricing without claiming a missing provider report. |
| Outcome                          | `succeeded` or `failed` for newly recorded terminal responses. Historical rows have an unknown outcome.                                                         |

Reasoning-token counts are provider usage metadata, not an effort measurement.
Effort can affect quality, latency, tools, and token consumption, but does not
itself change a token price.

## Compatibility and limits

Migration `0022_model_usage_provenance.sql` adds provenance and delivery
outcome columns without backfilling them. Earlier data remains queryable, but
its requested/resolved/provider-reported fields and outcome are honestly shown
as unavailable or unknown. Missing resolved effort is displayed as **Unknown
(not recorded)** and can be filtered without changing what that historical row
claims. Current routing configuration must never be used to infer historical
actual usage.

Delivery usage is idempotent by provider and provider call ID. Retries are
separate provider calls when they have separate IDs, and are counted
separately; this avoids both dropping billable retry usage and double-counting
a replay of the same response. Network failures, abandoned streams, and
delivery responses without a usable identifier cannot be converted into known
token or cost data.
