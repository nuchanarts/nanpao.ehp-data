<!--
Sync Impact Report
==================
Version change: 1.0.0 → 1.1.0
Bump rationale: MINOR — merged the "React Web Application Constitution (Enterprise Standard)"
reference; new principles and sections added, existing ones materially expanded. No principle
removed or redefined.

Modified principles:
  - VI. Centralized Business Logic → expanded with strict layering and state-management rules
  - VII. Commit Early, Commit Often → added PR review, CI, and no-direct-push-to-main rules

Added principles:
  - IX. Type Safety (TypeScript Strict)
  - X. Error Handling & Security

Added sections:
  - Documentation & Continuous Improvement

Removed sections: none

Templates reviewed (not modified by this command — they read the constitution at runtime):
  - .specify/templates/plan-template.md      ✅ "Constitution Check" gate picks up principles I–X
  - .specify/templates/spec-template.md      ✅ no conflict
  - .specify/templates/tasks-template.md     ✅ no conflict; tests-first ordering aligns with II

Deferred TODOs: none
-->

# EHP Nan Dashboard Constitution

## Core Principles

### I. Code Quality

- Code MUST be readable first: descriptive names, small single-purpose functions (target ≤ 40
  lines), and no dead or commented-out code merged to `main`.
- Code MUST pass the project linter, formatter, and type checker with zero errors before commit.
  Strict typing is REQUIRED where the language supports it; `any`/untyped escapes MUST be
  justified inline.
- Duplicate logic MUST NOT exist in more than one place (see Principles V and VI).
- Errors MUST be handled explicitly: no silently swallowed exceptions; user-facing failures
  MUST show a clear message, and internal failures MUST be logged with context.
- Secrets, credentials, and patient/personal data MUST NOT be committed to the repository.

**Rationale**: A hospital dashboard is maintained over years by changing staff; quality and
clarity are what keep it safe to change.

### II. Test-Driven Development (NON-NEGOTIABLE)

- Every feature and bug fix MUST follow Red → Green → Refactor: write a failing test, confirm it
  fails for the expected reason, write the minimum code to pass, then refactor with tests green.
- Production code written before its test MUST be deleted and rewritten test-first.
- Required test layers:
  - **Unit tests** for all business logic, calculations, and data transformations.
  - **Component tests** for shared UI components (rendering, states, interactions).
  - **End-to-end tests** (Playwright) for every primary user journey defined in a spec.
- Coverage floor: ≥ 90% line coverage for the centralized business-logic layer; ≥ 80% overall.
- Every bug fix MUST include a regression test that reproduces the bug before the fix.
- Tests MUST be deterministic: no reliance on real time, network, or execution order.

**Rationale**: Dashboard figures inform health decisions; a wrong number is worse than no number.
Tests are the proof that the numbers are right.

### III. User Experience Consistency

- All UI MUST be built from the shared design system: shared design tokens (color, spacing,
  typography, radius) and shared components. Ad-hoc one-off styles are NOT permitted.
- Every data view MUST handle and visually define four states: loading, empty, error, success.
- Charts and data visualizations MUST use a consistent palette, number/date formatting, units,
  and legend placement across the whole app.
- Thai is the primary UI language; dates, numbers, and labels MUST use one shared formatting
  utility so presentation is identical everywhere.
- UI MUST meet WCAG 2.1 AA: keyboard navigable, sufficient contrast, labeled inputs, and
  meaning never conveyed by color alone.
- Layouts MUST be responsive and usable from 360 px mobile width to large desktop screens.

**Rationale**: Users switch between views constantly; consistent patterns reduce misreading of
health data and training cost.

### IV. Performance Requirements

- Page performance budgets (measured on a mid-range device, 4G):
  - Largest Contentful Paint (LCP) ≤ 2.5 s
  - Interaction to Next Paint (INP) ≤ 200 ms
  - Cumulative Layout Shift (CLS) ≤ 0.1
- Initial JavaScript per route MUST stay ≤ 200 KB gzipped; heavy libraries (charts, maps) MUST
  be lazy-loaded.
