'use strict';

// Decimal(15,2) normalization without JavaScript floating-point balance comparisons.
// Accept JSON numbers or decimal strings; reject scientific notation, negatives,
// zero, excess precision and values exceeding the database column.
function positiveMoney(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    input = String(input);
  }
  if (typeof input !== 'string' || !/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(input)) {
    return null;
  }
  const [integer, fraction = ''] = input.split('.');
  const cents = fraction.padEnd(2, '0');
  if (integer === '0' && cents === '00') return null;
  return integer + '.' + cents;
}

module.exports = { positiveMoney };
