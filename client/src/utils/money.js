// Preserve PostgreSQL NUMERIC decimal strings without IEEE-754 rounding.
export function formatMoney(value) {
  if (value === undefined || value === null || value === '') return '0.00';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    return value.toFixed(2);
  }
  const text = String(value).trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) return '—';
  const [whole, fraction = ''] = text.split('.');
  return whole + '.' + fraction.padEnd(2, '0');
}
