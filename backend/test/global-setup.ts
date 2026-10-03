import { execSync } from 'node:child_process';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext { testDb: string }
}

// Usa TEST_DATABASE_URL si existe (CI); si no, levanta un PostgreSQL temporal local.
export default async function setup(project: TestProject) {
  let base = process.env.TEST_DATABASE_URL;
  let stop: (() => void) | undefined;
  if (!base) {
    const dir = `/tmp/fisiocerca-test-pg-${process.pid}`;
    base = execSync(`sh scripts/local-db.sh 54331 ${dir}`).toString().trim();
    const run = process.getuid?.() === 0 ? 'runuser -u postgres -- ' : '';
    const bin = execSync('ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1').toString().trim();
    stop = () => { execSync(`${run}${bin}/pg_ctl -D ${dir} -m immediate stop >/dev/null 2>&1 || true; rm -rf ${dir}`); };
  }
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS fisiocerca_test');
  await admin.query('CREATE DATABASE fisiocerca_test');
  await admin.end();
  const url = new URL(base); url.pathname = '/fisiocerca_test';
  project.provide('testDb', url.toString());
  return () => stop?.();
}
