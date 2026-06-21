const express = require("express");
const router = express.Router();
const processController = require("./process.controller");
const { validateAuth } = require('../../middlewares/auth.middleware');


router.post(
  "/:fileId/analyze",
  validateAuth,
  processController.analyzeFile
);

router.post(
  "/:fileId/normalize-columns",
  validateAuth,
  processController.normalizeColumnNames
);

// Method: POST
// URL: /api/v1/process/:fileId/handle-missing
router.post(
  "/:fileId/handle-missing",
  validateAuth,
  processController.handleMissingValues
);

// --- Rollback Endpoint ---
// This route reverts the file to its last saved backup.
// Method: POST
// URL: /api/v1/process/:fileId/rollback
router.post(
  "/:fileId/rollback",
  validateAuth,
  processController.rollbackFile
);

module.exports = router;
