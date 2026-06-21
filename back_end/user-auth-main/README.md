# user-auth

user-auth — authentication & authorization microservice

This project is a minimal, production-minded Node.js service that provides user authentication and role/permission based access control using Express and Sequelize (Postgres). It implements:
- User signup / signin, email verification, password reset
- JWT authentication and middleware to protect routes
- Role and Permission models with many-to-many associations
- Files and code structure following controller → service → repository → model

---

## Table of contents

1. Quick start
2. Configuration (.env)
3. Available Scripts
4. Architecture & key modules
5. Database & models
6. Seeding & verification scripts
7. API Reference (short) — Auth, Users, Roles, Permissions, Teams, Profiles
8. Typical Postman examples
9. Troubleshooting
10. Recommendations (migrations / tests)
11. Contributing
12. License

---

## Quick start

Prerequisites
- Node.js >= 18
- Postgres instance accessible using a connection string in `.env`

1. Clone the repository and install dependencies:

```bash
git clone <repo-url>
cd user-auth
npm install
```

2. Create and fill a `.env` file (see next section – DB_STRING and JWT_SECRET are required).

3. Start the server (development):

```bash
npm start
```

While the app uses `sequelize.sync({ alter: true })` to create/update tables on boot (useful for development), it's recommended to use migrations for production (see Recommendations section).

---

## Pre-test configuration (.env and DB)

Create a `.env` file in the project root with at minimum these values (example):

```env
PORT=3000
URL=http://localhost:3000
NODE_ENV=development
DB_STRING=postgres://postgres:password@localhost:5432/user_auth
DB_STRING_PROD=postgres://postgres:password@yourprod:5432/user_auth
JWT_SECRET=replace-with-secure-string
EMAIL_USER=your@email.com
APP_PASS=email-app-password
```

Make sure your Postgres server is running and reachable using the connection string. The app uses `sequelize` to manage connections.

---

## Pre-test & helper scripts


Common tasks you will run when preparing to test the application:

- npm start — start the server (runs sequelize.sync by default)
- npm run seed — create sample roles & permissions (Admin & User and example permissions)
- npm run check:associations — quick smoke-check for Role <-> Permission linking

Run scripts from the project root. Example:

```bash
npm run seed
npm run check:associations
```
user-auth — Authentication & Authorization microservice

- User signup / sign-in, email verification, password reset
- JWT authentication and middleware to protect routes
- Role and Permission models with many-to-many associations
- Files and code structure following controller → service → repository → model
This project is a production-minded Node.js microservice that provides user authentication, authorization and role/permission management using Express and Sequelize (Postgres). Key capabilities:

- User signup / sign-in, email verification, password reset
- JWT authentication with middleware and role-based route restrictions
- Role and Permission models, connected via a many-to-many join table (RolePermission)
- Organized layers: routes → controllers → services → repositories → models

1. Clone the repository and install dependencies (local development):

2. Create and fill a `.env` file (example below). At minimum set `DB_STRING` and `JWT_SECRET`.

3. Start the server (development):

```bash
npm start
```
- Controllers: `src/api/*/*.controller.js`
Create a `.env` file in the project root with the following minimum values (example):
- Repositories: `src/api/*/*.repository.js`
The server reads `.env` automatically. Ensure your Postgres database is running and reachable via the `DB_STRING` connection string.

Common tasks you will run when preparing to test the application (local):

Note: `npm run seed` expects the DB configured and available. If tables are missing, the seeder calls `sequelize.sync({ alter: true })` before creating data. This behavior is DEV-only — consider migrations for production.
- `src/index.js` — startup, model loader and sequelize.sync
Primary code layout

## Minimal pre-test checklist

1. Create `.env` and set `DB_STRING` and `JWT_SECRET` (see sample above).

2. Start Postgres and ensure the DB is reachable.

3. Start the server once: `npm start` (this runs `sequelize.sync({ alter: true })`) or run `npm run seed` to sync + seed initial roles/permissions.

