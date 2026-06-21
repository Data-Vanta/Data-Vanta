const express = require('express');
const router = express.Router();
const controller = require('./tableMetadata.controller');
const { validateAuth } = require('../../middlewares/auth.middleware');

// /api/v1/tables/:projectId/:tableName/metadata
router.get('/:projectId/:tableName/metadata', validateAuth, controller.get);
router.put('/:projectId/:tableName/metadata', validateAuth, controller.upsert);

module.exports = router;
