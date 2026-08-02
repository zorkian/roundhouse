# Graph Report - workspace  (2026-08-02)

## Corpus Check
- 137 files · ~234,520 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1577 nodes · 3743 edges · 84 communities (71 shown, 13 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.63)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `26d897ab`
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
- control-plane/package.json
- artifacts.ts
- contracts.ts
- attempt-dispatch.ts
- attempt-settlement.ts
- attempt-runtime.ts
- workflow.ts
- Attempt
- acceptGitHubComment
- RunSnapshot
- github.test.ts
- attempt-workflow.ts
- compilerOptions
- core/src/index.ts
- d1-store.ts
- workflow-view.test.ts
- workflow-view.ts
- isRecord
- D1ConversationRepository
- agent-runner/package.json
- scripts
- core/package.json
- aggregated-review.ts
- Roundhouse V2
- control-plane/src/index.ts
- observeResponse
- compilerOptions
- control-plane/worker-configuration.d.ts
- core/tsconfig.json
- response-observer/package.json
- compilerOptions
- index.mjs
- cloudflare-containers.ts
- RunRepository
- compileWorkflow
- check-license-headers.mjs
- conversation-store.ts
- runtime-host/package.json
- defaultIssueWorkflowSource
- model-broker/package.json
- model-broker/worker-configuration.d.ts
- index.d.mts
- cloudflare-workers.ts
- tsconfig.json
- text-modules.d.ts
- callback.ts
- conversation-worker.ts
- conversation-liveness.ts
- Cursor Cloud specific instructions
- GitHubApi
- implementation.md
- investigation.md
- planning.md
- project.md
- qualification.md
- review-data.md
- review-holistic.md
- review-security.md
- conversation-ui.ts
- coordinate
- README.md
- 9. Workflow implementation plan
- Conversational entry v0 implementation plan
- Conversational entry for Roundhouse
- Roundhouse
- github-ci.test.ts
- 3. Target workflow architecture
- createRun
- LocalD1Statement
- D1Like
- AttemptReporter

## God Nodes (most connected - your core abstractions)
1. `D1RunRepository` - 72 edges
2. `RunSnapshot` - 61 edges
3. `Attempt` - 51 edges
4. `D1ConversationRepository` - 47 edges
5. `coordinate()` - 35 edges
6. `RunRepository` - 32 edges
7. `MemoryRunRepository` - 32 edges
8. `observeResponse()` - 28 edges
9. `Wakeup` - 25 edges
10. `compileWorkflow()` - 23 edges

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

## Communities (84 total, 13 thin omitted)

### Community 0 - "runner.mjs"
Cohesion: 0.05
Nodes (97): activityRequest(), agentRuntime, agentSystemPrompt, agentToolNames(), artifactWriteTokenRequest(), bootstrapWorkspace(), checkpointWorkspace(), clone() (+89 more)

### Community 1 - "D1RunRepository"
Cohesion: 0.06
Nodes (19): pauseForModelBudget(), attemptFromRow(), D1RunRepository, PendingWakeup, Statement, usageFromRow(), publishPendingWakeup(), publishPendingWakeups() (+11 more)

### Community 2 - "coordinator.ts"
Cohesion: 0.12
Nodes (27): aggregatedReview, attemptInactivityMilliseconds, aggregateReviewAttempts(), aggregateReviews(), AttemptDispatcher, attemptOutcomeTransition(), ciTransition(), CompetitionStep (+19 more)

### Community 3 - "run-details.ts"
Cohesion: 0.08
Nodes (50): extractModelUsage(), RunSummary, detailsPath(), escapeHtml(), labels, renderDashboard(), renderRun(), section() (+42 more)

### Community 4 - "attempt-container.ts"
Cohesion: 0.06
Nodes (31): attemptAllowedHosts(), AttemptAssignment, attemptCompletion(), attemptUsesProjectEnvironment(), containerRegistryHosts, ModelPrice, ModelRates, PreparedAttempt (+23 more)

### Community 5 - "ui-auth.ts"
Cohesion: 0.10
Nodes (39): authorizedRepositoryIds(), base64UrlDecode(), base64UrlEncode(), beginGitHubSignIn(), clearStateCookie(), decryptUiAccessToken(), encryptUiAccessToken(), enrolledRepositoryIds() (+31 more)

