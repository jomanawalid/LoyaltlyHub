#!/usr/bin/env node
'use strict';
// (owner: Jana - deployment lead) Builds one deployment package per Lambda: backend/dist/<service>.zip  (npm run zip)
//
// Each zip contains ONLY: package.json, shared/, services/<service>/ and production
// node_modules. It never contains .env, tests, events, dist or dev dependencies.
// (rewards.zip also serves the e-mail worker: handler services/rewards/notifier.handler)

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { ZipArchive } = require('archiver');

const BACKEND = path.join(__dirname, '..');
const DIST = path.join(BACKEND, 'dist');
const DEPS = path.join(DIST, 'prod-deps');
const SERVICES = ['customers', 'points', 'rewards'];
const FORBIDDEN = /(^|\/)\.env($|\.)|\.zip$|^tests\//;

function installProductionDeps() {
  fs.rmSync(DEPS, { recursive: true, force: true });
  fs.mkdirSync(DEPS, { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(BACKEND, f), path.join(DEPS, f));
  execSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: DEPS, stdio: 'inherit' });
}

function zipService(service) {
  return new Promise((resolve, reject) => {
    const file = path.join(DIST, `${service}.zip`);
    const output = fs.createWriteStream(file);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', () => resolve({ file, bytes: archive.pointer() }));
    archive.on('error', reject);
    archive.on('entry', (entry) => {
      if (FORBIDDEN.test(entry.name)) reject(new Error(`Refusing to package ${entry.name}`));
    });
    archive.pipe(output);
    archive.file(path.join(BACKEND, 'package.json'), { name: 'package.json' });
    archive.directory(path.join(BACKEND, 'shared'), 'shared');
    archive.directory(path.join(BACKEND, 'services', service), `services/${service}`);
    archive.directory(path.join(DEPS, 'node_modules'), 'node_modules');
    archive.finalize();
  });
}

async function main() {
  fs.mkdirSync(DIST, { recursive: true });
  installProductionDeps();
  for (const service of SERVICES) {
    const { file, bytes } = await zipService(service);
    console.log(`built ${path.relative(BACKEND, file)} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
