# Vanta

> Chat with your data. Get answers, not dashboards.

A chat-driven analytics platform: upload a CSV/Excel file or connect a
database, ask a question in plain English, and the assistant writes
code, runs it, and explains the answer. 20+ chart types, 13 LLMs
(paid + free), 8 connectors, dashboards, teams.

## 📖 See [`PROJECT.md`](PROJECT.md) for everything.

Architecture, feature matrix, connector details, thinking-mode flow,
port + env reference, full API listing, security notes, rollback.

## Quick start

```bash
npm install
( cd back_end/Chart-API-main && python -m venv venv && ./venv/Scripts/pip install -r requirements.txt )
npm run dev
```

- `npm run dev` — full stack in parallel
- `npm run smoke` — health-check every service
- `http://localhost:3000` — app

---

Repository: [github.com/Aymona777/Data-Vanta](https://github.com/Aymona777/Data-Vanta).
