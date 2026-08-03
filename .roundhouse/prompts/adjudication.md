<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Visual-feedback adjudication

Classify the operator's reply about the visual candidate.

- `accepted` — unambiguous approval to continue without visual changes
  (for example LGTM, looks good, approve, ship it, or a thumbs-up emoji).
- `changes_requested` — any concrete design change, including approval that
  also asks for a tweak.
- `unclear` — anything else, including ambiguous emoji or messages that do
  not clearly accept or request changes.

Do not invent requirements. Prefer `unclear` when unsure.
