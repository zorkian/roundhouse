// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

// Browser entry served from /assets/workflow-graph.js. It initializes the
// Cytoscape graph, selection highlighting, and the editor validate/copy
// handlers. Kept as a plain string so the Worker can serve it as a
// same-origin script without a separate client build step; avoid template
// literals and `${` sequences inside it.
export const workflowGraphClientScript = `(function () {
  var startedAt = Date.now();
  function log(event, detail) {
    detail = detail || {};
    detail.message = event;
    detail.elapsedMs = Date.now() - startedAt;
    console.log(JSON.stringify(detail));
  }
  var container = document.getElementById("workflow-graph");
  var dataElement = document.getElementById("workflow-graph-data");
  if (container && dataElement && window.cytoscape) {
    var initStartedAt = Date.now();
    var elements = JSON.parse(dataElement.textContent);
    var cy = window.cytoscape({
      container: container,
      elements: elements,
      minZoom: 0.3,
      maxZoom: 2.5,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-wrap": "wrap",
            "text-max-width": "210px",
            "text-valign": "center",
            "text-halign": "center",
            "font-size": 13,
            "line-height": 1.4,
            color: "#18212f",
            width: 240,
            height: 110,
            shape: "round-rectangle",
            "background-color": "#ffffff",
            "border-width": 1.5,
            "border-color": "#8391a5"
          }
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "#8391a5",
            "target-arrow-color": "#8391a5",
            "target-arrow-shape": "triangle",
            "arrow-scale": 1.2,
            "curve-style": "bezier",
            "loop-direction": "0deg",
            "loop-sweep": "45deg"
          }
        },
        {
          selector: "node.selected-node",
          style: {
            "border-width": 5,
            "border-color": "#175cd3",
            "border-style": "double"
          }
        },
        {
          selector: "edge.connected-edge",
          style: {
            width: 4,
            "line-color": "#175cd3",
            "target-arrow-color": "#175cd3",
            "line-style": "solid",
            "underlay-color": "#175cd3",
            "underlay-opacity": 0.2,
            "underlay-padding": 4
          }
        },
        { selector: ".muted", style: { opacity: 0.18 } }
      ],
      layout: {
        name: "cose",
        animate: false,
        nodeDimensionsIncludeLabels: true,
        padding: 40,
        idealEdgeLength: 260,
        nodeRepulsion: function () { return 900000; },
        gravity: 0.4
      }
    });
    log("workflow_graph_initialized", {
      nodes: cy.nodes().length,
      edges: cy.edges().length
    });
    cy.on("layoutstop", function () {
      log("workflow_graph_layout_completed", {
        layout: "cose",
        nodes: cy.nodes().length,
        edges: cy.edges().length,
        layoutMs: Date.now() - initStartedAt
      });
    });
    function clearEmphasis() {
      cy.elements().removeClass("selected-node connected-edge muted");
    }
    cy.on("select", "node", function (event) {
      clearEmphasis();
      var node = event.target;
      node.addClass("selected-node");
      node.connectedEdges().addClass("connected-edge");
      cy.elements().difference(node.closedNeighborhood()).addClass("muted");
    });
    cy.on("tap", function (event) {
      if (event.target === cy) clearEmphasis();
    });
    var preselected = container.getAttribute("data-select");
    if (preselected) {
      cy.on("layoutstop", function selectOnce() {
        cy.off("layoutstop", selectOnce);
        var candidate = cy.getElementById(preselected);
        if (candidate.nonempty()) candidate.select();
      });
    }
  }
  var source = document.getElementById("source");
  var validation = document.getElementById("validation");
  var validate = document.getElementById("validate");
  if (source && validation && validate) {
    validate.addEventListener("click", async function () {
      validation.className = "";
      validation.textContent = "Validating\\u2026";
      try {
        var response = await fetch(location.pathname, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: source.value,
            sourceCommit: source.getAttribute("data-source-commit")
          })
        });
        var result = await response.json();
        validation.className = response.ok ? "ok" : "error";
        validation.textContent = response.ok
          ? "Valid \\u2014 " + result.nodes + " nodes, hash " + result.hash
          : "Invalid \\u2014 " + result.error;
      } catch (error) {
        validation.className = "error";
        validation.textContent = "Validation request failed.";
      }
    });
  }
  var copy = document.getElementById("copy");
  if (source && validation && copy) {
    copy.addEventListener("click", async function () {
      await navigator.clipboard.writeText(source.value);
      validation.textContent =
        "Copied. Paste this into the GitHub editor.";
    });
  }
})();
`;

export function workflowGraphAsset(cytoscapeSource: string): string {
  return `${cytoscapeSource}\n${workflowGraphClientScript}`;
}
