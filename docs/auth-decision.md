# Authentication consolidation decision (before implementation)

Reviewed 2026-10-15: PR #1, `saish` (`087b5f5cd5f9cdce0bc66cb8e4b68b4c766712f1`)
into `main` (`4eb85fb087eaa07f2ac1b86257a327ea62624936`). The PR's one commit
adds/changes six files relative to its merge base; it does not deliberately delete
the patient/case work added independently on main. GitHub reports conflicts.
The complete three-dot diff and both branch snapshots were inspected.

## Decision: A — retain main, selectively incorporate saish ideas

Main has the reusable foundation: typed SQLAlchemy models, central Pydantic
settings, PyJWT/Argon2, authentication dependencies, server-side permissions,
normalized unique email registration, and patient/case/image APIs. Keep those.
Saish contributes useful JSON-login and CORS integration ideas, and explicitly
identifies the four intended roles. Reimplement those within the existing modules.
Do not introduce its second security stack, database configuration, or User model.

Main defects: doctor/admin/researcher roles omit Data Scientist and mismatch React;
JWT claims are not required; no session revocation, profile API, audit logs,
migrations, CORS middleware, or tests. Configuration example suggests SQLite and a
published signing key. React auth/cases are mocks and the Vite proxy strips /api.

Saish defects: unrestricted role self-assignment including Administrator; plaintext
string schemas without email/password constraints; published fallback signing key;
no token decoder, protected route dependency, RBAC enforcement, inactive-user
check, profile/session API, audit logs, migrations, or tests. SQLite's connection
argument is passed even for PostgreSQL. The requirements file does not declare
passlib, bcrypt, or python-jose despite importing them. Login lacks the frontend's
user object; registration lacks its token/user envelope. Its users schema cannot
replace main's schema without a data migration.

## Scope and policy

The user-supplied requirements are the available specification. No separate official
specification, tests, or AGENTS.md exists in either branch. Do not claim a detailed
permission matrix is mandated by Infosys. Preserve main's permissions with
doctor -> Clinician, researcher -> Researcher, admin -> Admin. Add DataScientist
as a case reader, consistent with the existing frontend's research/model role;
patient records and clinical writes remain Clinician/Admin only. All four roles
can manage their own profile/session. Admin alone manages accounts and reads audit
events. Model administration remains a future backend feature.

Public registration will default to Clinician as main does, allow the three named
non-admin roles, and reject Admin/unknown roles. Deployment must restrict signup
or introduce approval before handling real clinical data. Preserve JSON registration
returning a user and form login; add JSON login with the same token/user response.
The React adapter will register then log in, map full_name -> name, and restore
identity from /auth/me. Logout/password changes invalidate all tokens for that user.

Use PostgreSQL + psycopg as the primary database; allow SQLite only in explicit test
mode, with foreign keys enabled. Introduce Alembic baseline and additive upgrade,
including role normalization and a constraint. Never auto-migrate unknown existing
databases, and do not silently import saish bcrypt hashes into Argon2. Document its
separate credential migration/reset requirement. No destructive data change is
authorized or planned.

Validation planned: dependency install, application startup, SQLite integration
tests, PostgreSQL tests if access is available, legacy-schema upgrade preserving
patient/case/user data, JWT negative cases, all-role authorization, image regression,
frontend contract tests/build/lint. Results will be recorded only after execution.
