# Graph Report - .  (2026-08-02)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1303 nodes · 3176 edges · 58 communities (54 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 22 edges (avg confidence: 0.64)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ac1e1acb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 57

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
- `assertCreateInput()` --indirect_call--> `value()`  [INFERRED]
  packages/core/src/run.ts → apps/control-plane/src/run-details.ts

## Import Cycles
- 3-file cycle: `packages/core/src/profile.ts -> packages/core/src/workflow.ts -> packages/core/src/run.ts -> packages/core/src/profile.ts`

## Communities (58 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (97): activityRequest(), agentRuntime, agentSystemPrompt, agentToolNames(), artifactWriteTokenRequest(), bootstrapWorkspace(), checkpointWorkspace(), clone() (+89 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (24): modelEgress(), pauseForModelBudget(), recordModelEvent(), loadRecordedAttemptCompletion(), recordAttemptCompletion(), recordTerminalWorkflowFailure(), attemptFromRow(), D1RunRepository (+16 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (50): attemptInactivityMilliseconds, attemptOutcomeTransition(), ciTransition(), CompetitionPromoter, CompetitionStep, coordinate(), coordinateCompetition(), dispatchCompetitionAttempt() (+42 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (57): extractModelUsage(), RunDetails, RunSummary, detailsPath(), escapeHtml(), labels, renderDashboard(), renderRun() (+49 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (30): attemptAllowedHosts(), AttemptAssignment, attemptCompletion(), attemptUsesProjectEnvironment(), containerRegistryHosts, ModelPrice, ModelRates, PreparedAttempt (+22 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (46): authorizedRepositoryIds(), base64UrlDecode(), base64UrlEncode(), beginGitHubSignIn(), clearStateCookie(), decryptUiAccessToken(), encryptUiAccessToken(), enrolledRepositoryIds() (+38 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (43): commit, workflowRun(), assertPathAllowed(), defaultBlockingSeverities, defaultReviewerModels, defaultStageModels, enumList(), findingSeverities (+35 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (24): artifactNeedsSync(), attemptArtifactAccess(), destroyAttemptSandboxWithTrace(), SandboxDestructionTrace, competitionPromoter(), AttemptTransportStatus, controlPlaneService, ExpiredAttemptRecoveryAction (+16 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (35): applyHostedResearch(), BrokerEnv, brokerRequest(), cloudflareStopReason(), configuredRoutes(), defaultProtocol(), defaultRoutes, defaultTransport() (+27 more)

