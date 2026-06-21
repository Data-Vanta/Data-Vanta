const FileRepository = require('./file.repository');
const fs = require('fs').promises; // Import fs.promises for async file operations

class FileService {
  constructor() {
    this.fileRepository = FileRepository;
  }

  async uploadFile(file, userId) {
    // ... (existing uploadFile logic)
    const fileData = {
      userId: userId,
      originalFilename: file.originalname,
      storagePath: file.path,
      mimetype: file.mimetype,
      sizeInBytes: file.size
    };
    return await this.fileRepository.create(fileData);
  }

  /**
   * Retrieves all files uploaded by a specific user.
   * @param {string} userId - The ID of the user.
   * @returns {Promise<object[]>}
   */
  async getFilesByUser(userId) {
    return await this.fileRepository.findAllByUserId(userId);
  }

  /**
   * Retrieves a single file by its ID, ensuring it belongs to the user.
   * @param {string} fileId - The ID of the file.
   * @param {string} userId - The ID of the user requesting the file.
   * @returns {Promise<object>}
   */
  async getFileById(fileId, userId) {
    const file = await this.fileRepository.findById(fileId);
    if (!file || file.userId !== userId) {
      throw { statusCode: 404, message: "File not found" };
    }
    return file;
  }

  /**
   * Deletes a file's record from the database and its physical file from the server.
   * @param {string} fileId - The ID of the file.
   * @param {string} userId - The ID of the user deleting the file.
   */
  async deleteFile(fileId, userId) {
    const file = await this.fileRepository.findById(fileId);
    if (!file || file.userId !== userId) {
      throw { statusCode: 404, message: "File not found" };
    }

    // 1. Delete the physical file from the 'uploads/' directory
    await fs.unlink(file.storagePath);

    // 2. Delete the record from the database
    await this.fileRepository.deleteById(fileId);
  }
}

module.exports = FileService;