'use strict';
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'ci-isolated-secret-only';
const pool = require('../database/db');
const investments = require('../server/routes/investments');
const opportunities = require('../server/routes/opportunities');
const investors = require('../server/routes/investors');
const companies = require('../server/routes/companies');
let server, root;
const uid = () => randomUUID();

before(async () => {
  await pool.query("CREATE TABLE users (id uuid PRIMARY KEY, email text UNIQUE, password_hash text NOT NULL, full_name text, user_type text NOT NULL, role text DEFAULT 'user', is_active boolean DEFAULT true, is_verified boolean DEFAULT false, phone_number text, profile_picture_url text, created_at timestamp DEFAULT now())");
  await pool.query("CREATE TABLE investors (id uuid PRIMARY KEY, user_id uuid UNIQUE NOT NULL REFERENCES users(id), country text, city text, preferred_investment_type text)");
  await pool.query("CREATE TABLE companies (id uuid PRIMARY KEY, user_id uuid UNIQUE NOT NULL REFERENCES users(id), company_name text NOT NULL, company_description text)");
  await pool.query("CREATE TABLE opportunities (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id), title text NOT NULL, description text, target_amount numeric(15,2) NOT NULL, current_amount numeric(15,2) NOT NULL DEFAULT 0, min_investment numeric(15,2) DEFAULT 1, max_investment numeric(15,2), status text NOT NULL CHECK(status IN ('open','closed','funded','cancelled')), investor_count int DEFAULT 0, funding_type text DEFAULT 'flexible', created_at timestamp DEFAULT now())");
  await pool.query("CREATE TABLE investments (id uuid PRIMARY KEY, investor_id uuid NOT NULL REFERENCES investors(id), opportunity_id uuid NOT NULL REFERENCES opportunities(id), amount numeric(15,2) NOT NULL, status text NOT NULL CHECK(status IN ('pending','confirmed','completed','cancelled')), investment_date timestamp DEFAULT now())");
  const app = express(); app.use(express.json());
  app.use('/api/investments', investments);
  app.use('/api/opportunities', opportunities);
  app.use('/api/investors', investors);
  app.use('/api/companies', companies);
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  root = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
});
async function identity(type) {
  const id = uid();
  await pool.query('INSERT INTO users(id,email,password_hash,full_name,user_type) VALUES($1,$2,$3,$4,$5)',
    [id, id+'@example.test', 'DO_NOT_EXPOSE_PASSWORD_HASH', 'Test Person', type]);
  let profileId = null;
  if (type === 'investor') {
    profileId = uid();
    await pool.query('INSERT INTO investors(id,user_id,country) VALUES($1,$2,$3)', [profileId,id,'SA']);
  }
  if (type === 'company') {
    profileId = uid();
    await pool.query('INSERT INTO companies(id,user_id,company_name) VALUES($1,$2,$3)', [profileId,id,'Test Company']);
  }
  return { id, profileId, token: jwt.sign({userId:id, user_type:'admin'}, process.env.JWT_SECRET) };
}
async function opportunity(owner, target='100.00') {
  const id=uid();
  await pool.query("INSERT INTO opportunities(id,company_id,title,target_amount,current_amount,min_investment,max_investment,status) VALUES($1,$2,'Test opportunity',$3,0,1,200,'open')",[id,owner.profileId,target]);
  return id;
}
async function request(method,path,user,body) {
  const response=await fetch(root+path,{
    method,headers:{'Authorization':'Bearer '+user.token,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  return {status:response.status,body:await response.json()};
}

test('profile APIs expose required public account fields but never password hashes', async () => {
  const investor=await identity('investor'), company=await identity('company');
  for(const [type,actor] of [['investors',investor],['companies',company]]){
    const result=await request('GET','/api/'+type+'/profile',actor);
    assert.equal(result.status,200);
    assert.equal(result.body.full_name,'Test Person');
    assert.equal(result.body.email,actor.id+'@example.test');
    assert.equal(result.body.password_hash,undefined);
    assert.equal(result.body.role,undefined);
    assert.equal(result.body.is_active,undefined);
    assert.doesNotMatch(JSON.stringify(result.body),/DO_NOT_EXPOSE_PASSWORD_HASH/);
  }
});

test('only an open opportunity is returned by public listings', async () => {
  const company=await identity('company'), open=await opportunity(company);
  const closed=await opportunity(company);
  await pool.query("UPDATE opportunities SET status='closed' WHERE id=$1",[closed]);
  const response=await fetch(root+'/api/opportunities/');
  const rows=await response.json();
  assert.equal(response.status,200);
  assert.ok(rows.some(x=>x.id===open));
  assert.ok(!rows.some(x=>x.id===closed));
});

test('invalid and negative reservation amounts are refused without side effects',async()=>{
  const company=await identity('company'), investor=await identity('investor'), op=await opportunity(company);
  for(const amount of [-10,0,'0.001','abc',300]){
    const response=await request('POST','/api/investments',investor,{opportunity_id:op,amount});
    assert.ok([400,409].includes(response.status),JSON.stringify(response));
  }
  const state=await pool.query('SELECT current_amount,investor_count FROM opportunities WHERE id=$1',[op]);
  assert.equal(state.rows[0].current_amount,'0.00');
  assert.equal(state.rows[0].investor_count,0);
});

test('concurrent reservations cannot exceed opportunity target',async()=>{
  const company=await identity('company'), a=await identity('investor'),b=await identity('investor'),op=await opportunity(company);
  const attempts=await Promise.all([
    request('POST','/api/investments',a,{opportunity_id:op,amount:'70.00'}),
    request('POST','/api/investments',b,{opportunity_id:op,amount:'70.00'})
  ]);
  assert.deepEqual(attempts.map(x=>x.status).sort(),[201,409]);
  const state=await pool.query('SELECT current_amount,investor_count FROM opportunities WHERE id=$1',[op]);
  assert.equal(state.rows[0].current_amount,'70.00');
  assert.equal(state.rows[0].investor_count,1);
  const tx=await pool.query('SELECT id FROM investments WHERE opportunity_id=$1',[op]);
  assert.equal(tx.rowCount,1);
});

test('cancel pending reservation exactly once and restore opportunity capacity',async()=>{
  const company=await identity('company'),investor=await identity('investor'),op=await opportunity(company);
  const created=await request('POST','/api/investments',investor,{opportunity_id:op,amount:'15.25'});
  assert.equal(created.status,201);
  const cancel=await request('PUT','/api/investments/'+created.body.investmentId+'/cancel',investor);
  assert.equal(cancel.status,200);
  const second=await request('PUT','/api/investments/'+created.body.investmentId+'/cancel',investor);
  assert.equal(second.status,409);
  const state=await pool.query('SELECT current_amount,investor_count FROM opportunities WHERE id=$1',[op]);
  assert.equal(state.rows[0].current_amount,'0.00');
  assert.equal(state.rows[0].investor_count,0);
});

test('a different investor cannot read or cancel an investment',async()=>{
  const company=await identity('company'), investor=await identity('investor'), stranger=await identity('investor'), op=await opportunity(company);
  const created=await request('POST','/api/investments',investor,{opportunity_id:op,amount:'11.00'});
  assert.equal(created.status,201);
  assert.equal((await request('GET','/api/investments/'+created.body.investmentId,stranger)).status,404);
  assert.equal((await request('PUT','/api/investments/'+created.body.investmentId+'/cancel',stranger)).status,409);
  assert.equal((await request('GET','/api/investments/'+created.body.investmentId,investor)).status,200);
  assert.equal((await request('GET','/api/investments/'+created.body.investmentId,company)).status,200);
});

test('failed investment insert rolls back opportunity capacity and counter',async()=>{
  const company=await identity('company'),investor=await identity('investor'),op=await opportunity(company);
  await pool.query("ALTER TABLE investments ADD CONSTRAINT test_limited_amount CHECK (amount < 5) NOT VALID");
  try {
    const response=await request('POST','/api/investments',investor,{opportunity_id:op,amount:'21.00'});
    assert.equal(response.status,500);
    const state=await pool.query('SELECT current_amount,investor_count FROM opportunities WHERE id=$1',[op]);
    assert.equal(state.rows[0].current_amount,'0.00');
    assert.equal(state.rows[0].investor_count,0);
  } finally {
    await pool.query('ALTER TABLE investments DROP CONSTRAINT test_limited_amount');
  }
});
