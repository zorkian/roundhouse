// Isolated preview of the actual renderWorkflowView + workflowGraphClientScript.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { compileWorkflow, defaultIssueWorkflowSource } from "./packages/core/dist/index.js";
import { renderWorkflowView } from "./apps/control-plane/dist/workflow-view.js";
import { workflowGraphAsset } from "./apps/control-plane/dist/workflow-client.js";

const select = process.env.PRESELECT ?? "implement";
const workflow = await compileWorkflow(defaultIssueWorkflowSource, "a".repeat(40));
const run = {
  schemaVersion: 2,
  id: "run_workflow",
  repository: "zorkian/roundhouse",
  githubDefaultBranch: "main",
  issueNumber: 453,
  baseCommit: "a".repeat(40),
  currentHead: "b".repeat(40),
  profileVersion: "c".repeat(64),
  profile: {
    sourcePath: ".roundhouse/profile.yaml",
    sourceCommit: "a".repeat(40),
    version: 2,
    hash: "c".repeat(64),
    workflow,
    paths: { allowed: ["**"], protected: [] },
  },
  workflowHash: workflow.hash,
  currentNodeId: select,
  status: "active",
  stage: select,
  revision: 4,
};
const html = renderWorkflowView(run).replace(
  '<div id="workflow-graph"',
  `<div id="workflow-graph" data-select="${select}"`,
);
const asset = workflowGraphAsset(
  readFileSync("node_modules/.pnpm/cytoscape@3.34.0/node_modules/cytoscape/dist/cytoscape.umd.js", "utf8"),
);
createServer((req, res) => {
  if (req.url === "/assets/workflow-graph.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(asset);
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(html);
}).listen(4173, "0.0.0.0", () => console.log("preview on 0.0.0.0:4173"));
