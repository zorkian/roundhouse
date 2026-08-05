# Graph Report - workspace  (2026-08-05)

## Corpus Check
- 152 files · ~254,958 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1718 nodes · 4135 edges · 96 communities (84 shown, 12 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `99aac7da`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- runner.mjs
- D1RunRepository
- RoundhouseRuntimeSandbox
- run-details.ts
- attempt-sandbox-components.test.ts
- ui-auth.ts
- profile.ts
- conversation-engine.ts
- model-broker/src/index.ts
- github.ts
- conversation-ui.ts
- coordinator.ts
- contracts.ts
- attempt-dispatch.ts
- .reconcileCi
- attempt-runtime.ts
- workflow.ts
- Attempt
- conversation-store.ts
- github-ci.ts
- artifacts.ts
- attempt-settlement.ts
- compilerOptions
- core/src/index.ts
- model-usage.ts
- workflow-view.test.ts
- v2Profile
- callback.ts
- D1ConversationRepository
- agent-runner/package.json
- scripts
- core/package.json
- aggregated-review.ts
- Roundhouse V2
- control-plane/src/index.ts
- github-ci.test.ts
- compilerOptions
- control-plane/worker-configuration.d.ts
- core/tsconfig.json
- response-observer/package.json
- compilerOptions
- Cursor Cloud specific instructions
- cloudflare-containers.ts
- conversation-service.ts
- dashboard.ts
- check-license-headers.mjs
- usage.ts
- runtime-host/package.json
- createRun
- model-broker/package.json
- model-broker/worker-configuration.d.ts
- index.d.mts
- cloudflare-workers.ts
- tsconfig.json
- text-modules.d.ts
- conversation-worker.ts
- conversation-promotion.ts
- conversation-liveness.ts
- CloudflareArtifactsNamespace
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
- isRecord
- README.md
- 9. Workflow implementation plan
- Conversational entry v0 implementation plan
- Conversational entry for Roundhouse
- Roundhouse
- GitHubAutomationApi
- d1-store.ts
- adjudication.md
- compileWorkflow
- CloudflareArtifactRepository
- dependencies
- workflow-view.ts
- workflow-coordinator.test.ts
- model-prices.ts
- .report
- conversation-client.test.ts
- RunSnapshot
- attempt-workflow.ts
- ModelRoute
- defaultIssueWorkflowSource
- .getById
- runtime-host.ts
- repository-contract.test.mjs

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
- `AttemptAssignment` --inherits--> `Attempt`  [EXTRACTED]
  apps/control-plane/src/attempt-container.ts → packages/core/src/contracts.ts
- `AttemptDiagnosticSnapshot` --references--> `Attempt`  [EXTRACTED]
  apps/control-plane/src/d1-store.ts → packages/core/src/contracts.ts
- `ActiveAttemptLease` --inherits--> `Wakeup`  [EXTRACTED]
  apps/control-plane/src/d1-store.ts → packages/core/src/contracts.ts
- `assertCreateInput()` --indirect_call--> `value()`  [INFERRED]
  packages/core/src/run.ts → apps/control-plane/src/run-details.ts

## Import Cycles
- 3-file cycle: `packages/core/src/profile.ts -> packages/core/src/workflow.ts -> packages/core/src/run.ts -> packages/core/src/profile.ts`

## Communities (96 total, 12 thin omitted)

### Community 0 - "runner.mjs"
Cohesion: 0.05
Nodes (100): activityRequest(), adjudicate(), adjudicationPrompt(), adjudicationSchema, agentRuntime, agentSystemPrompt, agentToolNames(), artifactWriteTokenRequest() (+92 more)

### Community 1 - "D1RunRepository"
Cohesion: 0.07
Nodes (15): pauseForModelBudget(), attemptFromRow(), D1RunRepository, PendingWakeup, Statement, usageFromRow(), publishPendingWakeup(), publishPendingWakeups() (+7 more)

### Community 2 - "RoundhouseRuntimeSandbox"
Cohesion: 0.24
Nodes (3): attemptAllowedHosts(), attemptUsesProjectEnvironment(), RoundhouseRuntimeSandbox

### Community 3 - "run-details.ts"
Cohesion: 0.11
Nodes (39): attemptLinks(), attemptResult(), boundaryWorkflowEvidence(), ciResult(), CompetitionGroup, competitionGroups(), competitionPanels(), DetailsAttempt (+31 more)

### Community 4 - "attempt-sandbox-components.test.ts"
Cohesion: 0.13
Nodes (14): NestedContainerRuntimeHost, PreviewTransportHost, SandboxComponentHost, SandboxTrace, componentHost(), runningProcess(), successful(), successfulRuntimeCommand() (+6 more)

### Community 5 - "ui-auth.ts"
Cohesion: 0.06
Nodes (51): GitHubClient, authorizedRepositoryIds(), base64UrlDecode(), base64UrlEncode(), beginGitHubSignIn(), clearStateCookie(), decryptUiAccessToken(), encryptUiAccessToken() (+43 more)

### Community 6 - "profile.ts"
Cohesion: 0.08
Nodes (28): defaultBlockingSeverities, defaultConversationModel, defaultReviewerModels, defaultStageModels, findingSeverities, FindingSeverity, isProtectedRepositoryPath(), matches() (+20 more)

### Community 7 - "conversation-engine.ts"
Cohesion: 0.06
Nodes (45): adapterFor(), anthropicMessagesAdapter, briefSchema, Broker, brokerFailureFields(), brokerHeaders(), callModel(), ConversationExecutionResult (+37 more)

### Community 8 - "model-broker/src/index.ts"
Cohesion: 0.08
Nodes (50): applyFailureHeaders(), applyHostedResearch(), BrokerEnv, brokerRequest(), cloudflareShaped(), configuredModels(), configuredRoutes(), defaultProtocol() (+42 more)

### Community 9 - "github.ts"
Cohesion: 0.12
Nodes (29): acceptGitHubComment(), appJwt(), bytesToBase64Url(), CommentPayload, concludedNoChangeQualification(), conversationPromotionMarker(), implementationComment(), implementationNoChangeComment() (+21 more)

### Community 10 - "conversation-ui.ts"
Cohesion: 0.17
Nodes (25): Conversation, actionableConversationStatus, briefEditor(), controlsHtml(), conversationPollingActive(), ConversationPollState, conversationStatus(), ConversationStatusInput (+17 more)

### Community 11 - "coordinator.ts"
Cohesion: 0.06
Nodes (52): aggregatedReview, attemptInactivityMilliseconds, aggregateReviewAttempts(), aggregateReviews(), AttemptDispatcher, attemptOutcomeTransition(), ciTransition(), CompetitionPromoter (+44 more)

### Community 12 - "contracts.ts"
Cohesion: 0.06
Nodes (41): AttemptAssignment, attemptCompletion(), containerRegistryHosts, modelEgress(), PreparedAttempt, recordModelEvent(), RunnerHttpResult, Approval (+33 more)

### Community 13 - "attempt-dispatch.ts"
Cohesion: 0.12
Nodes (28): artifactNeedsSync(), attemptArtifactAccess(), attemptContext(), AttemptEventRepository, AttemptWorkflowBinding, canonicalAttempts(), competitionAttemptBaseRole(), competitionForAttempt() (+20 more)

### Community 14 - ".reconcileCi"
Cohesion: 0.36
Nodes (7): aggregateReview(), checkRuns(), checksSucceeded(), exactAttempt(), GitHubAutomationRepository, GitHubCiAutomation, immutableAttemptId()

### Community 15 - "attempt-runtime.ts"
Cohesion: 0.12
Nodes (22): AttemptNamespace, AttemptRuntimeEnv, attemptSandbox(), AttemptStub, checkpointIdentityExpectation(), checkpointIdentityRejection(), checkpointIdentityRejectionDetails, cleanupCheckpointResources() (+14 more)

### Community 16 - "workflow.ts"
Cohesion: 0.07
Nodes (30): WaitingReason, executorCapabilities, taskContracts, WorkflowAdvance, WorkflowAgent, WorkflowAgentSchema, workflowAgentSchemas, WorkflowAgentTask (+22 more)

### Community 17 - "Attempt"
Cohesion: 0.13
Nodes (4): Attempt, Lease, MemoryRunRepository, RunStage

### Community 18 - "conversation-store.ts"
Cohesion: 0.11
Nodes (16): AttemptContainerEnv, BriefRow, ConversationContext, ConversationLink, ConversationPromotion, ConversationRow, ConversationSummary, initialBriefBody() (+8 more)

### Community 19 - "github-ci.ts"
Cohesion: 0.13
Nodes (20): acceptGitHubCheckSuite(), acceptGitHubPullRequest(), atWorkflowExecutor(), checkEvidence(), CheckRun, checksCompleted(), CheckSuitePayload, CiDiagnostics (+12 more)

### Community 20 - "artifacts.ts"
Cohesion: 0.22
Nodes (11): ArtifactAccess, artifactAdvertisementHasMain(), artifactAdvertisementMainHead(), artifactIdentity(), ArtifactLocation, artifactsErrorDetails(), ArtifactToken, Checkpoint (+3 more)

### Community 21 - "attempt-settlement.ts"
Cohesion: 0.16
Nodes (28): artifactsNamespace(), sandboxName(), saveWorkspaceBackup(), acceptRecordedAttemptCompletion(), AttemptBackupResult, AttemptPublicationResult, AttemptSettlementOutcome, AttemptSettlementResult (+20 more)

### Community 22 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, composite, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution (+10 more)

### Community 23 - "core/src/index.ts"
Cohesion: 0.20
Nodes (16): AppliedProfile, assertTransition(), CreateRunInput, IssueCommentSnapshot, IssueSnapshot, resumeRun(), RunResumeSignal, runSchemaVersion (+8 more)

### Community 24 - "model-usage.ts"
Cohesion: 0.21
Nodes (14): cost(), escapeHtml(), palette, renderChart(), renderModelUsage(), tokens(), utc(), developmentBadge (+6 more)

### Community 25 - "workflow-view.test.ts"
Cohesion: 0.16
Nodes (7): workflowGraphAsset(), workflowGraphClientScript, collection(), FakeElement, FakeNode, harness(), makeNode()

### Community 26 - "v2Profile"
Cohesion: 0.31
Nodes (13): enumList(), hasOnlyKeys(), instruction(), instructionSource(), isRecord(), model(), parseConversationModel(), reviewerConfig() (+5 more)

### Community 27 - "callback.ts"
Cohesion: 0.11
Nodes (14): acceptCallback(), BranchChangedError, bytesToHex(), encoder, record(), signCallback(), stable(), validAttemptCompletion() (+6 more)

### Community 28 - "D1ConversationRepository"
Cohesion: 0.19
Nodes (5): deliverPendingConversationReplies(), D1ConversationRepository, turnFromRow(), wakeupOutboxId(), processConversationWakeup()

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
Nodes (22): SandboxDestructionTrace, competitionPromoter(), ciDiagnosticsNotice, AttemptTransportStatus, controlPlaneService, ExpiredAttemptRecoveryAction, ExpiredAttemptRecoveryHandlers, handleRequest() (+14 more)

### Community 35 - "github-ci.test.ts"
Cohesion: 0.23
Nodes (8): workflow(), AutomationRepository, head, mergeCommit, returnToCi(), setupCi(), setupIntegrated(), sourceCommit

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

### Community 43 - "conversation-service.ts"
Cohesion: 0.28
Nodes (5): ConversationQueue, ConversationService, CanonicalInboundMessage, ConversationRepositoryRef, ConversationWakeup

### Community 44 - "dashboard.ts"
Cohesion: 0.26
Nodes (11): RunSummary, detailsPath(), escapeHtml(), labels, renderDashboard(), renderRun(), section(), prepare() (+3 more)

### Community 45 - "check-license-headers.mjs"
Cohesion: 0.29
Nodes (6): files, generatedFiles, missing, roots, run, sourceExtensions

### Community 46 - "usage.ts"
Cohesion: 0.18
Nodes (15): extractModelUsage(), call(), endAt, usageDisplay(), usageTable(), formatUsage(), formatUsageBreakdown(), ModelUsageDay (+7 more)

### Community 47 - "runtime-host/package.json"
Cohesion: 0.15
Nodes (12): dependencies, @cloudflare/sandbox, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox, @roundhouse/core, @roundhouse/response-observer, license (+4 more)

### Community 48 - "createRun"
Cohesion: 0.14
Nodes (14): runFixture(), reportRun(), workflowPageDb(), workflowRun(), resolveWorkflowContexts(), resumeExternalWorkflowEvent(), commit, head (+6 more)

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

### Community 57 - "conversation-worker.ts"
Cohesion: 0.29
Nodes (6): ConversationWakeupResult, conversationWakeupRetryDelaySeconds(), conversationWakeupShouldRetry(), ConversationWorkerDependencies, executionMetadata(), GitHubApi

### Community 58 - "conversation-promotion.ts"
Cohesion: 0.19
Nodes (14): promotionIssueMarker(), promotionStartMarker(), renderDeliveryBrief(), executeConversationPromotion(), findIssue(), GitHubComment, GitHubIssue, PromotionDependencies (+6 more)

### Community 59 - "conversation-liveness.ts"
Cohesion: 0.18
Nodes (11): ConversationAdapter, VerifiedConversationActor, webConversationAdapter, webInboundMessage(), ProtocolAdapter, ConversationQueue, conversationWakeupRedeliveryMilliseconds, publishConversationWakeup() (+3 more)

### Community 60 - "CloudflareArtifactsNamespace"
Cohesion: 0.22
Nodes (3): ArtifactsNamespace, CloudflareArtifactsNamespace, isArtifactsError()

### Community 61 - "run-details.test.ts"
Cohesion: 0.21
Nodes (11): RunDetails, completedRunDetailsFixture(), renderCompletedRunDetailsFixture(), renderReviewRunDetailsFixture(), reviewRunDetailsFixture(), DetailsAttempt, detailsFixture(), DetailsRun (+3 more)

### Community 71 - "3. Target workflow architecture"
Cohesion: 0.50
Nodes (4): 3.1 Repository source and compilation, 3.2 Typed executors, 3.3 Durable execution, 3. Target workflow architecture

### Community 72 - "isRecord"
Cohesion: 0.30
Nodes (16): agent(), competition(), condition(), external(), hasOnlyKeys(), human(), isRecord(), model() (+8 more)

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

### Community 78 - "GitHubAutomationApi"
Cohesion: 0.25
Nodes (3): actionsJobLink(), failedConclusion(), GitHubAutomationApi

### Community 79 - "d1-store.ts"
Cohesion: 0.25
Nodes (7): ActiveAttemptLease, AttemptDiagnosticSnapshot, AttemptExecutionRecordOutcome, AttemptRow, Result, RunRow, UsageRow

### Community 81 - "compileWorkflow"
Cohesion: 0.29
Nodes (6): visualFeedbackProfile(), runFixture(), compileWorkflow(), outputPaths(), validateCompetitionRoles(), validateGraph()

### Community 83 - "dependencies"
Cohesion: 0.11
Nodes (18): dependencies, @cloudflare/playwright, @cloudflare/sandbox, cytoscape, marked, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox (+10 more)

### Community 85 - "workflow-view.ts"
Cohesion: 0.29
Nodes (14): escapeHtml(), escapeJsonForHtml(), humanizeWorkflowValue(), renderWorkflowView(), truncateLabel(), workflowEditUrl(), workflowEntryStage(), WorkflowGraphElement (+6 more)

### Community 86 - "workflow-coordinator.test.ts"
Cohesion: 0.33
Nodes (4): commit, workflowRun(), parseProfile(), commit

### Community 88 - "model-prices.ts"
Cohesion: 0.23
Nodes (10): number(), usageForResponse(), normalizeModelId(), providerFromModel(), estimateModelCostUsd(), ModelPrice, modelPrices, ModelRates (+2 more)

### Community 89 - ".report"
Cohesion: 0.20
Nodes (8): findOpenPullRequest(), findPullRequest(), GitHubStageReporter, pullRequestBody(), qualificationHeading(), reviewComment(), reportedBody(), reportedBodyWithDetails()

### Community 90 - "conversation-client.test.ts"
Cohesion: 0.29
Nodes (4): conversationPollClientScript, Message, Rectangle, Region

### Community 91 - "RunSnapshot"
Cohesion: 0.18
Nodes (5): AttemptReporter, acceptGitHubIssueClosed(), GitHubCancellationRepository, GitHubIntakeRepository, RunSnapshot

### Community 92 - "attempt-workflow.ts"
Cohesion: 0.16
Nodes (11): AttemptPreparationEnv, AttemptWorkflowParams, SandboxNamespace, AttemptSettlementEnv, AttemptExecutionWorkflow, AttemptWorkflowEnv, noExecutionRetry, recordTerminalWorkflowFailure() (+3 more)

### Community 93 - "ModelRoute"
Cohesion: 0.22
Nodes (9): ConversationTurn, RoutingEnvelope, ModelRoute, ModelRuntimeCapabilities, modelRuntimeCatalog, ModelThinkingLevel, ModelThinkingLevelMap, modelThinkingLevels (+1 more)

### Community 94 - "defaultIssueWorkflowSource"
Cohesion: 0.47
Nodes (5): advanceWorkflow(), defaultIssueWorkflowSource, evaluateWorkflowCondition(), selectWorkflowTransition(), commit

### Community 95 - ".getById"
Cohesion: 0.29
Nodes (4): briefFromRow(), placeholders(), promotionFromRow(), repositoryFromRow()

### Community 96 - "runtime-host.ts"
Cohesion: 0.60
Nodes (3): handleRuntimeHostRequest(), runtimeHostService, worker

### Community 98 - "repository-contract.test.mjs"
Cohesion: 0.18
Nodes (3): input, LocalD1, LocalD1Statement

## Knowledge Gaps
- **437 isolated node(s):** `name`, `version`, `license`, `private`, `type` (+432 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `observeResponse()` connect `ui-auth.ts` to `runner.mjs`, `RoundhouseRuntimeSandbox`, `model-broker/src/index.ts`, `github.ts`, `contracts.ts`, `attempt-dispatch.ts`, `artifacts.ts`, `CloudflareArtifactsNamespace`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Why does `D1RunRepository` connect `D1RunRepository` to `control-plane/src/index.ts`, `repository-contract.test.mjs`, `coordinator.ts`, `contracts.ts`, `attempt-dispatch.ts`, `dashboard.ts`, `attempt-runtime.ts`, `attempt-workflow.ts`, `d1-store.ts`, `usage.ts`, `attempt-settlement.ts`, `conversation-worker.ts`, `CloudflareArtifactsNamespace`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `Attempt` connect `Attempt` to `D1RunRepository`, `run-details.ts`, `github.ts`, `coordinator.ts`, `contracts.ts`, `attempt-dispatch.ts`, `attempt-runtime.ts`, `github-ci.ts`, `attempt-settlement.ts`, `core/src/index.ts`, `callback.ts`, `aggregated-review.ts`, `control-plane/src/index.ts`, `github-ci.test.ts`, `run-details.test.ts`, `d1-store.ts`, `workflow-coordinator.test.ts`, `.report`, `RunSnapshot`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `name`, `version`, `license` to the rest of the system?**
  _437 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `runner.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05302464525765497 - nodes in this community are weakly interconnected._
- **Should `D1RunRepository` be split into smaller, more focused modules?**
  _Cohesion score 0.07099099099099099 - nodes in this community are weakly interconnected._
- **Should `run-details.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11406423034330011 - nodes in this community are weakly interconnected._