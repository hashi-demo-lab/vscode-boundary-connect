# Implementation Plan: CI/CD Pipeline Setup

**Branch**: `001-005-cicd-pipeline-setup` | **Date**: 2025-12-13 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-005-cicd-pipeline-setup/spec.md`

## Summary

Implement GitHub Actions workflows for continuous integration, automated releases, and quality monitoring for the VS Code Boundary extension. This includes CI pipelines for PR validation (lint, type-check, test, build), automated release packaging on version tags, security auditing, coverage reporting, and Dependabot configuration for npm dependencies.

## Technical Context

**Language/Version**: TypeScript 5.3, Node.js 20 LTS
**Primary Dependencies**: ESLint, Jest, esbuild, vsce (VS Code Extension CLI)
**Storage**: N/A (CI/CD configuration only)
**Testing**: Jest with ts-jest, coverage via Codecov
**Target Platform**: GitHub Actions (ubuntu-latest runners)
**Project Type**: VS Code Extension (single project)
**Performance Goals**: CI pipeline completes in under 5 minutes
**Constraints**: Must work with existing npm scripts, must not break existing development workflow
**Scale/Scope**: 3 workflow files, 1 config update, 1 README update

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **Simplicity**: Uses GitHub Actions built-in features, no custom actions required
✅ **Standard Patterns**: Follows GitHub Actions best practices and VS Code extension publishing conventions
✅ **Minimal Scope**: Only creates necessary workflow files, no changes to application code
✅ **Configuration-Only**: No application logic changes, purely infrastructure configuration

## Project Structure

### Documentation (this feature)

```text
specs/001-005-cicd-pipeline-setup/
├── spec.md              # Feature specification (complete)
├── plan.md              # This file (implementation plan)
└── tasks.md             # Phase 2 output (to be created)
```

### Source Code (repository root)

```text
.github/
├── workflows/
│   ├── ci.yml           # NEW - CI pipeline for PRs and main branch
│   ├── release.yml      # NEW - Release pipeline for version tags
│   └── quality.yml      # NEW - Security audit and coverage pipeline
├── dependabot.yml       # UPDATE - Add npm ecosystem monitoring
└── ...                  # Existing agent/prompt files (unchanged)

README.md                # UPDATE - Add CI status and coverage badges
jest.config.js           # UPDATE - Configure coverage thresholds
```

**Structure Decision**: Single project structure maintained. CI/CD configuration files added to `.github/workflows/` following GitHub Actions conventions.

## Complexity Tracking

No violations - this feature adds only configuration files with no application code changes.

## Implementation Phases

### Phase 1: Core CI Pipeline (P1)

Create the main CI workflow that runs on PRs and main branch pushes.

**Files to Create**:
- `.github/workflows/ci.yml`

**Key Components**:
1. Trigger on `push` to main and `pull_request` to main
2. Single `build` job with steps: checkout, setup-node, npm ci (cached), lint, type-check, test, build
3. Node.js 20 with npm caching for performance
4. Fail fast on any check failure

### Phase 2: Release Pipeline (P2)

Create the release workflow that packages and publishes on version tags.

**Files to Create**:
- `.github/workflows/release.yml`

**Key Components**:
1. Trigger on `push` tags matching `v*`
2. Build and package the extension using `vsce package`
3. Create GitHub Release using `softprops/action-gh-release`
4. Attach `.vsix` as release artifact

### Phase 3: Quality Pipeline (P2)

Create the quality monitoring workflow for security and coverage.

**Files to Create**:
- `.github/workflows/quality.yml`

**Key Components**:
1. Trigger on `push` and `pull_request`
2. Security audit using `npm audit`
3. Coverage upload to Codecov using `codecov/codecov-action`
4. Dependency review for PRs

### Phase 4: Configuration Updates (P3)

Update existing configuration files.

**Files to Update**:
- `.github/dependabot.yml` - Add npm ecosystem
- `jest.config.js` - Add coverage thresholds (optional)

### Phase 5: Documentation (P3)

Add status badges to README.

**Files to Update**:
- `README.md` - Add CI status and coverage badges

## Test Strategy

Since this is a CI/CD infrastructure feature, testing is verification-based:

1. **Workflow Validation**: Use `actionlint` or GitHub's workflow validation
2. **Local Verification**: Verify npm scripts work locally before CI
3. **Integration Test**: Create test PR to verify CI runs
4. **Release Test**: Push test tag to verify release pipeline
5. **Coverage Verification**: Confirm Codecov integration works

## Dependencies & Prerequisites

1. **GitHub Repository Access**: Workflows need proper permissions
2. **Codecov Account**: Optional - requires CODECOV_TOKEN secret if using private repos
3. **Node.js 20**: Already specified in workflows
4. **Existing npm Scripts**: lint, compile, test, package scripts exist in package.json

## Rollback Strategy

All changes are additive configuration files. Rollback is simple:
1. Delete workflow files to disable CI/CD
2. Revert dependabot.yml changes
3. Remove badges from README

## Open Questions

None - all requirements are clear from the issue specification.
