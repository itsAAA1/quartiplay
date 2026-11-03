'use strict';
// Additive/idempotent schema bootstrap; cannot replace a reviewed migration plan
// for an existing production database.
const fs = require('node:fs/promises');
const path = require('node:path');
const pool = require('./db');

async function migrate() {
  const sql = await fs.readFile(path.join(__dirname, 'migrations.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('quartiplay-schema-bootstrap'))");
    await client.query(sql);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Quartiplay schema bootstrap completed'))
    .catch(error => { console.error('Schema bootstrap failed:', error.code || error.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
module.exports = { migrate };