4. Use `npm run check:associations` to verify Role ↔ Permission associations are working.
2. Start Postgres and ensure the DB is accessible.
If `rolepermissions` or other tables are missing, start the server or run the seeder — both call `sequelize.sync({ alter: true })` in development mode.
4. Use `npm run check:associations` to verify Role ↔ Permission associations work.
- POST /auth/signup — register user. Body: { name, email, password }
- POST /auth/signin — login. Body: { email, password } → returns token and sets `x-auth-token` header
- GET /auth/verify-email?token=TOKEN — verify account (EJS render)
- POST /auth/forget-password — request reset email. Body: { email }
- GET /auth/reset-password?token=TOKEN — render reset form (EJS)
- POST /auth/change-password?token=TOKEN — change via reset token. Body: { password }
Auth endpoints (public)

- POST /auth/signup — register a user
  - Body: { name, email, password }
  - Result: sends verification email and creates user (isVerified=false)

- POST /auth/signin — login
  - Body: { email, password }
  - Result: returns { token, user } and sets `x-auth-token` header

- GET /auth/verify-email?token=TOKEN — verify account (email link, EJS view)

- POST /auth/forget-password — request a password reset email
  - Body: { email }

- GET /auth/reset-password?token=TOKEN — show reset page (EJS)

- POST /auth/change-password?token=TOKEN — complete password reset
  - Body: { password }
Users endpoints (protected)

- GET /user/ — list users (Admin)
  - Auth: x-auth-token — Admin only
  - Response: array of user objects

- GET /user/:id — get user by id
  - Auth: x-auth-token — Admin or the user (self) allowed

- PUT /user/:id — update user
  - Auth: x-auth-token — user updating own profile
  - Body: fields to update (name, email, password, ...)

- DELETE /user/:id — delete user
  - Auth: x-auth-token — Admin or the user themselves
Use `psql` or your DB GUI to inspect created tables (`users`, `roles`, `permissions`, `rolepermissions`, ...).
Roles (Admin)
- POST /role — create role. Body: { name }
- GET /role — list roles (includes permissions)
- GET /role/:role_id — get role (includes permissions)
- PUT /role/:role_id — update role
- DELETE /role/:role_id — delete role

Role permissions
- POST /role/:role_id/permissions — attach single permission. Body: { perm_id }
- POST /role/:role_id/permissions/bulk — attach multiple. Body: { perm_ids: [1,2] }
- DELETE /role/:role_id/permissions/:perm_id — remove permission
Important models and relationships:
- POST /profile — create profile (body validated)
- GET /profile/me — get own profile (auth)
- GET /profile/:id — get profile (role-check applies)
- POST /profile/:id — update profile (role-check applies)
- PUT /profile/:id/password — change password
- POST /profile/:id/profile-picture — upload picture

Profile endpoints
- POST /profile — create profile (body validated)
- GET /profile/me — get own profile (auth)
- GET /profile/:id — get profile by id (role-check applies)
- POST /profile/:id — update profile (role-check applies)
- PUT /profile/:id/password — change password for user (role-check applies)
- POST /profile/:id/profile-picture — upload picture (multipart)
- User
- POST /team — create team
- GET /team — list teams
- GET /team/:team_id — get single team (team_view check)
- PUT /team/:team_id — update team (team_update check)
- DELETE /team/:team_id — delete team

Team endpoints
- POST /team — create team
- GET /team — list teams
- GET /team/:team_id — get single team (team_view permission check)
- PUT /team/:team_id — update team (team_update permission check)
- DELETE /team/:team_id — delete team (team_delete permission check)
- Role
Sign in (get token)
- Permission
## Troubleshooting — quick (common problems)
- RolePermission (join table)
• DB connection failure — check `.env` variable `DB_STRING` and confirm Postgres instance is running.

• Missing tables — `npm start` or `npm run seed` will create missing tables in dev. Consider migrations for production.
- Role.belongsToMany(Permission, { through: RolePermission })
• Eager-loading error (Permission is not associated to Role) — ensure the app startup loads `rolePermission` model and restart server.

• Unauthorized / token expiry — pass `x-auth-token` header with a current token and ensure `isVerified=true`.

## Next steps and optional improvements

• For production: replace `sequelize.sync({ alter: true })` with Sequelize migrations and a CI-driven release process.

• Add automated integration tests (e.g., Jest + supertest) and a CI pipeline.
- Smoke-check: `npm run check:associations` will create temporary resources and verify Role-Permission linking (useful to confirm association are functional in your DB/environment).
• Consider fine-grained RBAC where middleware checks `permissions` (not only role names).

---

## API endpoints (compact)

Base path: `/api/v1`

