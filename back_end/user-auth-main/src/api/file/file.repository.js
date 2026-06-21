const File = require('./file.model');

class FileRepository {
  async create(fileData) {
    return await File.create(fileData);
  }

  async findAllByUserId(userId) {
    return await File.findAll({ where: { userId } });
  }

  async findById(id) {
    return await File.findOne({ where: { id } });
  }

  async deleteById(id) {
    return await File.destroy({ where: { id } });
  }

  async findByIdAndUserId(id, userId) {
    return await File.findOne({ where: { id, userId } });
  }
}

module.exports = new FileRepository();