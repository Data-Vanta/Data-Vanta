Local environment & Postgres setup

1) Copy `./.env.example` to `./.env` and update values if needed:
   - `DB_STRING=postgres://testuser:testpass@localhost:5432/testdb`
   - `JWT_SECRET=your_jwt_secret`

2) Bring up Postgres with Docker Compose:
   docker compose up -d

3) Verify the DB is reachable:
   psql "${DB_STRING}"

4) Start the app:
   npm start

5) Run the process tests (after DB is up):
   npm run test:process:all
