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
            "text-overflow-wrap": "anywhere",
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
    // One-time post-layout framing: the cose fit leaves the whole graph in
    // view at a distant, hard-to-read scale, so enforce a readable minimum
    // zoom and pan if needed to keep the workflow entry stage visible.
    var entryId = container.getAttribute("data-entry");
    cy.on("layoutstop", function frameOnce() {
      cy.off("layoutstop", frameOnce);
      var mobile = container.clientWidth <= 700;
      var zoomFloor = mobile ? 0.6 : 1;
      if (cy.zoom() < zoomFloor) cy.zoom(zoomFloor);
      var entry = entryId ? cy.getElementById(entryId) : null;
      var entryVisible = true;
      if (entry && entry.nonempty()) {
        var bounds = entry.renderedBoundingBox();
        entryVisible =
          bounds.x1 >= 0 &&
          bounds.y1 >= 0 &&
          bounds.x2 <= container.clientWidth &&
          bounds.y2 <= container.clientHeight;
        if (!entryVisible) {
          cy.center(entry);
          entryVisible = true;
        }
      }
      log("workflow_graph_viewport_initialized", {
        entryStage: entryId,
        mobile: mobile,
        zoom: cy.zoom(),
        entryVisible: entryVisible,
        framingMs: Date.now() - initStartedAt
      });
    });
    function clearEmphasis() {
      cy.elements().removeClass("selected-node connected-edge muted");
    }
    var stageButtons = Array.prototype.slice.call(
      document.querySelectorAll(".stage-button[data-stage]")
    );
    var detailsStatus = document.getElementById("stage-details-status");
    var detailsList = document.getElementById("stage-details-list");
    var detailFields = [
      ["executor", "Executor"],
      ["role", "Role"],
      ["task", "Agent task"],
      ["authority", "Permissions"],
      ["outputs", "Outputs"],
      ["reviewers", "Reviewers"],
      ["human", "Human handoff"],
      ["external", "External wait"]
    ];
    function renderDetails(node) {
      if (!detailsStatus || !detailsList) return;
      var started = Date.now();
      while (detailsList.firstChild) {
        detailsList.removeChild(detailsList.firstChild);
      }
      var data = node.data();
      detailsStatus.textContent =
        "Selected stage: " + (data.name || data.id) + " \u2014 " + data.summary;
      detailFields.forEach(function (field) {
        var value = data[field[0]];
        if (!value) return;
        var term = document.createElement("dt");
        term.textContent = field[1];
        var description = document.createElement("dd");
        description.textContent = value;
        detailsList.appendChild(term);
        detailsList.appendChild(description);
      });
      log("workflow_stage_details_rendered", {
        stage: data.id,
        renderMs: Date.now() - started
      });
    }
    function clearDetails() {
      if (!detailsStatus || !detailsList) return;
      detailsStatus.textContent =
        "Select a stage in the graph or the stage list to see its details.";
      while (detailsList.firstChild) {
        detailsList.removeChild(detailsList.firstChild);
      }
    }
    function syncStageButtons(selectedId) {
      stageButtons.forEach(function (button) {
        button.setAttribute(
          "aria-pressed",
          button.getAttribute("data-stage") === selectedId ? "true" : "false"
        );
      });
    }
    function selectStage(node) {
      // Enforce single selection so a new stage always replaces the old one.
      cy.$("node:selected").difference(node).unselect();
      clearEmphasis();
      node.addClass("selected-node");
      node.connectedEdges().addClass("connected-edge");
      cy.elements().difference(node.closedNeighborhood()).addClass("muted");
      renderDetails(node);
      syncStageButtons(node.id());
      log("workflow_stage_selected", { stage: node.id() });
    }
    function clearSelection() {
      clearEmphasis();
      clearDetails();
      syncStageButtons(null);
      cy.elements().unselect();
    }
    cy.on("select", "node", function (event) {
      selectStage(event.target);
    });
    stageButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        var candidate = cy.getElementById(
          button.getAttribute("data-stage")
        );
        if (!candidate.nonempty()) return;
        // Select explicitly instead of relying on the select event: a node
        // Cytoscape already considers selected would not fire it again.
        cy.$("node:selected").difference(candidate).unselect();
        if (candidate.selected()) {
          selectStage(candidate);
        } else {
          candidate.select();
        }
      });
    });
    cy.on("tap", function (event) {
      if (event.target === cy) clearSelection();
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
