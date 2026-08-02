-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  creator_github_user_id INTEGER NOT NULL,
  creator_github_login TEXT NOT NULL,
  origin_adapter TEXT NOT NULL,
  origin_adapter_installation TEXT NOT NULL,
  origin_external_message_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'handoff_pending', 'promoted')),
  source_commit TEXT NOT NULL,
  profile_hash TEXT NOT NULL,
  context_json TEXT NOT NULL,
  active_turn_id TEXT,
  current_brief_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  turn_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  actor_id TEXT NOT NULL,
  actor_login TEXT NOT NULL,
  adapter TEXT NOT NULL,
  adapter_installation TEXT NOT NULL,
  external_conversation_id TEXT NOT NULL,
  external_message_id TEXT,
  ordinal INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (conversation_id, ordinal)
);

CREATE TABLE conversation_turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  triggering_message_id TEXT REFERENCES conversation_messages(id),
  kind TEXT NOT NULL CHECK (kind IN ('message', 'brief')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'succeeded', 'failed')),
  source_commit TEXT NOT NULL,
  configured_model TEXT NOT NULL,
  configured_reasoning TEXT NOT NULL,
  model_route_json TEXT,
  result_message_id TEXT REFERENCES conversation_messages(id),
  result_brief_id TEXT REFERENCES conversation_delivery_briefs(id),
  ordinal INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_expires_at INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (conversation_id, ordinal)
);

CREATE TABLE conversation_delivery_briefs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  turn_id TEXT NOT NULL REFERENCES conversation_turns(id),
  revision INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draft', 'approved', 'superseded')),
  title TEXT NOT NULL,
  outcome TEXT NOT NULL,
  acceptance_criteria_json TEXT NOT NULL,
  constraints_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  uncertainties_json TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  approved_by_github_user_id INTEGER,
  approved_by_github_login TEXT,
  approved_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (conversation_id, revision)
);

CREATE TABLE conversation_promotions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id),
  brief_id TEXT NOT NULL REFERENCES conversation_delivery_briefs(id),
  state TEXT NOT NULL CHECK (state IN ('requested', 'issue_created', 'awaiting_intake', 'accepted', 'rejected')),
  actor_github_user_id INTEGER NOT NULL,
  actor_github_login TEXT NOT NULL,
  ui_session_hash TEXT NOT NULL,
  issue_number INTEGER,
  issue_url TEXT,
  run_id TEXT,
  lease_expires_at INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE conversation_links (
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  kind TEXT NOT NULL CHECK (kind IN ('github.issue', 'roundhouse.run')),
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, kind)
);

CREATE TABLE conversation_model_usage (
  call_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  turn_id TEXT NOT NULL REFERENCES conversation_turns(id),
  call_kind TEXT NOT NULL CHECK (call_kind IN ('conversation', 'delivery_brief')),
  model TEXT NOT NULL,
  configured_model TEXT NOT NULL,
  protocol TEXT NOT NULL,
  reasoning_level TEXT NOT NULL,
  routing_rule TEXT NOT NULL,
  input_tokens INTEGER,
  cached_input_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  reasoning_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cost_usd REAL,
  latency_ms INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, call_id)
);

CREATE TABLE conversation_outbox (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  kind TEXT NOT NULL CHECK (kind IN ('turn_wakeup', 'promotion_wakeup', 'adapter_reply')),
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX conversations_creator_updated
  ON conversations(creator_github_user_id, updated_at DESC);
CREATE UNIQUE INDEX conversations_origin_identity
  ON conversations(origin_adapter, origin_adapter_installation, origin_external_message_id);
CREATE INDEX conversation_messages_order
  ON conversation_messages(conversation_id, ordinal);
CREATE UNIQUE INDEX conversation_messages_adapter_identity
  ON conversation_messages(adapter, adapter_installation, external_message_id)
  WHERE external_message_id IS NOT NULL;
CREATE INDEX conversation_turns_ready
  ON conversation_turns(state, lease_expires_at, created_at);
CREATE INDEX conversation_briefs_conversation_revision
  ON conversation_delivery_briefs(conversation_id, revision DESC);
CREATE INDEX conversation_promotions_state
  ON conversation_promotions(state, lease_expires_at, updated_at);
CREATE INDEX conversation_usage_conversation
  ON conversation_model_usage(conversation_id, created_at);
CREATE INDEX conversation_outbox_ready
  ON conversation_outbox(state, available_at, id);
