// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ModelRoute, ProfileModel } from "@roundhouse/core";
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

export interface CanonicalInboundMessage {
  readonly adapter: string;
  readonly adapterInstallation: string;
  readonly externalConversationId: string;
  readonly externalMessageId: string;
  readonly verifiedActorId: string;
  readonly verifiedActorLogin: string;
  readonly body: string;
  readonly sentAt: number;
}

export interface DeliveryBrief {
  readonly id: string;
  readonly revision: number;
  readonly state: "draft" | "approved" | "superseded";
  readonly title: string;
  readonly body: string;
  readonly outcome: string;
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly string[];
  readonly evidence: readonly string[];
  readonly uncertainties: readonly string[];
  readonly sourceCommit: string;
  readonly approvedByGithubUserId?: number;
  readonly approvedByGithubLogin?: string;
  readonly approvedAt?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ConversationMessage {
  readonly id: string;
  readonly turnId?: string;
  readonly direction: "inbound" | "outbound";
  readonly role: "user" | "assistant";
  readonly actorId: string;
  readonly actorLogin: string;
  readonly adapter: string;
  readonly adapterInstallation: string;
  readonly externalConversationId: string;
  readonly externalMessageId?: string;
  readonly body: string;
  readonly createdAt: number;
}

export interface ConversationTurn {
  readonly id: string;
  readonly conversationId: string;
  readonly triggeringMessageId?: string;
  readonly kind: "message" | "brief";
  readonly ordinal: number;
  readonly state: "pending" | "running" | "succeeded" | "failed";
  readonly sourceCommit: string;
  readonly configuredModel: string;
  readonly configuredReasoning: string;
  readonly modelRoute?: ModelRoute;
  readonly resultMessageId?: string;
  readonly resultBriefId?: string;
  readonly attempts: number;
  readonly leaseExpiresAt?: number;
  readonly errorCode?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt?: number;
}

export interface ConversationPromotion {
  readonly id: string;
  readonly briefId: string;
  readonly state:
    "requested" | "issue_created" | "awaiting_intake" | "accepted" | "rejected";
  readonly actorGithubUserId: number;
  readonly actorGithubLogin: string;
  readonly issueNumber?: number;
  readonly issueUrl?: string;
  readonly runId?: string;
  readonly errorCode?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt?: number;
}

export interface ConversationLink {
  readonly kind: "github.issue" | "roundhouse.run";
  readonly externalId: string;
  readonly url: string;
  readonly createdAt: number;
}

export interface Conversation {
  readonly id: string;
  readonly repository: ConversationRepositoryRef;
  readonly creatorGithubUserId: number;
  readonly creatorGithubLogin: string;
  readonly status: "open" | "handoff_pending" | "promoted";
  readonly title?: string;
  readonly sourceCommit: string;
  readonly profileHash: string;
  readonly context: ConversationContext;
  readonly activeTurn?: ConversationTurn;
  readonly latestTurn?: ConversationTurn;
  readonly currentBrief?: DeliveryBrief;
  readonly promotion?: ConversationPromotion;
  readonly links: readonly ConversationLink[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messages: readonly ConversationMessage[];
}

export interface ConversationSummary {
  readonly id: string;
  readonly title?: string;
  readonly repository: string;
  readonly status: Conversation["status"];
  readonly promotionState?: ConversationPromotion["state"];
  readonly issueNumber?: number;
  readonly issueUrl?: string;
  readonly updatedAt: number;
}

export interface ConversationWakeup {
  readonly kind: "turn" | "promotion";
  readonly id: string;
}

export interface PendingConversationWakeup {
  readonly wakeup: ConversationWakeup;
  readonly attempts: number;
  readonly availableAt: number;
}

export interface ConversationCallUsage {
  readonly callId: string;
  readonly provider: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly callKind: "conversation" | "delivery_brief";
  readonly model: string;
  readonly configuredModel: string;
  readonly protocol: string;
  readonly reasoningLevel: string;
  readonly routingRule: string;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly reasoningTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly costUsd?: number;
  readonly latencyMs: number;
  readonly outcome: "succeeded" | "failed";
  readonly createdAt: number;
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
  title: string | null;
  source_commit: string;
  profile_hash: string;
  context_json: string;
  active_turn_id: string | null;
  current_brief_id: string | null;
  created_at: number;
  updated_at: number;
};

type TurnRow = {
  id: string;
  conversation_id: string;
  triggering_message_id: string | null;
  kind: ConversationTurn["kind"];
  state: ConversationTurn["state"];
  source_commit: string;
  configured_model: string;
  configured_reasoning: string;
  model_route_json: string | null;
  result_message_id: string | null;
  result_brief_id: string | null;
  ordinal: number;
  attempts: number;
  lease_expires_at: number | null;
  error_code: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type BriefRow = {
  id: string;
  revision: number;
  state: DeliveryBrief["state"];
  title: string;
  body: string;
  outcome: string;
  acceptance_criteria_json: string;
  constraints_json: string;
  evidence_json: string;
  uncertainties_json: string;
  source_commit: string;
  approved_by_github_user_id: number | null;
  approved_by_github_login: string | null;
  approved_at: number | null;
  created_at: number;
  updated_at: number;
};

type PromotionRow = {
  id: string;
  brief_id: string;
  state: ConversationPromotion["state"];
  actor_github_user_id: number;
  actor_github_login: string;
  issue_number: number | null;
  issue_url: string | null;
  run_id: string | null;
  error_code: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
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

function turnFromRow(row: TurnRow): ConversationTurn {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    ...(row.triggering_message_id
      ? { triggeringMessageId: row.triggering_message_id }
      : {}),
    kind: row.kind,
    ordinal: row.ordinal,
    state: row.state,
    sourceCommit: row.source_commit,
    configuredModel: row.configured_model,
    configuredReasoning: row.configured_reasoning,
    ...(row.model_route_json
      ? { modelRoute: JSON.parse(row.model_route_json) as ModelRoute }
      : {}),
    ...(row.result_message_id
      ? { resultMessageId: row.result_message_id }
      : {}),
    ...(row.result_brief_id ? { resultBriefId: row.result_brief_id } : {}),
    attempts: row.attempts,
    ...(row.lease_expires_at === null
      ? {}
      : { leaseExpiresAt: row.lease_expires_at }),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
  };
}

function briefFromRow(row: BriefRow): DeliveryBrief {
  return {
    id: row.id,
    revision: row.revision,
    state: row.state,
    title: row.title,
    body: row.body,
    outcome: row.outcome,
    acceptanceCriteria: JSON.parse(row.acceptance_criteria_json) as string[],
    constraints: JSON.parse(row.constraints_json) as string[],
    evidence: JSON.parse(row.evidence_json) as string[],
    uncertainties: JSON.parse(row.uncertainties_json) as string[],
    sourceCommit: row.source_commit,
    ...(row.approved_by_github_user_id === null
      ? {}
      : { approvedByGithubUserId: row.approved_by_github_user_id }),
    ...(row.approved_by_github_login
      ? { approvedByGithubLogin: row.approved_by_github_login }
      : {}),
    ...(row.approved_at === null ? {} : { approvedAt: row.approved_at }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function promotionFromRow(row: PromotionRow): ConversationPromotion {
  return {
    id: row.id,
    briefId: row.brief_id,
    state: row.state,
    actorGithubUserId: row.actor_github_user_id,
    actorGithubLogin: row.actor_github_login,
    ...(row.issue_number === null ? {} : { issueNumber: row.issue_number }),
    ...(row.issue_url ? { issueUrl: row.issue_url } : {}),
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
  };
}

function placeholders(values: readonly unknown[], offset = 1): string {
  return values.map((_, index) => `?${index + offset}`).join(",");
}

function wakeupOutboxId(wakeup: ConversationWakeup): string {
  return `conversation:${wakeup.kind}:${wakeup.id}`;
}

function initialBriefBody(
  brief: Pick<
    DeliveryBrief,
    | "outcome"
    | "acceptanceCriteria"
    | "constraints"
    | "evidence"
    | "uncertainties"
  >,
): string {
  const section = (heading: string, items: readonly string[]) =>
    items.length
      ? `\n\n## ${heading}\n\n${items.map((item) => `- ${item}`).join("\n")}`
      : "";
  return `## Outcome\n\n${brief.outcome}${section("Acceptance criteria", brief.acceptanceCriteria)}${section("Constraints", brief.constraints)}${section("Evidence and decisions", brief.evidence)}${section("Remaining uncertainties", brief.uncertainties)}\n`;
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
        `SELECT id,github_id,profile_json FROM repositories
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
        `SELECT id,github_id,profile_json FROM repositories
         WHERE id=?1 AND github_id IN (${placeholders(authorizedGithubIds, 2)})`,
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
        `SELECT c.id,c.title,c.status,
                CASE WHEN p.updated_at>c.updated_at THEN p.updated_at ELSE c.updated_at END AS updated_at,
                r.profile_json,p.state AS promotion_state,p.issue_number,p.issue_url
         FROM conversations c
         JOIN repositories r ON r.id=c.repository_id
         LEFT JOIN conversation_promotions p ON p.conversation_id=c.id
         WHERE c.creator_github_user_id=?1
           AND r.github_id IN (${placeholders(authorizedGithubIds, 2)})
         ORDER BY CASE WHEN p.updated_at>c.updated_at THEN p.updated_at ELSE c.updated_at END DESC LIMIT 50`,
      )
      .bind(creatorGithubUserId, ...authorizedGithubIds)
      .all<{
        id: string;
        title: string | null;
        status: Conversation["status"];
        updated_at: number;
        profile_json: string;
        promotion_state: ConversationPromotion["state"] | null;
        issue_number: number | null;
        issue_url: string | null;
      }>();
    return (rows.results ?? []).map((row) => ({
      id: row.id,
      ...(typeof row.title === "string" ? { title: row.title } : {}),
      repository: repositoryFromRow({
        id: "",
        github_id: "",
        profile_json: row.profile_json,
      }).name,
      status: row.status,
      ...(row.promotion_state ? { promotionState: row.promotion_state } : {}),
      ...(row.issue_number === null ? {} : { issueNumber: row.issue_number }),
      ...(row.issue_url ? { issueUrl: row.issue_url } : {}),
      updatedAt: row.updated_at,
    }));
  }

  private turnOutboxStatement(
    conversationId: string,
    wakeup: ConversationWakeup,
    availableAt: number,
  ) {
    const authority =
      wakeup.kind === "turn"
        ? "conversation_turns WHERE id=?6 AND conversation_id=?2 AND state='pending'"
        : "conversation_promotions WHERE id=?6 AND conversation_id=?2 AND state='requested'";
    return this.db
      .prepare(
        `INSERT INTO conversation_outbox
           (id,conversation_id,kind,payload_json,state,attempts,available_at,created_at,completed_at)
         SELECT ?1,?2,?3,?4,'pending',0,?5,?5,NULL
         FROM ${authority}`,
      )
      .bind(
        wakeupOutboxId(wakeup),
        conversationId,
        wakeup.kind === "turn" ? "turn_wakeup" : "promotion_wakeup",
        JSON.stringify(wakeup),
        availableAt,
        wakeup.id,
      );
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
    readonly message: CanonicalInboundMessage;
  }): Promise<{
    readonly conversationId: string;
    readonly turnId: string;
    readonly created: boolean;
  }> {
    const existing = await this.db
      .prepare(
        `SELECT id,active_turn_id FROM conversations
         WHERE origin_adapter=?1 AND origin_adapter_installation=?2
           AND origin_external_message_id=?3`,
      )
      .bind(
        input.message.adapter,
        input.message.adapterInstallation,
        input.message.externalMessageId,
      )
      .first<{ id: string; active_turn_id: string | null }>();
    if (existing)
      return {
        conversationId: existing.id,
        turnId: existing.active_turn_id ?? input.turnId,
        created: false,
      };
    const time = this.now();
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO conversations
             (id,repository_id,creator_github_user_id,creator_github_login,origin_adapter,origin_adapter_installation,origin_external_message_id,status,source_commit,profile_hash,context_json,active_turn_id,current_brief_id,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,'open',?8,?9,?10,?11,NULL,?12,?12)`,
          )
          .bind(
            input.id,
            input.repositoryId,
            input.creatorGithubUserId,
            input.creatorGithubLogin,
            input.message.adapter,
            input.message.adapterInstallation,
            input.message.externalMessageId,
            input.sourceCommit,
            input.profileHash,
            JSON.stringify(input.context),
            input.turnId,
            time,
          ),
        this.db
          .prepare(
            `INSERT INTO conversation_messages
             (id,conversation_id,turn_id,direction,role,actor_id,actor_login,adapter,adapter_installation,external_conversation_id,external_message_id,ordinal,body,created_at)
             VALUES (?1,?2,?3,'inbound','user',?4,?5,?6,?7,?8,?9,1,?10,?11)`,
          )
          .bind(
            input.messageId,
            input.id,
            input.turnId,
            input.message.verifiedActorId,
            input.message.verifiedActorLogin,
            input.message.adapter,
            input.message.adapterInstallation,
            input.message.externalConversationId,
            input.message.externalMessageId,
            input.message.body,
            input.message.sentAt,
          ),
        this.db
          .prepare(
            `INSERT INTO conversation_turns
             (id,conversation_id,triggering_message_id,kind,state,source_commit,configured_model,configured_reasoning,model_route_json,result_message_id,result_brief_id,ordinal,attempts,lease_expires_at,error_code,created_at,updated_at,completed_at)
             VALUES (?1,?2,?3,'message','pending',?4,?5,?6,NULL,NULL,NULL,1,0,NULL,NULL,?7,?7,NULL)`,
          )
          .bind(
            input.turnId,
            input.id,
            input.messageId,
            input.sourceCommit,
            input.context.model.id,
            input.context.model.reasoning,
            time,
          ),
        this.turnOutboxStatement(
          input.id,
          { kind: "turn", id: input.turnId },
          time,
        ),
      ]);
      return { conversationId: input.id, turnId: input.turnId, created: true };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("UNIQUE"))
        throw error;
      const raced = await this.db
        .prepare(
          `SELECT id,active_turn_id FROM conversations
           WHERE origin_adapter=?1 AND origin_adapter_installation=?2
             AND origin_external_message_id=?3`,
        )
        .bind(
          input.message.adapter,
          input.message.adapterInstallation,
          input.message.externalMessageId,
        )
        .first<{ id: string; active_turn_id: string | null }>();
      if (!raced) throw error;
      return {
        conversationId: raced.id,
        turnId: raced.active_turn_id ?? input.turnId,
        created: false,
      };
    }
  }

