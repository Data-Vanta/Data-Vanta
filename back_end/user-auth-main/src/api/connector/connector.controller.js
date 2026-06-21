const asyncFun = require('../../middlewares/async.handler');
const response = require('../../utils/ApiResponse');
const { ConnectorCredential, toPublic } = require('./connector.model');
const { encrypt, decryptJson } = require('../../utils/crypto');

// Chart-API mounts /data/* and the /connectors/* endpoints at its root,
// not under /api/v1. DATA_ENGINE_URL conventionally points at
// http://host:port/api/v1 (for compat with the old lakehouse), so we
// strip the /api/v1 suffix when calling the connector endpoints.
const _ENGINE_RAW = process.env.DATA_ENGINE_URL || 'http://localhost:8000/api/v1';
const ENGINE_ROOT = _ENGINE_RAW.replace(/\/api\/v\d+\/?$/, '');

/** Thin HTTP client for the Chart-API connectors endpoints. */
async function callEngine(path, { token, body } = {}) {
    const res = await fetch(`${ENGINE_ROOT}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'x-auth-token': token } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    let payload;
    try { payload = await res.json(); }
    catch { payload = { detail: 'non-JSON response from engine' }; }
    if (!res.ok) {
        throw { statusCode: res.status, message: payload.detail || payload.message || `engine ${res.status}` };
    }
    return payload;
}

class ConnectorController {
    /** GET /api/v1/connectors */
    list = asyncFun(async (req, res) => {
        const rows = await ConnectorCredential.findAll({
            where: { userId: req.user.id },
            order: [['updated_at', 'DESC']],
        });
        return response.success(res, 'OK', rows.map(toPublic));
    });

    /** POST /api/v1/connectors
     *  Body: { type, name, config } — config never round-trips back out.
     */
    create = asyncFun(async (req, res) => {
        const { type, name, config } = req.body || {};
        if (!type || typeof type !== 'string') {
            return response.fail(res, 'type is required', [], 400);
        }
        if (!name || typeof name !== 'string' || !name.trim()) {
            return response.fail(res, 'name is required', [], 400);
        }
        if (!config || typeof config !== 'object') {
            return response.fail(res, 'config is required', [], 400);
        }
        let configEncrypted;
        try {
            configEncrypted = encrypt(config);
        } catch (e) {
            return response.fail(res, `Encryption error: ${e.message}`, [], 500);
        }
        const row = await ConnectorCredential.create({
            userId: req.user.id,
            type: type.toLowerCase(),
            name: name.trim(),
            configEncrypted,
        });
        return response.success(res, 'Created', toPublic(row), 201);
    });

    /** GET /api/v1/connectors/:id */
    get = asyncFun(async (req, res) => {
        const row = await ConnectorCredential.findOne({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!row) return response.fail(res, 'Not found', [], 404);
        return response.success(res, 'OK', toPublic(row));
    });

    /** PATCH /api/v1/connectors/:id  Body: { name?, config? } */
    update = asyncFun(async (req, res) => {
        const { name, config } = req.body || {};
        const row = await ConnectorCredential.findOne({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!row) return response.fail(res, 'Not found', [], 404);

        if (name !== undefined) {
            if (typeof name !== 'string' || !name.trim()) {
                return response.fail(res, 'name must be a non-empty string', [], 400);
            }
            row.name = name.trim();
        }
        if (config !== undefined) {
            if (!config || typeof config !== 'object') {
                return response.fail(res, 'config must be an object', [], 400);
            }
            row.configEncrypted = encrypt(config);
        }
        row.updatedAt = new Date();
        await row.save();
        return response.success(res, 'Updated', toPublic(row));
    });

    /** DELETE /api/v1/connectors/:id */
    remove = asyncFun(async (req, res) => {
        const n = await ConnectorCredential.destroy({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!n) return response.fail(res, 'Not found', [], 404);
        return response.success(res, 'Deleted', null, 204);
    });

    /** POST /api/v1/connectors/:id/test */
    test = asyncFun(async (req, res) => {
        const row = await ConnectorCredential.findOne({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!row) return response.fail(res, 'Not found', [], 404);
        const cfg = decryptJson(row.configEncrypted);
        const token = req.headers['x-auth-token'] || '';
        let result;
        try {
            result = await callEngine('/connectors/test', {
                token,
                body: { type: row.type, config: cfg },
            });
        } catch (e) {
            result = { ok: false, message: e.message };
        }
        row.lastTestedAt = new Date();
        row.lastTestOk = !!result.ok;
        row.lastTestMessage = result.message || null;
        await row.save();
        return response.success(res, 'Tested', result);
    });

    /** POST /api/v1/connectors/:id/tables — discover source tables */
    listRemoteTables = asyncFun(async (req, res) => {
        const row = await ConnectorCredential.findOne({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!row) return response.fail(res, 'Not found', [], 404);
        const cfg = decryptJson(row.configEncrypted);
        const token = req.headers['x-auth-token'] || '';
        const result = await callEngine('/connectors/list-tables', {
            token,
            body: { type: row.type, config: cfg },
        });
        return response.success(res, 'OK', result);
    });

    /** POST /api/v1/connectors/:id/sql  Body: { sql, rowLimit?, timeoutSec? }
     *  Live-mode read-only SELECT against the source DB. Returns
     *  { columns:[{name,type}], rows:[{...}] }. */
    runSql = asyncFun(async (req, res) => {
        const { sql, rowLimit, timeoutSec } = req.body || {};
        if (!sql || typeof sql !== 'string') {
            return response.fail(res, 'sql is required', [], 400);
        }
        const row = await ConnectorCredential.findOne({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!row) return response.fail(res, 'Not found', [], 404);
        const cfg = decryptJson(row.configEncrypted);
        const token = req.headers['x-auth-token'] || '';
        try {
            const result = await callEngine('/connectors/run-sql', {
                token,
                body: {
                    type: row.type,
                    config: cfg,
                    sql,
                    row_limit: Number.isFinite(rowLimit) ? rowLimit : 10000,
                    timeout_sec: Number.isFinite(timeoutSec) ? timeoutSec : 10,
                },
            });
            return response.success(res, 'OK', result);
        } catch (e) {
            return response.fail(res, e.message || 'Engine error', [], e.statusCode || 500);
        }
    });

    /** POST /api/v1/connectors/:id/columns  Body: { schema?, name } */
    listRemoteColumns = asyncFun(async (req, res) => {
        const { schema, name } = req.body || {};
        if (!name || typeof name !== 'string' || !name.trim()) {
            return response.fail(res, 'name is required', [], 400);
        }
        const row = await ConnectorCredential.findOne({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!row) return response.fail(res, 'Not found', [], 404);
        const cfg = decryptJson(row.configEncrypted);
        const token = req.headers['x-auth-token'] || '';
        const result = await callEngine('/connectors/list-columns', {
            token,
            body: {
                type: row.type,
                config: cfg,
                schema: typeof schema === 'string' ? schema : undefined,
                name: name.trim(),
            },
        });
        return response.success(res, 'OK', result);
    });

    /** POST /api/v1/connectors/:id/ingest  Body: { projectId, tables[] } */
    ingest = asyncFun(async (req, res) => {
        const { projectId, tables } = req.body || {};
        if (!projectId || !Array.isArray(tables) || tables.length === 0) {
            return response.fail(res, 'projectId and tables[] are required', [], 400);
        }
        const row = await ConnectorCredential.findOne({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!row) return response.fail(res, 'Not found', [], 404);
        const cfg = decryptJson(row.configEncrypted);
        const token = req.headers['x-auth-token'] || '';
        const result = await callEngine('/connectors/ingest', {
            token,
            body: {
                type: row.type,
                config: cfg,
                projectId,
                tables,
                connectorName: row.name,
            },
        });
        return response.success(res, 'Ingested', result);
    });
}

module.exports = new ConnectorController();
