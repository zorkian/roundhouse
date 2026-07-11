# Dreamwidth issue 3452 reproduction bundle

Status: Reproduced and verified fixed

## Source

- Issue: [Birthday Gift button goes back to homepage due to empty link](https://github.com/dreamwidth/dreamwidth/issues/3452)
- Fix: [PR 3455](https://github.com/dreamwidth/dreamwidth/pull/3455)
- Pre-fix commit: `52ed843814534191640b92d508074b62ae37281d`
- Fix commit: `b08c5464dfa325d0892e14a40f7d65e648514a28`
- Environment image: `ghcr.io/dreamwidth/devcontainer@sha256:19365e4d012402b280b20a18187f882feac676c40c2163de6f8ebb92e54cebcd`
- Reproduction harness: `scripts/phase-zero/reproduce-dreamwidth-3452.pl`

## Expected behavior

The birthday widget's Gift link should use the URL returned by the user object's `gift_url` method.

## Observed pre-fix behavior

The actual template called the nonexistent `gift_link` method. Template Toolkit rendered the missing value as an empty string, producing an empty `href`:

```json
{
  "expected_href": "https://example.test/shop/randomgift",
  "expected_outcome": "defect",
  "matched": true,
  "observed_href": ""
}
```

## Fixed behavior

The fixing commit changed the template to call `gift_url`. With the same mock user and input, it rendered the expected destination:

```json
{
  "expected_href": "https://example.test/shop/randomgift",
  "expected_outcome": "fixed",
  "matched": true,
  "observed_href": "https://example.test/shop/randomgift"
}
```

## Procedure

1. Start a disposable container from the pinned image.
2. Fetch the exact pre-fix and fix commits into separate workspaces.
3. Disconnect all container networking.
4. Run the harness against the real `views/widget/friendbirthdays.tt` from each commit:

```text
perl reproduce-dreamwidth-3452.pl PRE_FIX/views/widget/friendbirthdays.tt defect
perl reproduce-dreamwidth-3452.pl FIXED/views/widget/friendbirthdays.tt fixed
```

The harness renders the actual template through Template Toolkit with a minimal user object that implements `gift_url` but not the erroneous `gift_link` method.

## Assessment

- Repeatability: deterministic; reproduced once before and once after with matching expected outcomes.
- Confidence: high for the reported empty-link defect and one-line fix.
- External dependencies: none during reproduction.
- Production data or credentials: none.
- Scope: template behavior only; it does not exercise a browser or full application server.
