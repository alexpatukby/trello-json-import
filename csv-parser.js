/* global Papa */

/**
 * Parse CSV text into rows and columns format matching JSON parser output.
 * @param {string} text - CSV file contents
 * @returns {{ rows: object[], columns: string[] }}
 */
function parseCSV(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('CSV content is empty or invalid.');
  }

  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  if (parsed.errors && parsed.errors.length) {
    const e = parsed.errors[0];
    throw new Error(`CSV parse error: ${e.message || e.code || 'unknown error'}`);
  }

  const rows = (parsed.data || []).filter((r) => r && Object.keys(r).length);
  
  if (!rows.length) {
    throw new Error('CSV file contains no data rows.');
  }

  const columns = (parsed.meta && parsed.meta.fields) || Object.keys(rows[0] || {});
  
  if (!columns || !columns.length) {
    throw new Error('CSV file appears to have no header row/columns.');
  }

  return { rows, columns };
}

// Export for use in import.js
window.parseCSV = parseCSV;

