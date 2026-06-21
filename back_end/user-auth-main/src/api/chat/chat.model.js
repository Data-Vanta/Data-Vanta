// src/api/chat/chat.model.js
const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const ChatSession = sequelize.define('ChatSession', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id'
    },
    title: {
        type: DataTypes.STRING(255),
        allowNull: false,
        defaultValue: 'New Chat'
    },
    fileId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'file_id'
    },
    // Per-chat system prompt — describes the business/dataset/tone this
    // session should consider. Prepended to every turn's prompt.
    systemPrompt: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'system_prompt'
    },
    // 'visual' → existing JSON-chart pipeline; 'thinking' → code-agent SSE.
    mode: {
        type: DataTypes.ENUM('visual', 'thinking'),
        allowNull: false,
        defaultValue: 'visual'
    },
    // OpenRouter model id (e.g. anthropic/claude-sonnet-4.6 or
    // minimax/minimax-m2.5:free). null → use server default.
    modelId: {
        type: DataTypes.STRING(120),
        allowNull: true,
        field: 'model_id'
    },
    createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        field: 'created_at'
    },
    updatedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        field: 'updated_at'
    }
}, {
    tableName: 'chat_sessions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
});

const ChatMessage = sequelize.define('ChatMessage', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    sessionId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'session_id'
    },
    role: {
        type: DataTypes.ENUM('user', 'assistant'),
        allowNull: false
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        field: 'created_at'
    }
}, {
    tableName: 'chat_messages',
    timestamps: false
});

// Define relationships
ChatSession.hasMany(ChatMessage, { as: 'messages', foreignKey: 'session_id' });
ChatMessage.belongsTo(ChatSession, { as: 'session', foreignKey: 'session_id' });

const ChatSessionAttachment = require('./chatSessionAttachment.model');
ChatSession.hasMany(ChatSessionAttachment, {
    foreignKey: 'session_id',
    as: 'attachments',
    onDelete: 'CASCADE',
});
ChatSessionAttachment.belongsTo(ChatSession, {
    foreignKey: 'session_id',
});

module.exports = { ChatSession, ChatMessage };
