#!/usr/bin/env node
/**
 * One-command dev orchestrator.
 * 1. Starts infra via docker-compose (datalakehouse + user-auth postgres)
 * 2. Waits for health on each infra dependency
 * 3. Starts user-auth, Chart-API, and the Next.js frontend in parallel
 *
 * Usage: from repo root → `npm run dev`
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const isWindows = process.platform === "win32";
const shell = isWindows; // use the shell to resolve .bat/.cmd on Windows

function run(cmd, args, opts = {}) {
    return spawn(cmd, args, { stdio: "inherit", shell, ...opts });
}

function tag(label, color) {
    const reset = "\x1b[0m";
    const colors = {
        cyan: "\x1b[36m",
        magenta: "\x1b[35m",
        green: "\x1b[32m",
        yellow: "\x1b[33m",
        blue: "\x1b[34m",
    };
    return `${colors[color] || ""}[${label}]${reset}`;
}

async function checkHealth(url, label, { retries = 60, interval = 1000 } = {}) {
    for (let i = 0; i < retries; i += 1) {
        try {
            const res = await fetch(url);
            if (res.ok) {
                console.log(`${tag(label, "green")} ✓ ready`);
                return true;
            }
        } catch {
            // not up yet
        }
        await delay(interval);
    }
    console.warn(`${tag(label, "yellow")} ⚠ health check timed out at ${url} — continuing anyway`);
    return false;
}

async function main() {
    console.log(`${tag("vanta", "cyan")} starting infra…`);

    // After the DuckDB refactor the only infra we need is the user-auth
    // Postgres. The old data-lakehouse compose (Spring/Spark/RabbitMQ/
    // MinIO/Redis/Iceberg-Postgres) is retired — see
    // back_end/datalakehouse-main/DEPRECATED.md for rollback instructions.
    const authDbUp = run("docker-compose", [
        "-f",
        "back_end/user-auth-main/docker-compose.yml",
        "up",
        "-d",
    ]);
    await new Promise((resolve) => authDbUp.on("exit", resolve));

    console.log(`${tag("vanta", "cyan")} infra ready. Starting native services…`);

    // Native services (frontend, user-auth, chart-api)
    const proc = run("npm", ["run", "dev:native"]);

    // Poll health (non-blocking — orchestrator keeps running)
    checkHealth("http://localhost:5000/health", "auth");
    checkHealth("http://localhost:8000/health", "chart");
    checkHealth("http://localhost:3000/", "front");

    const stop = () => {
        console.log(`\n${tag("vanta", "yellow")} shutting down…`);
        if (!proc.killed) proc.kill("SIGTERM");
        const down = run("docker-compose", [
            "-f",
            "back_end/user-auth-main/docker-compose.yml",
            "down",
        ]);
        new Promise((resolve) => down.on("exit", resolve)).then(() => process.exit(0));
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