Auth (public)
- POST /auth/signup — register user. Body: { name, email, password }
- POST /auth/signin — login. Body: { email, password } → returns token and sets `x-auth-token` header
- GET /auth/verify-email?token=TOKEN — verify account (EJS render)
- POST /auth/forget-password — request reset email. Body: { email }
- GET /auth/reset-password?token=TOKEN — render reset form (EJS)
- POST /auth/change-password?token=TOKEN — change via reset token. Body: { password }

Users (protected)
- GET /user/ — list users (Admin)
- GET /user/:id — get user by id (Admin or self)
- PUT /user/:id — update user (self)
- DELETE /user/:id — delete (Admin or self)

Roles (admin)
- POST /role — create role. Body: { name }
- GET /role — list roles (includes permissions)
- GET /role/:role_id — get role (includes permissions)
- PUT /role/:role_id — update role
- DELETE /role/:role_id — delete role

Role permissions
- POST /role/:role_id/permissions — attach single permission. Body: { perm_id }
- POST /role/:role_id/permissions/bulk — attach multiple. Body: { perm_ids: [1,2] }
- DELETE /role/:role_id/permissions/:perm_id — remove permission

Permissions (admin)
- POST /permission — create permission. Body: { name }
- GET /permission/:perm_id — get permission
- PUT /permission/:perm_id — update permission
- DELETE /permission/:perm_id — delete permission

Profile
- POST /profile — create profile (body validated)
- GET /profile/me — get own profile (auth)
- GET /profile/:id — get profile (role-check applies)
- POST /profile/:id — update profile (role-check applies)
- PUT /profile/:id/password — change password
- POST /profile/:id/profile-picture — upload picture

Team
- POST /team — create team
- GET /team — list teams
- GET /team/:team_id — get single team (team_view check)
- PUT /team/:team_id — update team (team_update check)
- DELETE /team/:team_id — delete team (team_delete check)

Team members
- POST /team/:team_id/members — add member (member_add)
- GET /team/:team_id/members — list members (team_view)
- PUT /team/:team_id/members/:user_id/role — update member role (member_role_update)
- DELETE /team/:team_id/members/:user_id — remove member (member_remove)

Auth header reminder: protected routes require a valid JWT in `x-auth-token`. Auth middlewares also require `isVerified` user.

---

## Example requests (Postman / curl)

Sign in (get token)

POST http://localhost:3000/api/v1/auth/signin
Body:
```json
{
  "email": "admin@example.com",
  "password": "password123"
}
```

2. Create a new permission (Admin token required)

POST http://localhost:3000/api/v1/permission
Headers: x-auth-token: <ADMIN_TOKEN>
Body:
```json
{ "name": "read:user" }
```

3. Create a role

POST http://localhost:3000/api/v1/role
Headers: x-auth-token: <ADMIN_TOKEN>
Body:
```json
{ "name": "Manager" }
```

Add permission to role (single)

POST http://localhost:3000/api/v1/role/:role_id/permissions
Headers: x-auth-token: <ADMIN_TOKEN>
Body: { "perm_id": <ID> }

Add permissions to role (bulk)

POST http://localhost:3000/api/v1/role/:role_id/permissions/bulk
Headers: x-auth-token: <ADMIN_TOKEN>
Body:
```json
{ "perm_ids": [1, 2, 3] }
```

---

## Troubleshooting — quick

• DB connection failure — check `.env` and Postgres availability.
• Missing tables — run server or `npm run seed` (dev only) to create them.
• Eager-loading error (Permission is not associated to Role) — restart server; model loader ensures associations before sync.
• Unauthorized / token expiry — use `x-auth-token` header with a current JWT; ensure user `isVerified`.

---

## Notes and next steps

• For production: replace `sequelize.sync({ alter: true })` with Sequelize migrations and CI-driven schema deployments.
• Add automated integration tests and a CI pipeline.
• Use explicit permission checks (RBAC) where necessary.

---

If you want, I can generate a Postman collection and a lightweight OpenAPI (Swagger) spec next.

---

## 11) Contributing

Contributions are welcome — please open issues or PRs. For major changes (migrations, tests, new endpoints), add tests and documentation updates to this README.

---

## 12) License

This repository is available under the project license in the repository root (see `LICENSE`).

---

Thanks for using the project — if you'd like, I can also add a complete Postman collection file and a set of automated integration tests to help with CI runs.
