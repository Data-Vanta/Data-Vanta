#!/usr/bin/env node
/**
 * Smoke test — hits /health on every service.
 * Exits 0 if all green, 1 otherwise.
 *
 * After the DuckDB refactor the infrastructure checklist shrank to one
 * postgres + three native services. MinIO / RabbitMQ / Spark are gone.
 */
const targets = [
    { name: "frontend", url: "http://localhost:3000/" },
    { name: "user-auth", url: "http://localhost:5000/health" },
    { name: "chart-api", url: "http://localhost:8000/health" },
    { name: "connectors", url: "http://localhost:8000/connectors/types" },
];

const results = await Promise.all(
    targets.map(async (t) => {
        try {
            const res = await fetch(t.url);
            return { ...t, ok: res.ok, status: res.status };
        } catch (e) {
            return { ...t, ok: false, status: "unreachable", error: e.message };
        }
    })
);

let allOk = true;
for (const r of results) {
    const mark = r.ok ? "✓" : "✗";
    console.log(`${mark} ${r.name.padEnd(12)} ${r.url}  →  ${r.status}`);
    if (!r.ok) allOk = false;
}
process.exit(allOk ? 0 : 1);
