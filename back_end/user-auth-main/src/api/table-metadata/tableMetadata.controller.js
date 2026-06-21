const asyncFun = require('../../middlewares/async.handler');
const response = require('../../utils/ApiResponse');
const { TableMetadata } = require('./tableMetadata.model');

class TableMetadataController {
    /** GET /api/v1/tables/:projectId/:tableName/metadata */
    get = asyncFun(async (req, res) => {
        const { projectId, tableName } = req.params;
        const row = await TableMetadata.findOne({
            where: { userId: req.user.id, projectId, tableName },
        });
        // Empty-but-not-an-error response keeps the frontend clean.
        return response.success(res, 'Metadata fetched', row || {
            projectId, tableName, alias: null, description: null, columnDescriptions: null,
        });
    });

    /** PUT /api/v1/tables/:projectId/:tableName/metadata
     *  Body: { alias?, description?, columnDescriptions? }
     */
    upsert = asyncFun(async (req, res) => {
        const { projectId, tableName } = req.params;
        const { alias, description, columnDescriptions } = req.body || {};

        if (alias !== undefined && alias !== null && typeof alias !== 'string') {
            return response.fail(res, 'alias must be a string or null', [], 400);
        }
        if (alias && alias.length > 200) {
            return response.fail(res, 'alias max 200 chars', [], 400);
        }
        if (description !== undefined && description !== null && typeof description !== 'string') {
            return response.fail(res, 'description must be a string or null', [], 400);
        }
        if (description && description.length > 4000) {
            return response.fail(res, 'description max 4000 chars', [], 400);
        }
        if (
            columnDescriptions !== undefined &&
            columnDescriptions !== null &&
            (typeof columnDescriptions !== 'object' || Array.isArray(columnDescriptions))
        ) {
            return response.fail(res, 'columnDescriptions must be an object', [], 400);
        }

        const [row] = await TableMetadata.upsert({
            userId: req.user.id,
            projectId,
            tableName,
            alias: alias === undefined ? undefined : alias,
            description: description === undefined ? undefined : description,
            columnDescriptions: columnDescriptions === undefined ? undefined : columnDescriptions,
        }, { returning: true });

        return response.success(res, 'Metadata saved', row);
    });
}

module.exports = new TableMetadataController();
