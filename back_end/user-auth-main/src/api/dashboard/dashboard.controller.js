const crypto = require('crypto');
const asyncFun = require('../../middlewares/async.handler');
const response = require('../../utils/ApiResponse');
const { Dashboard, DashboardWidget } = require('./dashboard.model');

// Chart-API exposes /widget/query at its root (not under /api/v1). Mirror the
// connector controller's normalization so DATA_ENGINE_URL can keep its trailing
// /api/v1 for compat with the legacy lakehouse mount.
const _ENGINE_RAW = process.env.DATA_ENGINE_URL || 'http://localhost:8000/api/v1';
const ENGINE_ROOT = _ENGINE_RAW.replace(/\/api\/v\d+\/?$/, '');

async function callEngine(path, token, body) {
    // Calls our OWN user-auth gateway over HTTP — used to keep credential
    // decryption and the engine forward in one place. Could be refactored
    // to a direct in-process function call if perf becomes an issue.
    const baseUrl = process.env.USER_AUTH_INTERNAL_URL || 'http://localhost:5000';
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'x-auth-token': token } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    let payload;
    try { payload = await res.json(); }
    catch { payload = { message: 'non-JSON response' }; }
    if (!res.ok) {
        throw {
            statusCode: res.status,
            message: payload.message || `gateway ${res.status}`,
        };
    }
    return payload;
}

async function callEngineWidgetQuery({ token, body }) {
    const res = await fetch(`${ENGINE_ROOT}/widget/query`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'x-auth-token': token } : {}),
        },
        body: JSON.stringify(body),
    });
    let payload;
    try { payload = await res.json(); }
    catch { payload = { detail: 'non-JSON response from engine' }; }
    if (!res.ok) {
        throw {
            statusCode: res.status,
            message: payload.detail || payload.message || `engine ${res.status}`,
        };
    }
    return payload;
}

async function callEngineWidgetQueryInternal({ body }) {
    const secret = process.env.INTERNAL_SHARED_SECRET;
    if (!secret) {
        throw {
            statusCode: 500,
            message: 'INTERNAL_SHARED_SECRET is not configured on the gateway',
        };
    }
    const res = await fetch(`${ENGINE_ROOT}/widget/query-internal`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': secret,
        },
        body: JSON.stringify(body),
    });
    let payload;
    try { payload = await res.json(); }
    catch { payload = { detail: 'non-JSON response from engine' }; }
    if (!res.ok) {
        throw {
            statusCode: res.status,
            message: payload.detail || payload.message || `engine ${res.status}`,
        };
    }
    return payload;
}

function randomShareToken() {
    return crypto.randomBytes(16).toString('hex'); // 32-char hex
}

class DashboardController {
    /** GET /api/v1/dashboards */
    list = asyncFun(async (req, res) => {
        const rows = await Dashboard.findAll({
            where: { userId: req.user.id },
            order: [['updated_at', 'DESC']],
        });
        return response.success(res, 'Dashboards fetched', rows);
    });

    /** POST /api/v1/dashboards  Body: { name, description?, visibility? } */
    create = asyncFun(async (req, res) => {
        const { name, description, visibility } = req.body || {};
        if (!name || typeof name !== 'string' || !name.trim()) {
            return response.fail(res, 'name is required', [], 400);
        }
        if (name.length > 200) {
            return response.fail(res, 'name max 200 chars', [], 400);
        }
        const row = await Dashboard.create({
            userId: req.user.id,
            name: name.trim(),
            description: description || null,
            visibility: ['private', 'team', 'public-link'].includes(visibility) ? visibility : 'private',
            shareToken: visibility === 'public-link' ? randomShareToken() : null,
        });
        return response.success(res, 'Dashboard created', row, 201);
    });

    /** GET /api/v1/dashboards/:id — includes widgets */
    get = asyncFun(async (req, res) => {
        const row = await Dashboard.findOne({
            where: { id: req.params.id, userId: req.user.id },
            include: [{ model: DashboardWidget, as: 'widgets' }],
        });
        if (!row) return response.fail(res, 'Dashboard not found', [], 404);
        return response.success(res, 'Dashboard fetched', row);
    });

