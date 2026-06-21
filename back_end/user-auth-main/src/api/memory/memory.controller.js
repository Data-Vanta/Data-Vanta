const asyncFun = require('../../middlewares/async.handler');
const response = require('../../utils/ApiResponse');
const { UserMemory } = require('./memory.model');

class MemoryController {
    /** GET /api/v1/profile/memories */
    list = asyncFun(async (req, res) => {
        const rows = await UserMemory.findAll({
            where: { userId: req.user.id },
            order: [['created_at', 'DESC']],
        });
        return response.success(res, 'Memories fetched', rows);
    });

    /** POST /api/v1/profile/memories  Body: { content: string } */
    create = asyncFun(async (req, res) => {
        const { content } = req.body;
        if (!content || typeof content !== 'string' || !content.trim()) {
            return response.fail(res, 'content is required', [], 400);
        }
        if (content.length > 2000) {
            return response.fail(res, 'content must be 2000 chars or fewer', [], 400);
        }
        const row = await UserMemory.create({
            userId: req.user.id,
            content: content.trim(),
        });
        return response.success(res, 'Memory saved', row, 201);
    });

    /** DELETE /api/v1/profile/memories/:id */
    remove = asyncFun(async (req, res) => {
        const deleted = await UserMemory.destroy({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!deleted) {
            return response.fail(res, 'Memory not found', [], 404);
        }
        return response.success(res, 'Memory deleted', null, 204);
    });
}

module.exports = new MemoryController();