- Data APIs MUST respond at p95 ≤ 500 ms; large datasets MUST be paginated, aggregated, or
  filtered server-side rather than sent whole to the client.
- Avoid request waterfalls: independent data MUST be fetched in parallel; repeated reads MUST
  be cached with an explicit invalidation strategy.
- Any change that breaks a budget MUST be fixed or justified in the plan's Complexity Tracking
  before merge.

**Rationale**: Hospital staff use the dashboard on shared and older hardware; slow screens get
abandoned.

### V. Reusable Components & Functions

- Before writing new UI or a helper, developers MUST search for an existing component, hook, or
  utility and reuse or extend it.
- Any UI pattern or logic needed in two or more places MUST be extracted into a shared
  component/function — the second use triggers extraction, not the third.
- Shared components MUST be composable (props/children/slots over boolean-flag proliferation),
  documented with usage examples, and covered by tests.
- Shared code lives in clearly named shared locations (e.g. `components/ui`, `hooks`, `lib`);
  feature folders MUST NOT import from other features' internals.

**Rationale**: Reuse keeps behavior consistent (Principle III) and means a fix lands everywhere
at once.

### VI. Centralized Business Logic

- All business rules — indicator calculations, thresholds, status classification, aggregation,
  validation, and permissions — MUST live in a single dedicated domain/service layer.
- UI components MUST NOT contain business rules; they render data and dispatch user intent only.
- Business logic MUST be pure and framework-independent where possible, so it can be unit
  tested without UI, network, or database.
- Constants such as thresholds, codes, and indicator definitions MUST be defined once in a
  central configuration and imported, never re-typed as literals.
- Data access MUST go through one data layer (repositories/API client); components MUST NOT
  call databases or external APIs directly.
- The codebase MUST use a feature-based modular structure with strictly separated layers:
  **UI** (presentation only) → **Business Logic** → **API/Service** → **State Management**.
- Reusable stateful logic MUST be extracted into custom hooks; async state MUST be handled in
  hooks or the service layer, never inline in JSX.
- State: prefer local state before global state; duplicated or derived state MUST NOT be stored;
  global state logic MUST be centralized in one store module.

**Rationale**: When a health indicator's definition changes, it must change in exactly one
place, with tests proving the new behavior.

### VII. Commit Early, Commit Often

- Work MUST be committed at every safe checkpoint: after each Red → Green → Refactor cycle and
  after each completed task. Uncommitted work MUST NOT be left at the end of a session.
