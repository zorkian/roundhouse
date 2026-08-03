# Graph Report - workspace  (2026-08-03)

## Corpus Check
- 147 files · ~247,032 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1651 nodes · 3961 edges · 86 communities (73 shown, 13 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `04a80253`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- runner.mjs
- D1RunRepository
- coordinator.ts
- run-details.ts
- attempt-container.ts
- ui-auth.ts
- profile.ts
- conversation-engine.ts
- model-broker/src/index.ts
- github.ts
- conversation-ui.ts
- coordinate
- contracts.ts
- attempt-dispatch.ts
- conversation-worker.ts
- attempt-runtime.ts
- workflow.ts
- Attempt
- acceptGitHubComment
- github-ci.ts
- artifacts.ts
- attempt-settlement.ts
- compilerOptions
- core/src/index.ts
- model-usage.ts
- FakeElement
- isRecord
- github.test.ts
- D1ConversationRepository
- agent-runner/package.json
- scripts
- core/package.json
- aggregated-review.ts
- Roundhouse V2
- control-plane/src/index.ts
- createRun
- compilerOptions
- control-plane/worker-configuration.d.ts
- core/tsconfig.json
- response-observer/package.json
- compilerOptions
- Development environment, GitHub Actions, and wrangler
- cloudflare-containers.ts
- conversation-store.ts
- dashboard.ts
- check-license-headers.mjs
- usage.ts
- runtime-host/package.json
- RunSnapshot
- model-broker/package.json
- model-broker/worker-configuration.d.ts
- index.d.mts
- cloudflare-workers.ts
- tsconfig.json
- text-modules.d.ts
- callback.ts
- conversation-promotion.ts
- conversation-liveness.ts
- Cursor Cloud specific instructions
- d1-store.ts
- implementation.md
- investigation.md
- planning.md
- project.md
- qualification.md
- review-data.md
- review-holistic.md
- review-security.md
- github-ci.test.ts
- workflow-view.ts
- README.md
- 9. Workflow implementation plan
- Conversational entry v0 implementation plan
- Conversational entry for Roundhouse
- Roundhouse
- workflow-coordinator.test.ts
- GitHubClient
- LocalD1Statement
- GitHubAutomationApi
- runtime-host.ts
- compileWorkflow
- 5. Runtime boundaries
- AttemptCompletion

## God Nodes (most connected - your core abstractions)
1. `D1RunRepository` - 72 edges
2. `RunSnapshot` - 61 edges
3. `Attempt` - 51 edges
4. `D1ConversationRepository` - 47 edges
5. `coordinate()` - 35 edges
6. `RunRepository` - 32 edges
7. `MemoryRunRepository` - 32 edges
8. `observeResponse()` - 28 edges
9. `renderRunDetails()` - 27 edges
10. `Wakeup` - 25 edges

## Surprising Connections (you probably didn't know these)
- `validateCheckpointIdentity()` --indirect_call--> `path()`  [INFERRED]
  apps/control-plane/src/artifacts.ts → packages/core/src/workflow.ts
- `AttemptAssignment` --inherits--> `Attempt`  [EXTRACTED]
  apps/control-plane/src/attempt-container.ts → packages/core/src/contracts.ts
- `AttemptDiagnosticSnapshot` --references--> `Attempt`  [EXTRACTED]
  apps/control-plane/src/d1-store.ts → packages/core/src/contracts.ts
- `ActiveAttemptLease` --inherits--> `Wakeup`  [EXTRACTED]
  apps/control-plane/src/d1-store.ts → packages/core/src/contracts.ts
- `visualFeedbackProfile()` --calls--> `compileWorkflow()`  [EXTRACTED]
  apps/control-plane/src/github.test.ts → packages/core/src/workflow.ts

## Import Cycles
- 3-file cycle: `packages/core/src/profile.ts -> packages/core/src/workflow.ts -> packages/core/src/run.ts -> packages/core/src/profile.ts`

## Communities (86 total, 13 thin omitted)

### Community 0 - "runner.mjs"
Cohesion: 0.05
Nodes (97): activityRequest(), agentRuntime, agentSystemPrompt, agentToolNames(), artifactWriteTokenRequest(), bootstrapWorkspace(), checkpointWorkspace(), clone() (+89 more)

### Community 1 - "D1RunRepository"
Cohesion: 0.06
Nodes (17): pauseForModelBudget(), attemptFromRow(), D1RunRepository, PendingWakeup, Statement, usageFromRow(), publishPendingWakeup(), publishPendingWakeups() (+9 more)

### Community 2 - "coordinator.ts"
Cohesion: 0.11
Nodes (30): attemptInactivityMilliseconds, aggregateReviewAttempts(), attemptOutcomeTransition(), ciTransition(), CompetitionPromoter, CompetitionStep, evidenceForAttempt(), graphCompletedTransition() (+22 more)

### Community 3 - "run-details.ts"
Cohesion: 0.21
Nodes (25): attemptLinks(), attemptResult(), boundaryWorkflowEvidence(), ciResult(), CompetitionGroup, competitionGroups(), competitionPanels(), DetailsAttempt (+17 more)

### Community 4 - "attempt-container.ts"
Cohesion: 0.06
Nodes (31): attemptAllowedHosts(), AttemptAssignment, attemptCompletion(), attemptUsesProjectEnvironment(), containerRegistryHosts, extractModelUsage(), modelEgress(), PreparedAttempt (+23 more)

### Community 5 - "ui-auth.ts"
Cohesion: 0.07
Nodes (50): authorizedRepositoryIds(), base64UrlDecode(), base64UrlEncode(), beginGitHubSignIn(), clearStateCookie(), decryptUiAccessToken(), encryptUiAccessToken(), enrolledRepositoryIds() (+42 more)

### Community 6 - "profile.ts"
Cohesion: 0.07
Nodes (28): defaultBlockingSeverities, defaultConversationModel, defaultReviewerModels, defaultStageModels, findingSeverities, FindingSeverity, isProtectedRepositoryPath(), matches() (+20 more)

### Community 7 - "conversation-engine.ts"
Cohesion: 0.07
Nodes (38): adapterFor(), anthropicMessagesAdapter, briefSchema, Broker, brokerHeaders(), callModel(), ConversationExecutionResult, ConversationFirstReply (+30 more)

### Community 8 - "model-broker/src/index.ts"
Cohesion: 0.09
Nodes (35): applyHostedResearch(), BrokerEnv, brokerRequest(), cloudflareStopReason(), configuredModels(), configuredRoutes(), defaultProtocol(), defaultRoutes (+27 more)

### Community 9 - "github.ts"
Cohesion: 0.14
Nodes (26): appJwt(), bytesToBase64Url(), CommentPayload, implementationComment(), implementationNoChangeComment(), IssuePayload, listComments(), ListedComment (+18 more)

### Community 10 - "conversation-ui.ts"
Cohesion: 0.07
Nodes (44): dependencies, @cloudflare/playwright, @cloudflare/sandbox, cytoscape, marked, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox (+36 more)

### Community 11 - "coordinate"
Cohesion: 0.14
Nodes (16): coordinate(), coordinateCompetition(), dispatchCompetitionAttempt(), dispatchReview(), effectiveAttemptCapabilities(), finalizePromotion(), recordAttemptOutcomeTransition(), recordIssuedCapabilities() (+8 more)

### Community 12 - "contracts.ts"
Cohesion: 0.09
Nodes (25): Approval, ApprovalPurpose, approvalPurposes, AttemptKind, attemptKinds, AttemptOutcome, AttemptState, attemptStates (+17 more)

### Community 13 - "attempt-dispatch.ts"
Cohesion: 0.12
Nodes (29): artifactNeedsSync(), attemptArtifactAccess(), attemptContext(), AttemptEventRepository, AttemptWorkflowBinding, canonicalAttempts(), competitionAttemptBaseRole(), competitionForAttempt() (+21 more)

### Community 14 - "conversation-worker.ts"
Cohesion: 0.14
Nodes (9): AttemptContainerEnv, webConversationAdapter, ids, ConversationWorkerDependencies, ConversationWorkerEnv, executionMetadata(), D1Like, GitHubApi (+1 more)

### Community 15 - "attempt-runtime.ts"
Cohesion: 0.13
Nodes (20): AttemptNamespace, AttemptRuntimeEnv, attemptSandbox(), AttemptStub, checkpointIdentityExpectation(), checkpointIdentityRejection(), checkpointIdentityRejectionDetails, cleanupCheckpointResources() (+12 more)

### Community 16 - "workflow.ts"
Cohesion: 0.07
Nodes (32): ModelThinkingLevel, WaitingReason, executorCapabilities, taskContracts, WorkflowAdvance, WorkflowAgent, WorkflowAgentSchema, workflowAgentSchemas (+24 more)

### Community 17 - "Attempt"
Cohesion: 0.11
Nodes (6): Attempt, Lease, MemoryRunRepository, RunStage, WorkflowCapability, WorkflowExecutorKind

### Community 18 - "acceptGitHubComment"
Cohesion: 0.15
Nodes (8): acceptGitHubComment(), acceptGitHubIssueClosed(), concludedNoChangeQualification(), conversationPromotionMarker(), GitHubCancellationRepository, GitHubIntakeRepository, operatorAuthorized(), runId()

### Community 19 - "github-ci.ts"
Cohesion: 0.11
Nodes (29): acceptGitHubCheckSuite(), acceptGitHubPullRequest(), aggregateReview(), atWorkflowExecutor(), checkEvidence(), CheckRun, checkRuns(), checksCompleted() (+21 more)

### Community 20 - "artifacts.ts"
Cohesion: 0.10
Nodes (16): ArtifactAccess, artifactAdvertisementHasMain(), artifactAdvertisementMainHead(), artifactIdentity(), ArtifactLocation, ArtifactRepository, artifactsErrorDetails(), ArtifactsNamespace (+8 more)

### Community 21 - "attempt-settlement.ts"
Cohesion: 0.14
Nodes (34): AttemptPreparationEnv, AttemptWorkflowParams, artifactsNamespace(), destroyAttemptSandboxWithTrace(), sandboxName(), SandboxNamespace, saveWorkspaceBackup(), acceptRecordedAttemptCompletion() (+26 more)

### Community 22 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, composite, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution (+10 more)

### Community 23 - "core/src/index.ts"
Cohesion: 0.19
Nodes (16): AppliedProfile, assertTransition(), CreateRunInput, IssueCommentSnapshot, IssueSnapshot, resumeRun(), RunResumeSignal, runSchemaVersion (+8 more)

### Community 24 - "model-usage.ts"
Cohesion: 0.20
Nodes (15): cost(), escapeHtml(), palette, renderChart(), renderModelUsage(), tokens(), utc(), developmentBadge (+7 more)

### Community 26 - "isRecord"
Cohesion: 0.30
Nodes (16): agent(), competition(), condition(), external(), hasOnlyKeys(), human(), isRecord(), model() (+8 more)

### Community 27 - "github.test.ts"
Cohesion: 0.14
Nodes (9): loadDefaultBranchProfile(), loadRepositoryProfile(), resolveDefaultBranchCommit(), closureDelivery(), concludeQualification(), delivery(), IntakeRepository, reportedBodyWithDetails() (+1 more)

### Community 28 - "D1ConversationRepository"
Cohesion: 0.14
Nodes (10): deliverPendingConversationReplies(), briefFromRow(), D1ConversationRepository, initialBriefBody(), placeholders(), promotionFromRow(), repositoryFromRow(), turnFromRow() (+2 more)

### Community 29 - "agent-runner/package.json"
Cohesion: 0.13
Nodes (14): dependencies, @devcontainers/cli, @earendil-works/pi-coding-agent, jsonc-parser, typebox, license, name, private (+6 more)

### Community 30 - "scripts"
Cohesion: 0.06
Nodes (32): @cloudflare/workers-types, devDependencies, @cloudflare/workers-types, prettier, @types/node, typescript, vitest, wrangler (+24 more)

### Community 31 - "core/package.json"
Cohesion: 0.17
Nodes (11): dependencies, yaml, exports, default, types, license, name, private (+3 more)

### Community 32 - "aggregated-review.ts"
Cohesion: 0.22
Nodes (8): aggregatedReview, AggregatedReviewFinding, attempt, configured, head, aggregateReviews(), reviewers, WorkflowReview

### Community 33 - "Roundhouse V2"
Cohesion: 0.15
Nodes (13): 10. Acceptance and observability, 11. Complexity and documentation, 1. Product and development rule, 2. Deployed behavior, 3.1 Repository source and compilation, 3.2 Typed executors, 3.3 Durable execution, 3. Target workflow architecture (+5 more)

### Community 34 - "control-plane/src/index.ts"
Cohesion: 0.05
Nodes (22): SandboxDestructionTrace, competitionPromoter(), conversationPollClientScript, Region, AttemptTransportStatus, controlPlaneService, ExpiredAttemptRecoveryAction, ExpiredAttemptRecoveryHandlers (+14 more)

### Community 35 - "createRun"
Cohesion: 0.14
Nodes (14): runFixture(), reportRun(), workflowPageDb(), workflowRun(), resolveWorkflowContexts(), resumeExternalWorkflowEvent(), commit, head (+6 more)

### Community 36 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, lib, outDir, rootDir, tsBuildInfoFile, types, extends, include (+7 more)

### Community 37 - "control-plane/worker-configuration.d.ts"
Cohesion: 0.28
Nodes (8): __BaseEnv_Env, Cloudflare, Env, GlobalProps, *.js, NodeJS, ProcessEnv, StringifyValues

### Community 38 - "core/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, tsBuildInfoFile, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 39 - "response-observer/package.json"
Cohesion: 0.22
Nodes (8): exports, default, types, license, name, private, type, version

### Community 40 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, lib, outDir, rootDir, tsBuildInfoFile, types, extends, include (+7 more)

### Community 41 - "Development environment, GitHub Actions, and wrangler"
Cohesion: 0.29
Nodes (7): Checking whether `main` has deployed, Debugging a live issue / run (D1, not the browser), Development environment, GitHub Actions, and wrangler, How development gets deployed, Safety when debugging the shared development environment, Topology, Wrangler CLI

### Community 42 - "cloudflare-containers.ts"
Cohesion: 0.25
Nodes (3): Container, ContainerProxy, outboundParams

### Community 43 - "conversation-store.ts"
Cohesion: 0.12
Nodes (18): ConversationQueue, ConversationService, BriefRow, CanonicalInboundMessage, Conversation, ConversationContext, ConversationLink, ConversationPromotion (+10 more)

### Community 44 - "dashboard.ts"
Cohesion: 0.26
Nodes (11): detailsPath(), escapeHtml(), labels, renderDashboard(), renderRun(), section(), prepare(), summary() (+3 more)

### Community 45 - "check-license-headers.mjs"
Cohesion: 0.29
Nodes (6): files, generatedFiles, missing, roots, run, sourceExtensions

### Community 46 - "usage.ts"
Cohesion: 0.22
Nodes (12): call(), endAt, estimateUsageCostUsd(), formatUsage(), formatUsageBreakdown(), ModelUsageDay, ModelUsageModelTotal, ModelUsageSourceTotal (+4 more)

### Community 47 - "runtime-host/package.json"
Cohesion: 0.15
Nodes (12): dependencies, @cloudflare/sandbox, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox, @roundhouse/core, @roundhouse/response-observer, license (+4 more)

### Community 48 - "RunSnapshot"
Cohesion: 0.29
Nodes (4): AttemptReporter, findOpenPullRequest(), GitHubStageReporter, RunSnapshot

### Community 49 - "model-broker/package.json"
Cohesion: 0.18
Nodes (10): dependencies, @roundhouse/core, @roundhouse/response-observer, @roundhouse/core, @roundhouse/response-observer, license, name, private (+2 more)

### Community 50 - "model-broker/worker-configuration.d.ts"
Cohesion: 0.50
Nodes (4): __BaseEnv_Env, Cloudflare, Env, GlobalProps

### Community 51 - "index.d.mts"
Cohesion: 0.40
Nodes (4): ApiResponseDetails, ApiResponseLogEntry, ApiResponseLogWriter, ApiResponseObserverOptions

### Community 52 - "cloudflare-workers.ts"
Cohesion: 0.40
Nodes (3): DurableObject, RpcTarget, WorkerEntrypoint

### Community 57 - "callback.ts"
Cohesion: 0.20
Nodes (15): callbackForCompletion(), settleAttempt(), acceptCallback(), BranchChangedError, bytesToHex(), callbackPayload(), CheckpointValidator, encoder (+7 more)

### Community 58 - "conversation-promotion.ts"
Cohesion: 0.14
Nodes (16): promotionIssueMarker(), promotionStartMarker(), renderDeliveryBrief(), conversation, github, responsesRoute, turn, executeConversationPromotion() (+8 more)

### Community 59 - "conversation-liveness.ts"
Cohesion: 0.20
Nodes (10): ConversationAdapter, VerifiedConversationActor, webInboundMessage(), ConversationQueue, conversationWakeupRedeliveryMilliseconds, publishConversationWakeup(), publishPending(), publishPendingConversationWakeups() (+2 more)

### Community 60 - "Cursor Cloud specific instructions"
Cohesion: 0.29
Nodes (6): AGENTS, Cursor Cloud specific instructions, Graphify knowledge graph, Node version, Other notes, There is no local dev server

### Community 61 - "d1-store.ts"
Cohesion: 0.13
Nodes (18): ActiveAttemptLease, AttemptDiagnosticSnapshot, AttemptExecutionRecordOutcome, AttemptRow, Result, RunDetails, RunRow, RunSummary (+10 more)

### Community 71 - "github-ci.test.ts"
Cohesion: 0.23
Nodes (8): workflow(), AutomationRepository, head, mergeCommit, returnToCi(), setupCi(), setupIntegrated(), sourceCommit

### Community 72 - "workflow-view.ts"
Cohesion: 0.14
Nodes (21): workflowGraphAsset(), workflowGraphClientScript, escapeHtml(), escapeJsonForHtml(), humanizeWorkflowValue(), renderWorkflowView(), collection(), FakeNode (+13 more)

### Community 73 - "README.md"
Cohesion: 0.25
Nodes (4): Current evidence, Deferred feature improvements, Improvement to revisit, Operational metrics and possible warm Sandbox reuse

### Community 74 - "9. Workflow implementation plan"
Cohesion: 0.22
Nodes (9): 9. Workflow implementation plan, Slice 7.0 — Reconcile the contract, Slice 7.1 — Run the current lifecycle through the graph, Slice 7.2 — General agent composition, Slice 7.3 — Generic review fan-out and join, Slice 7.4 — Human, external-event, context, and audit boundaries, Slice 7.5 — Repository-backed graph UI, Slice 8.0 — Operator visual feedback (+1 more)

### Community 75 - "Conversational entry v0 implementation plan"
Cohesion: 0.25
Nodes (8): Adapter contract, Brief and promotion lifecycle, Canonical records, Conversational entry v0 implementation plan, Explicitly deferred, Read-only execution, Requirement-to-test contract, V0 architecture

### Community 76 - "Conversational entry for Roundhouse"
Cohesion: 0.15
Nodes (13): Acceptance criteria, Accepted product decisions, Conversational entry for Roundhouse, Model policy, Prepare a delivery brief, Problem and product boundary, Product model and adapter boundary, Promote to delivery (+5 more)

### Community 77 - "Roundhouse"
Cohesion: 0.20
Nodes (10): Development, Go deeper, How a repository opts in, License, Project status, Repository layout, Roundhouse, Should you keep reading? (+2 more)

### Community 78 - "workflow-coordinator.test.ts"
Cohesion: 0.21
Nodes (16): commit, workflowRun(), enumList(), hasOnlyKeys(), instruction(), instructionSource(), isRecord(), model() (+8 more)

### Community 81 - "GitHubAutomationApi"
Cohesion: 0.25
Nodes (3): actionsJobLink(), failedConclusion(), GitHubAutomationApi

### Community 82 - "runtime-host.ts"
Cohesion: 0.60
Nodes (3): handleRuntimeHostRequest(), runtimeHostService, worker

### Community 84 - "compileWorkflow"
Cohesion: 0.24
Nodes (9): advanceWorkflow(), compileWorkflow(), defaultIssueWorkflowSource, evaluateWorkflowCondition(), outputPaths(), selectWorkflowTransition(), commit, validateCompetitionRoles() (+1 more)

### Community 85 - "5. Runtime boundaries"
Cohesion: 0.50
Nodes (4): 5.1 Control plane and storage, 5.2 Agent environment, 5.3 Models, 5. Runtime boundaries

### Community 86 - "AttemptCompletion"
Cohesion: 0.29
Nodes (3): {
  acceptRecordedAttemptCompletion,
  backupRecordedAttemptWorkspace,
  getAttempt,
  loadRecordedAttemptCompletion,
  markDispatched,
  prepareAttemptExecution,
  publishWakeup,
  publishRecordedAttemptCompletion,
  recordAttemptEvent,
  requestWakeup,
  settlementWorkflowCreate,
  settlementWorkflowGet,
  settlementWorkflowStatus,
  sandbox,
  settleAttemptOutcome,
  validateRecordedAttemptCompletion,
}, completion, AttemptCompletion

## Knowledge Gaps
- **422 isolated node(s):** `name`, `version`, `license`, `private`, `type` (+417 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `observeResponse()` connect `ui-auth.ts` to `runner.mjs`, `attempt-container.ts`, `model-broker/src/index.ts`, `github.ts`, `attempt-dispatch.ts`, `GitHubClient`, `artifacts.ts`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Why does `D1RunRepository` connect `D1RunRepository` to `coordinator.ts`, `control-plane/src/index.ts`, `attempt-container.ts`, `coordinate`, `dashboard.ts`, `attempt-dispatch.ts`, `conversation-worker.ts`, `attempt-runtime.ts`, `usage.ts`, `artifacts.ts`, `attempt-settlement.ts`, `AttemptCompletion`, `d1-store.ts`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `RunSnapshot` connect `RunSnapshot` to `D1RunRepository`, `coordinator.ts`, `github.ts`, `coordinate`, `contracts.ts`, `attempt-dispatch.ts`, `attempt-runtime.ts`, `Attempt`, `acceptGitHubComment`, `github-ci.ts`, `attempt-settlement.ts`, `core/src/index.ts`, `github.test.ts`, `control-plane/src/index.ts`, `createRun`, `d1-store.ts`, `github-ci.test.ts`, `workflow-view.ts`, `GitHubAutomationApi`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **What connects `name`, `version`, `license` to the rest of the system?**
  _422 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `runner.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05465346534653465 - nodes in this community are weakly interconnected._
- **Should `D1RunRepository` be split into smaller, more focused modules?**
  _Cohesion score 0.05690834473324213 - nodes in this community are weakly interconnected._
- **Should `coordinator.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10634920634920635 - nodes in this community are weakly interconnected._