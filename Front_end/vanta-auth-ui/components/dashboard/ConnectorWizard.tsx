"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ConnectorIcon, { type ConnectorType } from "./ConnectorIcons";
import { useDashboard } from "./DashboardLayout";

/**
 * Three-step drawer for adding + activating a new connector.
 *   1. Credentials — type-specific form (field schema in CREDENTIAL_FIELDS).
 *   2. Test        — /connectors/:id/test  + /connectors/:id/tables.
 *   3. Ingest      — POST /connectors/:id/ingest, show per-table result.
 */

export interface ConnectorTypeMeta {
    type: ConnectorType;
    label: string;
    description: string;
}

export const CONNECTOR_TYPES: ConnectorTypeMeta[] = [
    { type: "postgres", label: "PostgreSQL", description: "Open-source relational DB." },
    { type: "mysql", label: "MySQL / MariaDB", description: "MySQL 5.7+, MariaDB 10.3+." },
    { type: "mssql", label: "SQL Server", description: "Microsoft SQL Server — needs ODBC driver." },
    { type: "oracle", label: "Oracle", description: "Oracle 12c+, thin driver included." },
    { type: "bigquery", label: "BigQuery", description: "Google Cloud — service-account JSON." },
    { type: "snowflake", label: "Snowflake", description: "User + password (or key-pair)." },
    { type: "redshift", label: "Redshift", description: "AWS — uses the Postgres wire." },
    { type: "mongodb", label: "MongoDB", description: "Collections map to tables." },
];

export interface FieldSchema {
    key: string;
    label: string;
    type?: "text" | "number" | "password" | "textarea";
    placeholder?: string;
    required?: boolean;
    helper?: string;
}

const HOST_PORT_USER_PW = (defaultPort: number): FieldSchema[] => [
    { key: "host", label: "Host", placeholder: "db.example.com", required: true },
    { key: "port", label: "Port", type: "number", placeholder: String(defaultPort), required: true },
    { key: "database", label: "Database", required: true },
    { key: "user", label: "Username", required: true },
    { key: "password", label: "Password", type: "password" },
];

export const CREDENTIAL_FIELDS: Record<ConnectorType, FieldSchema[]> = {
    postgres: HOST_PORT_USER_PW(5432),
    mysql: HOST_PORT_USER_PW(3306),
    mssql: HOST_PORT_USER_PW(1433),
    oracle: [
        { key: "host", label: "Host", required: true },
        { key: "port", label: "Port", type: "number", placeholder: "1521" },
        { key: "service_name", label: "Service name", required: true },
        { key: "user", label: "Username", required: true },
        { key: "password", label: "Password", type: "password" },
    ],
    redshift: HOST_PORT_USER_PW(5439),
    bigquery: [
        { key: "project", label: "Project ID", required: true, placeholder: "my-gcp-project" },
        {
            key: "service_account_json",
            label: "Service account JSON",
            type: "textarea",
            required: true,
            helper: "Paste the full JSON key. Stored encrypted, never returned.",
        },
    ],
    snowflake: [
        { key: "account", label: "Account", required: true, placeholder: "abc-xy12345" },
        { key: "user", label: "User", required: true },
        { key: "password", label: "Password", type: "password", required: true },
        { key: "warehouse", label: "Warehouse" },
        { key: "database", label: "Database" },
        { key: "schema", label: "Schema", placeholder: "PUBLIC" },
        { key: "role", label: "Role" },
    ],
    mongodb: [
        { key: "uri", label: "Mongo URI", placeholder: "mongodb://...", helper: "Either fill this or host/port/database below." },
        { key: "host", label: "Host", placeholder: "localhost" },
        { key: "port", label: "Port", type: "number", placeholder: "27017" },
        { key: "database", label: "Database" },
        { key: "user", label: "Username" },
        { key: "password", label: "Password", type: "password" },
    ],
};

interface RemoteTable {
    schema?: string;
    name: string;
    row_estimate?: number;
}

interface IngestResult {
    table: string;
    rows: number;
    duration_ms: number;
}

