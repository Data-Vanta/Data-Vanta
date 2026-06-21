const express = require('express');
const router = express.Router();
const controller = require('./dashboard.controller');
const { validateAuth } = require('../../middlewares/auth.middleware');

// Public read via signed token — NO auth.
router.get('/public/:token', controller.getByToken);
router.post('/public/:token/widgets/:widgetId/refresh', controller.refreshPublicWidget);

// Authenticated CRUD on dashboards owned by the user.
router.get('/', validateAuth, controller.list);
router.post('/', validateAuth, controller.create);

// Live preview for the widget builder — runs an unsaved query.
// Declared BEFORE /:id so "preview-widget" doesn't collide with id matching.
router.post('/preview-widget', validateAuth, controller.previewWidget);

router.get('/:id', validateAuth, controller.get);
router.patch('/:id', validateAuth, controller.update);
router.delete('/:id', validateAuth, controller.remove);

// Widgets nested under a dashboard.
router.post('/:id/widgets', validateAuth, controller.addWidget);
router.patch('/:id/widgets/:widgetId', validateAuth, controller.updateWidget);
router.delete('/:id/widgets/:widgetId', validateAuth, controller.removeWidget);
router.post('/:id/widgets/:widgetId/refresh', validateAuth, controller.refreshWidget);

module.exports = router;
