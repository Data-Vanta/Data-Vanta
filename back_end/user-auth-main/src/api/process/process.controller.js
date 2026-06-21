const asyncFun = require('../../middlewares/async.handler');
const response = require('../../utils/ApiResponse');
const ProcessService = require('./process.service');

// Create a single instance of the service for this controller to use
const processService = new ProcessService();

class ProcessController {

  /**
   * Handles the request to analyze a file. It calls the service which
   * will either perform a new analysis or return a cached result.
   */
  analyzeFile = asyncFun(async (req, res) => {
    const analysis = await processService.analyzeFile(req.params.fileId, req.user.id);
    return response.success(res, "File analysis complete", analysis);
  });

  /**
   * Handles the request to normalize a file's column names.
   */
  normalizeColumnNames = asyncFun(async (req, res) => {
    const updatedFile = await processService.normalizeColumnNames(req.params.fileId, req.user.id);
    return response.success(res, "Column names normalized successfully", updatedFile);
  });

  /**
   * Handles the request to clean missing values from a file.
   * The options (column, strategy, fillValue) are passed in the request body.
   */
  handleMissingValues = asyncFun(async (req, res) => {
    const updatedFile = await processService.handleMissingValues(req.params.fileId, req.user.id, req.body);
    return response.success(res, "Missing values handled successfully", updatedFile);
  });
  
  /**
   * Handles the request to roll back a file to its last saved version.
   */
  rollbackFile = asyncFun(async (req, res) => {
    const rolledBackFile = await processService.rollbackFile(req.params.fileId, req.user.id);
    return response.success(res, "File rolled back to previous version", rolledBackFile);
  });
}

// Export a single instance for the routes to use
module.exports = new ProcessController();
