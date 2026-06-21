// src/api/chat/chat.controller.js
const asyncFun = require('../../middlewares/async.handler');
const response = require('../../utils/ApiResponse');
const ChatService = require('./chat.service');
const ChatRepository = require('./chat.repository');

const chatService = new ChatService();

class ChatController {
    /**
     * Create a new chat session
     * POST /api/v1/chat/sessions
     */
    createSession = asyncFun(async (req, res) => {
        const { title, fileId } = req.body;
        const session = await ChatRepository.createSession(req.user.id, title, fileId);
        return response.success(res, "Session created", session, 201);
    });

    /**
     * Get all chat sessions for the user
     * GET /api/v1/chat/sessions
     */
    getSessions = asyncFun(async (req, res) => {
        const sessions = await ChatRepository.findSessionsByUserId(req.user.id);
        return response.success(res, "Sessions retrieved", sessions);
    });

    /**
     * Get a specific session with messages
     * GET /api/v1/chat/sessions/:sessionId
     */
    getSession = asyncFun(async (req, res) => {
        const { sessionId } = req.params;
        const session = await ChatRepository.findSessionById(sessionId);
        if (!session) {
            return response.fail(res, "Session not found", [], 404);
        }
        return response.success(res, "Session retrieved", session);
    });

    /**
     * Delete a chat session
     * DELETE /api/v1/chat/sessions/:sessionId
     */
    deleteSession = asyncFun(async (req, res) => {
        const { sessionId } = req.params;
        await ChatRepository.deleteSession(sessionId);
        return response.success(res, "Session deleted", null, 204);
    });

    /**
     * Bulk-delete every chat session (with messages and attachments) owned
     * by the authed user. Wired to the "Delete all chats" UI button.
     * DELETE /api/v1/chat/sessions
     */
    deleteAllSessions = asyncFun(async (req, res) => {
        const count = await ChatRepository.deleteAllSessionsForUser(req.user.id);
        return response.success(res, "All chats deleted", { deleted: count });
    });

    /**
     * Rename a chat session.
     * PUT /api/v1/chat/sessions/:sessionId  Body: { title: string }
     */
    updateSession = asyncFun(async (req, res) => {
        const { sessionId } = req.params;
        const { title } = req.body;
        if (!title || typeof title !== "string" || !title.trim()) {
            return response.fail(res, "title is required", [], 400);
        }
        const updated = await ChatRepository.updateSessionTitle(sessionId, req.user.id, title.trim());
        if (!updated) {
            return response.fail(res, "Session not found", [], 404);
        }
        return response.success(res, "Session renamed", updated);
    });

    /**
     * Attach a data source (uploaded file or connector table) to a chat session.
     * POST /api/v1/chat/sessions/:sessionId/attachments
     * Body: { kind, fileId?, projectId?, tableName?, alias?, position? }
     */
    attachToSession = asyncFun(async (req, res) => {
        const { sessionId } = req.params;
        const { kind, fileId, projectId, tableName } = req.body || {};

        if (kind !== 'file' && kind !== 'connector_table') {
            return response.fail(res, "kind must be 'file' or 'connector_table'", [], 400);
        }
        if (kind === 'file' && !fileId) {
            return response.fail(res, "fileId is required for kind='file'", [], 400);
        }
        if (kind === 'connector_table' && (!projectId || !tableName)) {
            return response.fail(res, "projectId and tableName are required for kind='connector_table'", [], 400);
        }

        const session = await ChatRepository.getSession(sessionId, req.user.id);
        if (!session) {
            return response.fail(res, "Session not found", [], 404);
        }
        const attachment = await ChatRepository.addAttachment(sessionId, req.body);
        return response.success(res, "Attachment added", attachment, 201);
    });

    /**
     * Detach a data source from a chat session.
     * DELETE /api/v1/chat/sessions/:sessionId/attachments/:attachmentId
     */
    detachFromSession = asyncFun(async (req, res) => {
        const { sessionId, attachmentId } = req.params;
        const session = await ChatRepository.getSession(sessionId, req.user.id);
        if (!session) {
            return response.fail(res, "Session not found", [], 404);
        }
        const removed = await ChatRepository.removeAttachment(sessionId, attachmentId);
        if (!removed) {
            return response.fail(res, "Attachment not found", [], 404);
        }
        return response.success(res, "Attachment removed", null, 204);
    });

    /**
     * Patch per-session settings used by Phase 2b thinking mode.
     * PATCH /api/v1/chat/sessions/:sessionId/settings
     * Body: { systemPrompt?: string|null, mode?: 'visual'|'thinking', modelId?: string|null }
     */
    updateSessionSettings = asyncFun(async (req, res) => {
        const { sessionId } = req.params;
        const { systemPrompt, mode, modelId } = req.body || {};

        if (mode !== undefined && mode !== 'visual' && mode !== 'thinking') {
            return response.fail(res, "mode must be 'visual' or 'thinking'", [], 400);
        }
        if (systemPrompt !== undefined && systemPrompt !== null && typeof systemPrompt !== 'string') {
            return response.fail(res, 'systemPrompt must be a string or null', [], 400);
        }
        if (systemPrompt && systemPrompt.length > 4000) {
            return response.fail(res, 'systemPrompt must be 4000 chars or fewer', [], 400);
        }
        if (modelId !== undefined && modelId !== null && typeof modelId !== 'string') {
            return response.fail(res, 'modelId must be a string or null', [], 400);
        }

        const updated = await ChatRepository.updateSessionSettings(sessionId, req.user.id, {
            systemPrompt,
            mode,
            modelId,
        });
        if (!updated) {
            return response.fail(res, 'Session not found', [], 404);
        }
        return response.success(res, 'Session settings updated', updated);
    });

