// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

// Browser entry served from /assets/conversation-poll.js. It is a plain
// string so the Worker can serve the same-origin script without a client build.
export const conversationPollClientScript = `(function () {
  var script = document.currentScript;
  var stateUrl = script && script.getAttribute("data-state-url");
  var messages = document.getElementById("conversation-messages");
  var status = document.getElementById("conversation-status");
  var controls = document.getElementById("conversation-controls");
  var live = document.getElementById("conversation-live-status");
  var startedAt = Date.now();
  var delay = 2000;
  var statusKey = status && status.getAttribute("data-status-key");
  function log(message, detail) {
    detail = detail || {};
    detail.message = message;
    detail.elapsedMs = Date.now() - startedAt;
    console.log(JSON.stringify(detail));
  }
  function element(html) {
    var template = document.createElement("template");
    template.innerHTML = html;
    return template.content.firstElementChild;
  }
  function messageElement(id) {
    var children = messages ? messages.children : [];
    for (var i = 0; i < children.length; i += 1) {
      if (children[i].getAttribute("data-message-id") === id) return children[i];
    }
    return null;
  }
  function replaceRegion(region, update) {
    if (!region || region.getAttribute("data-version") === update.version) return false;
    region.innerHTML = update.html;
    region.setAttribute("data-version", update.version);
    return true;
  }
  function reconcile(state) {
    var scrollX = window.scrollX;
    var scrollY = window.scrollY;
    var changedMessages = 0;
    var changed = false;
    for (var i = 0; i < state.messages.length; i += 1) {
      var update = state.messages[i];
      var current = messageElement(update.id);
      if (current && current.getAttribute("data-version") === update.version) continue;
      var next = element(update.html);
      if (!next) continue;
      if (current) current.replaceWith(next); else messages.appendChild(next);
      changedMessages += 1;
      changed = true;
    }
    var statusChanged = replaceRegion(status, state.status);
    var controlsChanged = replaceRegion(controls, state.controls);
    changed = changed || statusChanged || controlsChanged;
    if (statusChanged && statusKey !== state.status.key) {
      statusKey = state.status.key;
      if (live) live.textContent = state.status.announcement;
    }
    if (changed) window.scrollTo(scrollX, scrollY);
    log("conversation_poll_updated", {
      changedMessages: changedMessages,
      statusChanged: statusChanged,
      controlsChanged: controlsChanged,
      polling: state.polling
    });
  }
  function poll() {
    fetch(stateUrl, { credentials: "same-origin" })
      .then(function (response) {
        if (!response.ok) throw new Error("conversation_state_" + response.status);
        return response.json();
      })
      .then(function (state) {
        reconcile(state);
        if (state.polling) window.setTimeout(poll, delay);
        else log("conversation_poll_stopped", { reason: "terminal" });
      })
      .catch(function (error) {
        log("conversation_poll_failed", { error: String(error) });
        window.setTimeout(poll, delay);
      });
  }
  if (!stateUrl || !messages || !status || !controls) return;
  log("conversation_poll_initialized", { stateUrl: stateUrl });
  window.setTimeout(poll, delay);
})();
`;
