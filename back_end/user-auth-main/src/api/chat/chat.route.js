// src/api/chat/chat.route.js
const express = require("express");
const router = express.Router();
const chatController = require("./chat.controller");
const { validateAuth } = require('../../middlewares/auth.middleware');

// Session management endpoints
router.post("/sessions", validateAuth, chatController.createSession);
router.get("/sessions", validateAuth, chatController.getSessions);
router.get("/sessions/:sessionId", validateAuth, chatController.getSession);
router.put("/sessions/:sessionId", validateAuth, chatController.updateSession);
router.patch("/sessions/:sessionId/settings", validateAuth, chatController.updateSessionSettings);
router.post("/sessions/:sessionId/attachments", validateAuth, chatController.attachToSession);
router.delete("/sessions/:sessionId/attachments/:attachmentId", validateAuth, chatController.detachFromSession);
// CRITICAL ORDERING: bulk-delete must be registered BEFORE the per-session
// delete; otherwise DELETE /sessions matches /sessions/:sessionId with
// :sessionId="sessions" and silently does the wrong thing.
router.delete("/sessions", validateAuth, chatController.deleteAllSessions);
router.delete("/sessions/:sessionId", validateAuth, chatController.deleteSession);

// POST /api/v1/chat - Send a message and get analysis response
router.post("/", validateAuth, chatController.chat);

// GET /api/v1/chat/preview/:fileId - Get file data preview
router.get("/preview/:fileId", validateAuth, chatController.getPreview);

// GET /api/v1/chat/preview/lakehouse/:jobId - Get lakehouse data preview
router.get("/preview/lakehouse/:jobId", validateAuth, chatController.getLakehousePreview);

module.exports = router;
