"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useDashboard, type ChatAttachment } from "@/components/dashboard/DashboardLayout";
import ChartRenderer from "@/components/charts/ChartRenderer";
import ModelPicker from "@/components/dashboard/ModelPicker";
import ThinkingStream, { type ThinkingRequest, type ThinkingEvent } from "@/components/dashboard/ThinkingStream";
import ChatSettingsDrawer from "@/components/dashboard/ChatSettingsDrawer";
import PinToDashboard from "@/components/dashboard/PinToDashboard";
import AttachFromLibraryModal from "@/components/dashboard/AttachFromLibraryModal";

interface Message {
    role: "user" | "assistant";
    content: string;
    isLoading?: boolean;
    hasChart?: boolean;
    // B8: persisted thinking-run metadata for static replay on session reload.
    thinking?: {
        runId?: string;
        result?: string;
        events: ThinkingEvent[];
    };
}

interface Insight {
    type: 'kpi' | 'bullet' | 'warning' | 'success';
    label?: string;
    value?: string | number;
    icon?: string;
    text?: string;
    severity?: string;
}

interface ChartSpec {
    id: string;
    type: string;
    title: string;
    chart_id?: string;
    chart_type?: string;
    encoding?: {
        x?: string;
        y?: string;
        color?: string;
    };
    data?: {
        labels?: string[];
        datasets?: Array<{
            label: string;
            data: number[];
            backgroundColor?: string[];
        }>;
        resultData?: unknown[];
        rowCount?: number;
    };
}

interface TablePreview {
    fileName: string;
    columns: string[];
    rows: unknown[][];
    totalRows: number;
    totalColumns: number;
}

type TabType = "charts" | "table" | "insights";

