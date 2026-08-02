-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  creator_github_user_id INTEGER NOT NULL,
  creator_github_login TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'ready', 'promoting', 'promoted')),
  source_commit TEXT NOT NULL,
  profile_hash TEXT NOT NULL,
  context_json TEXT NOT NULL,
  active_turn_id TEXT,
  delivery_brief_json TEXT,
  promotion_lease_expires_at INTEGER,
  promoted_issue_number INTEGER,
  promoted_issue_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  turn_id TEXT NOT NULL,
  adapter TEXT NOT NULL,
  external_message_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX conversations_creator_updated
  ON conversations(creator_github_user_id, updated_at DESC);
CREATE INDEX conversation_messages_order
  ON conversation_messages(conversation_id, created_at, id);
CREATE UNIQUE INDEX conversation_messages_adapter_identity
  ON conversation_messages(adapter, external_message_id)
  WHERE external_message_id IS NOT NULL;