  async appendUserTurn(input: {
    readonly conversationId: string;
    readonly creatorGithubUserId: number;
    readonly turnId: string;
    readonly messageId: string;
    readonly message: CanonicalInboundMessage;
  }): Promise<"created" | "duplicate" | "unavailable"> {
    const duplicate = await this.db
      .prepare(
        `SELECT id FROM conversation_messages
         WHERE adapter=?1 AND adapter_installation=?2 AND external_message_id=?3`,
      )
      .bind(
        input.message.adapter,
        input.message.adapterInstallation,
        input.message.externalMessageId,
      )
      .first<{ id: string }>();
    if (duplicate) return "duplicate";
    const time = this.now();
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO conversation_messages
           (id,conversation_id,turn_id,direction,role,actor_id,actor_login,adapter,adapter_installation,external_conversation_id,external_message_id,ordinal,body,created_at)
           SELECT ?1,?2,?3,'inbound','user',?4,?5,?6,?7,?8,?9,
                  (SELECT COALESCE(MAX(ordinal),0)+1 FROM conversation_messages WHERE conversation_id=?2),
                  ?10,?11
           FROM conversations c
           WHERE c.id=?2 AND c.creator_github_user_id=?12 AND c.status='open'
             AND c.active_turn_id IS NULL
             AND NOT EXISTS (SELECT 1 FROM conversation_promotions p WHERE p.conversation_id=c.id)`,
        )
        .bind(
          input.messageId,
          input.conversationId,
          input.turnId,
          input.message.verifiedActorId,
          input.message.verifiedActorLogin,
          input.message.adapter,
          input.message.adapterInstallation,
          input.message.externalConversationId,
          input.message.externalMessageId,
          input.message.body,
          input.message.sentAt,
          input.creatorGithubUserId,
        ),
      this.db
        .prepare(
          `INSERT INTO conversation_turns
           (id,conversation_id,triggering_message_id,kind,state,source_commit,configured_model,configured_reasoning,model_route_json,result_message_id,result_brief_id,ordinal,attempts,lease_expires_at,error_code,created_at,updated_at,completed_at)
           SELECT ?1,c.id,?2,'message','pending',c.source_commit,
                  json_extract(c.context_json,'$.model.id'),
                  json_extract(c.context_json,'$.model.reasoning'),
                  NULL,NULL,NULL,
                  (SELECT COALESCE(MAX(ordinal),0)+1 FROM conversation_turns WHERE conversation_id=c.id),
                  0,NULL,NULL,?3,?3,NULL
           FROM conversations c JOIN conversation_messages m ON m.id=?2
           WHERE c.id=?4 AND m.turn_id=?1`,
        )
        .bind(input.turnId, input.messageId, time, input.conversationId),
      this.db
        .prepare(
          `UPDATE conversation_delivery_briefs SET state='superseded',updated_at=?1
           WHERE id=(SELECT current_brief_id FROM conversations WHERE id=?2)
             AND state='draft'
             AND EXISTS (
               SELECT 1 FROM conversation_messages
               WHERE id=?3 AND conversation_id=?2
             )`,
        )
        .bind(time, input.conversationId, input.messageId),
      this.db
        .prepare(
          `UPDATE conversations SET active_turn_id=?1,current_brief_id=NULL,updated_at=?2
           WHERE id=?3 AND creator_github_user_id=?4 AND status='open'
             AND active_turn_id IS NULL
             AND EXISTS (SELECT 1 FROM conversation_turns WHERE id=?1 AND state='pending')`,
        )
        .bind(
          input.turnId,
          time,
          input.conversationId,
          input.creatorGithubUserId,
        ),
      this.turnOutboxStatement(
        input.conversationId,
        { kind: "turn", id: input.turnId },
        time,
      ),
    ]);
    return (results[0]?.meta.changes ?? 0) === 1 ? "created" : "unavailable";
  }

  async requestBrief(input: {
    readonly conversationId: string;
    readonly creatorGithubUserId: number;
    readonly turnId: string;
    readonly messageId?: string;
    readonly message?: CanonicalInboundMessage;
  }): Promise<"created" | "duplicate" | "unavailable"> {
    const duplicate = await this.db
      .prepare("SELECT id FROM conversation_turns WHERE id=?1")
      .bind(input.turnId)
      .first<{ id: string }>();
    if (duplicate) return "duplicate";
    const time = this.now();
    const messageStatement =
      input.message && input.messageId
        ? [
            this.db
              .prepare(
                `INSERT INTO conversation_messages
                 (id,conversation_id,turn_id,direction,role,actor_id,actor_login,adapter,adapter_installation,external_conversation_id,external_message_id,ordinal,body,created_at)
                 SELECT ?1,?2,?3,'inbound','user',?4,?5,?6,?7,?8,?9,
                        (SELECT COALESCE(MAX(ordinal),0)+1 FROM conversation_messages WHERE conversation_id=?2),
                        ?10,?11
                 FROM conversations c
                 WHERE c.id=?2 AND c.creator_github_user_id=?12 AND c.status='open'
                   AND c.active_turn_id IS NULL
                   AND NOT EXISTS (SELECT 1 FROM conversation_promotions p WHERE p.conversation_id=c.id)`,
              )
              .bind(
                input.messageId,
                input.conversationId,
                input.turnId,
                input.message.verifiedActorId,
                input.message.verifiedActorLogin,
                input.message.adapter,
                input.message.adapterInstallation,
                input.message.externalConversationId,
                input.message.externalMessageId,
                input.message.body,
                input.message.sentAt,
                input.creatorGithubUserId,
              ),
          ]
        : [];
    const trigger = input.messageId ?? null;
    try {
      const results = await this.db.batch([
        ...messageStatement,
        this.db
          .prepare(
            `INSERT INTO conversation_turns
             (id,conversation_id,triggering_message_id,kind,state,source_commit,configured_model,configured_reasoning,model_route_json,result_message_id,result_brief_id,ordinal,attempts,lease_expires_at,error_code,created_at,updated_at,completed_at)
             SELECT ?1,c.id,?2,'brief','pending',c.source_commit,
                    json_extract(c.context_json,'$.model.id'),
                    json_extract(c.context_json,'$.model.reasoning'),
                    NULL,NULL,NULL,
                    (SELECT COALESCE(MAX(ordinal),0)+1 FROM conversation_turns WHERE conversation_id=c.id),
                    0,NULL,NULL,?3,?3,NULL
             FROM conversations c
             WHERE c.id=?4 AND c.creator_github_user_id=?5 AND c.status='open'
               AND c.active_turn_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM conversation_promotions p WHERE p.conversation_id=c.id)
               ${input.messageId ? "AND EXISTS (SELECT 1 FROM conversation_messages WHERE id=?2 AND conversation_id=c.id)" : ""}`,
          )
          .bind(
            input.turnId,
            trigger,
            time,
            input.conversationId,
            input.creatorGithubUserId,
          ),
        this.db
          .prepare(
            `UPDATE conversation_delivery_briefs SET state='superseded',updated_at=?1
             WHERE id=(SELECT current_brief_id FROM conversations WHERE id=?2)
               AND state='draft' AND EXISTS (SELECT 1 FROM conversation_turns WHERE id=?3 AND state='pending')`,
          )
          .bind(time, input.conversationId, input.turnId),
        this.db
          .prepare(
            `UPDATE conversations SET active_turn_id=?1,current_brief_id=NULL,updated_at=?2
             WHERE id=?3 AND creator_github_user_id=?4 AND active_turn_id IS NULL
               AND EXISTS (SELECT 1 FROM conversation_turns WHERE id=?1 AND state='pending')`,
          )
          .bind(
            input.turnId,
            time,
            input.conversationId,
            input.creatorGithubUserId,
          ),
        this.turnOutboxStatement(
          input.conversationId,
          { kind: "turn", id: input.turnId },
          time,
        ),
      ]);
      return (results[messageStatement.length]?.meta.changes ?? 0) === 1
        ? "created"
        : "unavailable";
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("UNIQUE"))
        throw error;
      return (await this.db
        .prepare("SELECT id FROM conversation_turns WHERE id=?1")
        .bind(input.turnId)
        .first<{ id: string }>())
        ? "duplicate"
        : "unavailable";
    }
  }

  private async getById(
    id: string,
    authorization?: {
      readonly creatorGithubUserId: number;
      readonly authorizedGithubIds: readonly string[];
    },
  ): Promise<Conversation | undefined> {
    if (authorization && !authorization.authorizedGithubIds.length)
      return undefined;
    const auth = authorization
      ? ` AND c.creator_github_user_id=?2 AND r.github_id IN (${placeholders(
          authorization.authorizedGithubIds,
          3,
        )})`
      : "";
    const values = authorization
      ? [
          id,
          authorization.creatorGithubUserId,
          ...authorization.authorizedGithubIds,
        ]
      : [id];
    const row = await this.db
      .prepare(
        `SELECT c.id AS conversation_id,c.creator_github_user_id,c.creator_github_login,
                c.status,c.title,c.source_commit,c.profile_hash,c.context_json,c.active_turn_id,
                c.current_brief_id,c.created_at,c.updated_at,
                r.id,r.github_id,r.profile_json
         FROM conversations c JOIN repositories r ON r.id=c.repository_id
         WHERE c.id=?1${auth}`,
      )
      .bind(...values)
      .first<ConversationRow>();
    if (!row) return undefined;
    const [messages, activeTurn, latestTurn, currentBrief, promotion, links] =
      await Promise.all([
        this.db
          .prepare(
            `SELECT id,turn_id,direction,role,actor_id,actor_login,adapter,
                  adapter_installation,external_conversation_id,external_message_id,body,created_at
           FROM conversation_messages WHERE conversation_id=?1 ORDER BY ordinal`,
          )
          .bind(id)
          .all<{
            id: string;
            turn_id: string | null;
            direction: ConversationMessage["direction"];
            role: ConversationMessage["role"];
            actor_id: string;
            actor_login: string;
            adapter: string;
            adapter_installation: string;
            external_conversation_id: string;
            external_message_id: string | null;
            body: string;
            created_at: number;
          }>(),
        row.active_turn_id
          ? this.db
              .prepare("SELECT * FROM conversation_turns WHERE id=?1")
              .bind(row.active_turn_id)
              .first<TurnRow>()
          : Promise.resolve(null),
        this.db
          .prepare(
            "SELECT * FROM conversation_turns WHERE conversation_id=?1 ORDER BY ordinal DESC LIMIT 1",
          )
          .bind(id)
          .first<TurnRow>(),
        row.current_brief_id
          ? this.db
              .prepare("SELECT * FROM conversation_delivery_briefs WHERE id=?1")
              .bind(row.current_brief_id)
              .first<BriefRow>()
          : Promise.resolve(null),
        this.db
          .prepare(
            "SELECT * FROM conversation_promotions WHERE conversation_id=?1",
          )
          .bind(id)
          .first<PromotionRow>(),
        this.db
          .prepare(
            "SELECT kind,external_id,url,created_at FROM conversation_links WHERE conversation_id=?1 ORDER BY created_at,kind",
          )
          .bind(id)
          .all<{
            kind: ConversationLink["kind"];
            external_id: string;
            url: string;
            created_at: number;
          }>(),
      ]);
    return {
      id: row.conversation_id,
      repository: repositoryFromRow(row),
      creatorGithubUserId: row.creator_github_user_id,
      creatorGithubLogin: row.creator_github_login,
      status: row.status,
      ...(typeof row.title === "string" ? { title: row.title } : {}),
      sourceCommit: row.source_commit,
      profileHash: row.profile_hash,
      context: JSON.parse(row.context_json) as ConversationContext,
      ...(activeTurn ? { activeTurn: turnFromRow(activeTurn) } : {}),
      ...(latestTurn ? { latestTurn: turnFromRow(latestTurn) } : {}),
      ...(currentBrief ? { currentBrief: briefFromRow(currentBrief) } : {}),
      ...(promotion ? { promotion: promotionFromRow(promotion) } : {}),
      links: (links.results ?? []).map((link) => ({
        kind: link.kind,
        externalId: link.external_id,
        url: link.url,
        createdAt: link.created_at,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: (messages.results ?? []).map((message) => ({
        id: message.id,
        ...(message.turn_id ? { turnId: message.turn_id } : {}),
        direction: message.direction,
        role: message.role,
        actorId: message.actor_id,
        actorLogin: message.actor_login,
        adapter: message.adapter,
        adapterInstallation: message.adapter_installation,
        externalConversationId: message.external_conversation_id,
        ...(message.external_message_id
          ? { externalMessageId: message.external_message_id }
          : {}),
        body: message.body,
        createdAt: message.created_at,
      })),
    };
  }

  async get(
    id: string,
    creatorGithubUserId: number,
    authorizedGithubIds: readonly string[],
  ): Promise<Conversation | undefined> {
    return this.getById(id, { creatorGithubUserId, authorizedGithubIds });
  }

  async getForTurn(turnId: string): Promise<Conversation | undefined> {
    const row = await this.db
      .prepare("SELECT conversation_id FROM conversation_turns WHERE id=?1")
      .bind(turnId)
      .first<{ conversation_id: string }>();
    return row ? this.getById(row.conversation_id) : undefined;
  }

  async turn(turnId: string): Promise<ConversationTurn | undefined> {
    const row = await this.db
      .prepare("SELECT * FROM conversation_turns WHERE id=?1")
      .bind(turnId)
      .first<TurnRow>();
    return row ? turnFromRow(row) : undefined;
  }

  async claimTurn(
    turnId: string,
    leaseMilliseconds = 15 * 60_000,
  ): Promise<ConversationTurn | undefined> {
    const time = this.now();
    const row = await this.db
      .prepare(
        `UPDATE conversation_turns
         SET state='running',attempts=attempts+1,lease_expires_at=?1,
             error_code=NULL,updated_at=?2
         WHERE id=?3
           AND (state='pending' OR (state='running' AND lease_expires_at<=?2))
           AND EXISTS (
             SELECT 1 FROM conversations c
             WHERE c.id=conversation_turns.conversation_id
               AND c.active_turn_id=conversation_turns.id
               AND c.status='open'
           )
         RETURNING *`,
      )
      .bind(time + leaseMilliseconds, time, turnId)
      .first<TurnRow>();
    return row ? turnFromRow(row) : undefined;
  }

  async renewTurn(
    turnId: string,
    leaseMilliseconds = 15 * 60_000,
  ): Promise<boolean> {
    const time = this.now();
    const result = await this.db
      .prepare(
        `UPDATE conversation_turns SET lease_expires_at=?1,updated_at=?2
         WHERE id=?3 AND state='running'`,
      )
      .bind(time + leaseMilliseconds, time, turnId)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async recordTurnRoute(turnId: string, route: ModelRoute): Promise<void> {
    await this.db
      .prepare(
        "UPDATE conversation_turns SET model_route_json=?1,updated_at=?2 WHERE id=?3 AND state='running'",
      )
      .bind(JSON.stringify(route), this.now(), turnId)
      .run();
  }

  async completeMessageTurn(
    turnId: string,
    messageId: string,
    body: string,
    title?: string,
  ): Promise<boolean> {
    const time = this.now();
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO conversation_messages
           (id,conversation_id,turn_id,direction,role,actor_id,actor_login,adapter,adapter_installation,external_conversation_id,external_message_id,ordinal,body,created_at)
           SELECT ?1,t.conversation_id,t.id,'outbound','assistant','roundhouse','Roundhouse',
                  m.adapter,m.adapter_installation,m.external_conversation_id,NULL,
                  (SELECT COALESCE(MAX(ordinal),0)+1 FROM conversation_messages WHERE conversation_id=t.conversation_id),
                  ?2,?3
           FROM conversation_turns t
           JOIN conversation_messages m ON m.id=t.triggering_message_id
           WHERE t.id=?4 AND t.kind='message' AND t.state='running'`,
        )
        .bind(messageId, body, time, turnId),
      ...(title === undefined
        ? []
        : [
            this.db
              .prepare(
                `UPDATE conversations
                 SET title=?1
                 WHERE id=(SELECT conversation_id FROM conversation_turns WHERE id=?2)
                   AND title IS NULL
                   AND EXISTS (
                     SELECT 1 FROM conversation_turns t
                     WHERE t.id=?2 AND t.kind='message' AND t.state='running'
                       AND t.ordinal=1
                   )
                   AND EXISTS (
                     SELECT 1 FROM conversation_messages m
                     WHERE m.id=?3 AND m.turn_id=?2 AND m.role='assistant'
                   )`,
              )
              .bind(title, turnId, messageId),
          ]),
      this.db
        .prepare(
          `UPDATE conversation_turns
           SET state='succeeded',result_message_id=?1,lease_expires_at=NULL,
               updated_at=?2,completed_at=?2
           WHERE id=?3 AND state='running'
             AND EXISTS (
               SELECT 1 FROM conversation_messages
               WHERE id=?1 AND turn_id=?3 AND role='assistant'
             )`,
        )
        .bind(messageId, time, turnId),
      this.db
        .prepare(
          `UPDATE conversations SET active_turn_id=NULL,updated_at=?1
           WHERE active_turn_id=?2
             AND EXISTS (
               SELECT 1 FROM conversation_messages
               WHERE id=?3 AND turn_id=?2 AND role='assistant'
             )`,
        )
        .bind(time, turnId, messageId),
      this.db
        .prepare(
          `INSERT INTO conversation_outbox
           (id,conversation_id,kind,payload_json,state,attempts,available_at,created_at,completed_at)
           SELECT ?1,t.conversation_id,'adapter_reply',?2,'pending',0,?3,?3,NULL
           FROM conversation_turns t JOIN conversation_messages m ON m.id=?4
           WHERE t.id=?5 AND t.state='succeeded' AND m.turn_id=t.id`,
        )
        .bind(
          `conversation:reply:${messageId}`,
          JSON.stringify({ messageId }),
          time,
          messageId,
          turnId,
        ),
    ]);
    return (results[0]?.meta.changes ?? 0) === 1;
  }

  async completeBriefTurn(
    turnId: string,
    briefId: string,
    brief: Omit<
      DeliveryBrief,
      | "id"
      | "revision"
      | "state"
      | "body"
      | "sourceCommit"
      | "createdAt"
      | "updatedAt"
    >,
  ): Promise<boolean> {
    const turn = await this.turn(turnId);
    if (!turn || turn.kind !== "brief" || turn.state !== "running")
      return false;
    const revision =
      (
        await this.db
          .prepare(
            "SELECT COALESCE(MAX(revision),0)+1 AS revision FROM conversation_delivery_briefs WHERE conversation_id=?1",
          )
          .bind(turn.conversationId)
          .first<{ revision: number }>()
      )?.revision ?? 1;
    const time = this.now();
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO conversation_delivery_briefs
           (id,conversation_id,turn_id,revision,state,title,body,outcome,acceptance_criteria_json,constraints_json,evidence_json,uncertainties_json,source_commit,approved_by_github_user_id,approved_by_github_login,approved_at,created_at,updated_at)
           SELECT ?1,conversation_id,id,?2,'draft',?3,?4,?5,?6,?7,?8,?9,source_commit,NULL,NULL,NULL,?10,?10
           FROM conversation_turns WHERE id=?11 AND state='running' AND kind='brief'`,
        )
        .bind(
          briefId,
          revision,
          brief.title,
          initialBriefBody(brief),
          brief.outcome,
          JSON.stringify(brief.acceptanceCriteria),
          JSON.stringify(brief.constraints),
          JSON.stringify(brief.evidence),
          JSON.stringify(brief.uncertainties),
          time,
          turnId,
        ),
      this.db
        .prepare(
          `UPDATE conversation_turns
           SET state='succeeded',result_brief_id=?1,lease_expires_at=NULL,
               updated_at=?2,completed_at=?2
           WHERE id=?3 AND state='running'`,
        )
        .bind(briefId, time, turnId),
      this.db
        .prepare(
          `UPDATE conversations SET active_turn_id=NULL,current_brief_id=?1,updated_at=?2
           WHERE active_turn_id=?3
             AND EXISTS (SELECT 1 FROM conversation_delivery_briefs WHERE id=?1)`,
        )
        .bind(briefId, time, turnId),
    ]);
    return (results[0]?.meta.changes ?? 0) === 1;
  }

  async retryTurn(turnId: string, errorCode: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE conversation_turns
         SET state='pending',lease_expires_at=NULL,error_code=?1,updated_at=?2
         WHERE id=?3 AND state='running'`,
      )
      .bind(errorCode.slice(0, 120), this.now(), turnId)
      .run();
  }

  async failTurn(turnId: string, errorCode: string): Promise<void> {
    const time = this.now();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE conversation_turns
           SET state='failed',lease_expires_at=NULL,error_code=?1,
               updated_at=?2,completed_at=?2
           WHERE id=?3 AND state IN ('pending','running')`,
        )
        .bind(errorCode.slice(0, 120), time, turnId),
      this.db
        .prepare(
          "UPDATE conversations SET active_turn_id=NULL,updated_at=?1 WHERE active_turn_id=?2",
        )
        .bind(time, turnId),
    ]);
  }

  async recordModelUsage(
    items: readonly ConversationCallUsage[],
  ): Promise<void> {
    if (!items.length) return;
    await this.db.batch(
      items.map((usage) =>
        this.db
          .prepare(
            `INSERT OR IGNORE INTO conversation_model_usage
             (call_id,provider,conversation_id,turn_id,call_kind,model,configured_model,protocol,reasoning_level,routing_rule,input_tokens,cached_input_tokens,cache_creation_input_tokens,reasoning_tokens,output_tokens,total_tokens,cost_usd,latency_ms,outcome,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)`,
          )
          .bind(
            usage.callId,
            usage.provider,
            usage.conversationId,
            usage.turnId,
            usage.callKind,
            usage.model,
            usage.configuredModel,
            usage.protocol,
            usage.reasoningLevel,
            usage.routingRule,
            usage.inputTokens ?? null,
            usage.cachedInputTokens ?? null,
            usage.cacheCreationInputTokens ?? null,
            usage.reasoningTokens ?? null,
            usage.outputTokens ?? null,
            usage.totalTokens ?? null,
            usage.costUsd ?? null,
            usage.latencyMs,
            usage.outcome,
            usage.createdAt,
          ),
      ),
    );
  }

  async pendingWakeups(
    now: number,
    limit = 50,
  ): Promise<readonly PendingConversationWakeup[]> {
    const result = await this.db
      .prepare(
        `SELECT payload_json,attempts,available_at FROM conversation_outbox
         WHERE kind IN ('turn_wakeup','promotion_wakeup')
           AND state='pending' AND available_at<=?1
         ORDER BY available_at,id LIMIT ?2`,
      )
      .bind(now, limit)
      .all<{ payload_json: string; attempts: number; available_at: number }>();
    return (result.results ?? []).map((row) => ({
      wakeup: JSON.parse(row.payload_json) as ConversationWakeup,
      attempts: row.attempts,
      availableAt: row.available_at,
    }));
  }

  async markWakeupSent(
    wakeup: ConversationWakeup,
    nextAvailableAt: number,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE conversation_outbox SET attempts=attempts+1,available_at=?1
         WHERE id=?2 AND state='pending'`,
      )
      .bind(nextAvailableAt, wakeupOutboxId(wakeup))
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async completeWakeup(wakeup: ConversationWakeup): Promise<void> {
    await this.db
      .prepare(
        `UPDATE conversation_outbox SET state='completed',completed_at=?1
         WHERE id=?2 AND state='pending'`,
      )
      .bind(this.now(), wakeupOutboxId(wakeup))
      .run();
  }

  async pendingAdapterReplies(limit = 50): Promise<
    readonly {
      readonly outboxId: string;
      readonly message: ConversationMessage;
    }[]
  > {
    const rows = await this.db
      .prepare(
        `SELECT o.id AS outbox_id,m.id,m.turn_id,m.direction,m.role,m.actor_id,
                m.actor_login,m.adapter,m.adapter_installation,m.external_conversation_id,
                m.external_message_id,m.body,m.created_at
         FROM conversation_outbox o
         JOIN conversation_messages m ON m.id=json_extract(o.payload_json,'$.messageId')
         WHERE o.kind='adapter_reply' AND o.state='pending'
         ORDER BY o.available_at,o.id LIMIT ?1`,
      )
      .bind(limit)
      .all<{
        outbox_id: string;
        id: string;
        turn_id: string | null;
        direction: ConversationMessage["direction"];
        role: ConversationMessage["role"];
        actor_id: string;
        actor_login: string;
        adapter: string;
        adapter_installation: string;
        external_conversation_id: string;
        external_message_id: string | null;
        body: string;
        created_at: number;
      }>();
    return (rows.results ?? []).map((row) => ({
      outboxId: row.outbox_id,
      message: {
        id: row.id,
        ...(row.turn_id ? { turnId: row.turn_id } : {}),
        direction: row.direction,
        role: row.role,
        actorId: row.actor_id,
        actorLogin: row.actor_login,
        adapter: row.adapter,
        adapterInstallation: row.adapter_installation,
        externalConversationId: row.external_conversation_id,
        ...(row.external_message_id
          ? { externalMessageId: row.external_message_id }
          : {}),
        body: row.body,
        createdAt: row.created_at,
      },
    }));
  }

  async completeAdapterReply(outboxId: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE conversation_outbox SET state='completed',completed_at=?1
         WHERE id=?2 AND kind='adapter_reply' AND state='pending'`,
      )
      .bind(this.now(), outboxId)
      .run();
  }

  async approveBriefAndRequestPromotion(input: {
    readonly conversationId: string;
    readonly creatorGithubUserId: number;
    readonly creatorGithubLogin: string;
    readonly briefId: string;
    readonly title: string;
    readonly body: string;
    readonly promotionId: string;
    readonly uiSessionHash: string;
  }): Promise<boolean> {
    const time = this.now();
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE conversation_delivery_briefs
           SET state='approved',title=?1,body=?2,
               approved_by_github_user_id=?3,approved_by_github_login=?4,
               approved_at=?5,updated_at=?5
           WHERE id=?6 AND conversation_id=?7 AND state='draft'
             AND EXISTS (
               SELECT 1 FROM conversations c
               WHERE c.id=?7 AND c.creator_github_user_id=?3
                 AND c.current_brief_id=?6 AND c.status='open'
                 AND c.active_turn_id IS NULL
             )`,
        )
        .bind(
          input.title,
          input.body,
          input.creatorGithubUserId,
          input.creatorGithubLogin,
          time,
          input.briefId,
          input.conversationId,
        ),
      this.db
        .prepare(
          `INSERT INTO conversation_promotions
           (id,conversation_id,brief_id,state,actor_github_user_id,actor_github_login,ui_session_hash,issue_number,issue_url,run_id,lease_expires_at,error_code,created_at,updated_at,completed_at)
           SELECT ?1,?2,?3,'requested',?4,?5,?6,NULL,NULL,NULL,NULL,NULL,?7,?7,NULL
           FROM conversation_delivery_briefs
           WHERE id=?3 AND conversation_id=?2 AND state='approved'`,
        )
        .bind(
          input.promotionId,
          input.conversationId,
          input.briefId,
          input.creatorGithubUserId,
          input.creatorGithubLogin,
          input.uiSessionHash,
          time,
        ),
      this.turnOutboxStatement(
        input.conversationId,
        { kind: "promotion", id: input.promotionId },
        time,
      ),
    ]);
    return (results[0]?.meta.changes ?? 0) === 1;
  }

  async promotionForWork(promotionId: string): Promise<
    | {
        readonly promotion: ConversationPromotion;
        readonly conversation: Conversation;
        readonly brief: DeliveryBrief;
        readonly uiSessionHash: string;
      }
    | undefined
  > {
    const row = await this.db
      .prepare(
        `SELECT conversation_id,brief_id,ui_session_hash
         FROM conversation_promotions WHERE id=?1`,
      )
      .bind(promotionId)
      .first<{
        conversation_id: string;
        brief_id: string;
        ui_session_hash: string;
      }>();
    if (!row) return undefined;
    const conversation = await this.getById(row.conversation_id);
    const briefRow = await this.db
      .prepare("SELECT * FROM conversation_delivery_briefs WHERE id=?1")
      .bind(row.brief_id)
      .first<BriefRow>();
    if (!conversation?.promotion || !briefRow) return undefined;
    return {
      promotion: conversation.promotion,
      conversation,
      brief: briefFromRow(briefRow),
      uiSessionHash: row.ui_session_hash,
    };
  }

  async claimPromotion(
    promotionId: string,
    leaseMilliseconds = 5 * 60_000,
  ): Promise<boolean> {
    const time = this.now();
    const result = await this.db
      .prepare(
        `UPDATE conversation_promotions
         SET lease_expires_at=?1,error_code=NULL,updated_at=?2
         WHERE id=?3 AND state IN ('requested','issue_created')
           AND (lease_expires_at IS NULL OR lease_expires_at<=?2)`,
      )
      .bind(time + leaseMilliseconds, time, promotionId)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async recordPromotionIssue(
    promotionId: string,
    issueNumber: number,
    issueUrl: string,
  ): Promise<void> {
    const time = this.now();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE conversation_promotions
           SET state='issue_created',issue_number=?1,issue_url=?2,updated_at=?3
           WHERE id=?4 AND state IN ('requested','issue_created')`,
        )
        .bind(issueNumber, issueUrl, time, promotionId),
      this.db
        .prepare(
          `INSERT INTO conversation_links(conversation_id,kind,external_id,url,created_at)
           SELECT conversation_id,'github.issue',?1,?2,?3
           FROM conversation_promotions WHERE id=?4
           ON CONFLICT(conversation_id,kind) DO UPDATE SET
             external_id=excluded.external_id,url=excluded.url`,
        )
        .bind(String(issueNumber), issueUrl, time, promotionId),
    ]);
  }

  async markPromotionAwaitingIntake(promotionId: string): Promise<void> {
    const time = this.now();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE conversation_promotions
           SET state='awaiting_intake',lease_expires_at=NULL,updated_at=?1
           WHERE id=?2 AND state='issue_created'`,
        )
        .bind(time, promotionId),
      this.db
        .prepare(
          `UPDATE conversations SET status='handoff_pending',updated_at=?1
           WHERE id=(SELECT conversation_id FROM conversation_promotions WHERE id=?2)
             AND status='open'`,
        )
        .bind(time, promotionId),
    ]);
  }

  async retryPromotion(promotionId: string, errorCode: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE conversation_promotions
         SET lease_expires_at=NULL,error_code=?1,updated_at=?2
         WHERE id=?3 AND state IN ('requested','issue_created')`,
      )
      .bind(errorCode.slice(0, 120), this.now(), promotionId)
      .run();
  }

  async rejectPromotion(promotionId: string, errorCode: string): Promise<void> {
    const time = this.now();
    await this.db
      .prepare(
        `UPDATE conversation_promotions
         SET state='rejected',lease_expires_at=NULL,error_code=?1,
             updated_at=?2,completed_at=?2
         WHERE id=?3 AND state IN ('requested','issue_created')`,
      )
      .bind(errorCode.slice(0, 120), time, promotionId)
      .run();
  }

  async recordPromotionIntake(input: {
    readonly conversationId: string;
    readonly briefId: string;
    readonly issueNumber: number;
    readonly actorGithubLogin: string;
    readonly accepted: boolean;
    readonly runId?: string;
    readonly runUrl?: string;
    readonly errorCode?: string;
  }): Promise<boolean> {
    const time = this.now();
    const state = input.accepted ? "accepted" : "rejected";
    const statements = [
      this.db
        .prepare(
          `UPDATE conversation_promotions
           SET state=?1,run_id=?2,error_code=?3,lease_expires_at=NULL,
               updated_at=?4,completed_at=?4
           WHERE conversation_id=?5 AND brief_id=?6 AND issue_number=?7
             AND actor_github_login=?9 COLLATE NOCASE
             AND (
               state IN ('requested','issue_created','awaiting_intake')
               OR (?8=1 AND state='rejected')
               OR (state=?1 AND COALESCE(run_id,'')=COALESCE(?2,''))
             )`,
        )
        .bind(
          state,
          input.runId ?? null,
          input.errorCode ?? null,
          time,
          input.conversationId,
          input.briefId,
          input.issueNumber,
          input.accepted ? 1 : 0,
          input.actorGithubLogin,
        ),
    ];
    if (input.accepted && input.runId && input.runUrl)
      statements.push(
        this.db
          .prepare(
            `INSERT INTO conversation_links(conversation_id,kind,external_id,url,created_at)
             SELECT ?1,'roundhouse.run',?2,?3,?4
             FROM conversation_promotions
             WHERE conversation_id=?1 AND brief_id=?5 AND issue_number=?6
               AND state='accepted' AND run_id=?2
             ON CONFLICT(conversation_id,kind) DO UPDATE SET
               external_id=excluded.external_id,url=excluded.url`,
          )
          .bind(
            input.conversationId,
            input.runId,
            input.runUrl,
            time,
            input.briefId,
            input.issueNumber,
          ),
      );
    statements.push(
      this.db
        .prepare(
          input.accepted
            ? `UPDATE conversations SET status='promoted',updated_at=?1
               WHERE id=?2 AND status IN ('open','handoff_pending','promoted')
                 AND EXISTS (
                   SELECT 1 FROM conversation_promotions
                   WHERE conversation_id=?2 AND brief_id=?3
                     AND issue_number=?4 AND state='accepted'
                 )`
            : `UPDATE conversations SET status='open',updated_at=?1
               WHERE id=?2 AND status IN ('open','handoff_pending')
                 AND EXISTS (
                   SELECT 1 FROM conversation_promotions
                   WHERE conversation_id=?2 AND brief_id=?3
                     AND issue_number=?4 AND state='rejected'
                 )`,
        )
        .bind(time, input.conversationId, input.briefId, input.issueNumber),
    );
    await this.db.batch(statements);
    const recorded = await this.db
      .prepare(
        `SELECT state,run_id FROM conversation_promotions
         WHERE conversation_id=?1 AND brief_id=?2 AND issue_number=?3`,
      )
      .bind(input.conversationId, input.briefId, input.issueNumber)
      .first<{
        state: ConversationPromotion["state"];
        run_id: string | null;
      }>();
    return Boolean(
      recorded &&
      recorded.state === state &&
      (!input.accepted || recorded.run_id === (input.runId ?? null)),
    );
  }
}
