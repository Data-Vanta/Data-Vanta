const asyncFun = require('../../middlewares/async.handler');
const response = require('../../utils/ApiResponse');
const FileService = require('./file.service');
const fs = require('fs');
const path = require('path');

const fileService = new FileService();

// Chart-API root — same trick the connector controller uses to drop the
// trailing /api/v1 from DATA_ENGINE_URL when forwarding to the data engine.
const _ENGINE_RAW = process.env.DATA_ENGINE_URL || 'http://localhost:8000/api/v1';
const ENGINE_ROOT = _ENGINE_RAW.replace(/\/api\/v\d+\/?$/, '');

class FileController {
  /**
   * Handles the file upload request after it has passed through all middleware.
   */
  uploadFile = asyncFun(async (req, res) => {
    // 1. A safety check to ensure a file was actually uploaded.
    //    The route-level middleware should catch most errors, but this is good practice.
    if (!req.file) {
      return response.fail(res, "No file was uploaded.", [], 400);
    }

    // 2. Call the service layer to handle the business logic.
    //    - req.file: The object containing file details from multer.
    //    - req.user.id: The user's ID, attached by the auth middleware.
    const newFile = await fileService.uploadFile(req.file, req.user.id);

    // 3. Send a successful response back to the client.
    //    - A 201 status code indicates that a new resource has been created.
    return response.success(res, "File uploaded successfully", newFile, 201);
  });

  /**
   * Handles request to get all files for the authenticated user.
   */
  getFiles = asyncFun(async (req, res) => {
    const files = await fileService.getFilesByUser(req.user.id);
    return response.success(res, "Files retrieved successfully", files);
  });

  /**
   * Handles request to get a single file by its ID.
   */
  getFile = asyncFun(async (req, res) => {
    const file = await fileService.getFileById(req.params.id, req.user.id);
    return response.success(res, "File retrieved successfully", file);
  });

  /**
   * POST /api/v1/file/:id/ingest
   * Body: { projectId?, tableName? } — both optional, sensible defaults.
   *
   * Reads the on-disk bytes of an already-uploaded file and re-streams
   * them to Chart-API /data/upload so the file lands in the DuckDB
   * warehouse and becomes queryable from widgets, the chat agent, and
   * the boards. Idempotent at the warehouse level: re-uploading the
   * same tableName overwrites the Parquet.
   */
  ingestExisting = asyncFun(async (req, res) => {
    const { projectId, tableName } = req.body || {};
    const file = await fileService.getFileById(req.params.id, req.user.id);
    if (!file) return response.fail(res, 'File not found', [], 404);

    const onDiskPath = file.storagePath;
    if (!onDiskPath || !fs.existsSync(onDiskPath)) {
      return response.fail(
        res,
        'File bytes are missing on disk. Re-upload via the sidebar.',
        [],
        410,
      );
    }

    const safeTableName =
      (tableName || path.parse(file.originalFilename || 'upload').name)
        .replace(/[^A-Za-z0-9_]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .toLowerCase()
      || 'upload';

    const fd = new FormData();
    const fileBuffer = await fs.promises.readFile(onDiskPath);
    fd.append(
      'file',
      new Blob([fileBuffer], { type: file.mimetype || 'application/octet-stream' }),
      file.originalFilename || `${safeTableName}.csv`,
    );
    fd.append('projectId', projectId || 'default');
    fd.append('tableName', safeTableName);

    const token = req.headers['x-auth-token'] || '';
    let payload;
    try {
      const engineRes = await fetch(`${ENGINE_ROOT}/data/upload`, {
        method: 'POST',
        headers: token ? { 'x-auth-token': token } : undefined,
        body: fd,
      });
      const text = await engineRes.text();
      try { payload = JSON.parse(text); } catch { payload = { detail: text.slice(0, 200) }; }
      if (!engineRes.ok) {
        return response.fail(
          res,
          payload.detail || payload.message || `Engine ${engineRes.status}`,
          [],
          engineRes.status,
        );
      }
    } catch (e) {
      return response.fail(res, `Engine unreachable: ${e.message}`, [], 502);
    }

    return response.success(res, 'Ingested', payload);
  });

  /**
   * Handles request to delete a file.
   */
  deleteFile = asyncFun(async (req, res) => {
    await fileService.deleteFile(req.params.id, req.user.id);
    // A 204 No Content response is standard for a successful deletion
    return response.success(res, "File deleted successfully", null, 204);
  });
}

module.exports = new FileController();