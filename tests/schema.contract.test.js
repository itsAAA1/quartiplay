'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});
const app = require('../server/index');
let server, base;

before(async () => {
  // On a dedicated disposable PostgreSQL CI database, test real DDL twice.
  // Fail closed if somebody attempts to run this regression test outside CI.
  if (process.env.QUARTIPLAY_TEST_DB !== 'disposable' || process.env.NODE_ENV !== 'test') {
    throw new Error('Schema contract tests require an explicitly disposable CI database');
  }
  for (let i = 0; i < 2; i++) {
    execFileSync(process.execPath, ['database/migrate.js'], {
      env: process.env, stdio: 'pipe', timeout: 20000
    });
  }
  server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  // The application modules use a separate shared connection pool.
  await require('../database/db').end();
});

async function request(method, url, token, data) {
  const response = await fetch(base + url, {
    method, headers: {
      ...(token ? {Authorization:'Bearer '+token} : {}),
      ...(data ? {'Content-Type':'application/json'} : {})
    }, ...(data ? {body:JSON.stringify(data)} : {})
  });
  const result=await response.json();
  return {status: response.status, body:result};
}
async function signup(user_type) {
  const email = 'schema-' + user_type + '-' + Date.now().toString(36) + '@example.test';
  const result = await request('POST','/api/auth/register',null,
    {email,password:'safe-only-disposable-ci',full_name:'Schema Test',user_type});
  assert.equal(result.status,201,JSON.stringify(result.body));
  return result.body;
}
test('fresh schema can bootstrap twice without creating a default administrator', async () => {
  for (const table of ['users','investors','companies','wallets','transactions','opportunities','investments']) {
    const q=await pool.query('SELECT to_regclass($1) AS regclass',['public.'+table]);
    assert.equal(q.rows[0].regclass,table);
  }
  const admin=await pool.query("SELECT id FROM users WHERE email='admin@quartiplay.com'");
  assert.equal(admin.rowCount,0);
});
test('actual migrations support signup -> wallet reservation -> investment capacity', async () => {
  const company=await signup('company');
  const investor=await signup('investor');
  const wallet=await request('GET','/api/wallet/balance',investor.token);
  assert.equal(wallet.status,200);
  assert.equal(wallet.body.balance,'0.00');

  // Seed synthetic funds exclusively in the disposable test database.
  await pool.query("UPDATE wallets SET balance=100.00 WHERE user_id=$1",[investor.user.userId]);
  const withdrawal=await request('POST','/api/wallet/withdraw',investor.token,{amount:'12.25'});
  assert.equal(withdrawal.status,201,JSON.stringify(withdrawal.body));
  const afterWithdraw=await pool.query('SELECT balance FROM wallets WHERE user_id=$1',[investor.user.userId]);
  assert.equal(afterWithdraw.rows[0].balance,'87.75');

  const opportunity=await request('POST','/api/opportunities',company.token,{
    title:'Test project',description:'Synthetic test opportunity',
    target_amount:'80.00',min_investment:'1.00',max_investment:'80.00',
    funding_type:'flexible',duration_months:3,return_rate:0
  });
  assert.equal(opportunity.status,201,JSON.stringify(opportunity.body));
  const reservation=await request('POST','/api/investments',investor.token,{
    opportunity_id:opportunity.body.opportunityId,amount:'20.00'
  });
  assert.equal(reservation.status,201,JSON.stringify(reservation.body));
  const current=await pool.query('SELECT current_amount,investor_count FROM opportunities WHERE id=$1',[opportunity.body.opportunityId]);
  assert.equal(current.rows[0].current_amount,'20.00');
  assert.equal(current.rows[0].investor_count,1);
});