- Each commit MUST be small, focused on one logical change, and leave the build and tests green.
- Commit messages MUST follow Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`,
  `docs:`, `chore:`) and describe *why* when it is not obvious.
- Before risky changes (refactors, dependency upgrades, migrations), the current state MUST be
  committed first so it can be restored.
- Commits MUST be pushed to `origin` regularly.
- Feature work MUST happen on a feature branch; direct pushes to `main` are NOT permitted
  (initial repository bootstrap excepted). Changes reach `main` only through a Pull Request
  that has been reviewed and whose CI checks pass.

**Rationale**: Frequent commits are the undo button that prevents mistakes from becoming lost
work.

### VIII. Skill-Assisted Development

Available agent skills MUST be used whenever they apply, so every phase benefits from proven
practices:

| Phase | Skills to use |
|---|---|
| Specify / plan | `speckit-*` workflow, `superpowers:brainstorming`, `superpowers:writing-plans` |
| Implement | `superpowers:test-driven-development`, `vercel-react-best-practices`, `vercel-composition-patterns` |
| UI & charts | `frontend-design`, `dataviz`, `web-design-guidelines`, `vercel-react-view-transitions` |
| Debug | `superpowers:systematic-debugging` |
| Verify | Playwright MCP (E2E), `superpowers:verification-before-completion` |
| Review | `code-review`, `superpowers:requesting-code-review`, `security-review` |
| Deploy / optimize | `deploy-to-vercel`, `vercel-optimize` (only if hosted on Vercel) |

- If a relevant skill exists, it MUST be invoked before starting that kind of work.
- Skills guide *how* work is done; they never override this constitution.

**Rationale**: Skills encode tested workflows; using them consistently raises the quality floor
for every contributor, human or AI.

### IX. Type Safety (TypeScript Strict)

- The application MUST be written in TypeScript with `strict` mode enabled.
- `any` MUST NOT be used; use `unknown` plus narrowing, generics, or precise types instead.
- Every API request and response MUST have a defined interface, validated at the boundary.
- API DTO types MUST be kept separate from UI/domain models, with explicit mapping functions in
  the service layer.
- Shared types MUST live in one centralized types location; component props MUST be typed
  explicitly.

**Rationale**: Health indicator data passes through several layers; types catch shape mismatches
before they reach a chart.

### X. Error Handling & Security

- Error handling MUST be centralized: API errors are normalized into one error shape by the
  service layer, and every async action shows loading, error, and success states.
- Developer logs MUST be separate from user messages; users see friendly Thai messages, never
  stack traces or internal error details. No silent failures.
- Sensitive data (tokens, personal or patient data) MUST NOT be stored in `localStorage` or
  `sessionStorage`.
- All user input MUST be validated and sanitized; secrets MUST come from environment variables
  and never be committed.
- Access MUST be controlled by role-based access control (RBAC) enforced on the server, not only
  hidden in the UI.

**Rationale**: The dashboard handles hospital data; a leak or a misleading error has real-world
consequences.

## Quality Gates

A change MAY be merged to `main` only when all of the following pass:

1. Lint, format, and type checks: zero errors.
2. All unit, component, and E2E tests pass; coverage floors from Principle II are met.
3. Performance budgets from Principle IV are met (or a justified exception is recorded).
4. The four UI states and accessibility checks from Principle III are verified.
5. No duplicated business logic or UI patterns (Principles V and VI).
6. A code review (`code-review` skill or human reviewer) has been completed and findings
   resolved.
7. No secrets or personal/patient data are present in the diff.

## Development Workflow

1. **Specify** — `/speckit-specify` captures the what and why; `/speckit-clarify` resolves
   ambiguity.
2. **Plan** — `/speckit-plan` designs the solution and MUST pass the Constitution Check.
3. **Tasks** — `/speckit-tasks` produces ordered tasks with tests listed before implementation;
   `/speckit-analyze` checks consistency.
4. **Implement** — `/speckit-implement` executes tasks via TDD, committing after each task
   (Principle VII).
5. **Verify & review** — run all quality gates, then review before merging.

## Documentation & Continuous Improvement

- Each feature module MUST include a short README describing its purpose and public API.
- Reusable components MUST include a usage example; API contracts MUST be documented and kept
  current; the architecture diagram MUST be updated when layers or modules change.
- Code MUST favor clarity over cleverness and simplicity over premature optimization; optimize
  only when a measurable need exists (Principle IV).
- Refactor as soon as duplication or complexity appears; remove dead code and technical debt
  proactively. Every change SHOULD leave the codebase cleaner than before.

## Governance

- This constitution supersedes all other development practices and guidance for this project.
  Where a skill, template, or habit conflicts with it, the constitution wins.
- Every plan MUST include a Constitution Check; every review MUST verify compliance. Any
  violation MUST be either fixed or explicitly justified in the plan's Complexity Tracking.
- **Amendments** are made through `/speckit-constitution`, recorded with a Sync Impact Report,
  and committed in their own commit with a `docs: amend constitution to vX.Y.Z` message.
- **Versioning** follows semantic versioning:
  - MAJOR — a principle is removed or redefined in a backward-incompatible way.
  - MINOR — a principle or section is added or materially expanded.
  - PATCH — clarifications and wording fixes with no change in meaning.
- Compliance SHOULD be reviewed at the start of each new feature and whenever the tech stack
  changes.

**Version**: 1.1.0 | **Ratified**: 2026-10-01 | **Last Amended**: 2026-10-01
