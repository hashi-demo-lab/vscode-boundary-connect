# Tasks: CI/CD Pipeline Setup

**Input**: Design documents from `/specs/001-005-cicd-pipeline-setup/`
**Prerequisites**: plan.md (complete), spec.md (complete)

**Tests**: Workflow validation tests included for CI/CD verification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create workflows directory and verify existing prerequisites

- [ ] T001 Create `.github/workflows/` directory if not exists
- [ ] T002 [P] Fix existing lint errors in source code before CI setup
- [ ] T003 [P] Verify npm scripts work locally (lint, compile, test)

---

## Phase 2: User Story 1 - CI Pipeline (Priority: P1) 🎯 MVP

**Goal**: Automated PR validation with lint, type-check, test, and build

**Independent Test**: Create a PR and verify all checks run automatically

### Validation for User Story 1

- [ ] T004 [US1] Run `npm run lint` locally to verify linting works
- [ ] T005 [US1] Run `tsc --noEmit` locally to verify type checking works
- [ ] T006 [US1] Run `npm test -- --coverage` locally to verify tests with coverage work
- [ ] T007 [US1] Run `npm run compile` locally to verify build works

### Implementation for User Story 1

- [ ] T008 [US1] Create CI workflow file at `.github/workflows/ci.yml`:
  - Trigger on `push` to main and `pull_request` to main
  - Setup Node.js 20 with npm caching
  - Run: npm ci, lint, type-check, test, build
  - Upload coverage artifact
- [ ] T009 [US1] Test CI workflow by pushing to branch

**Checkpoint**: At this point, PRs should run automated checks

---

## Phase 3: User Story 2 - Release Pipeline (Priority: P2)

**Goal**: Automated release packaging on version tags

**Independent Test**: Push a version tag and verify GitHub Release is created with .vsix

### Validation for User Story 2

- [ ] T010 [US2] Run `npm run package` locally to verify VSCE packaging works

### Implementation for User Story 2

- [ ] T011 [US2] Create Release workflow file at `.github/workflows/release.yml`:
  - Trigger on `push` tags matching `v*`
  - Setup Node.js 20 with npm caching
  - Run: npm ci, compile, package
  - Create GitHub Release with .vsix artifact attached

**Checkpoint**: At this point, tagged versions should auto-release

---

## Phase 4: User Story 3 - Quality Pipeline (Priority: P2)

**Goal**: Security audit and coverage reporting

**Independent Test**: Verify npm audit runs and coverage uploads to Codecov

### Validation for User Story 3

- [ ] T012 [US3] Run `npm audit` locally to verify security audit works

### Implementation for User Story 3

- [ ] T013 [US3] Create Quality workflow file at `.github/workflows/quality.yml`:
  - Trigger on `push` and `pull_request`
  - Run: npm ci, npm audit (with continue-on-error for warnings)
  - Run tests with coverage
  - Upload coverage to Codecov using codecov/codecov-action@v4
  - Add dependency-review-action for PR dependency scanning

**Checkpoint**: At this point, PRs should show security audit results and coverage

---

## Phase 5: User Story 4 - Dependabot Configuration (Priority: P3)

**Goal**: Automated dependency update PRs for npm packages

**Independent Test**: Verify Dependabot creates PRs for outdated packages

### Implementation for User Story 4

- [ ] T014 [P] [US4] Update `.github/dependabot.yml` to add npm ecosystem:
  - Add npm package ecosystem monitoring
  - Configure weekly schedule
  - Set directory to root "/"

**Checkpoint**: Dependabot should monitor npm dependencies

---

## Phase 6: User Story 5 - Status Badges (Priority: P3)

**Goal**: README displays CI status and coverage badges

**Independent Test**: View README and verify badges show correct status

### Implementation for User Story 5

- [ ] T015 [US5] Check if README.md exists, create minimal one if not
- [ ] T016 [US5] Add CI status badge to README.md
- [ ] T017 [P] [US5] Add Codecov coverage badge to README.md

**Checkpoint**: README shows project health at a glance

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Finalization and documentation

- [ ] T018 [P] Add optional coverage threshold configuration to jest.config.js
- [ ] T019 [P] Commit all workflow files and push to branch
- [ ] T020 Run full CI validation by creating test PR
- [ ] T021 Update GitHub issue with completion status

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **User Story 1 (Phase 2)**: Depends on Setup - Core CI is foundation
- **User Story 2 (Phase 3)**: Can run in parallel with US3 after US1 setup
- **User Story 3 (Phase 4)**: Can run in parallel with US2 after US1 setup
- **User Story 4 (Phase 5)**: Independent - can run any time after Setup
- **User Story 5 (Phase 6)**: Depends on US1 for badge URL
- **Polish (Phase 7)**: Depends on all user stories being complete

### Within Each User Story

- Local validation tasks before implementation
- Create workflow file
- Test workflow by triggering appropriate event

### Parallel Opportunities

- T002 and T003 can run in parallel (Setup phase)
- T004-T007 can all run in parallel (US1 validation)
- US2, US3, US4 can all proceed in parallel after US1 is started
- T016 and T017 can run in parallel (US5 badges)
- T018 and T019 can run in parallel (Polish phase)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: User Story 1 (CI Pipeline)
3. **STOP and VALIDATE**: Push to branch, verify CI runs
4. Continue with remaining user stories

### Incremental Delivery

1. Setup + US1 → Core CI working
2. Add US2 → Release automation working
3. Add US3 → Quality monitoring working
4. Add US4 → Dependabot configured
5. Add US5 → Badges visible
6. Polish → All documentation complete

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Workflow files are YAML - validate syntax before committing
- GitHub Actions uses ubuntu-latest runners
- Node.js 20 LTS is the standard runtime
- npm caching speeds up all workflows
- Coverage thresholds are optional but recommended
