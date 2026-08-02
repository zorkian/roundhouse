// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ProfileModel } from "@roundhouse/core";
import type { D1Like } from "./d1-store.js";

export interface ConversationRepositoryRef {
  readonly id: string;
  readonly githubId: string;
  readonly name: string;
  readonly installationId: number;
}

export interface ConversationContext {
  readonly model: ProfileModel;
  readonly defaultBranch: string;
  readonly projectInstructions?: string;
}

export interface DeliveryBrief {
  readonly title: string;
  readonly outcome: string;
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly string[];
  readonly context: readonly string[];
}

export interface ConversationMessage {
  readonly id: string;
  readonly turnId: string;
  readonly role: "user" | "assistant";
  readonly adapter: string;
  readonly externalMessageId?: string;
  readonly body: string;
  readonly createdAt: number;
}

export interface Conversation {
  readonly id: string;
  readonly repository: ConversationRepositoryRef;
  readonly creatorGithubUserId: number;
  readonly creatorGithubLogin: string;
  readonly status: "open" | "ready" | "promoting" | "promoted";
  readonly sourceCommit: string;
  readonly profileHash: string;
  readonly context: ConversationContext;
  readonly activeTurnId?: string;
  readonly deliveryBrief?: DeliveryBrief;
  readonly promotedIssueNumber?: number;
  readonly promotedIssueUrl?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messages: readonly ConversationMessage[];
}

export interface ConversationSummary {
  readonly id: string;
  readonly repository: string;
  readonly status: Conversation["status"];
  readonly promotedIssueNumber?: number;
  readonly promotedIssueUrl?: string;
  readonly updatedAt: number;
}

type RepositoryRow = {
  id: string;
  github_id: string;
  profile_json: string;
};

type ConversationRow = RepositoryRow & {
  conversation_id: string;
  creator_github_user_id: number;
  creator_github_login: string;
  status: Conversation["status"];
  source_commit: string;
  profile_hash: string;
  context_json: string;
  active_turn_id: string | null;
  delivery_brief_json: string | null;
  promotion_lease_expires_at: number | null;
  promoted_issue_number: number | null;
  promoted_issue_url: string | null;
  created_at: number;
  updated_at: number;
};

function repositoryFromRow(row: RepositoryRow): ConversationRepositoryRef {
  const value = JSON.parse(row.profile_json) as {
    repository?: unknown;
    installationId?: unknown;
  };
  if (
    typeof value.repository !== "string" ||
    typeof value.installationId !== "number" ||
    !Number.isSafeInteger(value.installationId)
  )
    throw new Error("conversation_repository_invalid");
  return {
    id: row.id,
    githubId: String(row.github_id),
    name: value.repository,
    installationId: value.installationId,
  };
}

function placeholders(values: readonly unknown[]): string {
  return values.map((_, index) => `?${index + 1}`).join(",");
}

export class D1ConversationRepository {
  constructor(
    private readonly db: D1Like,
    private readonly now = () => Date.now(),
  ) {}

  async listRepositories(
    authorizedGithubIds: readonly string[],
  ): Promise<readonly ConversationRepositoryRef[]> {
    if (!authorizedGithubIds.length) return [];
    const rows = await this.db
      .prepare(
        `SELECT id, github_id, profile_json FROM repositories
         WHERE github_id IN (${placeholders(authorizedGithubIds)})
         ORDER BY github_id`,
      )
      .bind(...authorizedGithubIds)
      .all<RepositoryRow>();
    return (rows.results ?? []).map(repositoryFromRow);
  }

  async repository(
    repositoryId: string,
    authorizedGithubIds: readonly string[],
  ): Promise<ConversationRepositoryRef | undefined> {
    if (!authorizedGithubIds.length) return undefined;
    const row = await this.db
      .prepare(
        `SELECT id, github_id, profile_json FROM repositories
         WHERE id=?1 AND github_id IN (${authorizedGithubIds
           .map((_, index) => `?${index + 2}`)
           .join(",")})`,
      )
      .bind(repositoryId, ...authorizedGithubIds)
      .first<RepositoryRow>();
    return row ? repositoryFromRow(row) : undefined;
  }

  async list(
    creatorGithubUserId: number,
    authorizedGithubIds: readonly string[],
  ): Promise<readonly ConversationSummary[]> {
    if (!authorizedGithubIds.length) return [];
    const rows = await this.db
      .prepare(
        `SELECT c.id,c.status,c.promoted_issue_number,c.promoted_issue_url,c.updated_at,r.profile_json
         FROM conversations c JOIN repositories r ON r.id=c.repository_id
         WHERE c.creator_github_user_id=?1
           AND r.github_id IN (${authorizedGithubIds
             .map((_, index) => `?${index + 2}`)
             .join(",")})
         ORDER BY c.updated_at DESC LIMIT 50`,
      )
      .bind(creatorGithubUserId, ...authorizedGithubIds)
      .all<{
        id: string;
        status: Conversation["status"];
        promoted_issue_number: number | null;
        promoted_issue_url: string | null;
        updated_at: number;
        profile_json: string;
      }>();
    return (rows.results ?? []).map((row) => ({
      id: row.id,
      repository: repositoryFromRow({
        id: "",
        github_id: "",
        profile_json: row.profile_json,
      }).name,
      status: row.status,
      ...(row.promoted_issue_number === null
        ? {}
        : { promotedIssueNumber: row.promoted_issue_number }),
      ...(row.promoted_issue_url
        ? { promotedIssueUrl: row.promoted_issue_url }
        : {}),
      updatedAt: row.updated_at,
    }));
  }