### Community 6 - "profile.ts"
Cohesion: 0.08
Nodes (42): assertPathAllowed(), defaultBlockingSeverities, defaultConversationModel, defaultReviewerModels, defaultStageModels, enumList(), findingSeverities, FindingSeverity (+34 more)

### Community 7 - "conversation-engine.ts"
Cohesion: 0.07
Nodes (38): adapterFor(), anthropicMessagesAdapter, briefSchema, Broker, brokerHeaders(), callModel(), ConversationExecutionResult, conversationInstructions() (+30 more)

### Community 8 - "model-broker/src/index.ts"
Cohesion: 0.09
Nodes (34): applyHostedResearch(), BrokerEnv, brokerRequest(), cloudflareStopReason(), configuredModels(), configuredRoutes(), defaultProtocol(), defaultRoutes (+26 more)

### Community 9 - "github.ts"
Cohesion: 0.13
Nodes (27): appJwt(), bytesToBase64Url(), CommentPayload, findOpenPullRequest(), findPullRequest(), GitHubStageReporter, implementationComment(), implementationNoChangeComment() (+19 more)

### Community 10 - "control-plane/package.json"
Cohesion: 0.12
Nodes (16): dependencies, @cloudflare/playwright, @cloudflare/sandbox, cytoscape, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox, @roundhouse/core (+8 more)

### Community 11 - "artifacts.ts"
Cohesion: 0.11
Nodes (12): ArtifactAccess, artifactAdvertisementHasMain(), artifactAdvertisementMainHead(), artifactIdentity(), ArtifactLocation, ArtifactRepository, artifactsErrorDetails(), ArtifactsNamespace (+4 more)

### Community 12 - "contracts.ts"
Cohesion: 0.09
Nodes (22): Approval, ApprovalPurpose, approvalPurposes, AttemptCompetition, AttemptKind, attemptKinds, AttemptOutcome, AttemptState (+14 more)

### Community 13 - "attempt-dispatch.ts"
Cohesion: 0.11
Nodes (31): modelEgress(), recordModelEvent(), aggregateImplementationAttempts(), artifactNeedsSync(), attemptArtifactAccess(), AttemptEventRepository, AttemptWorkflowBinding, canonicalAttempts() (+23 more)

### Community 14 - "attempt-settlement.ts"
Cohesion: 0.22
Nodes (22): artifactsNamespace(), attemptWorkspaceBackupKey(), sandboxName(), saveWorkspaceBackup(), acceptRecordedAttemptCompletion(), AttemptBackupResult, AttemptPublicationResult, AttemptSettlementOutcome (+14 more)

### Community 15 - "attempt-runtime.ts"
Cohesion: 0.16
Nodes (17): validateCheckpointIdentity(), validateReadOnlyCheckpoint(), AttemptNamespace, AttemptRuntimeEnv, attemptSandbox(), AttemptStub, checkpointIdentityExpectation(), cleanupCheckpointResources() (+9 more)

### Community 16 - "workflow.ts"
Cohesion: 0.07
Nodes (34): ModelThinkingLevel, WaitingReason, executorCapabilities, outputPaths(), taskContracts, validateGraph(), WorkflowAdvance, WorkflowAgent (+26 more)

### Community 17 - "Attempt"
Cohesion: 0.11
Nodes (6): Attempt, Lease, MemoryRunRepository, RunStage, WorkflowCapability, WorkflowExecutorKind

### Community 18 - "acceptGitHubComment"
Cohesion: 0.15
Nodes (8): acceptGitHubComment(), acceptGitHubIssueClosed(), concludedNoChangeQualification(), conversationPromotionMarker(), GitHubCancellationRepository, GitHubIntakeRepository, operatorAuthorized(), runId()

### Community 19 - "RunSnapshot"
Cohesion: 0.12
Nodes (28): acceptGitHubCheckSuite(), acceptGitHubPullRequest(), actionsJobLink(), aggregateReview(), atWorkflowExecutor(), checkEvidence(), CheckRun, checkRuns() (+20 more)

### Community 20 - "github.test.ts"
Cohesion: 0.14
Nodes (8): loadDefaultBranchProfile(), loadRepositoryProfile(), closureDelivery(), concludeQualification(), delivery(), IntakeRepository, reportedBody(), visualFeedbackProfile()

### Community 21 - "attempt-workflow.ts"
Cohesion: 0.15
Nodes (15): AttemptPreparationEnv, AttemptWorkflowParams, destroyAttemptSandboxWithTrace(), SandboxNamespace, AttemptSettlementEnv, AttemptSettlementResult, AttemptExecutionWorkflow, AttemptWorkflowEnv (+7 more)

