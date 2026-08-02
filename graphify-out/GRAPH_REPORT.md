# Graph Report - workspace  (2026-08-02)

## Corpus Check
- 120 files · ~213,782 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1376 nodes · 3227 edges · 71 communities (58 shown, 13 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 22 edges (avg confidence: 0.64)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `463f91cb`
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
- control-plane/src/index.ts
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
- RunSnapshot
- github-ci.ts
- github.test.ts
- AttemptCompletion
- compilerOptions
- core/src/index.ts
- d1-store.ts
- workflow-view.test.ts
- workflow-view.ts
- isRecord
- github-ci.test.ts
- agent-runner/package.json
- scripts
- core/package.json
- aggregated-review.ts
- Roundhouse V2
- control-plane/src/index.test.ts
- observeResponse
- compilerOptions
- control-plane/worker-configuration.d.ts
- core/tsconfig.json
- response-observer/package.json
- compilerOptions
- index.mjs
- cloudflare-containers.ts
- acceptGitHubComment
- compileWorkflow
- check-license-headers.mjs
- liveness.ts
- runtime-host/package.json
- defaultIssueWorkflowSource
- model-broker/package.json
- model-broker/worker-configuration.d.ts
- index.d.mts
- cloudflare-workers.ts
- tsconfig.json
- text-modules.d.ts
- callback.ts
- LocalD1Statement
- destroyAttemptSandbox
- Cursor Cloud specific instructions
- Statement
- implementation.md
- investigation.md
- planning.md
- project.md
- qualification.md
- review-data.md
- review-holistic.md
- review-security.md

## God Nodes (most connected - your core abstractions)
1. `D1RunRepository` - 70 edges
2. `RunSnapshot` - 61 edges
3. `Attempt` - 51 edges
4. `coordinate()` - 35 edges
5. `RunRepository` - 32 edges
6. `MemoryRunRepository` - 32 edges
7. `observeResponse()` - 26 edges
8. `Wakeup` - 25 edges
9. `compileWorkflow()` - 23 edges
10. `createRun()` - 22 edges

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

## Communities (71 total, 13 thin omitted)

### Community 0 - "runner.mjs"
Cohesion: 0.05
Nodes (97): activityRequest(), agentRuntime, agentSystemPrompt, agentToolNames(), artifactWriteTokenRequest(), bootstrapWorkspace(), checkpointWorkspace(), clone() (+89 more)

### Community 1 - "D1RunRepository"
Cohesion: 0.10
Nodes (7): pauseForModelBudget(), D1RunRepository, usageFromRow(), input, repositoryContract(), ModelUsage, Wakeup

### Community 2 - "coordinator.ts"
Cohesion: 0.06
Nodes (49): aggregatedReview, attemptInactivityMilliseconds, aggregateReviewAttempts(), aggregateReviews(), AttemptDispatcher, attemptOutcomeTransition(), ciTransition(), CompetitionPromoter (+41 more)

### Community 3 - "run-details.ts"
Cohesion: 0.06
Nodes (56): extractModelUsage(), RunDetails, RunSummary, detailsPath(), escapeHtml(), labels, renderDashboard(), renderRun() (+48 more)

### Community 4 - "attempt-container.ts"
Cohesion: 0.07
Nodes (27): attemptAllowedHosts(), AttemptAssignment, attemptUsesProjectEnvironment(), containerRegistryHosts, ModelPrice, ModelRates, PreparedAttempt, prices (+19 more)

### Community 5 - "ui-auth.ts"
Cohesion: 0.09
Nodes (38): AttemptContainerEnv, D1Like, authorizedRepositoryIds(), base64UrlDecode(), base64UrlEncode(), beginGitHubSignIn(), clearStateCookie(), decryptUiAccessToken() (+30 more)

### Community 6 - "profile.ts"
Cohesion: 0.07
Nodes (43): commit, workflowRun(), assertPathAllowed(), defaultBlockingSeverities, defaultReviewerModels, defaultStageModels, enumList(), findingSeverities (+35 more)

### Community 7 - "control-plane/src/index.ts"
Cohesion: 0.11
Nodes (18): artifactNeedsSync(), attemptArtifactAccess(), competitionPromoter(), AttemptTransportStatus, controlPlaneService, ExpiredAttemptRecoveryAction, handleRequest(), json() (+10 more)

### Community 8 - "model-broker/src/index.ts"
Cohesion: 0.09
Nodes (35): applyHostedResearch(), BrokerEnv, brokerRequest(), cloudflareStopReason(), configuredRoutes(), defaultProtocol(), defaultRoutes, defaultTransport() (+27 more)

### Community 9 - "github.ts"
Cohesion: 0.10
Nodes (31): appJwt(), bytesToBase64Url(), CommentPayload, findOpenPullRequest(), findPullRequest(), GitHubApi, GitHubStageReporter, implementationComment() (+23 more)

### Community 10 - "control-plane/package.json"
Cohesion: 0.12
Nodes (16): dependencies, @cloudflare/playwright, @cloudflare/sandbox, cytoscape, @roundhouse/core, @roundhouse/response-observer, @cloudflare/sandbox, @roundhouse/core (+8 more)

### Community 11 - "artifacts.ts"
Cohesion: 0.11
Nodes (14): ArtifactAccess, artifactAdvertisementHasMain(), artifactAdvertisementMainHead(), artifactIdentity(), ArtifactLocation, ArtifactRepository, artifactsErrorDetails(), ArtifactsNamespace (+6 more)

### Community 12 - "contracts.ts"
Cohesion: 0.08
Nodes (29): SandboxAttemptPreparer, RoutingEnvelope, Approval, ApprovalPurpose, approvalPurposes, AttemptCompetition, AttemptKind, attemptKinds (+21 more)

### Community 13 - "attempt-dispatch.ts"
Cohesion: 0.13
Nodes (22): aggregateImplementationAttempts(), AttemptEventRepository, AttemptPreparationEnv, AttemptWorkflowBinding, canonicalAttempts(), competitionAttemptBaseRole(), competitionForAttempt(), DurableAttemptDispatcher (+14 more)

### Community 14 - "attempt-settlement.ts"
Cohesion: 0.15
Nodes (32): AttemptWorkflowParams, prepareAttemptExecution(), artifactsNamespace(), attemptWorkspaceBackupKey(), destroyAttemptSandboxWithTrace(), sandboxName(), SandboxNamespace, saveWorkspaceBackup() (+24 more)

### Community 15 - "attempt-runtime.ts"
Cohesion: 0.12
Nodes (20): Checkpoint, judgementCandidateEvidence(), artifactRepositoryName(), AttemptRuntimeEnv, attemptSandbox(), attemptWorkspaceRef(), checkpointIdentityExpectation(), cleanupCheckpointResources() (+12 more)

### Community 16 - "workflow.ts"
Cohesion: 0.07
Nodes (30): WaitingReason, executorCapabilities, outputPaths(), taskContracts, validateGraph(), WorkflowAdvance, WorkflowAgent, WorkflowAgentSchema (+22 more)

### Community 17 - "Attempt"
Cohesion: 0.11
Nodes (6): Attempt, Lease, MemoryRunRepository, RunStage, WorkflowCapability, WorkflowExecutorKind

### Community 18 - "RunSnapshot"
Cohesion: 0.21
Nodes (11): AttemptReporter, actionsJobLink(), aggregateReview(), checkRuns(), checksSucceeded(), exactAttempt(), failedConclusion(), GitHubAutomationRepository (+3 more)

### Community 19 - "github-ci.ts"
Cohesion: 0.10
Nodes (22): acceptGitHubCheckSuite(), acceptGitHubPullRequest(), atWorkflowExecutor(), checkEvidence(), CheckRun, checksCompleted(), CheckSuitePayload, CiDiagnostics (+14 more)

### Community 20 - "github.test.ts"
Cohesion: 0.12
Nodes (13): runFixture(), operatorAuthorized(), closureDelivery(), concludeQualification(), delivery(), IntakeRepository, reportRun(), visualFeedbackProfile() (+5 more)

### Community 21 - "AttemptCompletion"
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

### Community 22 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, composite, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution (+10 more)

### Community 23 - "core/src/index.ts"
Cohesion: 0.18
Nodes (17): AppliedProfile, assertTransition(), CreateRunInput, IssueCommentSnapshot, IssueSnapshot, resumeRun(), RunResumeSignal, runSchemaVersion (+9 more)

### Community 24 - "d1-store.ts"
Cohesion: 0.25
Nodes (7): ActiveAttemptLease, AttemptDiagnosticSnapshot, AttemptExecutionRecordOutcome, AttemptRow, Result, RunRow, UsageRow

### Community 25 - "workflow-view.test.ts"
Cohesion: 0.15
Nodes (8): workflowGraphAsset(), workflowGraphClientScript, collection(), FakeElement, FakeNode, harness(), makeNode(), runFixture()

### Community 26 - "workflow-view.ts"
Cohesion: 0.22
Nodes (16): escapeHtml(), escapeJsonForHtml(), humanizeWorkflowValue(), renderWorkflowView(), truncateLabel(), workflowEditUrl(), workflowEntryStage(), WorkflowGraphElement (+8 more)

### Community 27 - "isRecord"
Cohesion: 0.30
Nodes (16): agent(), competition(), condition(), external(), hasOnlyKeys(), human(), isRecord(), model() (+8 more)

### Community 28 - "github-ci.test.ts"
Cohesion: 0.23
Nodes (8): workflow(), AutomationRepository, head, mergeCommit, returnToCi(), setupCi(), setupIntegrated(), sourceCommit

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
Cohesion: 0.05
Nodes (36): Current evidence, Deferred feature improvements, Improvement to revisit, Operational metrics and possible warm Sandbox reuse, 10. Acceptance and observability, 11. Complexity and documentation, 1. Product and development rule, 2. Deployed behavior (+28 more)

### Community 34 - "control-plane/src/index.test.ts"
Cohesion: 0.11
Nodes (4): attemptContext(), seedPreImplementationResults(), workflowCommit, workflowProfile

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

### Community 43 - "acceptGitHubComment"
Cohesion: 0.18
Nodes (6): acceptGitHubComment(), acceptGitHubIssueClosed(), concludedNoChangeQualification(), GitHubCancellationRepository, GitHubIntakeRepository, runId()

### Community 44 - "compileWorkflow"
Cohesion: 0.21
Nodes (9): resolveWorkflowContexts(), resumeExternalWorkflowEvent(), commit, head, profileFor(), WorkflowContextProvider, WorkflowContextRequest, compileWorkflow() (+1 more)

### Community 45 - "check-license-headers.mjs"
Cohesion: 0.29
Nodes (6): files, generatedFiles, missing, roots, run, sourceExtensions

### Community 46 - "liveness.ts"
Cohesion: 0.21
Nodes (8): PendingWakeup, publishPendingWakeup(), publishPendingWakeups(), publishWakeup(), PendingWakeupRepository, wakeup, WakeupQueue, wakeupRedeliveryMilliseconds

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
Cohesion: 0.15
Nodes (18): attemptCompletion(), modelEgress(), recordModelEvent(), callbackForCompletion(), settleAttempt(), acceptCallback(), BranchChangedError, bytesToHex() (+10 more)

### Community 59 - "destroyAttemptSandbox"
Cohesion: 0.33
Nodes (4): AttemptNamespace, AttemptStub, destroyAttemptSandbox(), recoverExpiredAttempts()

### Community 60 - "Cursor Cloud specific instructions"
Cohesion: 0.33
Nodes (5): AGENTS, Cursor Cloud specific instructions, Node version (important gotcha), Other notes, There is no local dev server

## Knowledge Gaps
- **355 isolated node(s):** `name`, `version`, `license`, `private`, `type` (+350 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `observeResponse()` connect `observeResponse` to `runner.mjs`, `attempt-container.ts`, `ui-auth.ts`, `model-broker/src/index.ts`, `github.ts`, `index.mjs`, `artifacts.ts`, `contracts.ts`, `attempt-dispatch.ts`, `callback.ts`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Why does `D1RunRepository` connect `D1RunRepository` to `coordinator.ts`, `run-details.ts`, `attempt-container.ts`, `control-plane/src/index.ts`, `contracts.ts`, `attempt-dispatch.ts`, `attempt-settlement.ts`, `attempt-runtime.ts`, `liveness.ts`, `AttemptCompletion`, `d1-store.ts`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Why does `RunSnapshot` connect `RunSnapshot` to `D1RunRepository`, `coordinator.ts`, `run-details.ts`, `control-plane/src/index.ts`, `github.ts`, `contracts.ts`, `attempt-dispatch.ts`, `attempt-settlement.ts`, `attempt-runtime.ts`, `Attempt`, `github-ci.ts`, `github.test.ts`, `core/src/index.ts`, `d1-store.ts`, `workflow-view.test.ts`, `workflow-view.ts`, `github-ci.test.ts`, `control-plane/src/index.test.ts`, `acceptGitHubComment`, `compileWorkflow`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **What connects `name`, `version`, `license` to the rest of the system?**
  _355 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `runner.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05465346534653465 - nodes in this community are weakly interconnected._
- **Should `D1RunRepository` be split into smaller, more focused modules?**
  _Cohesion score 0.10454545454545454 - nodes in this community are weakly interconnected._
- **Should `coordinator.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05721168322794339 - nodes in this community are weakly interconnected._