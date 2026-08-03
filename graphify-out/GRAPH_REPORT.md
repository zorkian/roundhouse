# Graph Report - workspace  (2026-08-03)

## Corpus Check
- 147 files · ~246,421 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1661 nodes · 3975 edges · 93 communities (79 shown, 14 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `80e41493`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- runner.mjs
- D1RunRepository
- coordinate
- run-details.ts
- RoundhouseRuntimeSandbox
- ui-auth.ts
- profile.ts
- conversation-engine.ts
- model-broker/src/index.ts
- github.ts
- conversation-ui.ts
- createRun
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
- usage.ts
- FakeElement
- coordinator.ts
- github.test.ts
- D1ConversationRepository
- agent-runner/package.json
- scripts
- core/package.json
- aggregated-review.ts
- Roundhouse V2
- control-plane/src/index.test.ts
- control-plane/src/index.ts
- compilerOptions
- control-plane/worker-configuration.d.ts
- core/tsconfig.json
- response-observer/package.json
- compilerOptions
- Development environment, GitHub Actions, and wrangler
- cloudflare-containers.ts
- conversation-service.ts
- d1-store.ts
- check-license-headers.mjs
- conversation-store.ts
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
- Cursor Cloud specific instructions
- run-details.test.ts
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
- dependencies
- compileWorkflow
- workflow-coordinator.test.ts
- attempt-sandbox-components.test.ts
- attempt-container.ts
- index.mjs
- LocalD1Statement
- LocalD1Statement
- NestedContainerRuntime
- defaultIssueWorkflowSource
- runtime-host.ts
- 5. Runtime boundaries

## God Nodes (most connected - your core abstractions)
1. `D1RunRepository` - 72 edges
2. `RunSnapshot` - 61 edges
3. `Attempt` - 51 edges
4. `D1ConversationRepository` - 47 edges
5. `coordinate()` - 35 edges
6. `RunRepository` - 32 edges
7. `MemoryRunRepository` - 32 edges
8. `renderRunDetails()` - 31 edges
9. `observeResponse()` - 28 edges
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
- `reportRun()` --calls--> `createRun()`  [EXTRACTED]
  apps/control-plane/src/github.test.ts → packages/core/src/run.ts

## Import Cycles
- 3-file cycle: `packages/core/src/profile.ts -> packages/core/src/workflow.ts -> packages/core/src/run.ts -> packages/core/src/profile.ts`

## Communities (93 total, 14 thin omitted)

### Community 0 - "runner.mjs"
Cohesion: 0.05
Nodes (99): activityRequest(), agentRuntime, agentSystemPrompt, agentToolNames(), artifactWriteTokenRequest(), bootstrapWorkspace(), checkpointWorkspace(), clone() (+91 more)

### Community 1 - "D1RunRepository"
Cohesion: 0.07
Nodes (15): modelEgress(), pauseForModelBudget(), attemptFromRow(), D1RunRepository, PendingWakeup, Statement, usageFromRow(), publishPendingWakeup() (+7 more)

### Community 2 - "coordinate"
Cohesion: 0.13
Nodes (18): coordinate(), coordinateCompetition(), dispatchCompetitionAttempt(), dispatchReview(), effectiveAttemptCapabilities(), finalizePromotion(), recordAttemptOutcomeTransition(), recordIssuedCapabilities() (+10 more)

### Community 3 - "run-details.ts"
Cohesion: 0.10
Nodes (43): marked, seedPreImplementationResults(), attemptLinks(), attemptResult(), boundaryWorkflowEvidence(), ciResult(), CompetitionGroup, competitionGroups() (+35 more)

### Community 4 - "RoundhouseRuntimeSandbox"
Cohesion: 0.24
Nodes (3): attemptAllowedHosts(), attemptUsesProjectEnvironment(), RoundhouseRuntimeSandbox

### Community 5 - "ui-auth.ts"
Cohesion: 0.10
Nodes (39): authorizedRepositoryIds(), base64UrlDecode(), base64UrlEncode(), beginGitHubSignIn(), clearStateCookie(), decryptUiAccessToken(), encryptUiAccessToken(), enrolledRepositoryIds() (+31 more)

### Community 6 - "profile.ts"
Cohesion: 0.08
Nodes (27): defaultBlockingSeverities, defaultConversationModel, defaultReviewerModels, defaultStageModels, findingSeverities, FindingSeverity, isProtectedRepositoryPath(), matches() (+19 more)

### Community 7 - "conversation-engine.ts"
Cohesion: 0.08
Nodes (34): adapterFor(), anthropicMessagesAdapter, briefSchema, Broker, brokerHeaders(), callModel(), ConversationExecutionResult, ConversationFirstReply (+26 more)

### Community 8 - "model-broker/src/index.ts"
Cohesion: 0.09
Nodes (36): applyHostedResearch(), BrokerEnv, brokerRequest(), cloudflareStopReason(), configuredModels(), configuredRoutes(), defaultProtocol(), defaultRoutes (+28 more)

### Community 9 - "github.ts"
Cohesion: 0.17
Nodes (19): appJwt(), bytesToBase64Url(), CommentPayload, implementationComment(), implementationNoChangeComment(), IssuePayload, ListedComment, noChangeQualifications (+11 more)

### Community 10 - "conversation-ui.ts"
Cohesion: 0.17
Nodes (25): Conversation, actionableConversationStatus, briefEditor(), controlsHtml(), conversationNeedsRefresh(), conversationPollingActive(), ConversationPollState, conversationStatus() (+17 more)

### Community 11 - "createRun"
Cohesion: 0.14
Nodes (13): runFixture(), workflowPageDb(), workflowRun(), input, resolveWorkflowContexts(), resumeExternalWorkflowEvent(), commit, head (+5 more)

### Community 12 - "contracts.ts"
Cohesion: 0.09
Nodes (24): Approval, ApprovalPurpose, approvalPurposes, AttemptCompetition, AttemptKind, attemptKinds, AttemptOutcome, AttemptState (+16 more)

### Community 13 - "attempt-dispatch.ts"
Cohesion: 0.11
Nodes (29): aggregatedReview, artifactNeedsSync(), attemptArtifactAccess(), attemptContext(), AttemptEventRepository, AttemptWorkflowBinding, canonicalAttempts(), competitionAttemptBaseRole() (+21 more)

### Community 14 - "D1Like"
Cohesion: 0.29
Nodes (3): AttemptContainerEnv, ids, D1Like

### Community 15 - "attempt-runtime.ts"
Cohesion: 0.11
Nodes (22): artifactRepositoryName(), AttemptNamespace, AttemptRuntimeEnv, attemptSandbox(), AttemptStub, attemptWorkspaceRef(), checkpointIdentityExpectation(), checkpointIdentityRejection() (+14 more)

### Community 16 - "workflow.ts"
Cohesion: 0.07
Nodes (33): ModelThinkingLevel, WaitingReason, executorCapabilities, outputPaths(), taskContracts, validateGraph(), WorkflowAdvance, WorkflowAgent (+25 more)

### Community 17 - "Attempt"
Cohesion: 0.10
Nodes (6): AttemptReporter, Attempt, Lease, MemoryRunRepository, WorkflowCapability, WorkflowExecutorKind

### Community 18 - "acceptGitHubComment"
Cohesion: 0.27
Nodes (6): acceptGitHubComment(), acceptGitHubIssueClosed(), conversationPromotionMarker(), GitHubCancellationRepository, operatorAuthorized(), runId()

### Community 19 - "github-ci.ts"
Cohesion: 0.07
Nodes (39): acceptGitHubCheckSuite(), acceptGitHubPullRequest(), actionsJobLink(), aggregateReview(), atWorkflowExecutor(), checkEvidence(), CheckRun, checkRuns() (+31 more)

### Community 20 - "artifacts.ts"
Cohesion: 0.11
Nodes (15): ArtifactAccess, artifactAdvertisementHasMain(), artifactAdvertisementMainHead(), artifactIdentity(), ArtifactLocation, ArtifactRepository, artifactsErrorDetails(), ArtifactsNamespace (+7 more)

### Community 21 - "attempt-settlement.ts"
Cohesion: 0.13
Nodes (34): AttemptPreparationEnv, AttemptWorkflowParams, artifactsNamespace(), attemptWorkspaceBackupKey(), sandboxName(), SandboxNamespace, saveWorkspaceBackup(), acceptRecordedAttemptCompletion() (+26 more)

### Community 22 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, composite, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution (+10 more)

### Community 23 - "core/src/index.ts"
Cohesion: 0.14
Nodes (20): concludedNoChangeQualification(), GitHubIntakeRepository, AppliedProfile, assertTransition(), CreateRunInput, IssueCommentSnapshot, IssueSnapshot, resumeRun() (+12 more)

### Community 24 - "usage.ts"
Cohesion: 0.14
Nodes (20): extractModelUsage(), estimateModelCostUsd(), ModelPrice, modelPrices, ModelRates, resolveModelPrice(), call(), endAt (+12 more)

### Community 26 - "coordinator.ts"
Cohesion: 0.11
Nodes (30): attemptInactivityMilliseconds, aggregateReviewAttempts(), aggregateReviews(), attemptOutcomeTransition(), ciTransition(), CompetitionPromoter, CompetitionStep, evidenceForAttempt() (+22 more)

### Community 27 - "github.test.ts"
Cohesion: 0.14
Nodes (9): loadDefaultBranchProfile(), resolveDefaultBranchCommit(), closureDelivery(), concludeQualification(), delivery(), IntakeRepository, reportedBody(), reportRun() (+1 more)

### Community 28 - "D1ConversationRepository"
Cohesion: 0.14
Nodes (7): briefFromRow(), D1ConversationRepository, placeholders(), repositoryFromRow(), turnFromRow(), wakeupOutboxId(), processConversationWakeup()

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
Nodes (13): 10. Acceptance and observability, 11. Complexity and documentation, 1. Product and development rule, 2. Deployed behavior, 3.1 Repository source and compilation, 3.2 Typed executors, 3.3 Durable execution, 3. Target workflow architecture (+5 more)

### Community 34 - "control-plane/src/index.test.ts"
Cohesion: 0.09
Nodes (7): sandboxPreviewPath(), scheduleAttemptSandboxDestruction(), successorWakeup(), workflowCommit, workflowProfile, validAttemptProgress(), worker

### Community 35 - "control-plane/src/index.ts"
Cohesion: 0.11
Nodes (16): SandboxDestructionTrace, competitionPromoter(), webInboundMessage(), conversationPollClientScript, Region, AttemptTransportStatus, controlPlaneService, ExpiredAttemptRecoveryAction (+8 more)

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

### Community 43 - "conversation-service.ts"
Cohesion: 0.24
Nodes (7): ConversationQueue, ConversationService, CanonicalInboundMessage, ConversationContext, ConversationRepositoryRef, ConversationWakeup, ProfileModel

### Community 44 - "d1-store.ts"
Cohesion: 0.17
Nodes (12): ActiveAttemptLease, AttemptDiagnosticSnapshot, AttemptExecutionRecordOutcome, AttemptRow, Result, RunDetails, RunRow, RunSummary (+4 more)

### Community 45 - "check-license-headers.mjs"
Cohesion: 0.29
Nodes (6): files, generatedFiles, missing, roots, run, sourceExtensions

### Community 46 - "conversation-store.ts"
Cohesion: 0.13
Nodes (17): ProtocolAdapter, BriefRow, ConversationLink, ConversationMessage, ConversationPromotion, ConversationRow, ConversationSummary, ConversationTurn (+9 more)

### Community 47 - "runtime-host/package.json"
Cohesion: 0.15
Nodes (12): dependencies, @cloudflare/sandbox, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox, @roundhouse/core, @roundhouse/response-observer, license (+4 more)

### Community 48 - ".report"
Cohesion: 0.21
Nodes (9): findOpenPullRequest(), GitHubStageReporter, listComments(), postRunCommentOnce(), pullRequestBody(), qualificationHeading(), reviewComment(), runDetailsUrl() (+1 more)

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
Cohesion: 0.13
Nodes (19): Checkpoint, callbackForCompletion(), settleAttempt(), {
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
}, completion, workflow(), acceptCallback(), AttemptCallback (+11 more)

### Community 58 - "conversation-promotion.ts"
Cohesion: 0.16
Nodes (17): promotionIssueMarker(), promotionStartMarker(), renderDeliveryBrief(), conversation, github, responsesRoute, turn, executeConversationPromotion() (+9 more)

### Community 59 - "conversation-worker.ts"
Cohesion: 0.17
Nodes (12): ConversationAdapter, VerifiedConversationActor, webConversationAdapter, ConversationQueue, conversationWakeupRedeliveryMilliseconds, deliverPendingConversationReplies(), publishConversationWakeup(), publishPending() (+4 more)

### Community 60 - "Cursor Cloud specific instructions"
Cohesion: 0.29
Nodes (6): AGENTS, Cursor Cloud specific instructions, Graphify knowledge graph, Node version, Other notes, There is no local dev server

### Community 61 - "run-details.test.ts"
Cohesion: 0.22
Nodes (10): completedRunDetailsFixture(), renderCompletedRunDetailsFixture(), renderReviewRunDetailsFixture(), reviewRunDetailsFixture(), DetailsAttempt, detailsFixture(), DetailsRun, runFixture() (+2 more)

### Community 71 - "dashboard.ts"
Cohesion: 0.16
Nodes (20): detailsPath(), escapeHtml(), labels, renderDashboard(), renderRun(), section(), cost(), escapeHtml() (+12 more)

### Community 72 - "workflow-view.ts"
Cohesion: 0.15
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

### Community 78 - "v2Profile"
Cohesion: 0.31
Nodes (13): enumList(), hasOnlyKeys(), instruction(), instructionSource(), isRecord(), model(), parseConversationModel(), reviewerConfig() (+5 more)

### Community 80 - "dependencies"
Cohesion: 0.12
Nodes (16): dependencies, @cloudflare/playwright, @cloudflare/sandbox, cytoscape, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox, @roundhouse/core (+8 more)

### Community 81 - "compileWorkflow"
Cohesion: 0.29
Nodes (16): agent(), competition(), compileWorkflow(), external(), hasOnlyKeys(), human(), isRecord(), model() (+8 more)

### Community 82 - "workflow-coordinator.test.ts"
Cohesion: 0.29
Nodes (5): loadRepositoryProfile(), commit, workflowRun(), parseProfile(), commit

### Community 83 - "attempt-sandbox-components.test.ts"
Cohesion: 0.25
Nodes (8): SandboxComponentHost, SandboxTrace, componentHost(), runningProcess(), successful(), successfulRuntimeCommand(), WorkspaceLifecycleHost, WorkspaceLifecycle

### Community 84 - "attempt-container.ts"
Cohesion: 0.19
Nodes (9): AttemptAssignment, attemptCompletion(), containerRegistryHosts, PreparedAttempt, recordModelEvent(), RunnerHttpResult, PreviewTransportHost, PreviewResponse (+1 more)

### Community 85 - "index.mjs"
Cohesion: 0.32
Nodes (10): body(), failedEntry(), headers(), isSecretField(), observeBufferedResponse(), observeEventStream(), openedEntry(), redact() (+2 more)

### Community 88 - "NestedContainerRuntime"
Cohesion: 0.44
Nodes (3): NestedContainerRuntimeHost, BuilderRegistryCaVerification, NestedContainerRuntime

### Community 89 - "defaultIssueWorkflowSource"
Cohesion: 0.47
Nodes (5): advanceWorkflow(), defaultIssueWorkflowSource, evaluateWorkflowCondition(), selectWorkflowTransition(), commit

### Community 90 - "runtime-host.ts"
Cohesion: 0.60
Nodes (3): handleRuntimeHostRequest(), runtimeHostService, worker

### Community 91 - "5. Runtime boundaries"
Cohesion: 0.50
Nodes (4): 5.1 Control plane and storage, 5.2 Agent environment, 5.3 Models, 5. Runtime boundaries

## Knowledge Gaps
- **425 isolated node(s):** `name`, `version`, `license`, `private`, `type` (+420 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `observeResponse()` connect `observeResponse` to `runner.mjs`, `D1RunRepository`, `RoundhouseRuntimeSandbox`, `ui-auth.ts`, `model-broker/src/index.ts`, `github.ts`, `attempt-dispatch.ts`, `artifacts.ts`, `attempt-container.ts`, `index.mjs`, `response-observer/index.test.ts`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Why does `D1RunRepository` connect `D1RunRepository` to `coordinate`, `control-plane/src/index.ts`, `createRun`, `d1-store.ts`, `attempt-dispatch.ts`, `attempt-runtime.ts`, `attempt-container.ts`, `attempt-settlement.ts`, `usage.ts`, `coordinator.ts`, `conversation-worker.ts`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `Attempt` connect `Attempt` to `D1RunRepository`, `coordinate`, `run-details.ts`, `github.ts`, `contracts.ts`, `attempt-dispatch.ts`, `attempt-runtime.ts`, `github-ci.ts`, `attempt-settlement.ts`, `core/src/index.ts`, `coordinator.ts`, `github.test.ts`, `aggregated-review.ts`, `control-plane/src/index.test.ts`, `control-plane/src/index.ts`, `d1-store.ts`, `.report`, `workflow-coordinator.test.ts`, `attempt-container.ts`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **What connects `name`, `version`, `license` to the rest of the system?**
  _425 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `runner.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.052922139729678276 - nodes in this community are weakly interconnected._
- **Should `D1RunRepository` be split into smaller, more focused modules?**
  _Cohesion score 0.0721120984278879 - nodes in this community are weakly interconnected._
- **Should `coordinate` be split into smaller, more focused modules?**
  _Cohesion score 0.12762762762762764 - nodes in this community are weakly interconnected._