export default function DashboardPage() {
    const { currentDataset, attachments, setAttachments } = useDashboard();
    const searchParams = useSearchParams();
    const urlSession = searchParams.get("session");
    const [messages, setMessages] = useState<Message[]>([
        { role: "assistant", content: "Hello! I'm Vanta. Import an Excel file to start analyzing your data." }
    ]);
    const [inputValue, setInputValue] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<TabType>("charts");
    const [chartSpecs, setChartSpecs] = useState<ChartSpec[]>([]);
    const [insights, setInsights] = useState<Insight[]>([]);
    const [tablePreview, setTablePreview] = useState<TablePreview | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [modelId, setModelId] = useState<string | null>(null);
    // Visual mode (existing chart-suggester flow) vs Thinking mode (new code-agent SSE flow).
    const [chatMode, setChatMode] = useState<"visual" | "thinking">("visual");
    const [thinkingRequest, setThinkingRequest] = useState<ThinkingRequest | null>(null);
    // Latest completed thinking run, captured by ThinkingStream's onDone.
    // B7 will use this to POST the persisted run to user-auth.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [lastThinkingRun, setLastThinkingRun] = useState<{
        runId?: string;
        result?: string;
        events: unknown[];
    } | null>(null);
    // Per-chat system prompt. Persisted server-side once the session exists;
    // staged in local state for brand-new conversations (the first send-message
    // will push it to the backend via /chat/sessions/:id/settings).
    const [systemPrompt, setSystemPrompt] = useState<string>("");
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [pinTarget, setPinTarget] = useState<ChartSpec | null>(null);
    const [isAttachLibraryOpen, setIsAttachLibraryOpen] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";

    // Scroll to bottom when new messages arrive
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Load chat session whenever the URL's ?session= param changes
    // (click from Sidebar, or deep-link), or on first mount falling
    // back to localStorage.currentSessionId.
    useEffect(() => {
        const target = urlSession || (typeof window !== "undefined" ? localStorage.getItem("currentSessionId") : null);
        if (!target) {
            // No session picked — show the welcome message
            setMessages([
                { role: "assistant", content: "Hello! I'm Vanta. Import an Excel file to start analyzing your data." },
            ]);
            setChartSpecs([]);
            setInsights([]);
            setAttachments([]);
            setSessionId(null);
            // C3: brand-new chat with no session — let the wipe effect run freely.
            didRestoreRef.current = true;
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const token = localStorage.getItem("authToken") || "";
                // The correct endpoint is GET /chat/sessions/:id — it
                // returns the session with its `messages[]` included.
                const res = await fetch(`${apiUrl}/chat/sessions/${target}`, {
                    headers: { "x-auth-token": token },
                });
                if (!res.ok) {
                    if (res.status === 404) {
                        // Stale id (session was deleted) — clear and show welcome.
                        if (target === localStorage.getItem("currentSessionId")) {
                            localStorage.removeItem("currentSessionId");
                        }
                        if (!cancelled) {
                            setSessionId(null);
                            setMessages([
                                { role: "assistant", content: "Hello! I'm Vanta. Import an Excel file to start analyzing your data." },
                            ]);
                            setChartSpecs([]);
                            setInsights([]);
                            // Mirror the welcome branch — drop any stale attachments
                            // (including local: ids) so the next send doesn't try to
                            // attach orphaned ids to a brand-new session.
                            setAttachments([]);
                            // C3: 404 fallback resolved — let the wipe effect run freely.
                            didRestoreRef.current = true;
                        }
                    }
                    return;
                }
                const json = await res.json();
                if (cancelled) return;
                const data = json?.data || {};
                const loadedMessages = Array.isArray(data.messages) ? data.messages : [];
                // Restore both the text bubbles and any chart/insight
                // metadata the assistant originally produced.
                const hydratedMessages: Message[] = [];
                const restoredCharts: ChartSpec[] = [];
                const restoredInsights: Insight[] = [];
                for (const m of loadedMessages) {
                    const meta = (m.metadata || {}) as {
                        chartSpecs?: ChartSpec[];
                        insights?: Insight[];
                        thinking?: { runId?: string; result?: string; events?: ThinkingEvent[] };
                    };
                    const hasChart = Array.isArray(meta.chartSpecs) && meta.chartSpecs.length > 0;
                    if (hasChart) restoredCharts.push(...meta.chartSpecs!);
                    if (Array.isArray(meta.insights)) restoredInsights.push(...meta.insights);
                    // B8: surface persisted thinking-run events so the
                    // assistant bubble can replay them via ThinkingStream.
                    const thinking =
                        meta.thinking && Array.isArray(meta.thinking.events) && meta.thinking.events.length > 0
                            ? {
                                runId: meta.thinking.runId,
                                result: meta.thinking.result,
                                events: meta.thinking.events,
                            }
                            : undefined;
                    hydratedMessages.push({
                        role: m.role,
                        content: m.content,
                        hasChart,
                        thinking,
                    });
                }
                if (hydratedMessages.length === 0) {
                    hydratedMessages.push({
                        role: "assistant",
                        content: "Empty session — send a message to get started.",
                    });
                }
                setMessages(hydratedMessages);
                setChartSpecs(restoredCharts);
                setInsights(restoredInsights);
                // Hydrate per-chat context (system prompt, mode, model) from
                // the session record. Without this, returning to a chat with
                // a saved system prompt looks empty in the Settings drawer
                // even though the backend has it.
                if (typeof data.systemPrompt === "string") {
                    setSystemPrompt(data.systemPrompt);
                } else {
                    setSystemPrompt("");
                }
                if (data.mode === "thinking" || data.mode === "visual") {
                    setChatMode(data.mode);
                }
                if (typeof data.modelId === "string" && data.modelId) {
                    setModelId(data.modelId);
                }
                // Hydrate attachments[] from the eager-loaded session payload
                // (added by A2). Snake_case server fields → camelCase client.
                const sessAttachments: ChatAttachment[] = (data.attachments || []).map((a: { id: string; kind: string; file_id?: string; project_id?: string; table_name?: string; alias?: string }) => {
                    if (a.kind === 'file') {
                        return { kind: 'file' as const, id: a.id, fileId: a.file_id || '', alias: a.alias };
                    }
                    return {
                        kind: 'connector_table' as const,
                        id: a.id,
                        projectId: a.project_id || '',
                        tableName: a.table_name || '',
                        alias: a.alias,
                    };
                });
                setAttachments(sessAttachments);
                setSessionId(target);
                localStorage.setItem("currentSessionId", target);
                // C3: successful restore complete — let the wipe effect run freely.
                didRestoreRef.current = true;
            } catch (err) {
                console.error("Load session failed:", err);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [apiUrl, urlSession, setAttachments]);

    const fetchFilePreview = useCallback(async (fileId: string) => {
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/chat/preview/${fileId}?limit=50`, {
                headers: { "x-auth-token": token }
            });

            if (res.ok) {
                const json = await res.json();
                setTablePreview(json.data);
            }
        } catch (error) {
            console.error("Error fetching file preview:", error);
        }
    }, [apiUrl]);

    // Fetch preview for lakehouse datasets (data stored in MinIO)
    // Uses Next.js proxy to add auth token
    const fetchLakehousePreview = useCallback(async (jobId: string, projectId: string, tableName: string) => {
        try {
            const token = localStorage.getItem("authToken") || "";
            // Use Next.js proxy to add auth and avoid CORS
            const url = `/api/chat/preview/lakehouse/${jobId}?projectId=${encodeURIComponent(projectId)}&tableName=${encodeURIComponent(tableName)}&limit=50`;
            console.log('[Preview] Fetching lakehouse preview via proxy:', { jobId, projectId, tableName });

            const res = await fetch(url, {
                headers: { "x-auth-token": token }
            });

            if (res.ok) {
                const json = await res.json();
                console.log('[Preview] Lakehouse preview data:', json.data);
                setTablePreview(json.data);
            } else {
                const errorText = await res.text();
                console.error('[Preview] Lakehouse preview error:', res.status, errorText);
            }
        } catch (error) {
            console.error("Error fetching lakehouse preview:", error);
        }
    }, []);

    // Load file preview when dataset changes
    useEffect(() => {
        if (currentDataset?.id) {
            if (currentDataset.source === 'lakehouse' && currentDataset.projectId && currentDataset.tableName) {
                fetchLakehousePreview(currentDataset.id, currentDataset.projectId, currentDataset.tableName);
            } else {
                fetchFilePreview(currentDataset.id);
            }
        } else {
            setTablePreview(null);
        }
    }, [currentDataset, fetchFilePreview, fetchLakehousePreview]);

    // C3: wipe stale charts/insights when the user switches datasets.
    // Guarded by didRestoreRef so the initial null → hydrated transition
    // during session restore doesn't immediately discard the charts the
    // restore effect just hydrated from metadata.chartSpecs.
    useEffect(() => {
        if (!didRestoreRef.current) return; // initial hydration: no wipe
        setChartSpecs([]);
        setInsights([]);
    }, [currentDataset?.id]);

    const generateCharts = async (prompt: string, projectId: string, tableName: string) => {
        // Debug: Log environment and request details
        console.log('[Chart-API] Using proxy route /api/chart/execute-prompt');
        console.log('[Chart-API] Request payload:', { prompt, projectId, tableName });

        try {
            // D3: Surface chat attachments to Chart-API so the agent's
            // system prompt can list each source by user-set alias. The
            // backend falls back to (project_id, table_name) when this
            // is empty, preserving single-source semantics.
            const attachmentsPayload = attachments.map(a => {
                if (a.kind === 'file') {
                    return { kind: 'file' as const, file_id: a.fileId, alias: a.alias };
                }
                if (a.kind === 'connector_live') {
                    return {
                        kind: 'connector_live' as const,
                        connector_id: a.connectorId,
                        connector_type: a.connectorType,
                        alias: a.alias,
                    };
                }
                return {
                    kind: 'connector_table' as const,
                    project_id: a.projectId,
                    table_name: a.tableName,
                    alias: a.alias,
                };
            });

            const requestBody = {
                user_prompts: [prompt],
                project_id: projectId,
                table_name: tableName,
                attachments: attachmentsPayload,
            };
            console.log('[Chart-API] Full request body:', JSON.stringify(requestBody));

            // Use Next.js proxy to avoid CORS issues; forward the auth
            // token so the user-scoped Chart-API engine can resolve the
            // right warehouse.
            const authToken = typeof window !== "undefined"
                ? localStorage.getItem("authToken") || ""
                : "";
            const res = await fetch('/api/chart/execute-prompt', {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(authToken ? { "x-auth-token": authToken } : {}),
                },
                body: JSON.stringify(requestBody)
            });

            console.log('[Chart-API] Response status:', res.status, res.statusText);

            if (res.ok) {
                const json = await res.json();
                console.log('[Chart-API] Raw response:', JSON.stringify(json, null, 2));

                if (json.charts && json.charts.length > 0) {
                    console.log('[Chart-API] Charts found:', json.charts.length);
                    console.log('[Chart-API] First chart data sample:', json.charts[0]?.data);
                    // Transform Chart-API response to our ChartSpec format
                    // Chart-API now returns {labels: [...], datasets: [{data: [...]}]} format
                    const transformedCharts: ChartSpec[] = json.charts.map((chart: { chart_id?: string; chart_type?: string; encoding?: { x?: string; y?: string }; data?: { labels?: string[]; datasets?: Array<{ label?: string; data?: number[]; backgroundColor?: string[] }>; resultData?: unknown[] } }, idx: number) => ({
                        id: chart.chart_id || `chart-${Date.now()}-${idx}`,
                        type: chart.chart_type || 'bar',
                        title: `${chart.chart_type || 'Chart'} - ${chart.encoding?.y || 'Data'}`,
                        chart_id: chart.chart_id,
                        chart_type: chart.chart_type,
                        encoding: chart.encoding,
                        // Use Chart.js format directly if available, fallback to legacy format
                        data: chart.data?.labels ? {
                            labels: chart.data.labels,
                            datasets: chart.data.datasets || []
                        } : {
                            labels: [],
                            datasets: []
                        }
                    }));
                    console.log('[Chart-API] Transformed charts:', transformedCharts);
                    // Don't add charts here - they are added in handleSendMessage to avoid duplication
                    return transformedCharts;
                } else {
                    console.log('[Chart-API] No charts in response. Response keys:', Object.keys(json));
                }
            } else {
                const errorText = await res.text();
                console.error('[Chart-API] Error response:', errorText);
            }
            return null;
        } catch (error) {
            console.error("[Chart-API] Fetch error:", error);
            console.error("[Chart-API] This could be: CORS blocked, server not running, or network issue");
            return null;
        }
    };

    // B7: refs for reactive values read inside handleThinkingDone. Refs let
    // us keep the useCallback dep array empty (so handleThinkingDone keeps
    // a stable identity for ThinkingStream's [request, onDone] effect — see
    // B6's double-stream regression) while still reading fresh values for
    // the persistence POST.
    const apiUrlRef = useRef(apiUrl);
    const sessionIdRef = useRef(sessionId);
    const thinkingRequestRef = useRef(thinkingRequest);
    const currentDatasetIdRef = useRef(currentDataset?.id);
    const systemPromptRef = useRef(systemPrompt);
    // C3: gate the dataset-change chart wipe so it doesn't fire during the
    // brief moment between mount and the first session-restore (or welcome /
    // 404 fallback) completing. Without this, the wipe effect fires on the
    // initial null → hydrated currentDataset transition and immediately
    // discards charts the restore effect just hydrated from metadata.chartSpecs.
    const didRestoreRef = useRef(false);
    useEffect(() => { apiUrlRef.current = apiUrl; }, [apiUrl]);
    useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
    useEffect(() => { thinkingRequestRef.current = thinkingRequest; }, [thinkingRequest]);
    useEffect(() => { currentDatasetIdRef.current = currentDataset?.id; }, [currentDataset?.id]);
    useEffect(() => { systemPromptRef.current = systemPrompt; }, [systemPrompt]);

    // Stable onDone for ThinkingStream. The previous inline arrow got a fresh
    // identity on every parent render, which made ThinkingStream's effect
    // (keyed on [request, onDone]) abort the in-flight stream and re-issue a
    // second POST whenever the parent re-rendered (e.g., user typed in the
    // input). Wrapping in useCallback with [] freezes the identity for the
    // component's lifetime and stops the double-request bug.
    //
    // B7 extends this to persist the completed run via POST /chat with
    // mode='thinking' and a `thinking` metadata blob so the run survives a
    // session reload (B8 hydrates it back into the UI).
    const handleThinkingDone = useCallback(
        async (run: { runId?: string; result?: string; events: unknown[] } | null) => {
            setThinkingRequest(null);
            if (!run) return;
            setLastThinkingRun(run);
            // Empty/cancelled runs aren't worth showing or persisting.
            if (!run.result) return;

            // STEP 1 — ALWAYS show the result first.
            //
            // Persistence is best-effort below. Even if the POST fails (auth
            // expired, server down, body too big), the user must still see
            // the answer they paid LLM tokens for. The optimistic append
            // mirrors visual-mode's behavior; reload-survival is a bonus
            // contingent on the POST landing.
            setMessages((prev) => [
                ...prev,
                {
                    role: "assistant",
                    content: run.result || "",
                    thinking: {
                        runId: run.runId,
                        result: run.result,
                        events: run.events as ThinkingEvent[],
                    },
                },
            ]);

            // STEP 2 — try to persist (background, non-blocking on render).
            const token = typeof window !== "undefined"
                ? localStorage.getItem("authToken") || ""
                : "";
            if (!token) {
                console.error("[thinking-persist] no authToken in localStorage; skipping POST");
                return;
            }

            // Try to keep inline base64 chart payloads on the persisted
            // events so EventView can show real images on reload. If the
            // full payload would blow past express.json's default 100KB
            // limit (user-auth running with old config + chart-heavy run),
            // strip data_url. Retry path further down handles the residual.
            const fullEvents = run.events as Array<Record<string, unknown>>;
            const stripChartPayloads = (
                evts: Array<Record<string, unknown>>
            ): Array<Record<string, unknown>> =>
                evts.map((e) => {
                    if (e && e.type === "chart" && typeof e.data_url === "string") {
                        const { data_url: _stripped, ...rest } = e;
                        void _stripped;
                        return rest;
                    }
                    return e;
                });
            const SAFE_SIZE = 90_000;
            const fullSize = JSON.stringify(fullEvents).length;
            const wasStripped = fullSize > SAFE_SIZE;
            const lightEvents = wasStripped ? stripChartPayloads(fullEvents) : fullEvents;
            const strippedEvents = wasStripped ? lightEvents : stripChartPayloads(fullEvents);

            const postChat = async (
                eventsToSend: Array<Record<string, unknown>>
            ): Promise<{ res?: Response; err?: unknown }> => {
                try {
                    const r = await fetch(`${apiUrlRef.current}/chat`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-auth-token": token,
                        },
                        body: JSON.stringify({
                            message: thinkingRequestRef.current?.prompt ?? "",
                            sessionId: sessionIdRef.current,
                            fileId: currentDatasetIdRef.current ?? null,
                            mode: "thinking",
                            reply: run.result,
                            thinking: {
                                runId: run.runId,
                                events: eventsToSend,
                                result: run.result,
                            },
                        }),
                    });
                    return { res: r };
                } catch (err) {
                    return { err };
                }
            };

            // Diagnostic header — paste this if it still fails.
            console.info(
                `[thinking-persist] runId=${run.runId} eventCount=${fullEvents.length} ` +
                `fullEventsSize=${fullSize}B stripped=${wasStripped} ` +
                `apiUrl=${apiUrlRef.current} hasToken=${!!token} ` +
                `sessionId=${sessionIdRef.current ?? "(new)"}`
            );

            let { res, err } = await postChat(lightEvents);

            // If the first attempt blew up at the network layer ("Failed to
            // fetch" — body-parser 413 with no CORS headers) OR returned a
            // 413, retry once with the always-stripped variant.
            if ((!res || res.status === 413) && !wasStripped) {
                console.warn(
                    `[thinking-persist] first attempt failed ` +
                    `(status=${res?.status ?? "network"}, err=${err ? String(err) : "none"}); ` +
                    "retrying with stripped chart payloads"
                );
                ({ res, err } = await postChat(strippedEvents));
            }

            if (!res) {
                console.error(
                    "[thinking-persist] FAILED — server unreachable or body-parser rejected. " +
                    "The result is shown locally but won't survive a reload until persistence works. " +
                    "Most likely: user-auth process needs a restart to pick up the 10mb express.json " +
                    "limit (Ctrl+C in the npm run dev terminal, then npm run dev again). " +
                    "Underlying error:",
                    err
                );
                return;
            }
            if (!res.ok) {
                let body: unknown = null;
                try { body = await res.json(); } catch { /* not JSON */ }
                console.error(
                    `[thinking-persist] FAILED with status=${res.status}. Server response:`,
                    body
                );
                return;
            }

            const data = await res.json();
            console.info(
                `[thinking-persist] SUCCESS — sessionId=${data?.data?.sessionId ?? "(none)"}`
            );
            const persistedSessionId = data?.data?.sessionId;
            const wasFirstSend = !sessionIdRef.current;
            if (persistedSessionId && wasFirstSend) {
                setSessionId(persistedSessionId);
                if (typeof window !== "undefined") {
                    localStorage.setItem("currentSessionId", persistedSessionId);
                }
                if (systemPromptRef.current && systemPromptRef.current.trim()) {
                    fetch(`${apiUrlRef.current}/chat/sessions/${persistedSessionId}/settings`, {
                        method: "PATCH",
                        headers: {
                            "Content-Type": "application/json",
                            "x-auth-token": token,
                        },
                        body: JSON.stringify({
                            systemPrompt: systemPromptRef.current,
                            mode: "thinking",
                        }),
                    }).catch((e) => console.error("PATCH systemPrompt failed", e));
                }
            }
        },
        []
    );

    const handleSendMessage = async (content: string) => {
        if (!content.trim() || isLoading) return;

        const userMessage: Message = { role: "user", content: content.trim() };

        // Thinking mode short-circuits: append the user message, fire the
        // SSE stream. The ThinkingStream component renders results inline.
        if (chatMode === "thinking") {
            const dataset = currentDataset as { source?: string; projectId?: string; tableName?: string } | null;
            if (!dataset?.projectId || !dataset?.tableName) {
                setMessages(prev => [...prev, userMessage, {
                    role: "assistant",
                    content: "Thinking mode needs an attached lakehouse dataset. Import or pick one from Files first.",
                }]);
                setInputValue("");
                return;
            }
            // D3: Mirror visual mode — surface attachments[] to Chart-API
            // so the thinking-mode agent's system prompt can list each
            // source by alias. Empty -> backend falls back to the (project_id,
            // table_name) above.
            const attachmentsPayload = attachments.map(a => {
                if (a.kind === 'file') {
                    return { kind: 'file' as const, file_id: a.fileId, alias: a.alias };
                }
                if (a.kind === 'connector_live') {
                    return {
                        kind: 'connector_live' as const,
                        connector_id: a.connectorId,
                        connector_type: a.connectorType,
                        alias: a.alias,
                    };
                }
                return {
                    kind: 'connector_table' as const,
                    project_id: a.projectId,
                    table_name: a.tableName,
                    alias: a.alias,
                };
            });

            setMessages(prev => [...prev, userMessage]);
            setInputValue("");
            setThinkingRequest({
                prompt: content.trim(),
                project_id: dataset.projectId,
                table_name: dataset.tableName,
                model_id: modelId,
                system_prompt: systemPrompt || null,
                attachments: attachmentsPayload,
            });
            return;
        }

        // Visual mode (existing flow)
        setMessages(prev => [...prev, userMessage]);
        setInputValue("");
        setIsLoading(true);
        setMessages(prev => [...prev, { role: "assistant", content: "", isLoading: true }]);

        try {
            let reply = "";
            let newCharts: ChartSpec[] = [];
            let newInsights: Insight[] = [];
            let newSessionId = sessionId;

            // Check if dataset is from lakehouse
            const dataset = currentDataset as { source?: string; projectId?: string; tableName?: string } | null;
            const isLakehouse = dataset?.source === 'lakehouse' && dataset?.projectId && dataset?.tableName;

            if (isLakehouse) {
                // Use Chart-API for lakehouse datasets
                const charts = await generateCharts(
                    content.trim(),
                    dataset.projectId!,
                    dataset.tableName!
                );

                if (charts && charts.length > 0) {
                    newCharts = charts;
                    newInsights = deriveInsights(charts);
                    reply = `I've generated ${charts.length} chart(s) based on your query. Check the Charts panel to see the visualizations.`;
                } else {
                    reply = `I received your request about the ${dataset.tableName} table. The Chart-API processed it but didn't return any charts. Try a more specific request like "show sales by region" or "compare revenue across categories".`;
                }

                // SAVE lakehouse messages to backend for persistence
                try {
                    const token = localStorage.getItem("authToken") || "";
                    const saveRes = await fetch(`${apiUrl}/chat`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-auth-token": token
                        },
                        body: JSON.stringify({
                            message: content.trim(),
                            fileId: currentDataset?.id || null,
                            sessionId: sessionId,
                            // Include chart info + insights for persistence
                            chartSpecs: newCharts,
                            insights: newInsights,
                            reply: reply
                        })
                    });
                    const saveJson = await saveRes.json();
                    if (saveRes.ok && saveJson.data?.sessionId) {
                        newSessionId = saveJson.data.sessionId;
                        // Store in localStorage for page refresh
                        if (newSessionId) {
                            localStorage.setItem("currentSessionId", newSessionId);
                        }
                        console.log('[ChatPersistence] Saved lakehouse message to session:', newSessionId);
                    }
                } catch (saveError) {
                    console.warn('[ChatPersistence] Failed to save message to backend:', saveError);
                }
            } else {
                // Fall back to user-auth chat for local files
                const token = localStorage.getItem("authToken") || "";
                const res = await fetch(`${apiUrl}/chat`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-auth-token": token
                    },
                    body: JSON.stringify({
                        message: content.trim(),
                        fileId: currentDataset?.id || null,
                        sessionId: sessionId
                    })
                });

                const json = await res.json();

                if (!res.ok) {
                    throw new Error(json.message || "Failed to process message");
                }

                const data = json.data;
                reply = data.reply;
                newCharts = data.chartSpecs || [];
                newInsights = data.insights || [];
                newSessionId = data.sessionId || sessionId;
            }

            // Store sessionId for subsequent messages AND localStorage for persistence
            if (newSessionId && !sessionId) {
                setSessionId(newSessionId);
                // Save to localStorage for persistence across page refresh
                localStorage.setItem("currentSessionId", newSessionId);
                console.log('[ChatPersistence] New session created:', newSessionId);
            } else if (newSessionId && newSessionId !== sessionId) {
                setSessionId(newSessionId);
                localStorage.setItem("currentSessionId", newSessionId);
            }

            // Persist any local: attachments now that the session id is known.
            // Done sequentially so a single failure doesn't blow away the rest.
            // The next send will retry any 5xx failures that are still local: prefixed.
            // TODO(B7): handleThinkingDone will need to reuse this persist logic.
            // If reused twice, extract to a useCallback persistLocalAttachments(sessionId) helper.
            if (newSessionId && attachments.some(a => a.id.startsWith('local:'))) {
                const token = localStorage.getItem("authToken") || "";
                // Work against a local copy because context setAttachments is a
                // plain setter (not a functional updater) and we're mutating
                // multiple ids inside an async loop within one render cycle.
                let working: ChatAttachment[] = attachments.slice();
                // Track ids that should be removed entirely (4xx — payload bad,
                // retrying forever wouldn't help and just spams the controller).
                const workingDrops = new Set<string>();
                for (const a of attachments) {
                    if (!a.id.startsWith('local:')) continue;
                    // connector_live attachments are intentionally NOT persisted
                    // server-side — the user-auth attachments junction's ENUM only
                    // knows file/connector_table. Live sources are session-local.
                    if (a.kind === 'connector_live') continue;
                    const body =
                        a.kind === 'file'
                            ? { kind: 'file', fileId: a.fileId, alias: a.alias }
                            : {
                                kind: 'connector_table',
                                projectId: a.projectId,
                                tableName: a.tableName,
                                alias: a.alias,
                            };
                    try {
                        const r = await fetch(`${apiUrl}/chat/sessions/${newSessionId}/attachments`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                            body: JSON.stringify(body),
                        });
                        if (!r.ok) {
                            if (r.status >= 400 && r.status < 500) {
                                // 4xx — payload is bad; drop this attachment so we don't retry forever.
                                let errBody: { message?: string } | null = null;
                                try { errBody = await r.json(); } catch { }
                                console.error(
                                    `Persist attachment failed (${r.status}) for ${a.id}; dropping.`,
                                    errBody?.message ?? errBody
                                );
                                workingDrops.add(a.id);
                                continue;
                            }
                            // 5xx — transient; keep the local: id and retry on next send.
                            console.error(`Persist attachment failed (${r.status}) for ${a.id}; will retry.`);
                            continue;
                        }
                        const json = await r.json();
                        const serverId = json?.data?.id;
                        if (!serverId) continue;
                        working = working.map(x => (x.id === a.id ? { ...x, id: serverId } : x));
                    } catch (err) {
                        console.error('Persist attachment failed', err);
                    }
                }
                // Single setAttachments after the loop: filter out any 4xx-dropped
                // ids and commit the rebound server ids in one render.
                const finalAttachments = working.filter(a => !workingDrops.has(a.id));
                setAttachments(finalAttachments);
            }

            // Update charts and insights
            if (newCharts && newCharts.length > 0) {
                setChartSpecs(prev => [...prev, ...newCharts]);
            }
            if (newInsights && newInsights.length > 0) {
                setInsights(newInsights);
            }

            // Replace loading message with actual response
            setMessages(prev => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1] = {
                    role: "assistant",
                    content: reply,
                    hasChart: newCharts && newCharts.length > 0
                };
                return newMessages;
            });

            // Switch to appropriate tab if new content
            if (newCharts && newCharts.length > 0) {
                setActiveTab("charts");
            } else if (newInsights && newInsights.length > 0) {
                setActiveTab("insights");
            }

        } catch (error) {
            setMessages(prev => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1] = {
                    role: "assistant",
                    content: error instanceof Error ? error.message : "Sorry, I encountered an error processing your request."
                };
                return newMessages;
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage(inputValue);
        }
    };

    const handleChipClick = (chip: string) => {
        handleSendMessage(chip);
    };

    const tabs: { id: TabType; label: string }[] = [
        { id: "charts", label: "Charts" },
        { id: "table", label: "Table" },
        { id: "insights", label: "Insights" },
    ];

    const kpiInsights = insights.filter(i => i.type === 'kpi');
    const bulletInsights = insights.filter(i => i.type === 'bullet' || i.type === 'warning' || i.type === 'success');

    return (
        <div className="h-full grid grid-cols-12 gap-0 overflow-hidden">

            {/* Left Panel: Chat */}
            <section className="col-span-12 lg:col-span-7 flex flex-col border-r border-(--border-secondary) bg-(--bg-primary) h-full overflow-hidden">

                {/* Chat History — single scrollable container for both
                    message bubbles AND the live thinking-mode stream so
                    messages don't get squeezed when an agent run is open. */}
                <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
                    {messages.map((msg, idx) => {
                        // For assistant messages with persisted thinking-mode
                        // events, the replayed ThinkingStream below already
                        // renders the result via its own Markdown branch.
                        // Skipping the plain-text bubble avoids showing the
                        // same answer twice. The user-message bubble is
                        // unaffected; visual-mode assistant bubbles still
                        // render their content normally.
                        const hasThinkingReplay =
                            msg.role === 'assistant' &&
                            !!msg.thinking?.events &&
                            msg.thinking.events.length > 0;
                        return (
                        <div key={idx} className="space-y-2">
                            {!hasThinkingReplay && (
                            <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`
                max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed
                ${msg.role === 'user'
                                        ? 'bg-(--bg-tertiary) text-(--text-primary) rounded-br-none'
                                        : 'bg-(--bg-secondary) border border-(--border-primary) text-(--text-secondary) rounded-bl-none shadow-sm'}
              `}>
                                    {msg.isLoading ? (
                                        <div className="flex items-center gap-2">
                                            <div className="flex gap-1">
                                                <span className="w-2 h-2 bg-(--accent) rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                                <span className="w-2 h-2 bg-(--accent) rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                                <span className="w-2 h-2 bg-(--accent) rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                            </div>
                                            <span className="text-(--text-muted)">Analyzing...</span>
                                        </div>
                                    ) : (
                                        <div>
                                            <span className="whitespace-pre-wrap">{msg.content}</span>
                                            {msg.hasChart && (
                                                <button
                                                    onClick={() => setActiveTab("charts")}
                                                    className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-(--accent-muted) border border-(--accent)/30 text-(--accent) text-xs font-medium hover:bg-(--accent)/20 transition-colors"
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <rect x="3" y="3" width="18" height="18" rx="2" />
                                                        <path d="M3 9h18M9 21V9" />
                                                    </svg>
                                                    View Chart →
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                            )}
                            {/* B8: replay persisted thinking-mode runs in
                                place of the assistant bubble. Static (no
                                SSE, no fetch); onDone is a no-op. The
                                bubble above is hidden when this is shown
                                so the result text isn't displayed twice. */}
                            {hasThinkingReplay && (
                                <ThinkingStream
                                    key={`thinking-replay-${msg.thinking?.runId ?? idx}`}
                                    request={null}
                                    events={msg.thinking?.events}
                                    onDone={() => { }}
                                />
                            )}
                        </div>
                        );
                    })}
                    {/* Live ThinkingStream is only mounted while an SSE run is
                        in flight. Once handleThinkingDone fires it sets
                        thinkingRequest=null and the live stream unmounts;
                        the optimistically-appended assistant message's
                        replayed ThinkingStream is the single visible copy
                        of the result, eliminating the live+replay duplicate. */}
                    {chatMode === "thinking" && thinkingRequest && (
                        <ThinkingStream
                            request={thinkingRequest}
                            onDone={handleThinkingDone}
                        />
                    )}
                    <div ref={chatEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 border-t border-(--border-secondary) bg-(--bg-primary)">
                    <div className="mb-2 flex items-center gap-2 flex-wrap">
                        {/* Mode toggle: Visual (charts) | Thinking (agent) */}
                        <div className="inline-flex items-center rounded-lg border border-(--border-primary) bg-(--bg-secondary) p-0.5">
                            {(["visual", "thinking"] as const).map((m) => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => setChatMode(m)}
                                    className={`px-3 h-8 rounded-md text-xs font-semibold capitalize transition-all ${chatMode === m
                                        ? "bg-(--accent) text-(--accent-text) shadow"
                                        : "text-(--text-secondary) hover:text-(--text-primary)"
                                        }`}
                                    title={m === "thinking" ? "Agent writes & runs code" : "Classic chart suggestions"}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                        <ModelPicker onChange={setModelId} />
                        <button
                            type="button"
                            onClick={() => setIsSettingsOpen(true)}
                            className={`h-9 px-3 rounded-lg border text-xs font-medium transition-all flex items-center gap-1.5 ${systemPrompt
                                ? "border-vanta-neon/40 bg-vanta-neon/5 text-vanta-neon"
                                : "border-(--border-primary) bg-(--bg-secondary) text-(--text-secondary) hover:border-(--accent) hover:text-(--text-primary)"
                                }`}
                            title="Per-chat system prompt"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z" />
                                <path d="M9 21h6M10 18v3M14 18v3" />
                            </svg>
                            <span className="hidden md:inline">Context</span>
                            {systemPrompt && <span className="w-1.5 h-1.5 rounded-full bg-vanta-neon" />}
                        </button>
                        <span className="text-[11px] text-(--text-muted)">
                            {chatMode === "thinking"
                                ? "Agent writes Python, runs it in a sandbox, and explains the result."
                                : "Free models are rate-limited. Paid models use your OpenRouter key."}
                        </span>
                    </div>
                    <div className="relative">
                        <button
                            onClick={() => setIsAttachLibraryOpen(true)}
                            disabled={isLoading}
                            className="absolute left-2 top-2 h-8 px-2 rounded-lg bg-(--bg-tertiary) text-(--text-muted) hover:text-vanta-neon hover:bg-(--bg-hover) text-xs font-semibold flex items-center gap-1 transition-colors disabled:opacity-50"
                            title="Attach a file or connector table from your library"
                            aria-label="Attach from library"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            <span className="hidden md:inline">Attach</span>
                        </button>
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={currentDataset ? "Ask something about your data..." : "Import a dataset to start chatting..."}
                            disabled={isLoading}
                            className="w-full h-12 pl-24 pr-12 rounded-xl bg-(--bg-secondary) border border-(--border-primary) text-(--text-primary) focus:outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent)/50 transition-all placeholder:text-(--text-muted) disabled:opacity-50"
                        />
                        {thinkingRequest ? (
                            // Cancel button replaces the send button while a
                            // thinking-mode SSE run is in flight. Setting
                            // thinkingRequest=null unmounts the live
                            // ThinkingStream, whose effect cleanup calls
                            // controller.abort() on the AbortController, so
                            // the SSE fetch is cancelled cleanly.
                            <button
                                onClick={() => setThinkingRequest(null)}
                                className="absolute right-2 top-2 h-8 w-8 rounded-lg bg-(--error) grid place-items-center text-white hover:opacity-90 transition-opacity"
                                title="Cancel running thinking-mode request"
                                aria-label="Cancel"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                    <rect x="6" y="6" width="12" height="12" rx="1" />
                                </svg>
                            </button>
                        ) : (
                            <button
                                onClick={() => handleSendMessage(inputValue)}
                                disabled={!inputValue.trim() || isLoading}
                                className="absolute right-2 top-2 h-8 w-8 rounded-lg bg-(--accent) grid place-items-center text-(--accent-text) hover:bg-(--accent-hover) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Send"
                                aria-label="Send"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M22 2L11 13" />
                                    <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                                </svg>
                            </button>
                        )}
                    </div>
                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                        {["Summarize this data", "Create a chart", "Find anomalies", "Show me trends"].map(chip => (
                            <button
                                key={chip}
                                onClick={() => handleChipClick(chip)}
                                disabled={isLoading || !currentDataset}
                                className="px-3 py-1.5 rounded-full border border-(--border-primary) bg-(--bg-secondary) text-xs text-(--text-muted) hover:text-(--text-primary) hover:border-(--border-hover) transition-colors whitespace-nowrap disabled:opacity-50"
                            >
                                {chip}
                            </button>
                        ))}
                    </div>
                </div>

            </section>

            {/* Right Panel: Visualization */}
            <section className="col-span-12 lg:col-span-5 bg-(--bg-primary) flex flex-col h-full overflow-hidden">
                {/* Tabs */}
                <div className="h-12 border-b border-(--border-secondary) flex items-center px-4 gap-6">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`h-full border-b-2 text-sm font-medium transition-colors ${activeTab === tab.id
                                ? "border-(--accent) text-(--text-primary)"
                                : "border-transparent text-(--text-muted) hover:text-(--text-primary)"
                                }`}
                        >
                            {tab.label}
                            {tab.id === "charts" && chartSpecs.length > 0 && (
                                <span className="ml-2 px-1.5 py-0.5 rounded bg-(--accent-muted) text-(--accent) text-[10px]">
                                    {chartSpecs.length}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-y-auto">
                    {/* Charts Tab */}
                    {activeTab === "charts" && (
                        <div className="p-4 space-y-4">
                            {chartSpecs.length > 0 ? (
                                chartSpecs.map((chart, chartIdx) => (
                                    <div
                                        key={`${chart.id || 'chart'}-${chartIdx}-${chart.chart_type || chart.type}`}
                                        className="group relative rounded-xl border border-(--border-secondary) bg-(--bg-secondary)/40 p-2"
                                    >
                                        <button
                                            onClick={() => setPinTarget(chart)}
                                            className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity px-2.5 h-7 rounded-md bg-(--bg-secondary) border border-(--border-primary) hover:border-vanta-neon text-[11px] font-semibold text-(--text-secondary) hover:text-vanta-neon flex items-center gap-1"
                                            title="Pin to dashboard"
                                        >
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M12 17v5" />
                                                <path d="M9 11l-4 4v-3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3l-4-4" />
                                                <path d="M12 2l3 4h-6l3-4z" />
                                            </svg>
                                            Pin
                                        </button>
                                        <ChartRenderer chart={chart} height={300} />
                                    </div>
                                ))
                            ) : (
                                <div className="flex flex-col items-center justify-center text-(--text-muted) p-8 text-center min-h-[400px]">
                                    <div className="w-16 h-16 rounded-2xl bg-(--bg-secondary) border border-(--border-primary) mb-4 grid place-items-center">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                            <line x1="3" y1="9" x2="21" y2="9" />
                                            <line x1="9" y1="21" x2="9" y2="9" />
                                        </svg>
                                    </div>
                                    <h3 className="text-(--text-primary) font-medium mb-1">No charts yet</h3>
                                    <p className="text-sm max-w-xs">Ask Vanta to create a chart from your data.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Table Tab */}
                    {activeTab === "table" && (
                        <div className="p-4">
                            {tablePreview ? (
                                <div className="rounded-xl border border-(--border-primary) overflow-hidden">
                                    <div className="bg-(--bg-secondary) px-4 py-3 border-b border-(--border-primary) flex justify-between items-center">
                                        <h3 className="text-(--text-primary) font-medium text-sm">{tablePreview.fileName}</h3>
                                        <span className="text-(--text-muted) text-xs">
                                            {tablePreview.totalRows} rows × {tablePreview.totalColumns} cols
                                        </span>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="bg-(--bg-tertiary)">
                                                    {tablePreview.columns.map((col, idx) => (
                                                        <th key={idx} className="px-4 py-3 text-left text-(--text-muted) font-medium border-b border-(--border-primary) whitespace-nowrap">
                                                            {col}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {tablePreview.rows.slice(0, 20).map((row, rowIdx) => (
                                                    <tr key={rowIdx} className={rowIdx % 2 === 0 ? 'bg-(--bg-primary)' : 'bg-(--bg-tertiary)'}>
                                                        {/* Support both array rows and object rows */}
                                                        {Array.isArray(row)
                                                            ? (row as unknown[]).map((cell, cellIdx) => (
                                                                <td key={cellIdx} className="px-4 py-2 text-(--text-secondary) border-b border-(--border-secondary) whitespace-nowrap">
                                                                    {String(cell ?? '—')}
                                                                </td>
                                                            ))
                                                            : tablePreview.columns.map((col, cellIdx) => (
                                                                <td key={cellIdx} className="px-4 py-2 text-(--text-secondary) border-b border-(--border-secondary) whitespace-nowrap">
                                                                    {String((row as Record<string, unknown>)[col] ?? '—')}
                                                                </td>
                                                            ))
                                                        }
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    {tablePreview.rows.length > 20 && (
                                        <div className="px-4 py-2 bg-(--bg-tertiary) text-center text-(--text-muted) text-xs">
                                            Showing 20 of {tablePreview.totalRows} rows
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center text-(--text-muted) p-8 text-center min-h-[400px]">
                                    <p className="text-sm">Import a dataset to see the table view.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Insights Tab */}
                    {activeTab === "insights" && (
                        <div className="p-4 space-y-4">
                            {kpiInsights.length > 0 || bulletInsights.length > 0 ? (
                                <>
                                    {/* KPI Cards */}
                                    {kpiInsights.length > 0 && (
                                        <div className="grid grid-cols-2 gap-3">
                                            {kpiInsights.map((kpi, idx) => (
                                                <div key={idx} className="bg-(--bg-secondary) border border-(--border-primary) rounded-xl p-4">
                                                    <div className="text-lg mb-1">{kpi.icon}</div>
                                                    <div className="text-(--text-muted) text-xs">{kpi.label}</div>
                                                    <div className="text-(--text-primary) font-bold text-lg">{kpi.value}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Bullet Insights */}
                                    {bulletInsights.length > 0 && (
                                        <div className="bg-(--bg-secondary) border border-(--border-primary) rounded-xl p-4">
                                            <h4 className="text-(--text-primary) font-medium text-sm mb-3">Analysis Insights</h4>
                                            <ul className="space-y-2">
                                                {bulletInsights.map((insight, idx) => (
                                                    <li key={idx} className={`text-sm flex items-start gap-2 ${insight.type === 'warning' ? 'text-(--warning)' :
                                                        insight.type === 'success' ? 'text-(--success)' : 'text-(--text-secondary)'
                                                        }`}>
                                                        <span>{insight.type === 'warning' ? '⚠️' : insight.type === 'success' ? '✅' : '•'}</span>
                                                        <span>{insight.text}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </>
                            ) : currentDataset ? (
                                <div className="flex flex-col items-center justify-center text-(--text-muted) p-8 text-center min-h-[400px]">
                                    <p className="text-sm">Ask Vanta to analyze your data for insights.</p>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center text-(--text-muted) p-8 text-center min-h-[400px]">
                                    <p className="text-sm">Import a dataset to see insights.</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </section>

            <ChatSettingsDrawer
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                sessionId={sessionId}
                value={systemPrompt}
                onSaved={setSystemPrompt}
            />

            <PinToDashboard
                isOpen={!!pinTarget}
                onClose={() => setPinTarget(null)}
                chartSpec={pinTarget}
                title={pinTarget?.title}
            />

            <AttachFromLibraryModal
                isOpen={isAttachLibraryOpen}
                onClose={() => setIsAttachLibraryOpen(false)}
                sessionId={sessionId}
            />
        </div>
    );
}

/**
 * Derive a short list of insights from the ECharts-style chart data
 * returned by /execute-prompt. We avoid another LLM round-trip for
 * this — the charts already hold the aggregated numbers, and the
 * user gets immediate value in the Insights tab.
 */
function deriveInsights(charts: ChartSpec[]): Insight[] {
    const out: Insight[] = [];
    for (const chart of charts.slice(0, 3)) {
        const data = chart.data as {
            labels?: string[];
            datasets?: Array<{ label?: string; data?: number[] }>;
        } | undefined;
        const labels = data?.labels || [];
        const values = data?.datasets?.[0]?.data || [];
        if (!labels.length || !values.length) continue;

        // Top performer + its share of total.
        let maxIdx = 0;
        let sum = 0;
        let allNumeric = true;
        for (let i = 0; i < values.length; i += 1) {
            const v = Number(values[i]);
            if (!Number.isFinite(v)) { allNumeric = false; break; }
            sum += v;
            if (v > Number(values[maxIdx])) maxIdx = i;
        }
        if (!allNumeric || sum <= 0) continue;
        const topValue = Number(values[maxIdx]);
        const share = (topValue / sum) * 100;
        const yLabel = (data?.datasets?.[0]?.label) || chart.encoding?.y || "value";
        out.push({
            type: "kpi",
            label: `Top ${chart.encoding?.x || "category"}`,
            value: `${labels[maxIdx]}`,
            icon: "🏆",
            text: `${labels[maxIdx]} leads with ${formatNum(topValue)} ${yLabel} (${share.toFixed(1)}% of total).`,
        });

        if (values.length >= 2) {
            const min = Math.min(...(values as number[]));
            const max = Math.max(...(values as number[]));
            const spread = max - min;
            if (max > 0) {
                out.push({
                    type: spread / max > 0.5 ? "warning" : "bullet",
                    text: `Range: ${formatNum(min)} – ${formatNum(max)}${spread / max > 0.5
                        ? "  · very uneven distribution"
                        : "  · evenly spread"
                        }.`,
                });
            }
        }
    }
    return out;
}

function formatNum(n: number): string {
    if (!Number.isFinite(n)) return String(n);
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(Math.round(n * 100) / 100);
}
