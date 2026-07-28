// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

// Wrangler bundles this import as text (see the Text rule in
// wrangler.jsonc) so the same-origin graph asset can ship Cytoscape to the
// browser without a separate client build step.
declare module "cytoscape/dist/cytoscape.min.js" {
  const source: string;
  export default source;
}
