# Graph Report - workspace  (2026-08-03)

## Corpus Check
- 142 files · ~241,170 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1618 nodes · 3852 edges · 84 communities (70 shown, 14 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `553034de`
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
- v2Profile
- contracts.ts
- attempt-dispatch.ts
- dashboard.ts
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
- FakeElement
- GitHubClient
- dependencies
- D1ConversationRepository
- agent-runner/package.json
- scripts
- core/package.json
- aggregated-review.ts
- Roundhouse V2
- control-plane/src/index.ts
- model-usage.ts
- compilerOptions
- control-plane/worker-configuration.d.ts
- core/tsconfig.json
- response-observer/package.json
- compilerOptions
- Development environment, GitHub Actions, and wrangler
- cloudflare-containers.ts
- run-details.test.ts
- createRun
- check-license-headers.mjs
- conversation-store.ts
- runtime-host/package.json
- github-ci.test.ts
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
- CloudflareArtifactsNamespace
- implementation.md
- investigation.md
- planning.md
- project.md
- qualification.md
- review-data.md
- review-holistic.md
- review-security.md
- GitHubAutomationApi
- workflow-view.ts
- README.md
- 9. Workflow implementation plan
- Conversational entry v0 implementation plan
- Conversational entry for Roundhouse
- Roundhouse
- D1Like
- 3. Target workflow architecture
- github.test.ts
- ArtifactRepository
- repository-contract.test.mjs
- workflow-coordinator.test.ts

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
- `assertCreateInput()` --indirect_call--> `value()`  [INFERRED]
  packages/core/src/run.ts → apps/control-plane/src/run-details.ts

## Import Cycles
- 3-file cycle: `packages/core/src/profile.ts -> packages/core/src/workflow.ts -> packages/core/src/run.ts -> packages/core/src/profile.ts`

## Communities (84 total, 14 thin omitted)

### Community 0 - "runner.mjs"
Cohesion: 0.05
Nodes (98): activityRequest(), agentRuntime, agentSystemPrompt, agentToolNames(), artifactWriteTokenRequest(), bootstrapWorkspace(), checkpointWorkspace(), clone() (+90 more)

### Community 1 - "D1RunRepository"
Cohesion: 0.06
Nodes (28): modelEgress(), pauseForModelBudget(), recordModelEvent(), acceptRecordedAttemptCompletion(), enqueueAttemptWakeup(), publishRecordedAttemptCompletion(), recordAttemptCompletion(), recordedCallback() (+20 more)

### Community 2 - "coordinator.ts"
Cohesion: 0.06
Nodes (47): attemptInactivityMilliseconds, aggregateReviewAttempts(), aggregateReviews(), attemptOutcomeTransition(), ciTransition(), CompetitionPromoter, CompetitionStep, coordinate() (+39 more)

### Community 3 - "run-details.ts"
Cohesion: 0.21
Nodes (25): attemptLinks(), attemptResult(), boundaryWorkflowEvidence(), ciResult(), CompetitionGroup, competitionGroups(), competitionPanels(), DetailsAttempt (+17 more)

### Community 4 - "attempt-container.ts"
Cohesion: 0.06
Nodes (31): attemptAllowedHosts(), AttemptAssignment, attemptCompletion(), AttemptContainerEnv, attemptUsesProjectEnvironment(), containerRegistryHosts, extractModelUsage(), ModelPrice (+23 more)

### Community 5 - "ui-auth.ts"
Cohesion: 0.07
Nodes (50): authorizedRepositoryIds(), base64UrlDecode(), base64UrlEncode(), beginGitHubSignIn(), clearStateCookie(), decryptUiAccessToken(), encryptUiAccessToken(), enrolledRepositoryIds() (+42 more)

### Community 6 - "profile.ts"
Cohesion: 0.08
Nodes (25): defaultBlockingSeverities, defaultConversationModel, defaultReviewerModels, defaultStageModels, findingSeverities, FindingSeverity, MergeMethod, mergeMethods (+17 more)

### Community 7 - "conversation-engine.ts"
Cohesion: 0.06
Nodes (44): adapterFor(), anthropicMessagesAdapter, briefSchema, Broker, brokerHeaders(), callModel(), ConversationExecutionResult, ConversationFirstReply (+36 more)

### Community 8 - "model-broker/src/index.ts"
Cohesion: 0.09
Nodes (35): applyHostedResearch(), BrokerEnv, brokerRequest(), cloudflareStopReason(), configuredModels(), configuredRoutes(), defaultProtocol(), defaultRoutes (+27 more)

### Community 9 - "github.ts"
Cohesion: 0.13
Nodes (25): appJwt(), bytesToBase64Url(), CommentPayload, findOpenPullRequest(), GitHubStageReporter, implementationComment(), implementationNoChangeComment(), IssuePayload (+17 more)

### Community 10 - "conversation-ui.ts"
Cohesion: 0.20
Nodes (18): Conversation, actionableConversationStatus, briefEditor(), conversationMarkdown, conversationNeedsRefresh(), conversationStatus(), ConversationStatusInput, escapeHtml() (+10 more)

### Community 11 - "v2Profile"
Cohesion: 0.31
Nodes (13): enumList(), hasOnlyKeys(), instruction(), instructionSource(), isRecord(), model(), parseConversationModel(), reviewerConfig() (+5 more)

### Community 12 - "contracts.ts"
Cohesion: 0.09
Nodes (24): Approval, ApprovalPurpose, approvalPurposes, AttemptCompetition, AttemptKind, attemptKinds, AttemptOutcome, AttemptState (+16 more)

### Community 13 - "attempt-dispatch.ts"
Cohesion: 0.12
Nodes (28): aggregatedReview, aggregateImplementationAttempts(), attemptContext(), AttemptEventRepository, AttemptWorkflowBinding, canonicalAttempts(), competitionAttemptBaseRole(), competitionForAttempt() (+20 more)

### Community 14 - "dashboard.ts"
Cohesion: 0.15
Nodes (18): detailsPath(), escapeHtml(), labels, renderDashboard(), renderRun(), section(), call(), endAt (+10 more)

### Community 15 - "attempt-runtime.ts"
Cohesion: 0.11
Nodes (23): artifactRepositoryName(), AttemptNamespace, AttemptRuntimeEnv, attemptSandbox(), AttemptStub, attemptWorkspaceBackupKey(), attemptWorkspaceRef(), checkpointIdentityExpectation() (+15 more)

### Community 16 - "workflow.ts"
Cohesion: 0.06
Nodes (58): visualFeedbackProfile(), runFixture(), ModelThinkingLevel, WaitingReason, advanceWorkflow(), agent(), competition(), compileWorkflow() (+50 more)

### Community 17 - "Attempt"
Cohesion: 0.11
Nodes (6): Attempt, Lease, MemoryRunRepository, RunStage, WorkflowCapability, WorkflowExecutorKind

### Community 18 - "RunSnapshot"
Cohesion: 0.14
Nodes (10): AttemptReporter, acceptGitHubComment(), acceptGitHubIssueClosed(), concludedNoChangeQualification(), conversationPromotionMarker(), GitHubCancellationRepository, GitHubIntakeRepository, operatorAuthorized() (+2 more)

### Community 19 - "github-ci.ts"
Cohesion: 0.11
Nodes (29): acceptGitHubCheckSuite(), acceptGitHubPullRequest(), aggregateReview(), atWorkflowExecutor(), checkEvidence(), CheckRun, checkRuns(), checksCompleted() (+21 more)

### Community 20 - "artifacts.ts"
Cohesion: 0.16
Nodes (12): ArtifactAccess, artifactAdvertisementHasMain(), artifactAdvertisementMainHead(), ArtifactLocation, artifactsErrorDetails(), ArtifactsNamespace, ArtifactToken, Checkpoint (+4 more)

### Community 21 - "attempt-workflow.ts"
Cohesion: 0.16
Nodes (12): AttemptPreparationEnv, AttemptWorkflowParams, SandboxNamespace, AttemptSettlementEnv, AttemptSettlementResult, loadRecordedAttemptCompletion(), AttemptExecutionWorkflow, AttemptWorkflowEnv (+4 more)

### Community 22 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, composite, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution (+10 more)

### Community 23 - "core/src/index.ts"
Cohesion: 0.20
Nodes (16): AppliedProfile, assertTransition(), CreateRunInput, IssueCommentSnapshot, IssueSnapshot, resumeRun(), RunResumeSignal, runSchemaVersion (+8 more)

### Community 24 - "d1-store.ts"
Cohesion: 0.18
Nodes (10): ActiveAttemptLease, AttemptDiagnosticSnapshot, AttemptExecutionRecordOutcome, AttemptRow, Result, RunRow, RunSummary, UsageRow (+2 more)

### Community 27 - "dependencies"
Cohesion: 0.11
Nodes (18): dependencies, @cloudflare/playwright, @cloudflare/sandbox, cytoscape, marked, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox (+10 more)

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
Cohesion: 0.25
Nodes (6): AggregatedReviewFinding, attempt, configured, head, reviewers, WorkflowReview

### Community 33 - "Roundhouse V2"
Cohesion: 0.15
Nodes (13): 10. Acceptance and observability, 11. Complexity and documentation, 1. Product and development rule, 2. Deployed behavior, 4. Security kernel, 5.1 Control plane and storage, 5.2 Agent environment, 5.3 Models (+5 more)

### Community 34 - "control-plane/src/index.ts"
Cohesion: 0.06
Nodes (24): artifactNeedsSync(), attemptArtifactAccess(), destroyAttemptSandboxWithTrace(), SandboxDestructionTrace, AttemptTransportStatus, controlPlaneService, ExpiredAttemptRecoveryAction, ExpiredAttemptRecoveryHandlers (+16 more)

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

### Community 43 - "run-details.test.ts"
Cohesion: 0.21
Nodes (10): RunDetails, completedRunDetailsFixture(), renderCompletedRunDetailsFixture(), DetailsAttempt, detailsFixture(), DetailsRun, runFixture(), runtime (+2 more)

### Community 44 - "createRun"
Cohesion: 0.14
Nodes (14): runFixture(), reportRun(), workflowPageDb(), workflowRun(), resolveWorkflowContexts(), resumeExternalWorkflowEvent(), commit, head (+6 more)

### Community 45 - "check-license-headers.mjs"
Cohesion: 0.29
Nodes (6): files, generatedFiles, missing, roots, run, sourceExtensions

### Community 46 - "conversation-store.ts"
Cohesion: 0.13
Nodes (18): ConversationQueue, ConversationService, BriefRow, CanonicalInboundMessage, ConversationContext, ConversationLink, ConversationPromotion, ConversationRepositoryRef (+10 more)

### Community 47 - "runtime-host/package.json"
Cohesion: 0.15
Nodes (12): dependencies, @cloudflare/sandbox, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox, @roundhouse/core, @roundhouse/response-observer, license (+4 more)

### Community 48 - "github-ci.test.ts"
Cohesion: 0.23
Nodes (8): workflow(), AutomationRepository, head, mergeCommit, returnToCi(), setupCi(), setupIntegrated(), sourceCommit

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
Nodes (22): SandboxCheckpointValidator, AttemptBackupResult, AttemptPublicationResult, AttemptSettlementOutcome, AttemptValidationResult, callbackForCompletion(), competitionPromoter(), observedBranchHead() (+14 more)

### Community 58 - "conversation-promotion.ts"
Cohesion: 0.22
Nodes (14): promotionIssueMarker(), promotionStartMarker(), renderDeliveryBrief(), executeConversationPromotion(), findIssue(), GitHubComment, GitHubIssue, PromotionDependencies (+6 more)

### Community 59 - "conversation-worker.ts"
Cohesion: 0.16
Nodes (13): ConversationAdapter, VerifiedConversationActor, webConversationAdapter, webInboundMessage(), ConversationQueue, conversationWakeupRedeliveryMilliseconds, deliverPendingConversationReplies(), publishConversationWakeup() (+5 more)

### Community 60 - "Cursor Cloud specific instructions"
Cohesion: 0.29
Nodes (6): AGENTS, Cursor Cloud specific instructions, Graphify knowledge graph, Node version, Other notes, There is no local dev server

### Community 61 - "CloudflareArtifactsNamespace"
Cohesion: 0.22
Nodes (4): artifactIdentity(), CloudflareArtifactRepository, CloudflareArtifactsNamespace, isArtifactsError()

### Community 71 - "GitHubAutomationApi"
Cohesion: 0.25
Nodes (3): actionsJobLink(), failedConclusion(), GitHubAutomationApi

### Community 72 - "workflow-view.ts"
Cohesion: 0.17
Nodes (20): workflowGraphAsset(), workflowGraphClientScript, escapeHtml(), escapeJsonForHtml(), humanizeWorkflowValue(), renderWorkflowView(), collection(), FakeNode (+12 more)

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

### Community 80 - "github.test.ts"
Cohesion: 0.15
Nodes (8): loadDefaultBranchProfile(), resolveDefaultBranchCommit(), closureDelivery(), concludeQualification(), delivery(), IntakeRepository, reportedBody(), reportedBodyWithDetails()

### Community 82 - "repository-contract.test.mjs"
Cohesion: 0.18
Nodes (3): input, LocalD1, LocalD1Statement

### Community 83 - "workflow-coordinator.test.ts"
Cohesion: 0.29
Nodes (5): loadRepositoryProfile(), commit, workflowRun(), parseProfile(), commit

## Knowledge Gaps
- **420 isolated node(s):** `name`, `version`, `license`, `private`, `type` (+415 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `observeResponse()` connect `ui-auth.ts` to `runner.mjs`, `D1RunRepository`, `attempt-container.ts`, `model-broker/src/index.ts`, `github.ts`, `attempt-dispatch.ts`, `artifacts.ts`, `GitHubClient`, `CloudflareArtifactsNamespace`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Why does `D1RunRepository` connect `D1RunRepository` to `coordinator.ts`, `control-plane/src/index.ts`, `attempt-container.ts`, `attempt-dispatch.ts`, `dashboard.ts`, `attempt-runtime.ts`, `repository-contract.test.mjs`, `attempt-workflow.ts`, `d1-store.ts`, `attempt-settlement.ts`, `conversation-worker.ts`, `CloudflareArtifactsNamespace`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `RunSnapshot` connect `RunSnapshot` to `D1RunRepository`, `coordinator.ts`, `control-plane/src/index.ts`, `GitHubAutomationApi`, `workflow-view.ts`, `github.ts`, `run-details.test.ts`, `contracts.ts`, `attempt-dispatch.ts`, `createRun`, `attempt-runtime.ts`, `github-ci.test.ts`, `github.test.ts`, `Attempt`, `github-ci.ts`, `core/src/index.ts`, `d1-store.ts`, `attempt-settlement.ts`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `name`, `version`, `license` to the rest of the system?**
  _420 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `runner.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.054164239953407106 - nodes in this community are weakly interconnected._
- **Should `D1RunRepository` be split into smaller, more focused modules?**
  _Cohesion score 0.06282847587195413 - nodes in this community are weakly interconnected._
- **Should `coordinator.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05886075949367089 - nodes in this community are weakly interconnected._