### Community 22 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, composite, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution (+10 more)

### Community 23 - "core/src/index.ts"
Cohesion: 0.18
Nodes (17): AppliedProfile, assertTransition(), CreateRunInput, IssueCommentSnapshot, IssueSnapshot, resumeRun(), RunResumeSignal, runSchemaVersion (+9 more)

### Community 24 - "d1-store.ts"
Cohesion: 0.12
Nodes (15): ActiveAttemptLease, AttemptDiagnosticSnapshot, AttemptExecutionRecordOutcome, AttemptRow, Result, RunDetails, RunRow, UsageRow (+7 more)

### Community 25 - "workflow-view.test.ts"
Cohesion: 0.15
Nodes (8): workflowGraphAsset(), workflowGraphClientScript, collection(), FakeElement, FakeNode, harness(), makeNode(), runFixture()

### Community 26 - "workflow-view.ts"
Cohesion: 0.24
Nodes (15): escapeHtml(), escapeJsonForHtml(), humanizeWorkflowValue(), renderWorkflowView(), truncateLabel(), workflowEditUrl(), workflowEntryStage(), WorkflowGraphElement (+7 more)

### Community 27 - "isRecord"
Cohesion: 0.30
Nodes (16): agent(), competition(), condition(), external(), hasOnlyKeys(), human(), isRecord(), model() (+8 more)

### Community 28 - "D1ConversationRepository"
Cohesion: 0.13
Nodes (8): deliverPendingConversationReplies(), briefFromRow(), D1ConversationRepository, placeholders(), repositoryFromRow(), turnFromRow(), wakeupOutboxId(), processConversationWakeup()

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
Cohesion: 0.25
Nodes (6): AggregatedReviewFinding, attempt, configured, head, reviewers, WorkflowReview

### Community 33 - "Roundhouse V2"
Cohesion: 0.15
Nodes (13): 10. Acceptance and observability, 11. Complexity and documentation, 1. Product and development rule, 2. Deployed behavior, 4. Security kernel, 5.1 Control plane and storage, 5.2 Agent environment, 5.3 Models (+5 more)

### Community 34 - "control-plane/src/index.ts"
Cohesion: 0.06
Nodes (21): attemptContext(), SandboxDestructionTrace, competitionPromoter(), AttemptTransportStatus, controlPlaneService, ExpiredAttemptRecoveryAction, ExpiredAttemptRecoveryHandlers, handleRequest() (+13 more)

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

### Community 41 - "index.mjs"
Cohesion: 0.21
Nodes (10): body(), failedEntry(), headers(), isSecretField(), observeBufferedResponse(), observeEventStream(), openedEntry(), redact() (+2 more)

### Community 42 - "cloudflare-containers.ts"
Cohesion: 0.25
Nodes (3): Container, ContainerProxy, outboundParams

### Community 43 - "RunRepository"
Cohesion: 0.11
Nodes (8): CompetitionPromoter, coordinateCompetition(), finalizePromotion(), competitionCandidateRole(), CompetitionJudgement, competitionJudgeRole(), RunRepository, validateCompetitionJudgement()

### Community 44 - "compileWorkflow"
Cohesion: 0.21
Nodes (9): resolveWorkflowContexts(), resumeExternalWorkflowEvent(), commit, head, profileFor(), WorkflowContextProvider, WorkflowContextRequest, compileWorkflow() (+1 more)

### Community 45 - "check-license-headers.mjs"
Cohesion: 0.29
Nodes (6): files, generatedFiles, missing, roots, run, sourceExtensions

### Community 46 - "conversation-store.ts"
Cohesion: 0.14
Nodes (15): ConversationQueue, ConversationService, BriefRow, CanonicalInboundMessage, ConversationContext, ConversationLink, ConversationPromotion, ConversationRepositoryRef (+7 more)

### Community 47 - "runtime-host/package.json"
Cohesion: 0.15
Nodes (12): dependencies, @cloudflare/sandbox, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox, @roundhouse/core, @roundhouse/response-observer, license (+4 more)

### Community 48 - "defaultIssueWorkflowSource"
Cohesion: 0.47
Nodes (5): advanceWorkflow(), defaultIssueWorkflowSource, evaluateWorkflowCondition(), selectWorkflowTransition(), commit

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
Cohesion: 0.17
Nodes (12): Checkpoint, settleAttempt(), acceptCallback(), AttemptCallback, BranchChangedError, bytesToHex(), CheckpointRejectedError, encoder (+4 more)

