// src/api/chat/chat.repository.js
const { ChatSession, ChatMessage } = require('./chat.model');
const ChatSessionAttachment = require('./chatSessionAttachment.model');

class ChatRepository {
    async createSession(userId, title = 'New Chat', fileId = null, mode = undefined) {
        const payload = {
            userId,
            title,
            fileId,
        };
        // Only include `mode` when the caller explicitly opted in. The model
        // already defaults to 'visual', so omitting it preserves the existing
        // behaviour for every legacy 3-arg caller.
        if (mode === 'visual' || mode === 'thinking') {
            payload.mode = mode;
        }
        return await ChatSession.create(payload);
    }

    async findSessionsByUserId(userId) {
        return await ChatSession.findAll({
            where: { userId },
            order: [['updated_at', 'DESC']],
            limit: 50
        });
    }

    async findSessionById(sessionId) {
        return await ChatSession.findByPk(sessionId, {
            include: [
                {
                    association: 'messages',
                    order: [['created_at', 'ASC']]
                },
                {
                    association: 'attachments'
                }
            ]
        });
    }

    /**
     * Lightweight ownership-scoped lookup. Returns the session row only when
     * it belongs to the supplied user. Used by attachment / settings handlers
     * that need a "does this user own this session?" gate without paying the
     * cost of eager-loading messages.
     */
    async getSession(sessionId, userId) {
        return await ChatSession.findOne({ where: { id: sessionId, userId } });
    }

    async updateSessionTitle(sessionId, userId, title) {
        // Ownership-scoped rename: a user can't touch another user's sessions.
        const session = await ChatSession.findOne({ where: { id: sessionId, userId } });
        if (!session) return null;
        session.title = title;
        session.updatedAt = new Date();
        await session.save();
        return session;
    }

    /**
     * Patch per-session settings: system prompt, mode ("visual" | "thinking"),
     * and/or OpenRouter model id. Ownership-scoped — silently ignores
     * sessions the user doesn't own.
     */
    async updateSessionSettings(sessionId, userId, { systemPrompt, mode, modelId }) {
        const session = await ChatSession.findOne({ where: { id: sessionId, userId } });
        if (!session) return null;
        if (systemPrompt !== undefined) session.systemPrompt = systemPrompt;
        if (mode !== undefined) session.mode = mode;
        if (modelId !== undefined) session.modelId = modelId;
        session.updatedAt = new Date();
        await session.save();
        return session;
    }

    async deleteSession(sessionId) {
        await ChatMessage.destroy({ where: { sessionId } });
        return await ChatSession.destroy({ where: { id: sessionId } });
    }

    /**
     * Bulk-delete every chat session (and its messages + attachments) owned
     * by the given user. Used by the "Delete all chats" UI action.
     *
     * Order matters: dependents first, then sessions. The
     * chat_session_attachments FK has ON DELETE CASCADE so destroying
     * sessions would auto-clear attachments, but we delete them explicitly
     * for symmetry with chat_messages (which has no CASCADE) and to be
     * safe against any pre-A1 attachment rows that may pre-date the FK.
     *
     * Returns the number of sessions deleted (0 when the user has none).
     */
    async deleteAllSessionsForUser(userId) {
        const sessions = await ChatSession.findAll({ where: { userId } });
        const ids = sessions.map((s) => s.id);
        if (ids.length === 0) return 0;
        await ChatMessage.destroy({ where: { sessionId: ids } });
        await ChatSessionAttachment.destroy({ where: { session_id: ids } });
        return await ChatSession.destroy({ where: { id: ids } });
    }

    async addMessage(sessionId, role, content, metadata = null) {
        const message = await ChatMessage.create({
            sessionId,
            role,
            content,
            metadata
        });

        // Update session's updatedAt
        await ChatSession.update(
            { updatedAt: new Date() },
            { where: { id: sessionId } }
        );

        return message;
    }

    async getMessages(sessionId) {
        return await ChatMessage.findAll({
            where: { sessionId },
            order: [['created_at', 'ASC']]
        });
    }

    /**
     * Attach a file or connector table to a chat session. Controllers pass
     * camelCase keys; the ChatSessionAttachment model uses snake_case
     * attribute names directly (underscored: true) so we translate here.
     */
    async addAttachment(sessionId, attachment) {
        const {
            kind,
            fileId = null,
            projectId = null,
            tableName = null,
            alias = null,
            position = 0,
        } = attachment;
        return await ChatSessionAttachment.create({
            session_id: sessionId,
            kind,
            file_id: fileId,
            project_id: projectId,
            table_name: tableName,
            alias,
            position,
        });
    }

    async listAttachments(sessionId) {
        return await ChatSessionAttachment.findAll({
            where: { session_id: sessionId },
            order: [['position', 'ASC'], ['created_at', 'ASC']],
        });
    }

    async removeAttachment(sessionId, attachmentId) {
        return await ChatSessionAttachment.destroy({
            where: { id: attachmentId, session_id: sessionId },
        });
    }
}

module.exports = new ChatRepository();