### Community 9 - "Community 9"
Cohesion: 0.10
Nodes (30): appJwt(), bytesToBase64Url(), CommentPayload, findOpenPullRequest(), findPullRequest(), GitHubApi, GitHubStageReporter, implementationComment() (+22 more)

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (33): dependencies, @cloudflare/playwright, @cloudflare/sandbox, cytoscape, @roundhouse/core, @roundhouse/response-observer, license, name (+25 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (14): ArtifactAccess, artifactAdvertisementHasMain(), artifactAdvertisementMainHead(), artifactIdentity(), ArtifactLocation, ArtifactRepository, artifactsErrorDetails(), ArtifactsNamespace (+6 more)

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (30): RoutingEnvelope, Approval, ApprovalPurpose, approvalPurposes, AttemptCompetition, AttemptKind, attemptKinds, AttemptOutcome (+22 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (26): aggregateImplementationAttempts(), attemptContext(), AttemptEventRepository, AttemptWorkflowBinding, canonicalAttempts(), competitionAttemptBaseRole(), competitionForAttempt(), DurableAttemptDispatcher (+18 more)

### Community 14 - "Community 14"
Cohesion: 0.24
Nodes (19): artifactsNamespace(), attemptSandbox(), attemptWorkspaceBackupKey(), sandboxName(), acceptRecordedAttemptCompletion(), AttemptBackupResult, AttemptPublicationResult, AttemptSettlementOutcome (+11 more)

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (19): Checkpoint, artifactRepositoryName(), AttemptNamespace, AttemptRuntimeEnv, AttemptStub, attemptWorkspaceRef(), checkpointIdentityExpectation(), cleanupCheckpointResources() (+11 more)

### Community 16 - "Community 16"
Cohesion: 0.07
Nodes (30): WaitingReason, condition(), executorCapabilities, scalar(), taskContracts, WorkflowAdvance, WorkflowAgent, WorkflowAgentSchema (+22 more)

### Community 17 - "Community 17"
Cohesion: 0.11
Nodes (6): Attempt, Lease, MemoryRunRepository, RunStage, WorkflowCapability, WorkflowExecutorKind

### Community 18 - "Community 18"
Cohesion: 0.21
Nodes (11): AttemptReporter, actionsJobLink(), aggregateReview(), checkRuns(), checksSucceeded(), exactAttempt(), failedConclusion(), GitHubAutomationRepository (+3 more)

### Community 19 - "Community 19"
Cohesion: 0.12
Nodes (21): acceptGitHubCheckSuite(), acceptGitHubPullRequest(), atWorkflowExecutor(), checkEvidence(), CheckRun, checksCompleted(), CheckSuitePayload, CiDiagnostics (+13 more)

### Community 20 - "Community 20"
Cohesion: 0.11
Nodes (16): aggregateReviewAttempts(), selectedReviewers(), runFixture(), acceptGitHubComment(), loadDefaultBranchProfile(), loadRepositoryProfile(), operatorAuthorized(), closureDelivery() (+8 more)

### Community 21 - "Community 21"
Cohesion: 0.15
Nodes (13): AttemptPreparationEnv, AttemptWorkflowParams, SandboxNamespace, AttemptSettlementEnv, AttemptSettlementResult, AttemptExecutionWorkflow, AttemptWorkflowEnv, noExecutionRetry (+5 more)

### Community 22 - "Community 22"
Cohesion: 0.11
Nodes (18): compilerOptions, composite, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution (+10 more)

### Community 23 - "Community 23"
Cohesion: 0.23
Nodes (12): assertTransition(), IssueCommentSnapshot, runSchemaVersion, runStages, RunStatus, runStatuses, RunTransition, terminalStatuses (+4 more)

### Community 24 - "Community 24"
Cohesion: 0.17
Nodes (12): ActiveAttemptLease, AttemptDiagnosticSnapshot, AttemptExecutionRecordOutcome, AttemptRow, Result, RunRow, UsageRow, AppliedProfile (+4 more)

### Community 25 - "Community 25"
Cohesion: 0.16
Nodes (7): workflowGraphAsset(), workflowGraphClientScript, collection(), FakeElement, FakeNode, harness(), makeNode()

### Community 26 - "Community 26"
Cohesion: 0.26
Nodes (15): escapeHtml(), escapeJsonForHtml(), humanizeWorkflowValue(), renderWorkflowView(), truncateLabel(), workflowEditUrl(), workflowEntryStage(), WorkflowGraphElement (+7 more)

### Community 27 - "Community 27"
Cohesion: 0.36
Nodes (14): agent(), competition(), external(), hasOnlyKeys(), human(), isRecord(), model(), modelOrCompetition() (+6 more)

### Community 28 - "Community 28"
Cohesion: 0.17
Nodes (8): AutomationRepository, head, mergeCommit, returnToCi(), setupCi(), setupIntegrated(), sourceCommit, GitHubAutomationApi

### Community 29 - "Community 29"
Cohesion: 0.13
Nodes (14): dependencies, @devcontainers/cli, @earendil-works/pi-coding-agent, jsonc-parser, typebox, license, name, private (+6 more)

### Community 30 - "Community 30"
Cohesion: 0.17
Nodes (12): scripts, build, check, deploy:development, deploy:development:control-plane, deploy:development:runtime, format, format:check (+4 more)

### Community 31 - "Community 31"
Cohesion: 0.17
Nodes (11): dependencies, yaml, exports, default, types, license, name, private (+3 more)

### Community 32 - "Community 32"
Cohesion: 0.22
Nodes (8): AggregatedReview, AggregatedReviewFinding, attempt, configured, head, aggregateReviews(), reviewers, WorkflowReview

### Community 33 - "Community 33"
Cohesion: 0.18
Nodes (11): devDependencies, prettier, @types/node, typescript, vitest, wrangler, prettier, @types/node (+3 more)

### Community 34 - "Community 34"
Cohesion: 0.29
Nodes (5): AttemptContainerEnv, saveWorkspaceBackup(), workspaceBackup(), D1Like, UiAuthEnv

### Community 36 - "Community 36"
Cohesion: 0.22
Nodes (9): compilerOptions, lib, outDir, rootDir, tsBuildInfoFile, ES2023, lib, ES2023 (+1 more)

### Community 37 - "Community 37"
Cohesion: 0.28
Nodes (8): __BaseEnv_Env, Cloudflare, Env, GlobalProps, *.js, NodeJS, ProcessEnv, StringifyValues

### Community 38 - "Community 38"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, tsBuildInfoFile, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 39 - "Community 39"
Cohesion: 0.22
Nodes (8): exports, default, types, license, name, private, type, version

### Community 40 - "Community 40"
Cohesion: 0.25
Nodes (8): types, compilerOptions, outDir, rootDir, tsBuildInfoFile, types, @cloudflare/workers-types, @cloudflare/workers-types

### Community 41 - "Community 41"
Cohesion: 0.25
Nodes (7): engines, node, license, name, packageManager, private, version

### Community 42 - "Community 42"
Cohesion: 0.25
Nodes (3): Container, ContainerProxy, outboundParams

### Community 43 - "Community 43"
Cohesion: 0.38
Nodes (3): acceptGitHubIssueClosed(), GitHubCancellationRepository, runId()

### Community 44 - "Community 44"
Cohesion: 0.29
Nodes (6): visualFeedbackProfile(), runFixture(), compileWorkflow(), outputPaths(), validateCompetitionRoles(), validateGraph()

### Community 45 - "Community 45"
Cohesion: 0.29
Nodes (6): files, generatedFiles, missing, roots, run, sourceExtensions

### Community 47 - "Community 47"
Cohesion: 0.33
Nodes (5): extends, include, src/**/*.ts, references, worker-configuration.d.ts

### Community 48 - "Community 48"
Cohesion: 0.47
Nodes (5): advanceWorkflow(), defaultIssueWorkflowSource, evaluateWorkflowCondition(), selectWorkflowTransition(), commit

### Community 49 - "Community 49"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, references

### Community 50 - "Community 50"
Cohesion: 0.50
Nodes (4): __BaseEnv_Env, Cloudflare, Env, GlobalProps

### Community 51 - "Community 51"
Cohesion: 0.40
Nodes (4): ApiResponseDetails, ApiResponseLogEntry, ApiResponseLogWriter, ApiResponseObserverOptions

### Community 52 - "Community 52"
Cohesion: 0.40
Nodes (3): DurableObject, RpcTarget, WorkerEntrypoint

### Community 57 - "Community 57"
Cohesion: 0.24
Nodes (11): callbackForCompletion(), acceptCallback(), BranchChangedError, bytesToHex(), callbackPayload(), CheckpointRejectedError, encoder, signCallback() (+3 more)

## Knowledge Gaps
- **297 isolated node(s):** `name`, `version`, `license`, `private`, `type` (+292 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `observeResponse()` connect `Community 5` to `Community 0`, `Community 1`, `Community 35`, `Community 4`, `Community 8`, `Community 9`, `Community 11`, `Community 13`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Why does `D1RunRepository` connect `Community 1` to `Community 2`, `Community 3`, `Community 4`, `Community 7`, `Community 13`, `Community 14`, `Community 15`, `Community 21`, `Community 24`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Why does `RunSnapshot` connect `Community 18` to `Community 1`, `Community 2`, `Community 3`, `Community 7`, `Community 9`, `Community 12`, `Community 13`, `Community 14`, `Community 15`, `Community 17`, `Community 19`, `Community 20`, `Community 23`, `Community 24`, `Community 25`, `Community 26`, `Community 28`, `Community 43`, `Community 46`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **What connects `name`, `version`, `license` to the rest of the system?**
  _297 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05465346534653465 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05509518477043673 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.051590483827853514 - nodes in this community are weakly interconnected._