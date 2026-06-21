const ProcessResult = require('./process.model');

class ProcessRepository {
  /**
   * Finds an existing analysis result by its fileId.
   * This is used for the caching logic in the service.
   * @param {string} fileId - The UUID of the file.
   * @returns {Promise<object|null>} The analysis result object if found, otherwise null.
   */
  async findByFileId(fileId) {
    return await ProcessResult.findOne({ where: { fileId } });
  }

  /**
   * Creates a new analysis result record in the database.
   * @param {object} analysisData - The analysis data to be saved.
   * @returns {Promise<object>} The newly created analysis result object.
   */
  async create(analysisData) {
    return await ProcessResult.create(analysisData);
  }

  /**
   * Finds an analysis result by fileId and updates it if it exists,
   * or creates a new one if it does not.
   * @param {string} fileId - The UUID of the file.
   * @param {object} analysisData - The data to save.
   * @returns {Promise<object>} The created or updated analysis result object.
   */
  async createOrUpdate(fileId, analysisData) {
    const existingResult = await this.findByFileId(fileId);

    if (existingResult) {
      // If a result exists, update it
      await existingResult.update(analysisData);
      return existingResult;
    } else {
      // Otherwise, create a new one
      return await this.create(analysisData);
    }
  }
}

// Export a single instance
module.exports = new ProcessRepository();

