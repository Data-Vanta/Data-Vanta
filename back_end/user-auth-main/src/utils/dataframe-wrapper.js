const fs = require('fs').promises;

/**
 * Lightweight DataFrame wrapper to provide only the features needed by ProcessService.
 * This avoids depending on a heavy dataframe library while still replacing danfojs usage.
 */
class DataFrame {
  constructor(rows, columns) {
    this.rows = rows || []; // array of objects
    this.columns = columns || (rows.length > 0 ? Object.keys(rows[0]) : []);
  }

  get shape() {
    return [this.rows.length, this.columns.length];
  }

  get ctypes() {
    // simple inference per column
    const types = this.columns.map(col => {
      for (const r of this.rows) {
        const v = r[col];
        if (v === null || v === undefined || v === '') continue;
        if (typeof v === 'number') return 'float64';
        if (!isNaN(Number(v))) return 'float64';
        return 'string';
      }
      return 'string';
    });
    return { values: types };
  }

  // Metadata
  getMetadata() {
    return {
      columnNames: this.columns.slice(),
      dataTypes: this.ctypes.values.slice(),
      rows: this.shape[0],
      columns: this.shape[1],
    };
  }

  // Summary statistics for numeric columns
  getSummaryStatistics() {
    const numericCols = this.columns.filter(col => {
      const dtype = this._colType(col);
      return dtype === 'float64' || dtype === 'int32' || dtype === 'number';
    });

    if (numericCols.length === 0) return { message: 'No numeric columns found to describe.' };

    const summary = {};
    numericCols.forEach(col => {
      const vals = this.rows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== '' && !isNaN(Number(v))).map(Number);
      const count = vals.length;
      const mean = count ? vals.reduce((a,b) => a+b, 0)/count : null;
      const variance = count ? vals.reduce((a,b) => a + Math.pow(b - mean, 2), 0) / count : null;
      const std = variance !== null ? Math.sqrt(variance) : null;
      const min = count ? Math.min(...vals) : null;
      const max = count ? Math.max(...vals) : null;
      const sorted = vals.slice().sort((a,b) => a-b);
      const median = count ? (count%2 ? sorted[(count-1)/2] : (sorted[count/2 -1] + sorted[count/2])/2) : null;

      summary[col] = { count, mean, std, min, median, max };
    });

    return summary;
  }

  // Missing values per column
  getMissingValues() {
    const res = {};
    this.columns.forEach(col => {
      const miss = this.rows.reduce((acc, r) => acc + ((r[col] === null || r[col] === undefined || r[col] === '') ? 1 : 0), 0);
      res[col] = miss;
    });
    return res;
  }

  // Unique values per column (count and sample)
  getUniqueValues(sampleSize = 5) {
    const result = {};
    this.columns.forEach(col => {
      const set = new Set(this.rows.map(r => r[col]));
      const values = Array.from(set).filter(v => v !== undefined);
      const sample = values.slice(0, Math.min(values.length, sampleSize));
      result[col] = { count: values.length, sample };
    });
    return result;
  }

  // Rename columns (mapper: { oldName: newName })
  rename(mapper, opts = { inplace: true }) {
    const newCols = this.columns.map(c => mapper[c] || c);
    const newRows = this.rows.map(r => {
      const obj = {};
      this.columns.forEach((c, i) => {
        const nc = newCols[i];
        obj[nc] = r[c];
      });
      return obj;
    });
    if (opts.inplace) {
      this.columns = newCols;
      this.rows = newRows;
      return this;
    }
    return new DataFrame(newRows, newCols);
  }

  // Drop rows where column is Na
  dropNaRows(column) {
    const keep = this.rows.filter(r => !(r[column] === null || r[column] === undefined || r[column] === ''));
    return new DataFrame(keep, this.columns.slice());
  }

  // Fill Na in a single column with value
  fillNaColumn(column, value, inplace = true) {
    const newRows = this.rows.map(r => {
      const copy = Object.assign({}, r);
      if (copy[column] === null || copy[column] === undefined || copy[column] === '') copy[column] = value;
      return copy;
    });
    if (inplace) {
      this.rows = newRows;
      return this;
    }
    return new DataFrame(newRows, this.columns.slice());
  }

  // Mode for a column
  mode(column) {
    const counts = {};
    this.rows.forEach(r => {
      const v = r[column];
      if (v === null || v === undefined || v === '') return;
      counts[v] = (counts[v] || 0) + 1;
    });
    const entries = Object.entries(counts).sort((a,b) => b[1]-a[1]);
    return entries.length ? entries[0][0] : null;
  }

  // toCSV
  async toCSV(filePath) {
    const header = this.columns.join(',');
    const lines = this.rows.map(r => this.columns.map(c => this._escape(String(r[c] !== undefined && r[c] !== null ? r[c] : ''))).join(','));
    const content = [header, ...lines].join('\n');
    await fs.writeFile(filePath, content, 'utf8');
  }

  // Internal helpers
  _colType(col) {
    // using ctypes inference
    for (const r of this.rows) {
      const v = r[col];
      if (v === null || v === undefined || v === '') continue;
      return (typeof v === 'number' || !isNaN(Number(v))) ? 'float64' : 'string';
    }
    return 'string';
  }

  _escape(v) {
    if (v.includes(',') || v.includes('\"') || v.includes('\n')) {
      return '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  }
}

// CSV reader
async function readCSV(filePath, options = {}) {
  const { header = true, delimiter = ',', skipEmptyLines = true, encoding = 'utf8', dynamicTyping = true } = options;
  const content = await fs.readFile(filePath, encoding);
  const lines = content.split(/\r?\n/).filter((l, i) => !(skipEmptyLines && l.trim() === ''));
  if (lines.length === 0) return new DataFrame([], []);
  let headers;
  let start = 0;
  if (header) {
    headers = _parseLine(lines[0], delimiter);
    start = 1;
  } else {
    // generate column names
    const colCount = _parseLine(lines[0], delimiter).length;
    headers = Array.from({ length: colCount }, (_, i) => `column_${i}`);
  }
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const values = _parseLine(lines[i], delimiter);
    if (values.length === 0) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      let val = values[j] !== undefined ? values[j] : '';
      if (dynamicTyping && val !== '') {
        const n = Number(val);
        if (!isNaN(n)) val = n;
      }
      obj[headers[j]] = val;
    }
    rows.push(obj);
  }
  return new DataFrame(rows, headers);
}

function _parseLine(line, delimiter) {
  // simple CSV parse, doesn't handle all edge cases but sufficient for typical exports
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { cur += '"'; i++; continue; }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === delimiter && !inQuotes) { result.push(cur); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur);
  return result.map(r => r.trim());
}

module.exports = { readCSV };
