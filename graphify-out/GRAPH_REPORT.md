# Graph Report - workspace  (2026-08-03)

## Corpus Check
- 144 files · ~244,715 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1643 nodes · 3914 edges · 92 communities (76 shown, 16 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ad83849f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- runner.mjs
- D1RunRepository
- coordinate
- run-details.ts
- attempt-container.ts
- ui-auth.ts
- profile.ts
- conversation-engine.ts
- model-broker/src/index.ts
- github.ts
- conversation-ui.ts
- d1-store.ts
- contracts.ts
- attempt-dispatch.ts
- D1Like
- attempt-runtime.ts
- workflow.ts
- Attempt
- acceptGitHubComment
- github-ci.ts
- artifacts.ts
- attempt-workflow.ts
- compilerOptions
- core/src/index.ts
- usage.ts
- workflow-view.test.ts
- coordinator.ts
- github.test.ts
- D1ConversationRepository
- agent-runner/package.json
- scripts
- core/package.json
- aggregated-review.ts
- Roundhouse V2
- control-plane/src/index.test.ts
- model-usage.ts
- compilerOptions
- control-plane/worker-configuration.d.ts
- core/tsconfig.json
- response-observer/package.json
- compilerOptions
- Development environment, GitHub Actions, and wrangler
- cloudflare-containers.ts
- conversation-store.ts
- createRun
- check-license-headers.mjs
- control-plane/src/index.ts
- runtime-host/package.json
- GitHubApi
- model-broker/package.json
- model-broker/worker-configuration.d.ts
- index.d.mts
- cloudflare-workers.ts
- tsconfig.json
- text-modules.d.ts
- attempt-settlement.ts
- conversation-promotion.ts
- conversation-worker.ts
- Cursor Cloud specific instructions
- run-details.fixture.ts
- implementation.md
- investigation.md
- planning.md
- project.md
- qualification.md
- review-data.md
- review-holistic.md
- review-security.md
- dashboard.ts
- workflow-view.ts
- README.md
- 9. Workflow implementation plan
- Conversational entry v0 implementation plan
- Conversational entry for Roundhouse
- Roundhouse
- v2Profile
- observeResponse
- CloudflareArtifactsNamespace
- CloudflareArtifactRepository
- workflow-coordinator.test.ts
- ArtifactsNamespace
- 5. Runtime boundaries
- index.mjs
- liveness.ts
- ui-auth.test.ts
- handleGitHubCallback
- LocalD1Statement
- LocalD1Statement
- acceptGitHubIssueClosed

## God Nodes (most connected - your core abstractions)
1. `D1RunRepository` - 72 edges
2. `RunSnapshot` - 61 edges
3. `Attempt` - 51 edges
4. `D1ConversationRepository` - 47 edges
5. `coordinate()` - 35 edges
6. `RunRepository` - 32 edges
7. `MemoryRunRepository` - 32 edges
8. `observeResponse()` - 28 edges
9. `renderRunDetails()` - 26 edges
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

## Communities (92 total, 16 thin omitted)

### Community 0 - "runner.mjs"
Cohesion: 0.05
Nodes (98): activityRequest(), agentRuntime, agentSystemPrompt, agentToolNames(), artifactWriteTokenRequest(), bootstrapWorkspace(), checkpointWorkspace(), clone() (+90 more)

### Community 1 - "D1RunRepository"
Cohesion: 0.10
Nodes (6): pauseForModelBudget(), D1RunRepository, Statement, usageFromRow(), repositoryContract(), Wakeup

### Community 2 - "coordinate"
Cohesion: 0.13
Nodes (19): coordinate(), coordinateCompetition(), dispatchCompetitionAttempt(), dispatchReview(), effectiveAttemptCapabilities(), finalizePromotion(), recordAttemptOutcomeTransition(), recordIssuedCapabilities() (+11 more)

### Community 3 - "run-details.ts"
Cohesion: 0.21
Nodes (25): attemptLinks(), attemptResult(), boundaryWorkflowEvidence(), ciResult(), CompetitionGroup, competitionGroups(), competitionPanels(), DetailsAttempt (+17 more)

### Community 4 - "attempt-container.ts"
Cohesion: 0.06
Nodes (30): attemptAllowedHosts(), AttemptAssignment, attemptCompletion(), attemptUsesProjectEnvironment(), containerRegistryHosts, ModelPrice, ModelRates, PreparedAttempt (+22 more)

### Community 5 - "ui-auth.ts"
Cohesion: 0.17
Nodes (20): authorizedRepositoryIds(), base64UrlDecode(), base64UrlEncode(), decryptUiAccessToken(), encryptUiAccessToken(), enrolledRepositoryIds(), escapeHtml(), githubRepositoryReadable() (+12 more)

### Community 6 - "profile.ts"
Cohesion: 0.08
Nodes (28): defaultBlockingSeverities, defaultConversationModel, defaultReviewerModels, defaultStageModels, findingSeverities, FindingSeverity, isProtectedRepositoryPath(), matches() (+20 more)

### Community 7 - "conversation-engine.ts"
Cohesion: 0.06
Nodes (42): adapterFor(), anthropicMessagesAdapter, briefSchema, Broker, brokerHeaders(), callModel(), ConversationExecutionResult, ConversationFirstReply (+34 more)

### Community 8 - "model-broker/src/index.ts"
Cohesion: 0.08
Nodes (40): applyHostedResearch(), BrokerEnv, brokerRequest(), cloudflareStopReason(), configuredModels(), configuredRoutes(), defaultProtocol(), defaultRoutes (+32 more)

### Community 9 - "github.ts"
Cohesion: 0.16
Nodes (23): appJwt(), bytesToBase64Url(), CommentPayload, findOpenPullRequest(), findPullRequest(), implementationComment(), implementationNoChangeComment(), IssuePayload (+15 more)

### Community 10 - "conversation-ui.ts"
Cohesion: 0.07
Nodes (46): dependencies, @cloudflare/playwright, @cloudflare/sandbox, cytoscape, marked, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox (+38 more)

### Community 11 - "d1-store.ts"
Cohesion: 0.14
Nodes (13): ActiveAttemptLease, AttemptDiagnosticSnapshot, AttemptExecutionRecordOutcome, AttemptRow, Result, RunDetails, RunRow, RunSummary (+5 more)

### Community 12 - "contracts.ts"
Cohesion: 0.09
Nodes (20): CompetitionPromoter, Approval, ApprovalPurpose, approvalPurposes, AttemptCompetition, AttemptKind, attemptKinds, AttemptOutcome (+12 more)

### Community 13 - "attempt-dispatch.ts"
Cohesion: 0.10
Nodes (33): aggregateImplementationAttempts(), artifactNeedsSync(), attemptArtifactAccess(), AttemptEventRepository, AttemptWorkflowBinding, canonicalAttempts(), competitionAttemptBaseRole(), competitionForAttempt() (+25 more)

### Community 14 - "D1Like"
Cohesion: 0.29
Nodes (3): AttemptContainerEnv, ids, D1Like

### Community 15 - "attempt-runtime.ts"
Cohesion: 0.09
Nodes (25): Checkpoint, AttemptNamespace, AttemptRuntimeEnv, attemptSandbox(), AttemptStub, checkpointIdentityExpectation(), checkpointIdentityRejection(), checkpointIdentityRejectionDetails (+17 more)

### Community 16 - "workflow.ts"
Cohesion: 0.06
Nodes (60): DetailsAttempt, detailsFixture(), DetailsRun, runFixture(), runtime, workflowCommit, ModelThinkingLevel, WaitingReason (+52 more)

### Community 17 - "Attempt"
Cohesion: 0.10
Nodes (7): AttemptReporter, Attempt, Lease, MemoryRunRepository, RunStage, WorkflowCapability, WorkflowExecutorKind

### Community 18 - "acceptGitHubComment"
Cohesion: 0.19
Nodes (7): acceptGitHubComment(), concludedNoChangeQualification(), conversationPromotionMarker(), GitHubIntakeRepository, operatorAuthorized(), postRunCommentOnce(), runDetailsUrl()

### Community 19 - "github-ci.ts"
Cohesion: 0.07
Nodes (39): workflow(), acceptGitHubCheckSuite(), acceptGitHubPullRequest(), actionsJobLink(), aggregateReview(), atWorkflowExecutor(), checkEvidence(), CheckRun (+31 more)

### Community 20 - "artifacts.ts"
Cohesion: 0.31
Nodes (9): ArtifactAccess, artifactAdvertisementHasMain(), artifactAdvertisementMainHead(), artifactIdentity(), ArtifactLocation, ArtifactToken, validateCheckpointIdentity(), validateReadOnlyCheckpoint() (+1 more)

### Community 21 - "attempt-workflow.ts"
Cohesion: 0.17
Nodes (25): modelEgress(), recordModelEvent(), AttemptPreparationEnv, AttemptWorkflowParams, artifactsNamespace(), sandboxName(), SandboxNamespace, acceptRecordedAttemptCompletion() (+17 more)

### Community 22 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, composite, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution (+10 more)

### Community 23 - "core/src/index.ts"
Cohesion: 0.20
Nodes (17): AppliedProfile, assertTransition(), CreateRunInput, IssueCommentSnapshot, IssueSnapshot, resumeRun(), RunResumeSignal, runSchemaVersion (+9 more)

### Community 24 - "usage.ts"
Cohesion: 0.16
Nodes (17): extractModelUsage(), call(), estimateUsageCostUsd(), formatUsage(), formatUsageBreakdown(), ModelPrice, modelPrices, ModelRates (+9 more)

### Community 25 - "workflow-view.test.ts"
Cohesion: 0.18
Nodes (6): collection(), FakeElement, FakeNode, harness(), makeNode(), runFixture()

### Community 26 - "coordinator.ts"
Cohesion: 0.13
Nodes (25): attemptInactivityMilliseconds, aggregateReviewAttempts(), AttemptDispatcher, attemptOutcomeTransition(), ciTransition(), CompetitionStep, evidenceForAttempt(), graphCompletedTransition() (+17 more)

### Community 27 - "github.test.ts"
Cohesion: 0.14
Nodes (9): loadDefaultBranchProfile(), loadRepositoryProfile(), resolveDefaultBranchCommit(), closureDelivery(), concludeQualification(), delivery(), IntakeRepository, reportedBodyWithDetails() (+1 more)

### Community 28 - "D1ConversationRepository"
Cohesion: 0.13
Nodes (8): briefFromRow(), D1ConversationRepository, placeholders(), promotionFromRow(), repositoryFromRow(), turnFromRow(), wakeupOutboxId(), processConversationWakeup()

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

### Community 34 - "control-plane/src/index.test.ts"
Cohesion: 0.09
Nodes (6): sandboxPreviewPath(), scheduleAttemptSandboxDestruction(), seedPreImplementationResults(), workflowCommit, workflowProfile, worker

### Community 35 - "model-usage.ts"
Cohesion: 0.25
Nodes (12): cost(), escapeHtml(), palette, renderChart(), renderModelUsage(), tokens(), utc(), escapeHtml() (+4 more)

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
Cohesion: 0.13
Nodes (18): ConversationQueue, ConversationService, BriefRow, CanonicalInboundMessage, ConversationContext, ConversationLink, ConversationPromotion, ConversationRepositoryRef (+10 more)

### Community 44 - "createRun"
Cohesion: 0.12
Nodes (15): runFixture(), reportRun(), workflowPageDb(), workflowRun(), input, resolveWorkflowContexts(), resumeExternalWorkflowEvent(), commit (+7 more)

### Community 45 - "check-license-headers.mjs"
Cohesion: 0.29
Nodes (6): files, generatedFiles, missing, roots, run, sourceExtensions

### Community 46 - "control-plane/src/index.ts"
Cohesion: 0.10
Nodes (17): attemptContext(), competitionPromoter(), conversationPollClientScript, Region, AttemptTransportStatus, controlPlaneService, ExpiredAttemptRecoveryAction, handleRequest() (+9 more)

### Community 47 - "runtime-host/package.json"
Cohesion: 0.15
Nodes (12): dependencies, @cloudflare/sandbox, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox, @roundhouse/core, @roundhouse/response-observer, license (+4 more)

### Community 48 - "GitHubApi"
Cohesion: 0.22
Nodes (4): ConversationWorkerDependencies, GitHubApi, GitHubStageReporter, listComments()

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

### Community 57 - "attempt-settlement.ts"
Cohesion: 0.15
Nodes (20): AttemptBackupResult, AttemptPublicationResult, AttemptSettlementOutcome, AttemptValidationResult, callbackForCompletion(), observedBranchHead(), settleAttempt(), {
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
} (+12 more)

### Community 58 - "conversation-promotion.ts"
Cohesion: 0.16
Nodes (17): promotionIssueMarker(), promotionStartMarker(), renderDeliveryBrief(), conversation, github, responsesRoute, turn, executeConversationPromotion() (+9 more)

### Community 59 - "conversation-worker.ts"
Cohesion: 0.18
Nodes (13): ConversationAdapter, VerifiedConversationActor, webConversationAdapter, webInboundMessage(), ConversationQueue, conversationWakeupRedeliveryMilliseconds, deliverPendingConversationReplies(), publishConversationWakeup() (+5 more)

### Community 60 - "Cursor Cloud specific instructions"
Cohesion: 0.29
Nodes (6): AGENTS, Cursor Cloud specific instructions, Graphify knowledge graph, Node version, Other notes, There is no local dev server

### Community 71 - "dashboard.ts"
Cohesion: 0.46
Nodes (7): detailsPath(), escapeHtml(), labels, renderDashboard(), renderRun(), section(), stageLabel()

### Community 72 - "workflow-view.ts"
Cohesion: 0.26
Nodes (14): escapeHtml(), escapeJsonForHtml(), humanizeWorkflowValue(), renderWorkflowView(), truncateLabel(), workflowEditUrl(), workflowEntryStage(), WorkflowGraphElement (+6 more)

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

### Community 78 - "v2Profile"
Cohesion: 0.31
Nodes (13): enumList(), hasOnlyKeys(), instruction(), instructionSource(), isRecord(), model(), parseConversationModel(), reviewerConfig() (+5 more)

### Community 80 - "CloudflareArtifactsNamespace"
Cohesion: 0.35
Nodes (3): artifactsErrorDetails(), CloudflareArtifactsNamespace, isArtifactsError()

### Community 82 - "workflow-coordinator.test.ts"
Cohesion: 0.33
Nodes (4): commit, workflowRun(), parseProfile(), commit

### Community 84 - "5. Runtime boundaries"
Cohesion: 0.50
Nodes (4): 5.1 Control plane and storage, 5.2 Agent environment, 5.3 Models, 5. Runtime boundaries

### Community 85 - "index.mjs"
Cohesion: 0.21
Nodes (10): body(), failedEntry(), headers(), isSecretField(), observeBufferedResponse(), observeEventStream(), openedEntry(), redact() (+2 more)

### Community 86 - "liveness.ts"
Cohesion: 0.21
Nodes (8): PendingWakeup, publishPendingWakeup(), publishPendingWakeups(), publishWakeup(), PendingWakeupRepository, wakeup, WakeupQueue, wakeupRedeliveryMilliseconds

### Community 87 - "ui-auth.test.ts"
Cohesion: 0.18
Nodes (8): callbackRequest(), completeGitHubSignIn(), env(), html(), uiSessionCookie, uiSessionHash(), uiSessionLifetimeMs, uiStateCookie

### Community 88 - "handleGitHubCallback"
Cohesion: 0.31
Nodes (11): beginGitHubSignIn(), clearStateCookie(), handleGitHubCallback(), log(), randomToken(), readCookie(), redirect(), sessionCookieHeader() (+3 more)

### Community 91 - "acceptGitHubIssueClosed"
Cohesion: 0.38
Nodes (3): acceptGitHubIssueClosed(), GitHubCancellationRepository, runId()

## Knowledge Gaps
- **425 isolated node(s):** `name`, `version`, `license`, `private`, `type` (+420 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `observeResponse()` connect `observeResponse` to `runner.mjs`, `attempt-container.ts`, `ui-auth.ts`, `model-broker/src/index.ts`, `github.ts`, `attempt-dispatch.ts`, `CloudflareArtifactsNamespace`, `artifacts.ts`, `attempt-workflow.ts`, `index.mjs`, `handleGitHubCallback`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Why does `RunSnapshot` connect `core/src/index.ts` to `D1RunRepository`, `coordinate`, `github.ts`, `d1-store.ts`, `contracts.ts`, `attempt-dispatch.ts`, `attempt-runtime.ts`, `Attempt`, `acceptGitHubComment`, `github-ci.ts`, `workflow-view.test.ts`, `coordinator.ts`, `github.test.ts`, `control-plane/src/index.test.ts`, `createRun`, `control-plane/src/index.ts`, `GitHubApi`, `attempt-settlement.ts`, `workflow-view.ts`, `acceptGitHubIssueClosed`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `D1RunRepository` connect `D1RunRepository` to `coordinate`, `attempt-container.ts`, `d1-store.ts`, `createRun`, `attempt-dispatch.ts`, `control-plane/src/index.ts`, `attempt-runtime.ts`, `attempt-workflow.ts`, `liveness.ts`, `attempt-settlement.ts`, `coordinator.ts`, `conversation-worker.ts`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **What connects `name`, `version`, `license` to the rest of the system?**
  _425 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `runner.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.054164239953407106 - nodes in this community are weakly interconnected._
- **Should `D1RunRepository` be split into smaller, more focused modules?**
  _Cohesion score 0.09701928696668614 - nodes in this community are weakly interconnected._
- **Should `coordinate` be split into smaller, more focused modules?**
  _Cohesion score 0.12762762762762764 - nodes in this community are weakly interconnected._