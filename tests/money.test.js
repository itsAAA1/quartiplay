'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { positiveMoney } = require('../server/money');

test('valid positive decimal strings and JSON numbers', () => {
  for (const [value, normalized] of [
    ['0.01', '0.01'], [0.01, '0.01'], ['42', '42.00'],
    [42, '42.00'], ['7.5', '7.50'], ['9999999999999.99', '9999999999999.99']
  ]) assert.equal(positiveMoney(value), normalized);
});

test('rejects negatives, zeros, subcents, overflow, bad types and notation', () => {
  for (const value of [
    0, -10, '0.00', '-0.01', '10.001', 1.234, 0.001,
    '1e3', 1e-7, NaN, Infinity, null, {}, [], 'abc', '01.00',
    '10000000000000', '10000000000000.00', '0', true, '', '1.'
  ]) assert.equal(positiveMoney(value), null, String(value));
});
