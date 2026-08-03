// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

// Browser entry served from /assets/conversation-poll.js. It is a plain
// string so the Worker can serve the same-origin script without a client build.
export const conversationPollClientScript = `(function () {
  var script = document.currentScript;
  var stateUrl = script && script.getAttribute("data-state-url");
  var polling = script && script.getAttribute("data-polling") === "true";
  var messages = document.getElementById("conversation-messages");
  var status = document.getElementById("conversation-status");
  var controls = document.getElementById("conversation-controls");
  var live = document.getElementById("conversation-live-status");
  var newResponse = document.getElementById("conversation-new-response");
  var startedAt = Date.now();
  var delay = 2000;
  var nearBottomThreshold = 160;
  var responseSeenDepth = 96;
  var responseClickOffset = 24;
  var statusKey = status && status.getAttribute("data-status-key");
  var unseenResponse = null;
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
  function landingTarget() {
    var names = ["delivery", "brief", "working", "composer"];
    for (var i = 0; i < names.length; i += 1) {
      var target = document.querySelector && document.querySelector('[data-conversation-landing="' + names[i] + '"]');
      if (target) return target;
    }
    return messages && messages.lastElementChild;
  }
  function jumpToCurrent(reason) {
    var target = landingTarget();
    if (target && target.scrollIntoView) target.scrollIntoView({ block: "end" });
    if (newResponse) newResponse.hidden = true;
    log("conversation_positioned", {
      reason: reason,
      target: target && target.getAttribute ? target.getAttribute("data-conversation-landing") || "latest-message" : "none"
    });
  }
  function nearBottom() {
    var root = document.documentElement;
    var body = document.body;
    var height = Math.max(root ? root.scrollHeight : 0, body ? body.scrollHeight : 0);
    return height - (window.scrollY + window.innerHeight) <= nearBottomThreshold;
  }
  function readingAnchor() {
    var children = messages ? messages.children : [];
    for (var i = 0; i < children.length; i += 1) {
      var rect = children[i].getBoundingClientRect && children[i].getBoundingClientRect();
      if (rect && rect.bottom > 0) return { element: children[i], top: rect.top };
    }
    return null;
  }
  function preserveAnchor(anchor, scrollX, scrollY) {
    if (!anchor || !anchor.element.getBoundingClientRect) {
      window.scrollTo(scrollX, scrollY);
      return;
    }
    var rect = anchor.element.getBoundingClientRect();
    window.scrollTo(scrollX, scrollY + rect.top - anchor.top);
  }
  function responseId(response) {
    return response && response.getAttribute && response.getAttribute("data-message-id");
  }
  function readableBottom() {
    var composer = document.querySelector && document.querySelector(".composer");
    if (composer && composer.getBoundingClientRect) return composer.getBoundingClientRect().top;
    return window.innerHeight;
  }
  function responseIsSeen(response) {
    if (!response || !response.getBoundingClientRect) return false;
    var rect = response.getBoundingClientRect();
    var seenDepth = Math.min(responseSeenDepth, rect.height);
    return rect.top >= 0 && rect.top + seenDepth <= readableBottom();
  }
  function showNewResponse(reason) {
    if (!newResponse) return;
    var composer = document.querySelector && document.querySelector(".composer");
    var offset = 16;
    if (composer && composer.getBoundingClientRect) {
      offset += Math.max(0, Math.round(composer.getBoundingClientRect().height));
    }
    newResponse.style.bottom = offset + "px";
    if (!newResponse.hidden) return;
    newResponse.hidden = false;
    log("conversation_new_response_shown", {
      responseId: responseId(unseenResponse),
      reason: reason
    });
  }
  function dismissNewResponse(reason) {
    if (!unseenResponse) return;
    var response = unseenResponse;
    unseenResponse = null;
    if (newResponse) newResponse.hidden = true;
    log("conversation_new_response_dismissed", {
      responseId: responseId(response),
      reason: reason
    });
  }
  function evaluateNewResponse(reason) {
    if (!unseenResponse) return;
    if (responseIsSeen(unseenResponse)) dismissNewResponse("visible");
    else showNewResponse(reason);
  }
  function scrollToNewResponse() {
    if (!unseenResponse) return;
    var response = unseenResponse;
    dismissNewResponse("new_response_control");
    var rect = response.getBoundingClientRect();
    window.scrollTo({
      top: Math.max(0, window.scrollY + rect.top - responseClickOffset),
      behavior: "smooth"
    });
    log("conversation_positioned", {
      reason: "new_response_control",
      target: "new-response",
      responseId: responseId(response)
    });
  }
  function reconcile(state) {
    var scrollX = window.scrollX;
    var scrollY = window.scrollY;
    var follow = nearBottom();
    var anchor = follow ? null : readingAnchor();
    var changedMessages = 0;
    var appended = false;
    var appendedAssistant = null;
    var changed = false;
    for (var i = 0; i < state.messages.length; i += 1) {
      var update = state.messages[i];
      var current = messageElement(update.id);
      if (current && current.getAttribute("data-version") === update.version) continue;
      var next = element(update.html);
      if (!next) continue;
      if (current) current.replaceWith(next); else {
        messages.appendChild(next);
        appended = true;
        if (next.matches && next.matches(".message.assistant")) appendedAssistant = next;
      }
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
    var outcome;
    if (appended) {
      if (follow) {
        jumpToCurrent("update");
        outcome = "followed";
      } else {
        preserveAnchor(anchor, scrollX, scrollY);
        if (appendedAssistant) {
          unseenResponse = appendedAssistant;
          evaluateNewResponse("appended");
        }
        outcome = "preserved";
      }
    } else if (changed) window.scrollTo(scrollX, scrollY);
    log("conversation_poll_updated", {
      changedMessages: changedMessages,
      statusChanged: statusChanged,
      controlsChanged: controlsChanged,
      polling: state.polling,
      outcome: outcome
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
  if (newResponse && newResponse.addEventListener)
    newResponse.addEventListener("click", scrollToNewResponse);
  if (window.addEventListener)
    window.addEventListener("scroll", function () { evaluateNewResponse("scroll"); });
  jumpToCurrent("initial");
  log("conversation_poll_initialized", { stateUrl: stateUrl, polling: polling, nearBottomThreshold: nearBottomThreshold });
  if (polling) window.setTimeout(poll, delay);
})();
`;
