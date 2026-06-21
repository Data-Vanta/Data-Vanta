const express = require('express');
const router = express.Router();
const memoryController = require('./memory.controller');
const { validateAuth } = require('../../middlewares/auth.middleware');

// All memory routes require auth.
router.get('/', validateAuth, memoryController.list);
router.post('/', validateAuth, memoryController.create);
router.delete('/:id', validateAuth, memoryController.remove);

module.exports = router;
