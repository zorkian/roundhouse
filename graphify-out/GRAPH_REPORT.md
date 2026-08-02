# Graph Report - workspace  (2026-08-02)

## Corpus Check
- 137 files · ~234,869 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1578 nodes · 3746 edges · 81 communities (67 shown, 14 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.63)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f59d470b`
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
- CloudflareArtifactsNamespace
- contracts.ts
- attempt-dispatch.ts
- .getAttempt
- attempt-runtime.ts
- workflow.ts
- Attempt
- RunSnapshot
- github-ci.ts
- artifacts.ts
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
- v2Profile
- compilerOptions
- control-plane/worker-configuration.d.ts
- core/tsconfig.json
- response-observer/package.json
- compilerOptions
- LocalD1Statement
- cloudflare-containers.ts
- run-details.test.ts
- createRun
- check-license-headers.mjs
- conversation-store.ts
- runtime-host/package.json
- compileWorkflow
- model-broker/package.json
- model-broker/worker-configuration.d.ts
- index.d.mts
- cloudflare-workers.ts
- tsconfig.json
- text-modules.d.ts
- attempt-settlement.ts
- conversation-worker.ts
- conversation-liveness.ts
- Cursor Cloud specific instructions
- CloudflareArtifactRepository
- implementation.md
- investigation.md
- planning.md
- project.md
- qualification.md
- review-data.md
- review-holistic.md
- review-security.md
- conversation-ui.ts
- ArtifactsNamespace
- README.md
- 9. Workflow implementation plan
- Conversational entry v0 implementation plan
- Conversational entry for Roundhouse
- Roundhouse
- 3. Target workflow architecture
- workflow-coordinator.test.ts
- D1Like

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

## Communities (81 total, 14 thin omitted)

### Community 0 - "runner.mjs"
Cohesion: 0.06
Nodes (96): activityRequest(), agentRuntime, agentSystemPrompt, agentToolNames(), artifactWriteTokenRequest(), bootstrapWorkspace(), checkpointWorkspace(), clone() (+88 more)

### Community 1 - "D1RunRepository"
Cohesion: 0.07
Nodes (15): pauseForModelBudget(), attemptFromRow(), D1RunRepository, PendingWakeup, Statement, usageFromRow(), publishPendingWakeup(), publishPendingWakeups() (+7 more)

### Community 2 - "coordinator.ts"
Cohesion: 0.06
Nodes (50): aggregatedReview, attemptInactivityMilliseconds, acceptCallback(), aggregateReviewAttempts(), aggregateReviews(), AttemptDispatcher, attemptOutcomeTransition(), ciTransition() (+42 more)

### Community 3 - "run-details.ts"
Cohesion: 0.09
Nodes (47): extractModelUsage(), detailsPath(), escapeHtml(), labels, renderDashboard(), renderRun(), section(), cost() (+39 more)

### Community 4 - "attempt-container.ts"
Cohesion: 0.06
Nodes (31): attemptAllowedHosts(), AttemptAssignment, attemptCompletion(), attemptUsesProjectEnvironment(), containerRegistryHosts, ModelPrice, ModelRates, PreparedAttempt (+23 more)

### Community 5 - "ui-auth.ts"
Cohesion: 0.07
Nodes (50): authorizedRepositoryIds(), base64UrlDecode(), base64UrlEncode(), beginGitHubSignIn(), clearStateCookie(), decryptUiAccessToken(), encryptUiAccessToken(), enrolledRepositoryIds() (+42 more)

### Community 6 - "profile.ts"
Cohesion: 0.09
Nodes (23): defaultBlockingSeverities, defaultConversationModel, defaultReviewerModels, defaultStageModels, findingSeverities, FindingSeverity, MergeMethod, mergeMethods (+15 more)

### Community 7 - "conversation-engine.ts"
Cohesion: 0.07
Nodes (37): adapterFor(), anthropicMessagesAdapter, briefSchema, Broker, brokerHeaders(), callModel(), ConversationExecutionResult, conversationInstructions() (+29 more)

### Community 8 - "model-broker/src/index.ts"
Cohesion: 0.11
Nodes (31): applyHostedResearch(), BrokerEnv, brokerRequest(), cloudflareStopReason(), configuredModels(), configuredRoutes(), defaultProtocol(), defaultRoutes (+23 more)

### Community 9 - "github.ts"
Cohesion: 0.05
Nodes (46): ConversationWorkerDependencies, acceptGitHubComment(), acceptGitHubIssueClosed(), appJwt(), bytesToBase64Url(), CommentPayload, conversationPromotionMarker(), findOpenPullRequest() (+38 more)

### Community 10 - "control-plane/package.json"
Cohesion: 0.12
Nodes (16): dependencies, @cloudflare/playwright, @cloudflare/sandbox, cytoscape, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox, @roundhouse/core (+8 more)

### Community 12 - "contracts.ts"
Cohesion: 0.08
Nodes (27): Approval, ApprovalPurpose, approvalPurposes, AttemptCompetition, AttemptKind, attemptKinds, AttemptOutcome, AttemptState (+19 more)

### Community 13 - "attempt-dispatch.ts"
Cohesion: 0.11
Nodes (28): aggregateImplementationAttempts(), attemptContext(), AttemptEventRepository, AttemptWorkflowBinding, canonicalAttempts(), competitionAttemptBaseRole(), competitionForAttempt(), DurableAttemptDispatcher (+20 more)

### Community 14 - ".getAttempt"
Cohesion: 0.31
Nodes (15): modelEgress(), recordModelEvent(), artifactsNamespace(), sandboxName(), acceptRecordedAttemptCompletion(), backupRecordedAttemptWorkspace(), enqueueAttemptWakeup(), publishRecordedAttemptCompletion() (+7 more)

### Community 15 - "attempt-runtime.ts"
Cohesion: 0.13
Nodes (18): judgementCandidateEvidence(), artifactRepositoryName(), AttemptNamespace, AttemptRuntimeEnv, attemptSandbox(), AttemptStub, attemptWorkspaceRef(), checkpointIdentityExpectation() (+10 more)

### Community 16 - "workflow.ts"
Cohesion: 0.07
Nodes (31): ModelThinkingLevel, WaitingReason, executorCapabilities, outputPaths(), taskContracts, validateGraph(), WorkflowAdvance, WorkflowAgentSchema (+23 more)

### Community 17 - "Attempt"
Cohesion: 0.11
Nodes (6): Attempt, Lease, MemoryRunRepository, RunStage, WorkflowCapability, WorkflowExecutorKind

### Community 18 - "RunSnapshot"
Cohesion: 0.23
Nodes (4): AttemptReporter, concludedNoChangeQualification(), GitHubIntakeRepository, RunSnapshot

### Community 19 - "github-ci.ts"
Cohesion: 0.07
Nodes (39): workflow(), acceptGitHubCheckSuite(), acceptGitHubPullRequest(), actionsJobLink(), aggregateReview(), atWorkflowExecutor(), checkEvidence(), CheckRun (+31 more)

### Community 20 - "artifacts.ts"
Cohesion: 0.22
Nodes (11): ArtifactAccess, artifactAdvertisementHasMain(), artifactAdvertisementMainHead(), artifactIdentity(), ArtifactLocation, artifactsErrorDetails(), ArtifactToken, validateCheckpointIdentity() (+3 more)

### Community 21 - "attempt-workflow.ts"
Cohesion: 0.16
Nodes (13): AttemptPreparationEnv, AttemptWorkflowParams, SandboxNamespace, AttemptSettlementEnv, AttemptSettlementResult, loadRecordedAttemptCompletion(), AttemptExecutionWorkflow, AttemptWorkflowEnv (+5 more)

### Community 22 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, composite, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution (+10 more)

### Community 23 - "core/src/index.ts"
Cohesion: 0.19
Nodes (17): AppliedProfile, assertTransition(), CreateRunInput, IssueCommentSnapshot, IssueSnapshot, resumeRun(), RunResumeSignal, runSchemaVersion (+9 more)

### Community 24 - "d1-store.ts"
Cohesion: 0.17
Nodes (12): ActiveAttemptLease, AttemptDiagnosticSnapshot, AttemptExecutionRecordOutcome, AttemptRow, Result, RunDetails, RunRow, RunSummary (+4 more)

### Community 25 - "workflow-view.test.ts"
Cohesion: 0.16
Nodes (7): workflowGraphAsset(), workflowGraphClientScript, collection(), FakeElement, FakeNode, harness(), makeNode()

### Community 26 - "workflow-view.ts"
Cohesion: 0.24
Nodes (16): escapeHtml(), escapeJsonForHtml(), humanizeWorkflowValue(), renderWorkflowView(), truncateLabel(), workflowEditUrl(), workflowEntryStage(), WorkflowGraphElement (+8 more)

### Community 27 - "isRecord"
Cohesion: 0.27
Nodes (17): agent(), competition(), condition(), external(), hasOnlyKeys(), human(), isRecord(), model() (+9 more)

### Community 28 - "D1ConversationRepository"
Cohesion: 0.13
Nodes (9): deliverPendingConversationReplies(), briefFromRow(), D1ConversationRepository, placeholders(), promotionFromRow(), repositoryFromRow(), turnFromRow(), wakeupOutboxId() (+1 more)

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
Nodes (24): artifactNeedsSync(), attemptArtifactAccess(), destroyAttemptSandboxWithTrace(), SandboxDestructionTrace, AttemptTransportStatus, controlPlaneService, ExpiredAttemptRecoveryAction, ExpiredAttemptRecoveryHandlers (+16 more)

### Community 35 - "v2Profile"
Cohesion: 0.31
Nodes (13): enumList(), hasOnlyKeys(), instruction(), instructionSource(), isRecord(), model(), parseConversationModel(), reviewerConfig() (+5 more)

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

### Community 42 - "cloudflare-containers.ts"
Cohesion: 0.25
Nodes (3): Container, ContainerProxy, outboundParams

### Community 43 - "run-details.test.ts"
Cohesion: 0.25
Nodes (7): DetailsAttempt, detailsFixture(), DetailsRun, runFixture(), runtime, workflowCommit, defaultIssueWorkflowSource

### Community 44 - "createRun"
Cohesion: 0.12
Nodes (15): runFixture(), reportRun(), workflowPageDb(), workflowRun(), input, resolveWorkflowContexts(), resumeExternalWorkflowEvent(), commit (+7 more)

### Community 45 - "check-license-headers.mjs"
Cohesion: 0.29
Nodes (6): files, generatedFiles, missing, roots, run, sourceExtensions

### Community 46 - "conversation-store.ts"
Cohesion: 0.15
Nodes (14): ConversationQueue, ConversationService, BriefRow, CanonicalInboundMessage, ConversationContext, ConversationLink, ConversationPromotion, ConversationRepositoryRef (+6 more)

### Community 47 - "runtime-host/package.json"
Cohesion: 0.15
Nodes (12): dependencies, @cloudflare/sandbox, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox, @roundhouse/core, @roundhouse/response-observer, license (+4 more)

### Community 48 - "compileWorkflow"
Cohesion: 0.28
Nodes (7): runFixture(), advanceWorkflow(), compileWorkflow(), evaluateWorkflowCondition(), selectWorkflowTransition(), commit, validateCompetitionRoles()

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
Nodes (20): Checkpoint, saveWorkspaceBackup(), AttemptBackupResult, AttemptPublicationResult, AttemptSettlementOutcome, AttemptValidationResult, callbackForCompletion(), competitionPromoter() (+12 more)

### Community 58 - "conversation-worker.ts"
Cohesion: 0.19
Nodes (16): promotionIssueMarker(), promotionStartMarker(), renderDeliveryBrief(), executeConversationPromotion(), findIssue(), GitHubComment, GitHubIssue, PromotionDependencies (+8 more)

### Community 59 - "conversation-liveness.ts"
Cohesion: 0.16
Nodes (12): ConversationAdapter, VerifiedConversationActor, webConversationAdapter, webInboundMessage(), ProtocolAdapter, ConversationQueue, conversationWakeupRedeliveryMilliseconds, publishConversationWakeup() (+4 more)

### Community 60 - "Cursor Cloud specific instructions"
Cohesion: 0.29
Nodes (6): AGENTS, Cursor Cloud specific instructions, Graphify knowledge graph, Node version (important gotcha), Other notes, There is no local dev server

### Community 71 - "conversation-ui.ts"
Cohesion: 0.33
Nodes (11): Conversation, ConversationSummary, briefEditor(), escapeHtml(), lines(), openControls(), page(), promotionControls() (+3 more)

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

### Community 79 - "3. Target workflow architecture"
Cohesion: 0.50
Nodes (4): 3.1 Repository source and compilation, 3.2 Typed executors, 3.3 Durable execution, 3. Target workflow architecture

### Community 80 - "workflow-coordinator.test.ts"
Cohesion: 0.33
Nodes (4): commit, workflowRun(), parseProfile(), commit

### Community 82 - "D1Like"
Cohesion: 0.29
Nodes (3): AttemptContainerEnv, ids, D1Like

## Knowledge Gaps
- **407 isolated node(s):** `name`, `version`, `license`, `private`, `type` (+402 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `observeResponse()` connect `ui-auth.ts` to `runner.mjs`, `attempt-container.ts`, `model-broker/src/index.ts`, `github.ts`, `CloudflareArtifactsNamespace`, `attempt-dispatch.ts`, `.getAttempt`, `artifacts.ts`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Why does `D1RunRepository` connect `D1RunRepository` to `coordinator.ts`, `control-plane/src/index.ts`, `attempt-container.ts`, `run-details.ts`, `CloudflareArtifactsNamespace`, `createRun`, `attempt-dispatch.ts`, `.getAttempt`, `attempt-runtime.ts`, `attempt-workflow.ts`, `d1-store.ts`, `attempt-settlement.ts`, `conversation-liveness.ts`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `Attempt` connect `Attempt` to `aggregated-review.ts`, `D1RunRepository`, `coordinator.ts`, `control-plane/src/index.ts`, `attempt-container.ts`, `run-details.ts`, `github.ts`, `contracts.ts`, `attempt-dispatch.ts`, `.getAttempt`, `attempt-runtime.ts`, `workflow-coordinator.test.ts`, `RunSnapshot`, `github-ci.ts`, `core/src/index.ts`, `d1-store.ts`, `attempt-settlement.ts`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **What connects `name`, `version`, `license` to the rest of the system?**
  _407 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `runner.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.055353535353535356 - nodes in this community are weakly interconnected._
- **Should `D1RunRepository` be split into smaller, more focused modules?**
  _Cohesion score 0.0712280701754386 - nodes in this community are weakly interconnected._
- **Should `coordinator.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05700852189244784 - nodes in this community are weakly interconnected._