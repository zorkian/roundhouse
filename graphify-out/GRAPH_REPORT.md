# Graph Report - workspace  (2026-08-03)

## Corpus Check
- 149 files · ~249,888 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1673 nodes · 4018 edges · 90 communities (73 shown, 17 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ec48bf86`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- runner.mjs
- D1RunRepository
- compileWorkflow
- run-details.ts
- attempt-container.ts
- ui-auth.ts
- profile.ts
- conversation-engine.ts
- model-broker/src/index.ts
- github.ts
- conversation-ui.ts
- coordinator.ts
- contracts.ts
- attempt-dispatch.ts
- D1Like
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
- workflow-view.test.ts
- isRecord
- github.test.ts
- D1ConversationRepository
- agent-runner/package.json
- scripts
- core/package.json
- aggregated-review.ts
- Roundhouse V2
- control-plane/src/index.ts
- workflow-boundaries.test.ts
- compilerOptions
- control-plane/worker-configuration.d.ts
- core/tsconfig.json
- response-observer/package.json
- compilerOptions
- Cursor Cloud specific instructions
- cloudflare-containers.ts
- conversation-store.ts
- dashboard.ts
- check-license-headers.mjs
- usage.ts
- runtime-host/package.json
- .report
- model-broker/package.json
- model-broker/worker-configuration.d.ts
- index.d.mts
- cloudflare-workers.ts
- tsconfig.json
- text-modules.d.ts
- callback.ts
- conversation-promotion.ts
- conversation-worker.ts
- acceptGitHubIssueClosed
- run-details.test.ts
- implementation.md
- investigation.md
- planning.md
- project.md
- qualification.md
- review-data.md
- review-holistic.md
- review-security.md
- 3. Target workflow architecture
- workflow-view.ts
- README.md
- 9. Workflow implementation plan
- Conversational entry v0 implementation plan
- Conversational entry for Roundhouse
- Roundhouse
- v2Profile
- GitHubClient
- adjudication.md
- RunSnapshot
- dependencies
- defaultIssueWorkflowSource
- CloudflareArtifactRepository
- CloudflareArtifactsNamespace
- workflow-coordinator.test.ts
- conversation-client.test.ts
- safe-markdown.ts
- ArtifactsNamespace

## God Nodes (most connected - your core abstractions)
1. `D1RunRepository` - 72 edges
2. `RunSnapshot` - 61 edges
3. `Attempt` - 51 edges
4. `D1ConversationRepository` - 47 edges
5. `coordinate()` - 35 edges
6. `renderRunDetails()` - 32 edges
7. `RunRepository` - 32 edges
8. `MemoryRunRepository` - 32 edges
9. `observeResponse()` - 28 edges
10. `Wakeup` - 25 edges

## Surprising Connections (you probably didn't know these)
- `validateCheckpointIdentity()` --indirect_call--> `path()`  [INFERRED]
  apps/control-plane/src/artifacts.ts → packages/core/src/workflow.ts
- `AttemptDiagnosticSnapshot` --references--> `Attempt`  [EXTRACTED]
  apps/control-plane/src/d1-store.ts → packages/core/src/contracts.ts
- `ActiveAttemptLease` --inherits--> `Wakeup`  [EXTRACTED]
  apps/control-plane/src/d1-store.ts → packages/core/src/contracts.ts
- `assertCreateInput()` --indirect_call--> `value()`  [INFERRED]
  packages/core/src/run.ts → apps/control-plane/src/run-details.ts
- `assertTransition()` --indirect_call--> `value()`  [INFERRED]
  packages/core/src/run.ts → apps/control-plane/src/run-details.ts

## Import Cycles
- 3-file cycle: `packages/core/src/profile.ts -> packages/core/src/workflow.ts -> packages/core/src/run.ts -> packages/core/src/profile.ts`

## Communities (90 total, 17 thin omitted)

### Community 0 - "runner.mjs"
Cohesion: 0.05
Nodes (100): activityRequest(), adjudicate(), adjudicationPrompt(), adjudicationSchema, agentRuntime, agentSystemPrompt, agentToolNames(), artifactWriteTokenRequest() (+92 more)

### Community 1 - "D1RunRepository"
Cohesion: 0.06
Nodes (19): modelEgress(), pauseForModelBudget(), conflictedIntegrationOutcome(), attemptFromRow(), D1RunRepository, PendingWakeup, Statement, usageFromRow() (+11 more)

### Community 2 - "compileWorkflow"
Cohesion: 0.29
Nodes (6): visualFeedbackProfile(), runFixture(), compileWorkflow(), outputPaths(), validateCompetitionRoles(), validateGraph()

### Community 3 - "run-details.ts"
Cohesion: 0.14
Nodes (37): attemptLinks(), attemptResult(), boundaryWorkflowEvidence(), ciResult(), CompetitionGroup, competitionGroups(), competitionPanels(), DetailsAttempt (+29 more)

### Community 4 - "attempt-container.ts"
Cohesion: 0.07
Nodes (24): attemptAllowedHosts(), attemptUsesProjectEnvironment(), containerRegistryHosts, PreparedAttempt, recordModelEvent(), RoundhouseRuntimeSandbox, RunnerHttpResult, NestedContainerRuntimeHost (+16 more)

### Community 5 - "ui-auth.ts"
Cohesion: 0.07
Nodes (52): authorizedRepositoryIds(), base64UrlDecode(), base64UrlEncode(), beginGitHubSignIn(), clearStateCookie(), decryptUiAccessToken(), encryptUiAccessToken(), enrolledRepositoryIds() (+44 more)

### Community 6 - "profile.ts"
Cohesion: 0.08
Nodes (27): defaultBlockingSeverities, defaultConversationModel, defaultReviewerModels, defaultStageModels, findingSeverities, FindingSeverity, isProtectedRepositoryPath(), matches() (+19 more)

### Community 7 - "conversation-engine.ts"
Cohesion: 0.07
Nodes (39): adapterFor(), anthropicMessagesAdapter, briefSchema, Broker, brokerHeaders(), callModel(), ConversationExecutionResult, ConversationFirstReply (+31 more)

### Community 8 - "model-broker/src/index.ts"
Cohesion: 0.09
Nodes (36): applyHostedResearch(), BrokerEnv, brokerRequest(), cloudflareStopReason(), configuredModels(), configuredRoutes(), defaultProtocol(), defaultRoutes (+28 more)

### Community 9 - "github.ts"
Cohesion: 0.15
Nodes (22): appJwt(), bytesToBase64Url(), CommentPayload, implementationComment(), implementationNoChangeComment(), IssuePayload, ListedComment, loadDefaultBranchProfile() (+14 more)

### Community 10 - "conversation-ui.ts"
Cohesion: 0.17
Nodes (26): Conversation, ConversationSummary, actionableConversationStatus, briefEditor(), controlsHtml(), conversationPollingActive(), ConversationPollState, conversationStatus() (+18 more)

### Community 11 - "coordinator.ts"
Cohesion: 0.06
Nodes (49): attemptInactivityMilliseconds, acceptCallback(), aggregateReviewAttempts(), aggregateReviews(), attemptOutcomeTransition(), ciTransition(), CompetitionPromoter, CompetitionStep (+41 more)

### Community 12 - "contracts.ts"
Cohesion: 0.08
Nodes (26): Approval, ApprovalPurpose, approvalPurposes, AttemptCompetition, AttemptKind, attemptKinds, AttemptOutcome, AttemptState (+18 more)

### Community 13 - "attempt-dispatch.ts"
Cohesion: 0.12
Nodes (28): attemptContext(), AttemptEventRepository, AttemptWorkflowBinding, canonicalAttempts(), competitionAttemptBaseRole(), competitionForAttempt(), DurableAttemptDispatcher, judgementCandidateAttempts() (+20 more)

### Community 14 - "D1Like"
Cohesion: 0.29
Nodes (3): AttemptContainerEnv, ids, D1Like

### Community 15 - "attempt-runtime.ts"
Cohesion: 0.10
Nodes (20): Checkpoint, AttemptNamespace, AttemptRuntimeEnv, attemptSandbox(), AttemptStub, checkpointIdentityExpectation(), checkpointIdentityRejection(), checkpointIdentityRejectionDetails (+12 more)

### Community 16 - "workflow.ts"
Cohesion: 0.07
Nodes (30): ModelThinkingLevel, WaitingReason, executorCapabilities, taskContracts, WorkflowAdvance, WorkflowAgentSchema, workflowAgentSchemas, WorkflowAgentTask (+22 more)

### Community 17 - "Attempt"
Cohesion: 0.12
Nodes (6): AttemptAssignment, Attempt, Lease, MemoryRunRepository, WorkflowCapability, WorkflowExecutorKind

### Community 18 - "acceptGitHubComment"
Cohesion: 0.22
Nodes (6): acceptGitHubComment(), concludedNoChangeQualification(), conversationPromotionMarker(), GitHubIntakeRepository, operatorAuthorized(), runId()

### Community 19 - "github-ci.ts"
Cohesion: 0.07
Nodes (39): workflow(), acceptGitHubCheckSuite(), acceptGitHubPullRequest(), actionsJobLink(), aggregateReview(), atWorkflowExecutor(), checkEvidence(), CheckRun (+31 more)

### Community 20 - "artifacts.ts"
Cohesion: 0.24
Nodes (10): ArtifactAccess, artifactAdvertisementHasMain(), artifactAdvertisementMainHead(), artifactIdentity(), ArtifactLocation, artifactsErrorDetails(), ArtifactToken, validateCheckpointIdentity() (+2 more)

### Community 21 - "attempt-settlement.ts"
Cohesion: 0.12
Nodes (36): AttemptPreparationEnv, AttemptWorkflowParams, artifactsNamespace(), attemptWorkspaceBackupKey(), destroyAttemptSandboxWithTrace(), sandboxName(), SandboxNamespace, saveWorkspaceBackup() (+28 more)

### Community 22 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, composite, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution (+10 more)

### Community 23 - "core/src/index.ts"
Cohesion: 0.19
Nodes (17): AppliedProfile, assertTransition(), CreateRunInput, IssueCommentSnapshot, IssueSnapshot, resumeRun(), RunResumeSignal, runSchemaVersion (+9 more)

### Community 24 - "model-usage.ts"
Cohesion: 0.29
Nodes (11): cost(), escapeHtml(), palette, renderChart(), renderModelUsage(), tokens(), utc(), escapeHtml() (+3 more)

### Community 25 - "workflow-view.test.ts"
Cohesion: 0.16
Nodes (7): workflowGraphAsset(), workflowGraphClientScript, collection(), FakeElement, FakeNode, harness(), makeNode()

### Community 26 - "isRecord"
Cohesion: 0.30
Nodes (16): agent(), competition(), condition(), external(), hasOnlyKeys(), human(), isRecord(), model() (+8 more)

### Community 27 - "github.test.ts"
Cohesion: 0.12
Nodes (11): runFixture(), closureDelivery(), concludeQualification(), delivery(), IntakeRepository, reportedBodyWithDetails(), reportRun(), workflowPageDb() (+3 more)

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
Cohesion: 0.24
Nodes (7): aggregatedReview, AggregatedReviewFinding, attempt, configured, head, reviewers, WorkflowReview

### Community 33 - "Roundhouse V2"
Cohesion: 0.15
Nodes (13): 10. Acceptance and observability, 11. Complexity and documentation, 1. Product and development rule, 2. Deployed behavior, 4. Security kernel, 5.1 Control plane and storage, 5.2 Agent environment, 5.3 Models (+5 more)

### Community 34 - "control-plane/src/index.ts"
Cohesion: 0.06
Nodes (23): artifactNeedsSync(), attemptArtifactAccess(), SandboxDestructionTrace, competitionPromoter(), AttemptTransportStatus, controlPlaneService, ExpiredAttemptRecoveryAction, ExpiredAttemptRecoveryHandlers (+15 more)

### Community 35 - "workflow-boundaries.test.ts"
Cohesion: 0.24
Nodes (8): resolveWorkflowContexts(), resumeExternalWorkflowEvent(), commit, head, profileFor(), runWith(), WorkflowContextProvider, WorkflowContextRequest

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

### Community 41 - "Cursor Cloud specific instructions"
Cohesion: 0.15
Nodes (13): Checking whether `main` has deployed, Cursor Cloud specific instructions, Debugging a live issue / run (D1, not the browser), Development environment, GitHub Actions, and wrangler, Graphify knowledge graph, How development gets deployed, Node version, Other notes (+5 more)

### Community 42 - "cloudflare-containers.ts"
Cohesion: 0.25
Nodes (3): Container, ContainerProxy, outboundParams

### Community 43 - "conversation-store.ts"
Cohesion: 0.14
Nodes (15): ConversationQueue, ConversationService, BriefRow, CanonicalInboundMessage, ConversationContext, ConversationLink, ConversationRepositoryRef, ConversationRow (+7 more)

### Community 44 - "dashboard.ts"
Cohesion: 0.24
Nodes (12): detailsPath(), escapeHtml(), labels, renderDashboard(), renderRun(), section(), prepare(), summary() (+4 more)

### Community 45 - "check-license-headers.mjs"
Cohesion: 0.29
Nodes (6): files, generatedFiles, missing, roots, run, sourceExtensions

### Community 46 - "usage.ts"
Cohesion: 0.13
Nodes (20): extractModelUsage(), estimateModelCostUsd(), ModelPrice, modelPrices, ModelRates, resolveModelPrice(), call(), endAt (+12 more)

### Community 47 - "runtime-host/package.json"
Cohesion: 0.15
Nodes (12): dependencies, @cloudflare/sandbox, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox, @roundhouse/core, @roundhouse/response-observer, license (+4 more)

### Community 48 - ".report"
Cohesion: 0.18
Nodes (9): ConversationWorkerDependencies, findOpenPullRequest(), findPullRequest(), GitHubApi, GitHubStageReporter, pullRequestBody(), qualificationHeading(), reviewComment() (+1 more)

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
Cohesion: 0.16
Nodes (16): attemptCompletion(), callbackForCompletion(), settleAttempt(), {
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
}, completion, AttemptCompletion, BranchChangedError, bytesToHex() (+8 more)

### Community 58 - "conversation-promotion.ts"
Cohesion: 0.15
Nodes (17): promotionIssueMarker(), promotionStartMarker(), renderDeliveryBrief(), conversation, github, responsesRoute, turn, executeConversationPromotion() (+9 more)

### Community 59 - "conversation-worker.ts"
Cohesion: 0.18
Nodes (13): ConversationAdapter, VerifiedConversationActor, webConversationAdapter, webInboundMessage(), ConversationQueue, conversationWakeupRedeliveryMilliseconds, deliverPendingConversationReplies(), publishConversationWakeup() (+5 more)

### Community 61 - "run-details.test.ts"
Cohesion: 0.22
Nodes (10): completedRunDetailsFixture(), renderCompletedRunDetailsFixture(), renderReviewRunDetailsFixture(), reviewRunDetailsFixture(), DetailsAttempt, detailsFixture(), DetailsRun, runFixture() (+2 more)

### Community 71 - "3. Target workflow architecture"
Cohesion: 0.50
Nodes (4): 3.1 Repository source and compilation, 3.2 Typed executors, 3.3 Durable execution, 3. Target workflow architecture

### Community 72 - "workflow-view.ts"
Cohesion: 0.26
Nodes (15): escapeHtml(), escapeJsonForHtml(), humanizeWorkflowValue(), renderWorkflowView(), truncateLabel(), workflowEditUrl(), workflowEntryStage(), WorkflowGraphElement (+7 more)

### Community 73 - "README.md"
Cohesion: 0.20
Nodes (5): AGENTS, Current evidence, Deferred feature improvements, Improvement to revisit, Operational metrics and possible warm Sandbox reuse

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

### Community 79 - "GitHubClient"
Cohesion: 0.23
Nodes (4): GitHubClient, listComments(), postRunCommentOnce(), runDetailsUrl()

### Community 81 - "RunSnapshot"
Cohesion: 0.15
Nodes (12): AttemptReporter, ActiveAttemptLease, AttemptDiagnosticSnapshot, AttemptExecutionRecordOutcome, AttemptRow, Result, RunDetails, RunRow (+4 more)

### Community 83 - "dependencies"
Cohesion: 0.11
Nodes (18): dependencies, @cloudflare/playwright, @cloudflare/sandbox, cytoscape, marked, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox (+10 more)

### Community 84 - "defaultIssueWorkflowSource"
Cohesion: 0.47
Nodes (5): advanceWorkflow(), defaultIssueWorkflowSource, evaluateWorkflowCondition(), selectWorkflowTransition(), commit

### Community 89 - "workflow-coordinator.test.ts"
Cohesion: 0.33
Nodes (4): commit, workflowRun(), parseProfile(), commit

## Knowledge Gaps
- **427 isolated node(s):** `name`, `version`, `license`, `private`, `type` (+422 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `observeResponse()` connect `ui-auth.ts` to `runner.mjs`, `D1RunRepository`, `attempt-container.ts`, `model-broker/src/index.ts`, `github.ts`, `attempt-dispatch.ts`, `GitHubClient`, `artifacts.ts`, `CloudflareArtifactsNamespace`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Why does `RunRepository` connect `coordinator.ts` to `D1RunRepository`, `workflow-boundaries.test.ts`, `attempt-container.ts`, `contracts.ts`, `attempt-dispatch.ts`, `RunSnapshot`, `Attempt`, `github-ci.ts`, `core/src/index.ts`, `callback.ts`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `D1RunRepository` connect `D1RunRepository` to `control-plane/src/index.ts`, `attempt-container.ts`, `coordinator.ts`, `dashboard.ts`, `attempt-dispatch.ts`, `usage.ts`, `attempt-runtime.ts`, `RunSnapshot`, `attempt-settlement.ts`, `conversation-worker.ts`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **What connects `name`, `version`, `license` to the rest of the system?**
  _427 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `runner.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05302464525765497 - nodes in this community are weakly interconnected._
- **Should `D1RunRepository` be split into smaller, more focused modules?**
  _Cohesion score 0.056679151061173536 - nodes in this community are weakly interconnected._
- **Should `run-details.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13940256045519203 - nodes in this community are weakly interconnected._