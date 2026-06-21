const express = require('express');
const router = express.Router();
const controller = require('./connector.controller');
const { validateAuth } = require('../../middlewares/auth.middleware');

router.get('/', validateAuth, controller.list);
router.post('/', validateAuth, controller.create);
router.get('/:id', validateAuth, controller.get);
router.patch('/:id', validateAuth, controller.update);
router.delete('/:id', validateAuth, controller.remove);
router.post('/:id/test', validateAuth, controller.test);
router.post('/:id/tables', validateAuth, controller.listRemoteTables);
router.post('/:id/columns', validateAuth, controller.listRemoteColumns);
router.post('/:id/sql', validateAuth, controller.runSql);
router.post('/:id/ingest', validateAuth, controller.ingest);

module.exports = router;
