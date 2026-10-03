import pg from 'pg';

// Los bigint/count de Postgres llegan como texto; los convertimos a número.
pg.types.setTypeParser(20, v => Number(v));
pg.types.setTypeParser(1700, v => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10 });
}

export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function one<T>(q: Queryable, text: string, params: unknown[] = []): Promise<T | undefined> {
  const r = await q.query(text, params);
  return r.rows[0] as T | undefined;
}

export async function many<T>(q: Queryable, text: string, params: unknown[] = []): Promise<T[]> {
  const r = await q.query(text, params);
  return r.rows as T[];
}
