<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Goal 1 low-risk residual-risk wording

A useful Goal 1 recommendation should briefly state why the change is low
risk, which validation and independent review passed, and which residual risks
remain. Name the checks and review outcome rather than describing the change as
safe without supporting evidence.

## Examples

- **Documentation only:** Low risk because this changes one dogfood note and no
  runtime behavior. Markdown formatting and independent review passed. Residual
  risk is limited to wording that may still be unclear or incomplete.
- **Focused bug fix:** Low risk because the change is confined to the reproduced
  failure path. The focused regression test, repository checks, and independent
  review passed. Residual risk is that untested variants of the input may still
  exercise a different path.
