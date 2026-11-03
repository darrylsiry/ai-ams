// One CSV cell, shared by every export. Pure module for node:test.

/**
 * SEC-010: a spreadsheet runs a cell that starts with = + - @ tab or CR as a formula, and names and
 * subjects in exports can come from the public quote form or an outside email. Those get a leading
 * apostrophe; plain numbers such as -5.00 stay numbers.
 */
export function csvCell(v: unknown): string {
  const raw = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  const s = /^[=+\-@\t\r]/.test(raw) && !/^-?\d+(\.\d+)?$/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
