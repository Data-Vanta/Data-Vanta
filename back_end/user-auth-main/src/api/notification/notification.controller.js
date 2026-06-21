const asyncFun = require('../../middlewares/async.handler');
const response = require('../../utils/ApiResponse');
const { Notification } = require('./notification.model');
const { Op } = require('sequelize');

class NotificationController {
    /** GET /api/v1/notifications?limit=50&unreadOnly=0 */
    list = asyncFun(async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        const where = { userId: req.user.id };
        if (req.query.unreadOnly === '1' || req.query.unreadOnly === 'true') {
            where.readAt = null;
        }
        const rows = await Notification.findAll({
            where,
            order: [['created_at', 'DESC']],
            limit,
        });
        const unread = await Notification.count({
            where: { userId: req.user.id, readAt: null },
        });
        return response.success(res, 'OK', { items: rows, unread });
    });

    /** POST /api/v1/notifications/:id/read */
    markRead = asyncFun(async (req, res) => {
        const [count] = await Notification.update(
            { readAt: new Date() },
            { where: { id: req.params.id, userId: req.user.id, readAt: null } }
        );
        return response.success(res, 'OK', { updated: count });
    });

    /** POST /api/v1/notifications/read-all */
    markAllRead = asyncFun(async (req, res) => {
        const [count] = await Notification.update(
            { readAt: new Date() },
            { where: { userId: req.user.id, readAt: null } }
        );
        return response.success(res, 'OK', { updated: count });
    });

    /** DELETE /api/v1/notifications/:id */
    remove = asyncFun(async (req, res) => {
        const destroyed = await Notification.destroy({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!destroyed) return response.fail(res, 'Not found', [], 404);
        return response.success(res, 'Deleted', null, 204);
    });

    /**
     * GET /api/v1/notifications/stream — Server-Sent Events poll.
     *
     * SSE with backend-side polling every 10s. When notifications newer
     * than the last seen ID exist, they're pushed down. The connection
     * stays open until the client disconnects. This is simpler than a
     * pub/sub fanout and works fine with one Node instance in dev.
     */
    stream = asyncFun(async (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        let lastCheck = new Date();

        const interval = setInterval(async () => {
            try {
                const newRows = await Notification.findAll({
                    where: {
                        userId: req.user.id,
                        createdAt: { [Op.gt]: lastCheck },
                    },
                    order: [['created_at', 'ASC']],
                });
                for (const row of newRows) {
                    res.write(`data: ${JSON.stringify(row)}\n\n`);
                }
                if (newRows.length > 0) {
                    lastCheck = newRows[newRows.length - 1].createdAt;
                }
                // Comment ping keeps any proxy from closing the connection.
                res.write(': ping\n\n');
            } catch (err) {
                // Don't crash the stream on a transient DB blip.
                res.write(`: error ${String(err).slice(0, 100)}\n\n`);
            }
        }, 10000);

        req.on('close', () => {
            clearInterval(interval);
            res.end();
        });
    });
}

module.exports = new NotificationController();