    /** PATCH /api/v1/dashboards/:id  Body: { name?, description?, visibility? } */
    update = asyncFun(async (req, res) => {
        const { name, description, visibility } = req.body || {};
        const row = await Dashboard.findOne({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!row) return response.fail(res, 'Dashboard not found', [], 404);

        if (name !== undefined) {
            if (!name || typeof name !== 'string' || name.length > 200) {
                return response.fail(res, 'name must be a string (<=200)', [], 400);
            }
            row.name = name.trim();
        }
        if (description !== undefined) row.description = description;
        if (visibility !== undefined) {
            if (!['private', 'team', 'public-link'].includes(visibility)) {
                return response.fail(res, 'invalid visibility', [], 400);
            }
            row.visibility = visibility;
            // Issue a share token the first time we flip to public-link.
            if (visibility === 'public-link' && !row.shareToken) {
                row.shareToken = randomShareToken();
            }
            if (visibility !== 'public-link') row.shareToken = null;
        }
        row.updatedAt = new Date();
        await row.save();
        return response.success(res, 'Dashboard updated', row);
    });

    /** DELETE /api/v1/dashboards/:id */
    remove = asyncFun(async (req, res) => {
        const destroyed = await Dashboard.destroy({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!destroyed) return response.fail(res, 'Dashboard not found', [], 404);
        return response.success(res, 'Deleted', null, 204);
    });

    // -------- Widgets --------

    /** POST /api/v1/dashboards/:id/widgets  Body: { type, config, gridX?, gridY?, gridW?, gridH? } */
    addWidget = asyncFun(async (req, res) => {
        const owner = await Dashboard.findOne({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!owner) return response.fail(res, 'Dashboard not found', [], 404);

        const { type, config, gridX, gridY, gridW, gridH } = req.body || {};
        if (!type || typeof type !== 'string') {
            return response.fail(res, 'type is required', [], 400);
        }
        const widget = await DashboardWidget.create({
            dashboardId: owner.id,
            type,
            config: config || {},
            gridX: Number.isInteger(gridX) ? gridX : 0,
            gridY: Number.isInteger(gridY) ? gridY : 0,
            gridW: Number.isInteger(gridW) ? gridW : 6,
            gridH: Number.isInteger(gridH) ? gridH : 4,
        });
        // Touch parent so it sorts to top of the list.
        owner.updatedAt = new Date();
        await owner.save();
        return response.success(res, 'Widget added', widget, 201);
    });

    /** PATCH /api/v1/dashboards/:id/widgets/:widgetId */
    updateWidget = asyncFun(async (req, res) => {
        const owner = await Dashboard.findOne({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!owner) return response.fail(res, 'Dashboard not found', [], 404);

        const widget = await DashboardWidget.findOne({
            where: { id: req.params.widgetId, dashboardId: owner.id },
        });
        if (!widget) return response.fail(res, 'Widget not found', [], 404);

        const { type, config, gridX, gridY, gridW, gridH } = req.body || {};
        if (type !== undefined) widget.type = type;
        if (config !== undefined) widget.config = config;
        if (Number.isInteger(gridX)) widget.gridX = gridX;
        if (Number.isInteger(gridY)) widget.gridY = gridY;
        if (Number.isInteger(gridW)) widget.gridW = gridW;
        if (Number.isInteger(gridH)) widget.gridH = gridH;
        widget.updatedAt = new Date();
        await widget.save();
        return response.success(res, 'Widget updated', widget);
    });

    /** DELETE /api/v1/dashboards/:id/widgets/:widgetId */
    removeWidget = asyncFun(async (req, res) => {
        const owner = await Dashboard.findOne({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!owner) return response.fail(res, 'Dashboard not found', [], 404);

        const destroyed = await DashboardWidget.destroy({
            where: { id: req.params.widgetId, dashboardId: owner.id },
        });
        if (!destroyed) return response.fail(res, 'Widget not found', [], 404);
        return response.success(res, 'Widget deleted', null, 204);
    });

    /**
     * POST /api/v1/dashboards/preview-widget
     * Body: { source:{projectId,tableName}, fields, chartType, title?, rowLimit? }
     *
     * Runs an unsaved widget query against the user's warehouse and returns
     * the resulting chart spec. Used by the widget builder for live preview
     * before save.
     */
    previewWidget = asyncFun(async (req, res) => {
        const { source, fields, chartType, title, rowLimit } = req.body || {};
        if (!source || !source.projectId || !source.tableName) {
            return response.fail(res, 'source.projectId and source.tableName are required', [], 400);
        }
        if (!fields || typeof fields !== 'object') {
            return response.fail(res, 'fields object is required', [], 400);
        }
        if (!chartType || typeof chartType !== 'string') {
            return response.fail(res, 'chartType is required', [], 400);
        }
        const token = req.headers['x-auth-token'] || '';
        try {
            const payload = await callEngineWidgetQuery({
                token,
                body: {
                    project_id: source.projectId,
                    table_name: source.tableName,
                    fields,
                    chart_type: chartType,
                    row_limit: Number.isFinite(rowLimit) ? rowLimit : 5000,
                    title: title || null,
                },
            });
            return response.success(res, 'OK', payload);
        } catch (e) {
            return response.fail(res, e.message || 'Engine error', [], e.statusCode || 500);
        }
    });

    /**
     * POST /api/v1/dashboards/:id/widgets/:widgetId/refresh[?reingest=true]
     *
     * Re-runs the saved query for a `type='query'` widget and returns the
     * latest chart spec. With `?reingest=true` AND when the widget config
     * carries `source.connectorId/sourceSchema/sourceName`, the controller
     * re-pulls that table from the source DB before running the query.
     * Other widget types are pass-through (return their existing config).
     */
    refreshWidget = asyncFun(async (req, res) => {
        const owner = await Dashboard.findOne({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!owner) return response.fail(res, 'Dashboard not found', [], 404);

        const widget = await DashboardWidget.findOne({
            where: { id: req.params.widgetId, dashboardId: owner.id },
        });
        if (!widget) return response.fail(res, 'Widget not found', [], 404);

        if (widget.type !== 'query') {
            return response.success(res, 'Static widget', { chartSpec: widget.config?.chartSpec || null });
        }

        const cfg = widget.config || {};
        const source = cfg.source || {};
        let fields = cfg.fields || {};
        const chartType = cfg.chartType || 'bar_chart';
        if (!source.projectId || !source.tableName) {
            return response.fail(res, 'widget.source is incomplete', [], 400);
        }

        // Phase 13 — board-level cross-filters merged into the widget's
        // saved filters. Each entry: {col, op, value}. We don't dedupe;
        // the same field can have multiple constraints (e.g. between).
        const extraFilters = Array.isArray(req.body?.extraFilters) ? req.body.extraFilters : [];
        if (extraFilters.length > 0) {
            const existing = Array.isArray(fields.filters) ? fields.filters : [];
            fields = { ...fields, filters: [...existing, ...extraFilters] };
        }

        const token = req.headers['x-auth-token'] || '';

        const wantsReingest =
            String(req.query.reingest || '').toLowerCase() === 'true' ||
            cfg.reingestOnRefresh === true;
        if (wantsReingest && source.kind === 'connector_table' && source.connectorId && source.sourceName) {
            try {
                await callEngine(`/api/v1/connectors/${source.connectorId}/ingest`, token, {
                    projectId: source.projectId,
                    tables: [{ schema: source.sourceSchema, name: source.sourceName }],
                });
            } catch (e) {
                // Re-ingest failure shouldn't kill the refresh — log and fall
                // through so the widget still shows the cached data.
                console.warn(
                    `widget reingest failed for ${owner.id}/${widget.id}: ${e.message || e}`,
                );
            }
        }

        try {
            const payload = await callEngineWidgetQuery({
                token,
                body: {
                    project_id: source.projectId,
                    table_name: source.tableName,
                    fields,
                    chart_type: chartType,
                    row_limit: Number.isFinite(cfg.rowLimit) ? cfg.rowLimit : 5000,
                    title: cfg.title || null,
                },
            });
            return response.success(res, 'OK', payload);
        } catch (e) {
            return response.fail(res, e.message || 'Engine error', [], e.statusCode || 500);
        }
    });

    /**
     * POST /api/v1/dashboards/public/:token/widgets/:widgetId/refresh
     * No auth — anyone with the share token can refresh public-link widgets.
     * Runs against the dashboard owner's warehouse via the internal engine
     * endpoint (gated by INTERNAL_SHARED_SECRET).
     */
    refreshPublicWidget = asyncFun(async (req, res) => {
        const owner = await Dashboard.findOne({
            where: { shareToken: req.params.token, visibility: 'public-link' },
        });
        if (!owner) return response.fail(res, 'Not found', [], 404);

        const widget = await DashboardWidget.findOne({
            where: { id: req.params.widgetId, dashboardId: owner.id },
        });
        if (!widget) return response.fail(res, 'Widget not found', [], 404);

        if (widget.type !== 'query') {
            // Static widgets just return their config — no live re-query.
            return response.success(res, 'Static widget', { chartSpec: widget.config?.chartSpec || null });
        }

        const cfg = widget.config || {};
        const source = cfg.source || {};
        if (!source.projectId || !source.tableName) {
            return response.fail(res, 'widget.source is incomplete', [], 400);
        }

        try {
            const payload = await callEngineWidgetQueryInternal({
                body: {
                    user_id: owner.userId,
                    project_id: source.projectId,
                    table_name: source.tableName,
                    fields: cfg.fields || {},
                    chart_type: cfg.chartType || 'bar_chart',
                    row_limit: Number.isFinite(cfg.rowLimit) ? cfg.rowLimit : 5000,
                    title: cfg.title || null,
                },
            });
            return response.success(res, 'OK', payload);
        } catch (e) {
            return response.fail(res, e.message || 'Engine error', [], e.statusCode || 500);
        }
    });

    // -------- Public (signed-link) read --------

    /**
     * GET /api/v1/dashboards/public/:token — no auth required; returns a
     * read-only snapshot when the dashboard is 'public-link' visible and
     * the token matches.
     */
    getByToken = asyncFun(async (req, res) => {
        const row = await Dashboard.findOne({
            where: { shareToken: req.params.token, visibility: 'public-link' },
            include: [{ model: DashboardWidget, as: 'widgets' }],
        });
        if (!row) return response.fail(res, 'Not found', [], 404);
        // Strip the ownership fields from the public view.
        const safe = row.toJSON();
        delete safe.userId;
        delete safe.teamId;
        return response.success(res, 'Dashboard fetched', safe);
    });
}

module.exports = new DashboardController();
