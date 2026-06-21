const dfw = require('../../utils/dataframe-wrapper');
const fs = require('fs').promises;
const path = require('path');
const FileRepository = require('../file/file.repository');
const ProcessRepository = require('./process.repository');

class ProcessService {
  constructor() {
    this.processRepository = ProcessRepository;
    this.fileRepository = FileRepository;
    
    this.csvReadOptions = {
      header: true,
      delimiter: ",",
      skipEmptyLines: true,
      encoding: "utf8",
      dynamicTyping: true,
    };
  }

  // ===============================================
  // ==        ANALYSIS METHODS                   ==
  // ===============================================

  async analyzeFile(fileId, userId) {
    const file = await this.fileRepository.findByIdAndUserId(fileId, userId);
    if (!file) {
      throw { statusCode: 404, message: "File not found or access denied" };
    }

   const existingAnalysis = await this.processRepository.findByFileId(fileId);
   if (existingAnalysis && file.updatedAt <= existingAnalysis.updatedAt) {
     console.log('Returning cached analysis result.');
     return existingAnalysis;
   }
    
    console.log('Performing new file analysis.');
    const df = await dfw.readCSV(file.storagePath, this.csvReadOptions);

    const analysisData = {
      fileId,
      metadata: this.getMetadata(df),
      missingValues: this.getMissingValues(df),
      summaryStatistics: this.getSummaryStatistics(df),
      uniqueValues: this.getUniqueValues(df),
      status: 'COMPLETED'
    };

    return await this.processRepository.createOrUpdate(fileId, analysisData);
  }

  getMetadata(df) {
    return df.getMetadata();
  }


  getSummaryStatistics(df) {
    return df.getSummaryStatistics();
  }

  getMissingValues(df) {
    return df.getMissingValues();
  }

  getUniqueValues(df) {
    return df.getUniqueValues();
  }

  // ===============================================
  // ==      DATA TRANSFORMATION METHODS          ==
  // ===============================================

  async normalizeColumnNames(fileId, userId) {
    const file = await this.fileRepository.findByIdAndUserId(fileId, userId);
    if (!file) {
      throw { statusCode: 404, message: "File not found or access denied" };
    }

    let df = await dfw.readCSV(file.storagePath, this.csvReadOptions);

    const newColumns = df.columns.map(col =>
      col.toLowerCase()
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
    );

    const mapper = Object.fromEntries(df.columns.map((oldCol, i) => [oldCol, newColumns[i]]));
    df.rename(mapper);
    return await this._overwriteAndBackupFile(df, file);
  }

  async handleMissingValues(fileId, userId, options) {
    const { column, strategy, fillValue } = options;
    const file = await this.fileRepository.findByIdAndUserId(fileId, userId);
    if (!file) throw { statusCode: 404, message: "File not found or access denied" };

    let df = await dfw.readCSV(file.storagePath, this.csvReadOptions);
    if (!df.columns.includes(column)) {
      throw { statusCode: 400, message: `Column '${column}' not found.` };
    }

    const colIndex = df.columns.indexOf(column);
    const colDtype = df.ctypes.values[colIndex];

    const ensureNumeric = () => {
      if (!['int32', 'float32', 'float64', 'int64', 'number'].includes(colDtype)) {
        throw { statusCode: 400, message: `Column '${column}' must be numeric for '${strategy}' strategy.` };
      }
    };

    switch (strategy) {
      case 'drop': {
        df = df.dropNaRows(column);
        break;
      }

      case 'mean': {
        ensureNumeric();
        const stats = df.getSummaryStatistics();
        const meanVal = stats[column] ? stats[column].mean : null;
        df.fillNaColumn(column, meanVal);
        break;
      }

      case 'median': {
        ensureNumeric();
        const stats = df.getSummaryStatistics();
        const medianVal = stats[column] ? stats[column].median : null;
        df.fillNaColumn(column, medianVal);
        break;
      }

      case 'mode': {
        const modeVal = df.mode(column);
        df.fillNaColumn(column, modeVal);
        break;
      }

      case 'fill': {
        if (fillValue === undefined)
          throw { statusCode: 400, message: "A 'fillValue' is required for 'fill' strategy." };
        df.fillNaColumn(column, fillValue);
        break;
      }

      default:
        throw { statusCode: 400, message: `Invalid strategy: '${strategy}'.` };
    }

    return await this._overwriteAndBackupFile(df, file);
  }


  // ===============================================
  // ==            ROLLBACK METHOD                ==
  // ===============================================

  async rollbackFile(fileId, userId) {
    const file = await this.fileRepository.findByIdAndUserId(fileId, userId);
    if (!file) {
      throw { statusCode: 404, message: "File not found or access denied" };
    }
    if (!file.backupStoragePath) {
      throw { statusCode: 400, message: "No previous version available to rollback to." };
    }

    await fs.unlink(file.storagePath);
    await fs.rename(file.backupStoragePath, file.storagePath);

    const stats = await fs.stat(file.storagePath);
    file.backupStoragePath = null;
    file.sizeInBytes = stats.size;
    await file.save();

    return file;
  }

  /**
   * Private helper to save a DataFrame by overwriting the original file
   * and creating a backup of the previous version.
   * @private
   */
  async _overwriteAndBackupFile(df, file) {
    const backupPath = `${file.storagePath}.bak`;

    if (file.backupStoragePath) {
      await fs.unlink(file.backupStoragePath).catch(() => {});
    }

    await fs.rename(file.storagePath, backupPath);
    await df.toCSV(file.storagePath);

    const stats = await fs.stat(file.storagePath);
    file.backupStoragePath = backupPath;
    file.sizeInBytes = stats.size;
    await file.save();

    return file;
  }
}

module.exports = ProcessService;