    /**
     * Process a chat message and return analysis/chart suggestions
     * POST /api/v1/chat
     * Body: { message: string, fileId?: string, sessionId?: string }
     */
    chat = asyncFun(async (req, res) => {
        const { message, fileId, sessionId, reply, chartSpecs, insights, thinking } = req.body;

        if (!message || typeof message !== 'string') {
            return response.fail(res, "Message is required", [], 400);
        }

        // B7: validate the optional `thinking` payload BEFORE we touch the
        // database. A bad shape or oversized blob must not leave behind an
        // orphan user message or a freshly-created empty session.
        let safeThinking = null;
        if (thinking !== undefined && thinking !== null) {
            const isPlainObject =
                typeof thinking === 'object' &&
                !Array.isArray(thinking) &&
                thinking !== null;
            if (!isPlainObject) {
                return response.fail(res, 'thinking must be a plain object', [], 400);
            }
            let serializedSize;
            try {
                serializedSize = Buffer.byteLength(JSON.stringify(thinking), 'utf8');
            } catch (err) {
                // Circular refs, BigInt, etc.
                return response.fail(res, 'thinking is not serializable', [], 400);
            }
            // JSONB can hold up to ~1GB; cap defensively at 8 MB so chart-
            // heavy runs don't bloat a single row catastrophically. Pairs
            // with app.js's 10mb express.json limit (envelope headroom).
            if (serializedSize > 8_000_000) {
                return response.fail(res, 'Thinking payload too large', [], 413);
            }
            safeThinking = thinking;
        }

        // Accept a mode hint from the body so a brand-new session created by
        // this POST is tagged correctly. Anything other than 'thinking' or
        // 'visual' is ignored — the model default ('visual') still applies.
        const mode =
            req.body.mode === 'thinking' || req.body.mode === 'visual'
                ? req.body.mode
                : undefined;

        // Guard against invalid UUIDs — fileId column is UUID type.
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const safeFileId = fileId && uuidRe.test(String(fileId)) ? fileId : null;

        // Create session if not provided
        let activeSessionId = sessionId;
        if (!activeSessionId) {
            const newSession = await ChatRepository.createSession(
                req.user.id,
                message.slice(0, 60) || 'New chat',
                safeFileId,
                mode,
            );
            activeSessionId = newSession.id;
        }

        // Save user message
        await ChatRepository.addMessage(activeSessionId, 'user', message);

        // Build the assistant-message metadata. We only include keys when
        // they have content so we don't store empty arrays for every turn.
        const buildMeta = (charts, ins) => {
            const meta = {};
            if (Array.isArray(charts) && charts.length) meta.chartSpecs = charts;
            if (Array.isArray(ins) && ins.length) meta.insights = ins;
            if (safeThinking) meta.thinking = safeThinking;
            return Object.keys(meta).length ? meta : null;
        };

        // Fast path: when the caller already computed the reply + charts
        // (e.g. the lakehouse chat flow calls Chart-API directly and just
        // wants to persist the turn), skip processMessage entirely. This
        // keeps the saved history consistent with what the user saw
        // instead of the generic "I couldn't find that dataset" fallback.
        if (typeof reply === 'string' && reply.length) {
            const result = {
                reply,
                chartSpecs: Array.isArray(chartSpecs) ? chartSpecs : [],
                insights: Array.isArray(insights) ? insights : [],
                tablePreview: null,
                sessionId: activeSessionId,
            };
            await ChatRepository.addMessage(
                activeSessionId,
                'assistant',
                reply,
                buildMeta(result.chartSpecs, result.insights),
            );
            return response.success(res, 'Message persisted', result);
        }

        // Normal path: user-auth derives the reply from local File records.
        const result = await chatService.processMessage(message, safeFileId, req.user.id);

        // Save assistant response
        await ChatRepository.addMessage(
            activeSessionId,
            'assistant',
            result.reply,
            buildMeta(result.chartSpecs, result.insights),
        );

        // Include sessionId in response
        result.sessionId = activeSessionId;

        return response.success(res, "Message processed", result);
    });

    /**
     * Get file preview data (parsed rows)
     * GET /api/v1/chat/preview/:fileId
     */
    getPreview = asyncFun(async (req, res) => {
        const { fileId } = req.params;
        const limit = parseInt(req.query.limit) || 100;

        const preview = await chatService.getFilePreview(fileId, req.user.id, limit);
        return response.success(res, "Preview retrieved", preview);
    });

    /**
     * Get lakehouse data preview (from MinIO via datalakehouse)
     * GET /api/v1/chat/preview/lakehouse/:jobId
     * Query: projectId, tableName, limit
     */
    getLakehousePreview = asyncFun(async (req, res) => {
        const { jobId } = req.params;
        const { projectId, tableName } = req.query;
        const limit = parseInt(req.query.limit) || 50;

        if (!projectId || !tableName) {
            return response.fail(res, "projectId and tableName are required", [], 400);
        }

        // Forward the caller's auth token so the Chart-API engine can
        // identify the user. validateAuth already verified it.
        const token = req.headers['x-auth-token'] || '';
        const preview = await chatService.getLakehousePreview(
            jobId,
            projectId,
            tableName,
            limit,
            token
        );
        return response.success(res, "Preview retrieved", preview);
    });
}

module.exports = new ChatController();