### Community 58 - "conversation-worker.ts"
Cohesion: 0.18
Nodes (16): promotionIssueMarker(), promotionStartMarker(), renderDeliveryBrief(), executeConversationPromotion(), findIssue(), GitHubComment, GitHubIssue, PromotionDependencies (+8 more)

### Community 59 - "conversation-liveness.ts"
Cohesion: 0.16
Nodes (12): ConversationAdapter, VerifiedConversationActor, webConversationAdapter, webInboundMessage(), ProtocolAdapter, ConversationQueue, conversationWakeupRedeliveryMilliseconds, publishConversationWakeup() (+4 more)

### Community 60 - "Cursor Cloud specific instructions"
Cohesion: 0.29
Nodes (6): AGENTS, Cursor Cloud specific instructions, Graphify knowledge graph, Node version (important gotcha), Other notes, There is no local dev server

### Community 61 - "GitHubApi"
Cohesion: 0.17
Nodes (5): ConversationWorkerDependencies, PullRequest, GitHubApi, GitHubAutomationApi, OpenPullRequest

### Community 71 - "conversation-ui.ts"
Cohesion: 0.33
Nodes (11): Conversation, ConversationSummary, briefEditor(), escapeHtml(), lines(), openControls(), page(), promotionControls() (+3 more)

### Community 72 - "coordinate"
Cohesion: 0.27
Nodes (13): coordinate(), dispatchCompetitionAttempt(), dispatchReview(), effectiveAttemptCapabilities(), recordAttemptOutcomeTransition(), recordIssuedCapabilities(), reportStarted(), resumeCreatedDispatch() (+5 more)

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

### Community 78 - "github-ci.test.ts"
Cohesion: 0.23
Nodes (8): workflow(), AutomationRepository, head, mergeCommit, returnToCi(), setupCi(), setupIntegrated(), sourceCommit

### Community 79 - "3. Target workflow architecture"
Cohesion: 0.50
Nodes (4): 3.1 Repository source and compilation, 3.2 Typed executors, 3.3 Durable execution, 3. Target workflow architecture

### Community 80 - "createRun"
Cohesion: 0.20
Nodes (9): runFixture(), reportRun(), workflowPageDb(), workflowRun(), runWith(), commit, workflowRun(), assertCreateInput() (+1 more)

### Community 82 - "D1Like"
Cohesion: 0.29
Nodes (3): AttemptContainerEnv, ids, D1Like

## Knowledge Gaps
- **407 isolated node(s):** `name`, `version`, `license`, `private`, `type` (+402 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `observeResponse()` connect `observeResponse` to `runner.mjs`, `attempt-container.ts`, `ui-auth.ts`, `model-broker/src/index.ts`, `github.ts`, `index.mjs`, `artifacts.ts`, `attempt-dispatch.ts`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `D1RunRepository` connect `D1RunRepository` to `coordinator.ts`, `run-details.ts`, `attempt-container.ts`, `control-plane/src/index.ts`, `artifacts.ts`, `RunRepository`, `attempt-dispatch.ts`, `attempt-settlement.ts`, `attempt-runtime.ts`, `attempt-workflow.ts`, `d1-store.ts`, `conversation-worker.ts`, `conversation-liveness.ts`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `RunSnapshot` connect `RunSnapshot` to `D1RunRepository`, `coordinator.ts`, `run-details.ts`, `github.ts`, `contracts.ts`, `attempt-dispatch.ts`, `attempt-settlement.ts`, `attempt-runtime.ts`, `Attempt`, `acceptGitHubComment`, `github.test.ts`, `core/src/index.ts`, `d1-store.ts`, `workflow-view.test.ts`, `workflow-view.ts`, `control-plane/src/index.ts`, `RunRepository`, `compileWorkflow`, `coordinate`, `github-ci.test.ts`, `AttemptReporter`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `name`, `version`, `license` to the rest of the system?**
  _407 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `runner.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05465346534653465 - nodes in this community are weakly interconnected._
- **Should `D1RunRepository` be split into smaller, more focused modules?**
  _Cohesion score 0.05518102372034956 - nodes in this community are weakly interconnected._
- **Should `coordinator.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12096774193548387 - nodes in this community are weakly interconnected._