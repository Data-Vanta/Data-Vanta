// src/api/file/file.route.js
const express = require("express");
const router = express.Router();
const fileController = require("./file.controller");
const createUploadMiddleware = require('../../middlewares/upload');
const { validateAuth } = require('../../middlewares/auth.middleware');
const response = require('../../utils/ApiResponse');
const multer = require('multer');

// Support CSV and Excel formats
const fileUpload = createUploadMiddleware({
  allowedMimeTypes: [
    'text/csv',
    'application/vnd.ms-excel', // .xls
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' // .xlsx
  ],
  maxSize: 1024 * 1024 * 100 // 100 MB limit for Excel files
});


const uploadMiddleware = fileUpload.single('file');

router.post(
  "/upload", validateAuth,
  (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (err instanceof multer.MulterError) { // Catches errors from multer (e.g., file too large)
        return response.fail(res, err.message, [], 400);
      } else if (err) { // Catches our custom errors (e.g., wrong file type)
        return response.fail(res, err.message, [], 400);
      }
      // If no errors, proceed to the controller
      next();
    });
  }, fileController.uploadFile
);


// GET /api/v1/files/ -> Get all files for the logged-in user
router.get("/", validateAuth, fileController.getFiles);

// GET /api/v1/files/:id -> Get a single file by its ID
router.get("/:id", validateAuth, fileController.getFile);

// POST /api/v1/file/:id/ingest -> Re-stream the file bytes into the warehouse
router.post("/:id/ingest", validateAuth, fileController.ingestExisting);

// DELETE /api/v1/files/:id -> Delete a file by its ID
router.delete("/:id", validateAuth, fileController.deleteFile);


module.exports = router;