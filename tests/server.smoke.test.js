'use strict';
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');

// Importing the Express app must not launch a second listener.
const app = require('../server/index');
let server, base;
before(async () => {
  server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

test('server boots with all safe routes registered and health check responds', async () => {
  const r = await fetch(base + '/health');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, 'OK');
});

test('login verification requires a valid token', async () => {
  const r = await fetch(base + '/api/auth/verify');
  assert.equal(r.status, 401);
});

test('legacy external money-moving provider endpoints are not exposed', async () => {
  const endpoints = ['/api/wise/balance', '/api/paypal/details/test', '/api/skrill-neteller/balance'];
  for (const path of endpoints) {
    const r = await fetch(base + path);
    assert.equal(r.status, 404, path);
  }
});

// ---------------------------------------------------------------------------
// Vercel frontend deployment configuration regression checks (static, offline).
// The Express backend is NOT deployed by these files; they only describe the
// React (create-react-app / react-scripts) frontend build.
// ---------------------------------------------------------------------------
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));

// Subset of the `framework` values accepted by the current Vercel vercel.json schema
// (taken from the Vercel validation error message on PR #2).
const VERCEL_SCHEMA_FRAMEWORKS = new Set([
  'nextjs', 'gatsby', 'remix', 'react-router', 'astro', 'preact', 'vue', 'angular',
  'svelte', 'sveltekit', 'ionic-react', 'create-react-app', 'vite', 'parcel',
  'express', 'node', 'python', 'go', 'ruby', 'rust'
]);

test('client is a react-scripts app that builds into client/build', () => {
  const pkg = readJson('client/package.json');
  assert.equal(pkg.scripts.build, 'react-scripts build');
  assert.ok(pkg.devDependencies['react-scripts'] || pkg.dependencies['react-scripts']);
  assert.ok(!pkg.dependencies.vite && !pkg.devDependencies.vite);
});

for (const [label, rel, expected] of [
  ['root (project root = repository root)', 'vercel.json', {
    installCommand: 'npm --prefix client install',
    buildCommand: 'npm --prefix client run build',
    outputDirectory: 'client/build'
  }],
  ['client (Vercel project root directory = client)', 'client/vercel.json', {
    installCommand: 'npm install',
    buildCommand: 'npm run build',
    outputDirectory: 'build'
  }]
]) {
  test(`vercel.json ${label} matches the CRA frontend build`, () => {
    const cfg = readJson(rel);
    assert.equal(cfg.framework, 'create-react-app');
    assert.ok(VERCEL_SCHEMA_FRAMEWORKS.has(cfg.framework), 'framework must be a schema-valid value (not "react")');
    assert.equal(cfg.installCommand, expected.installCommand);
    assert.equal(cfg.buildCommand, expected.buildCommand);
    assert.equal(cfg.outputDirectory, expected.outputDirectory);
    assert.ok(!/dist/.test(JSON.stringify(cfg)), 'react-scripts does not emit dist/');
    // Frontend-only: no serverless/backend replacement in the Vercel config.
    for (const key of ['functions', 'builds', 'routes', 'env']) assert.equal(cfg[key], undefined, key);
    assert.deepEqual(cfg.rewrites, [{ source: '/(.*)', destination: '/index.html' }]);
  });
}

test('root vercel.json output directory resolves to the react-scripts build folder', () => {
  const out = path.posix.normalize(readJson('vercel.json').outputDirectory);
  assert.equal(out, 'client/build');
  assert.equal(path.posix.join('client', readJson('client/vercel.json').outputDirectory), out);
});