  async create(input: {
    readonly id: string;
    readonly repositoryId: string;
    readonly creatorGithubUserId: number;
    readonly creatorGithubLogin: string;
    readonly sourceCommit: string;
    readonly profileHash: string;
    readonly context: ConversationContext;
    readonly turnId: string;
    readonly messageId: string;
    readonly body: string;
  }): Promise<void> {
    const time = this.now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO conversations
           (id,repository_id,creator_github_user_id,creator_github_login,status,source_commit,profile_hash,context_json,active_turn_id,delivery_brief_json,promotion_lease_expires_at,promoted_issue_number,promoted_issue_url,created_at,updated_at)
           VALUES (?1,?2,?3,?4,'open',?5,?6,?7,?8,NULL,NULL,NULL,NULL,?9,?9)`,
        )
        .bind(
          input.id,
          input.repositoryId,
          input.creatorGithubUserId,
          input.creatorGithubLogin,
          input.sourceCommit,
          input.profileHash,
          JSON.stringify(input.context),
          input.turnId,
          time,
        ),
      this.db
        .prepare(
          `INSERT INTO conversation_messages
           (id,conversation_id,turn_id,adapter,external_message_id,role,body,created_at)
           VALUES (?1,?2,?3,'web',NULL,'user',?4,?5)`,
        )
        .bind(input.messageId, input.id, input.turnId, input.body, time),
    ]);
  }

  async get(
    id: string,
    creatorGithubUserId: number,
    authorizedGithubIds: readonly string[],
  ): Promise<Conversation | undefined> {
    if (!authorizedGithubIds.length) return undefined;
    const row = await this.db
      .prepare(
        `SELECT c.id AS conversation_id,c.creator_github_user_id,c.creator_github_login,c.status,c.source_commit,c.profile_hash,c.context_json,c.active_turn_id,c.delivery_brief_json,c.promotion_lease_expires_at,c.promoted_issue_number,c.promoted_issue_url,c.created_at,c.updated_at,r.id,r.github_id,r.profile_json
         FROM conversations c JOIN repositories r ON r.id=c.repository_id
         WHERE c.id=?1 AND c.creator_github_user_id=?2
           AND r.github_id IN (${authorizedGithubIds
             .map((_, index) => `?${index + 3}`)
             .join(",")})`,
      )
      .bind(id, creatorGithubUserId, ...authorizedGithubIds)
      .first<ConversationRow>();
    if (!row) return undefined;
    const messages = await this.db
      .prepare(
        `SELECT id,turn_id,adapter,external_message_id,role,body,created_at FROM conversation_messages
         WHERE conversation_id=?1 ORDER BY created_at,id`,
      )
      .bind(id)
      .all<{
        id: string;
        turn_id: string;
        adapter: string;
        external_message_id: string | null;
        role: ConversationMessage["role"];
        body: string;
        created_at: number;
      }>();
    return {
      id: row.conversation_id,
      repository: repositoryFromRow(row),
      creatorGithubUserId: row.creator_github_user_id,
      creatorGithubLogin: row.creator_github_login,
      status: row.status,
      sourceCommit: row.source_commit,
      profileHash: row.profile_hash,
      context: JSON.parse(row.context_json) as ConversationContext,
      ...(row.active_turn_id ? { activeTurnId: row.active_turn_id } : {}),
      ...(row.delivery_brief_json
        ? {
            deliveryBrief: JSON.parse(row.delivery_brief_json) as DeliveryBrief,
          }
        : {}),
      ...(row.promoted_issue_number === null
        ? {}
        : { promotedIssueNumber: row.promoted_issue_number }),
      ...(row.promoted_issue_url
        ? { promotedIssueUrl: row.promoted_issue_url }
        : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: (messages.results ?? []).map((message) => ({
        id: message.id,
        turnId: message.turn_id,
        role: message.role,
        adapter: message.adapter,
        ...(message.external_message_id
          ? { externalMessageId: message.external_message_id }
          : {}),
        body: message.body,
        createdAt: message.created_at,
      })),
    };
  }

  async appendUserTurn(input: {
    readonly conversationId: string;
    readonly creatorGithubUserId: number;
    readonly turnId: string;
    readonly messageId: string;
    readonly body: string;
  }): Promise<boolean> {
    const time = this.now();
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO conversation_messages
           (id,conversation_id,turn_id,adapter,external_message_id,role,body,created_at)
           SELECT ?1,?2,?3,'web',NULL,'user',?4,?5 FROM conversations
           WHERE id=?2 AND creator_github_user_id=?6 AND status='open'
             AND active_turn_id IS NULL`,
        )
        .bind(
          input.messageId,
          input.conversationId,
          input.turnId,
          input.body,
          time,
          input.creatorGithubUserId,
        ),
      this.db
        .prepare(
          `UPDATE conversations SET active_turn_id=?1,updated_at=?2
           WHERE id=?3 AND creator_github_user_id=?4 AND status='open'
             AND active_turn_id IS NULL
             AND EXISTS (SELECT 1 FROM conversation_messages WHERE id=?5 AND turn_id=?1)`,
        )
        .bind(
          input.turnId,
          time,
          input.conversationId,
          input.creatorGithubUserId,
          input.messageId,
        ),
    ]);
    return (results[0]?.meta.changes ?? 0) > 0;
  }

  async finishTurn(
    conversationId: string,
    turnId: string,
    messageId: string,
    body: string,
  ): Promise<boolean> {
    const time = this.now();
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO conversation_messages
           (id,conversation_id,turn_id,adapter,external_message_id,role,body,created_at)
           SELECT ?1,?2,?3,'web',NULL,'assistant',?4,?5 FROM conversations
           WHERE id=?2 AND active_turn_id=?3 AND status='open'`,
        )
        .bind(messageId, conversationId, turnId, body, time),
      this.db
        .prepare(
          `UPDATE conversations SET active_turn_id=NULL,updated_at=?1
           WHERE id=?2 AND active_turn_id=?3 AND status='open'`,
        )
        .bind(time, conversationId, turnId),
    ]);
    return (results[0]?.meta.changes ?? 0) > 0;
  }

  async failTurn(conversationId: string, turnId: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE conversations SET active_turn_id=NULL,updated_at=?1
         WHERE id=?2 AND active_turn_id=?3 AND status='open'`,
      )
      .bind(this.now(), conversationId, turnId)
      .run();
  }

  async preparePromotion(
    conversationId: string,
    creatorGithubUserId: number,
    brief: DeliveryBrief,
  ): Promise<boolean> {
    const row = await this.db
      .prepare(
        `UPDATE conversations
         SET status='ready',delivery_brief_json=?1,updated_at=?2
         WHERE id=?3 AND creator_github_user_id=?4 AND status='open'
           AND active_turn_id IS NULL RETURNING id`,
      )
      .bind(
        JSON.stringify(brief),
        this.now(),
        conversationId,
        creatorGithubUserId,
      )
      .first<{ id: string }>();
    return Boolean(row);
  }

  async beginPromotion(
    conversationId: string,
    creatorGithubUserId: number,
  ): Promise<boolean> {
    const time = this.now();
    const row = await this.db
      .prepare(
        `UPDATE conversations SET status='promoting',promotion_lease_expires_at=?1,updated_at=?2
         WHERE id=?3 AND creator_github_user_id=?4 AND status='ready'
           AND delivery_brief_json IS NOT NULL RETURNING id`,
      )
      .bind(time + 120_000, time, conversationId, creatorGithubUserId)
      .first<{ id: string }>();
    return Boolean(row);
  }

  async claimPromotionRetry(
    conversationId: string,
    creatorGithubUserId: number,
  ): Promise<boolean> {
    const time = this.now();
    const row = await this.db
      .prepare(
        `UPDATE conversations SET promotion_lease_expires_at=?1,updated_at=?2
         WHERE id=?3 AND creator_github_user_id=?4 AND status='promoting'
           AND (promotion_lease_expires_at IS NULL OR promotion_lease_expires_at<=?2)
         RETURNING id`,
      )
      .bind(time + 120_000, time, conversationId, creatorGithubUserId)
      .first<{ id: string }>();
    return Boolean(row);
  }

  async releasePromotion(
    conversationId: string,
    creatorGithubUserId: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE conversations SET promotion_lease_expires_at=NULL,updated_at=?1
         WHERE id=?2 AND creator_github_user_id=?3 AND status='promoting'`,
      )
      .bind(this.now(), conversationId, creatorGithubUserId)
      .run();
  }

  async recordPromotionIssue(
    conversationId: string,
    issueNumber: number,
    issueUrl: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE conversations SET promoted_issue_number=?1,promoted_issue_url=?2,updated_at=?3
         WHERE id=?4 AND status='promoting' AND promoted_issue_number IS NULL`,
      )
      .bind(issueNumber, issueUrl, this.now(), conversationId)
      .run();
  }

  async completePromotion(conversationId: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE conversations SET status='promoted',promotion_lease_expires_at=NULL,updated_at=?1
         WHERE id=?2 AND status='promoting' AND promoted_issue_number IS NOT NULL`,
      )
      .bind(this.now(), conversationId)
      .run();
  }
}