export default function ConnectorWizard({
    type,
    isOpen,
    onClose,
    onCompleted,
}: {
    type: ConnectorType;
    isOpen: boolean;
    onClose: () => void;
    onCompleted?: () => void;
}) {
    const meta = useMemo(() => CONNECTOR_TYPES.find((t) => t.type === type)!, [type]);
    const fields = CREDENTIAL_FIELDS[type];

    const router = useRouter();
    const { addAttachment, setCurrentDataset } = useDashboard();

    const [step, setStep] = useState<"creds" | "tables" | "ingest">("creds");
    const [name, setName] = useState<string>(`${meta.label} connection`);
    const [config, setConfig] = useState<Record<string, string>>({});
    const [connectorId, setConnectorId] = useState<string | null>(null);
    const [tables, setTables] = useState<RemoteTable[]>([]);
    const [picked, setPicked] = useState<Record<string, boolean>>({});
    const [projectId, setProjectId] = useState<string>("default");
    const [ingestResults, setIngestResults] = useState<IngestResult[] | null>(null);
    const [lastIngest, setLastIngest] = useState<{ projectId: string; tables: string[] } | null>(null);
    const [testMsg, setTestMsg] = useState<string | null>(null);
    const [testOk, setTestOk] = useState<boolean | null>(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";

    const reset = useCallback(() => {
        setStep("creds");
        setConnectorId(null);
        setTables([]);
        setPicked({});
        setIngestResults(null);
        setLastIngest(null);
        setTestMsg(null);
        setTestOk(null);
        setErr(null);
        setBusy(false);
    }, []);

    async function doCreateAndTest() {
        setErr(null);
        setBusy(true);
        setTestOk(null);
        setTestMsg(null);
        try {
            const token = localStorage.getItem("authToken") || "";

            // 1. Create (or reuse) the credential row.
            let id = connectorId;
            if (!id) {
                const res = await fetch(`${apiUrl}/connectors`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-auth-token": token },
                    body: JSON.stringify({ type, name, config }),
                });
                const body = await res.json();
                if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
                id = body.data.id;
                setConnectorId(id);
            }

            // 2. Test + fetch source tables in parallel.
            const [testRes, listRes] = await Promise.all([
                fetch(`${apiUrl}/connectors/${id}/test`, {
                    method: "POST",
                    headers: { "x-auth-token": token },
                }),
                fetch(`${apiUrl}/connectors/${id}/tables`, {
                    method: "POST",
                    headers: { "x-auth-token": token },
                }),
            ]);

            const testBody = await testRes.json().catch(() => ({}));
            const listBody = await listRes.json().catch(() => ({}));

            setTestOk(!!(testBody?.data?.ok));
            setTestMsg(testBody?.data?.message || testBody?.message || "");

            if (!testBody?.data?.ok) {
                // Stay on the creds step so the user can fix fields.
                return;
            }
            if (!listRes.ok) {
                throw new Error(listBody.message || "Could not list tables");
            }
            setTables(listBody?.data?.tables || []);
            setStep("tables");
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Unknown error");
        } finally {
            setBusy(false);
        }
    }

    async function doIngest() {
        setErr(null);
        setBusy(true);
        try {
            const token = localStorage.getItem("authToken") || "";
            const selected = tables.filter((t) => picked[keyFor(t)]);
            if (selected.length === 0) {
                throw new Error("Pick at least one table");
            }
            const res = await fetch(`${apiUrl}/connectors/${connectorId}/ingest`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-auth-token": token },
                body: JSON.stringify({ projectId, tables: selected }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
            const ingested: IngestResult[] = body?.data?.ingested || [];
            setIngestResults(ingested);
            // Track the resolved (post-ingestion) destination table names so the
            // success-state "Open in chat" CTA seeds chat against the lakehouse
            // names that actually exist (not the source-side selection).
            setLastIngest({
                projectId,
                tables: ingested.map((r) => r.table).filter(Boolean),
            });
            setStep("ingest");
            onCompleted?.();
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Unknown error");
        } finally {
            setBusy(false);
        }
    }

    function keyFor(t: RemoteTable) {
        return `${t.schema || ""}::${t.name}`;
    }

    const openInChat = useCallback((tableName: string) => {
        if (!lastIngest) return;
        const pid = lastIngest.projectId;
        addAttachment({
            kind: "connector_table",
            id: `local:${tableName}`,
            projectId: pid,
            tableName,
            alias: tableName,
        });
        setCurrentDataset({
            id: `${pid}.${tableName}`,
            name: tableName,
            projectId: pid,
            tableName,
            source: "lakehouse",
        });
        onCompleted?.();
        router.push("/dashboard");
    }, [lastIngest, addAttachment, setCurrentDataset, onCompleted, router]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-100 flex justify-end">
            <div className="absolute inset-0 bg-(--backdrop) backdrop-blur-sm" onClick={onClose} />

            <aside className="relative w-full sm:w-[520px] bg-(--bg-secondary) border-l border-(--border-primary) h-full shadow-2xl flex flex-col">
                <header className="flex items-center gap-4 p-5 border-b border-(--border-primary)">
                    <ConnectorIcon type={type} size={32} />
                    <div className="flex-1">
                        <p className="text-[10px] uppercase tracking-widest text-vanta-neon font-semibold mb-0.5">
                            New connector · step {step === "creds" ? 1 : step === "tables" ? 2 : 3} of 3
                        </p>
                        <h2
                            className="text-lg font-bold text-(--text-primary)"
                            style={{ fontFamily: "var(--font-heading)" }}
                        >
                            {meta.label}
                        </h2>
                    </div>
                    <button
                        onClick={() => { reset(); onClose(); }}
                        className="w-9 h-9 rounded-lg bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-muted) hover:text-(--text-primary) flex items-center justify-center"
                        aria-label="Close"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto p-5">
                    {step === "creds" && (
                        <CredentialsStep
                            meta={meta}
                            fields={fields}
                            name={name}
                            setName={setName}
                            config={config}
                            setConfig={setConfig}
                            testOk={testOk}
                            testMsg={testMsg}
                            err={err}
                        />
                    )}

                    {step === "tables" && (
                        <TablesStep
                            tables={tables}
                            picked={picked}
                            setPicked={setPicked}
                            projectId={projectId}
                            setProjectId={setProjectId}
                            err={err}
                        />
                    )}

                    {step === "ingest" && ingestResults && (
                        <IngestStep
                            results={ingestResults}
                            lastIngest={lastIngest}
                            onOpenInChat={openInChat}
                        />
                    )}
                </div>

                <footer className="p-5 border-t border-(--border-primary) flex gap-3">
                    {step === "creds" && (
                        <>
                            <button
                                onClick={() => { reset(); onClose(); }}
                                className="flex-1 h-11 rounded-xl bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-primary) font-medium transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={doCreateAndTest}
                                disabled={busy}
                                className="flex-[2] h-11 rounded-xl bg-vanta-neon text-black font-bold hover:bg-vanta-neon/90 transition-all shadow-md shadow-vanta-neon/25 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {busy ? "Testing…" : "Save + test"}
                            </button>
                        </>
                    )}

                    {step === "tables" && (
                        <>
                            <button
                                onClick={() => setStep("creds")}
                                className="flex-1 h-11 rounded-xl bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-primary) font-medium"
                            >
                                Back
                            </button>
                            <button
                                onClick={doIngest}
                                disabled={busy || Object.values(picked).every((v) => !v)}
                                className="flex-[2] h-11 rounded-xl bg-vanta-neon text-black font-bold hover:bg-vanta-neon/90 transition-all shadow-md shadow-vanta-neon/25 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {busy ? "Ingesting…" : `Ingest ${Object.values(picked).filter(Boolean).length} table(s)`}
                            </button>
                        </>
                    )}

                    {step === "ingest" && (
                        <button
                            onClick={() => { reset(); onClose(); }}
                            className="flex-1 h-11 rounded-xl bg-vanta-neon text-black font-bold"
                        >
                            Done
                        </button>
                    )}
                </footer>
            </aside>
        </div>
    );
}


// ---------- step components ----------

function CredentialsStep({
    meta,
    fields,
    name,
    setName,
    config,
    setConfig,
    testOk,
    testMsg,
    err,
}: {
    meta: ConnectorTypeMeta;
    fields: FieldSchema[];
    name: string;
    setName: (s: string) => void;
    config: Record<string, string>;
    setConfig: (c: Record<string, string>) => void;
    testOk: boolean | null;
    testMsg: string | null;
    err: string | null;
}) {
    return (
        <div className="space-y-4">
            <p className="text-sm text-(--text-muted) leading-relaxed">
                {meta.description} Credentials are encrypted with AES-256-GCM and
                never returned to the browser.
            </p>

            <label className="block">
                <span className="text-xs font-semibold text-(--text-secondary) uppercase tracking-wider">
                    Name
                </span>
                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputCls}
                />
            </label>

            <div className="pt-3 border-t border-(--border-secondary) space-y-3">
                {fields.map((f) => {
                    const v = config[f.key] ?? "";
                    const onChange = (val: string) => setConfig({ ...config, [f.key]: val });
                    return (
                        <label key={f.key} className="block">
                            <span className="text-xs font-semibold text-(--text-secondary) uppercase tracking-wider">
                                {f.label}{f.required && " *"}
                            </span>
                            {f.type === "textarea" ? (
                                <textarea
                                    value={v}
                                    onChange={(e) => onChange(e.target.value)}
                                    placeholder={f.placeholder}
                                    rows={5}
                                    className={`${inputCls} resize-none font-mono text-[11px] leading-relaxed`}
                                />
                            ) : (
                                <input
                                    type={f.type || "text"}
                                    value={v}
                                    onChange={(e) => onChange(e.target.value)}
                                    placeholder={f.placeholder}
                                    className={inputCls}
                                    autoComplete={f.type === "password" ? "new-password" : "off"}
                                />
                            )}
                            {f.helper && (
                                <span className="text-[11px] text-(--text-muted) mt-1 block">
                                    {f.helper}
                                </span>
                            )}
                        </label>
                    );
                })}
            </div>

            {testOk === false && (
                <div className="rounded-lg border border-(--error)/30 bg-(--error-bg) text-(--error) text-sm px-3 py-2">
                    Couldn&rsquo;t connect: {testMsg || "unknown error"}
                </div>
            )}
            {err && (
                <div className="rounded-lg border border-(--error)/30 bg-(--error-bg) text-(--error) text-sm px-3 py-2">
                    {err}
                </div>
            )}
        </div>
    );
}

function TablesStep({
    tables,
    picked,
    setPicked,
    projectId,
    setProjectId,
    err,
}: {
    tables: RemoteTable[];
    picked: Record<string, boolean>;
    setPicked: (p: Record<string, boolean>) => void;
    projectId: string;
    setProjectId: (s: string) => void;
    err: string | null;
}) {
    const allKeys = tables.map((t) => `${t.schema || ""}::${t.name}`);
    const allChecked = allKeys.length > 0 && allKeys.every((k) => picked[k]);
    return (
        <div className="space-y-4">
            <label className="block">
                <span className="text-xs font-semibold text-(--text-secondary) uppercase tracking-wider">
                    Ingest into project
                </span>
                <input
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value.replace(/[^a-zA-Z0-9_-]/g, "_"))}
                    className={inputCls}
                />
                <span className="text-[11px] text-(--text-muted) mt-1 block">
                    Ingested tables land under this project in your warehouse.
                </span>
            </label>

            <div className="flex items-center justify-between pt-3 border-t border-(--border-secondary)">
                <p className="text-[11px] font-semibold text-(--text-muted) uppercase tracking-wider">
                    Pick tables ({tables.length})
                </p>
                <button
                    type="button"
                    onClick={() => {
                        const next: Record<string, boolean> = {};
                        if (!allChecked) allKeys.forEach((k) => { next[k] = true; });
                        setPicked(next);
                    }}
                    className="text-xs text-vanta-neon hover:text-vanta-neon/80 font-semibold"
                >
                    {allChecked ? "Clear all" : "Select all"}
                </button>
            </div>

            <ul className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
                {tables.map((t) => {
                    const k = `${t.schema || ""}::${t.name}`;
                    const on = !!picked[k];
                    return (
                        <li
                            key={k}
                            onClick={() => setPicked({ ...picked, [k]: !on })}
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-all ${on
                                ? "bg-vanta-neon/10 border-vanta-neon/50"
                                : "bg-(--bg-tertiary) border-(--border-primary) hover:border-(--accent)"
                                }`}
                        >
                            <span className={`w-4 h-4 rounded border flex items-center justify-center flex-none ${on ? "bg-vanta-neon border-vanta-neon" : "border-(--border-hover)"}`}>
                                {on && (
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                )}
                            </span>
                            <span className="flex-1 text-sm font-medium text-(--text-primary) truncate">
                                {t.schema ? `${t.schema}.${t.name}` : t.name}
                            </span>
                            {typeof t.row_estimate === "number" && (
                                <span className="text-[11px] text-(--text-muted)">~{t.row_estimate.toLocaleString()}</span>
                            )}
                        </li>
                    );
                })}
                {tables.length === 0 && (
                    <li className="text-sm text-(--text-muted) italic">No tables found at the source.</li>
                )}
            </ul>

            {err && (
                <div className="rounded-lg border border-(--error)/30 bg-(--error-bg) text-(--error) text-sm px-3 py-2">
                    {err}
                </div>
            )}
        </div>
    );
}

function IngestStep({
    results,
    lastIngest,
    onOpenInChat,
}: {
    results: IngestResult[];
    lastIngest: { projectId: string; tables: string[] } | null;
    onOpenInChat: (tableName: string) => void;
}) {
    const total = results.reduce((a, b) => a + (b.rows || 0), 0);
    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-vanta-neon/30 bg-vanta-neon/5 p-4">
                <p className="text-sm font-bold text-(--text-primary) mb-1">
                    ✓ Ingested {results.length} table{results.length === 1 ? "" : "s"} · {total.toLocaleString()} rows
                </p>
                <p className="text-xs text-(--text-muted)">
                    Find them in Files — ready to chat.
                </p>
            </div>
            <ul className="space-y-1.5">
                {results.map((r) => (
                    <li
                        key={r.table}
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-(--bg-tertiary) border border-(--border-primary)"
                    >
                        <span className="text-sm font-medium text-(--text-primary) truncate">{r.table}</span>
                        <span className="text-[11px] text-(--text-muted)">
                            {r.rows.toLocaleString()} rows · {(r.duration_ms / 1000).toFixed(1)}s
                        </span>
                    </li>
                ))}
            </ul>

            {lastIngest && lastIngest.tables.length > 0 && (
                <div className="pt-3 border-t border-(--border-secondary) space-y-2">
                    <p className="text-[11px] font-semibold text-(--text-muted) uppercase tracking-wider">
                        Open in chat
                    </p>
                    <div className="space-y-1.5">
                        {lastIngest.tables.map((t) => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => onOpenInChat(t)}
                                className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-(--bg-tertiary) border border-(--border-primary) hover:border-vanta-neon/50 hover:bg-vanta-neon/5 transition-all text-left group"
                            >
                                <span className="text-sm font-medium text-(--text-primary) truncate">
                                    Chat with <span className="font-mono text-xs text-(--text-secondary)">{t}</span>
                                </span>
                                <span className="text-[11px] text-vanta-neon font-semibold opacity-0 group-hover:opacity-100 transition-opacity flex-none">
                                    Open →
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

const inputCls =
    "mt-1.5 w-full h-11 px-3 rounded-lg bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) placeholder:text-(--text-muted) text-sm focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent)/25 transition-all";
