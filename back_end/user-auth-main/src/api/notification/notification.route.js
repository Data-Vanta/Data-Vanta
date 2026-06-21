const express = require('express');
const router = express.Router();
const controller = require('./notification.controller');
const { validateAuth } = require('../../middlewares/auth.middleware');

router.get('/', validateAuth, controller.list);
router.get('/stream', validateAuth, controller.stream);
router.post('/read-all', validateAuth, controller.markAllRead);
router.post('/:id/read', validateAuth, controller.markRead);
router.delete('/:id', validateAuth, controller.remove);

module.exports = router;
