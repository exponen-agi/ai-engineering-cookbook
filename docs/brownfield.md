# Brownfield Workflow Guide

Brownfield development is modifying, expanding, or fixing an existing codebase. The critical priority in brownfield development is **safety**—ensuring new features do not regress existing functionality, database migrations are backwards-compatible, and new code respects the established architecture.

---

## 🗺 Brownfield Workflow Overview

```mermaid
sequenceDiagram
    autonumber
    actor Developer
    participant Agent as Coding Agent

    Developer->>Agent: Run CI / Test suite (Ensure green baseline)
    Developer->>Agent: Run Brownfield Bootstrap & Risk Assessment
    Developer->>Agent: /speckit-constitution (Capture constraints)
    Developer->>Agent: /speckit-specify (Define feature delta)
    Developer->>Agent: /speckit-clarify (Check backward compatibility — optional gate)
    Developer->>Agent: /speckit-plan (Design without adding new deps)
    Developer->>Agent: /speckit-tasks (Generate tasks.md)
    Developer->>Agent: /speckit-implement (Verify green baseline, then TDD per task)
    Agent->>Developer: Tasks complete, run regression suite
    Developer->>Agent: /speckit-converge (Did the code actually meet the spec?)
```

Spec-Kit runs the whole loop. [Superpowers](https://github.com/obra/superpowers)
is an optional TDD discipline layer on top — see
[Greenfield: Optional Superpowers TDD discipline](./greenfield.md#optional-superpowers-tdd-discipline).

---

## 🚀 Step-by-Step Command Sequence

### Step 0: Confirm the Baseline

Before running any Spec-Kit commands, run the codebase's existing tests.

```bash
# Example test run commands
npm test
# OR
pytest
```

> [!WARNING]
> If any existing tests fail, **STOP**. You must fix the baseline or resolve environment issues before starting. Implementing a feature on top of a broken codebase makes it impossible for AI agents to verify their own changes.

---

### Step 1: Bootstrapping & Setup

If this is your first time adopting Spec-Kit on the repository, install the
[Brownfield Bootstrap](https://speckit-community.github.io/extensions/brownfield)
extension and run its scan, then its bootstrap step (`speckit.brownfield.scan`,
then `speckit.brownfield.bootstrap` — type them with your agent's
[prefix](./installation.md#the-prefix-depends-on-your-agent)).

*This discovers the architecture and drafts a constitution tailored to it.*

Next, run [BrownKit](https://speckit-community.github.io/extensions/brownkit)
to assess risk, starting with `speckit.brownkit.init`.

*Produces an evidence-based list of what the codebase does, with a security and QA risk assessment — including fragile areas such as database migrations and billing handlers.*

---

### Step 2: Set the Constitution

Capture constraints discovered in Step 1. Save these in `.specify/memory/constitution.md`.

```
/speckit-constitution Capture our existing project constraints:
  - Tech stack: Node.js 20, Express 4.x, PostgreSQL via Knex.js
  - Do not modify: src/database/migrations/ (DBA approval required)
  - Testing: Jest with Supertest for API integration tests
  - Coverage threshold: 80%
  - Branch naming convention: NNN-kebab-slug
```

---

### Step 3: Specify the Change (As a Delta)

Describe the feature not as a greenfield application, but as a change to the current system.

```
/speckit-specify Add user authentication using JWT tokens.
Extend the existing User model schema.
Users log in by POSTing email/password to /auth/login.
On successful login, return a JWT token in an httpOnly cookie.
On failed login, return 401 without revealing if the email exists.
```

*Creates: `.specify/specs/001-user-auth/spec.md`*

---

### Step 4: Run Clarification Q&A

Focus questions on backward-compatibility, token expiry, database migration scripts, and SDK behaviors.

```
/speckit-clarify
```

---

### Step 5: Plan within Constraints

Specify that the agent must use the existing db clients and libraries, and must avoid introducing new packages unless approved.

```
/speckit-plan Use existing libraries (bcryptjs, jsonwebtoken) already in package.json.
```

*Creates: `.specify/specs/001-user-auth/plan.md`*

---

### Step 6: Generate Tasks

```
/speckit-tasks
```

*Creates: `.specify/specs/001-user-auth/tasks.md`*

---

## ⚙️ Implement and Converge

### Step 7: Implement the Tasks

Run `/speckit-implement` with the brownfield rules as extra instructions. The key
instruction is to **verify the baseline passes before modifying any files**.

```text
/speckit-implement
  Constraints:
  - Do not generate a new plan; tasks.md is authoritative
  - Do not create a new git branch (already created by Spec-Kit as 001-user-auth)
  - Verify that all existing tests pass BEFORE touching any files
  - Follow the tech stack and protected modules in .specify/memory/constitution.md
  - Do not introduce new dependencies without explicit approval
  - All changes must be backward compatible
```

### Step 8: Converge

```text
/speckit-converge
```

If it appends new tasks, run `/speckit-implement` again, then converge again,
until it reports **Converged**.

---

## 📝 Real-World Example: Express.js JWT Auth

Here is how the Spec-Kit files map to the existing Express app structure:

### 1. Specification (`spec.md`)

```markdown
# Spec: Express JWT Authentication

## Delta Definition
- Add `/auth/login` endpoint (POST).
- Modify user schema to support hashed passwords.
- Protect existing `/api/users/profile` using an authentication middleware.

## Acceptance Criteria
- **Given** a user exists with email `test@test.com` and password `password123`, **when** I POST `{"email": "test@test.com", "password": "password123"}` to `/auth/login`, **then** the response status is 200 and a cookie named `token` is present in the response headers.
- **Given** I call a protected API route without a valid cookie, **when** I make a GET request to `/api/users/profile`, **then** the response status is 401.
```

### 2. Technical Plan (`plan.md`)

```markdown
# Plan: Express JWT Authentication

## Pre-Flight Risk Check
- Modifying `src/models/User.js` could break existing user creation scripts.
- Verification: Keep password hashing optional/backward-compatible during schema migration.

## Proposed Code Changes
- [NEW] `src/middleware/auth.js` - JWT validation middleware.
- [NEW] `src/controllers/authController.js` - Login handler.
- [MODIFY] `src/models/User.js` - Add helper method `comparePassword()`.
- [MODIFY] `src/app.js` - Import and register auth routes.
```

### 3. Checklist (`tasks.md`)

```markdown
- [ ] Task 1: Write integration tests in `tests/auth.test.js` to assert login endpoint failures.
- [ ] Task 2: Implement password comparison on the User model.
- [ ] Task 3: Implement `/auth/login` route controller and token cookie generation.
- [ ] Task 4: Write unit tests for the JWT authentication middleware.
- [ ] Task 5: Implement `auth.js` middleware.
- [ ] Task 6: Apply middleware to protect `/api/users/profile` and write integration tests.
```

---

## 🛡️ Post-Implementation Safety Gate

In brownfield projects, we use **Ripple** to scan for hidden coupling. After all tasks in `tasks.md` are marked green, run its scan (`speckit.ripple.scan`, with your agent's prefix).

The [Ripple](https://speckit-community.github.io/extensions/ripple) extension will analyze the files you changed (`User.js`, `app.js`, etc.) and find dependent modules that weren't touched but might break (e.g. user seed scripts, admin dashboard pages, billing routes). This ensures 100% confidence before merging.

---

### 📖 Next Steps

- Review the 20 Curated Extensions: [Extensions Guide](./extensions.md)
- Set up the AI-Native flywheels: [AI Governance Guide](./governance.md)
- Get set up in 5 minutes: [Quickstart Guide](../QUICKSTART.md)
