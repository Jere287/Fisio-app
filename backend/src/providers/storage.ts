import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Config } from '../config.js';

// Almacenamiento de archivos. Los datos llegan ya cifrados: el proveedor nunca ve el contenido en claro.
// En producción se implementa con S3, Google Cloud Storage o similar, con la misma interfaz.
export interface ObjectStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_-]*\.bin$/;
const check = (key: string) => { if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error(`Clave de archivo inválida: ${key}`); return key; };

export class MemoryStorage implements ObjectStorage {
  files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) { this.files.set(check(key), data); }
  async get(key: string) { const f = this.files.get(check(key)); if (!f) throw new Error('Archivo no encontrado'); return f; }
  async delete(key: string) { this.files.delete(check(key)); }
}

export class LocalDiskStorage implements ObjectStorage {
  private root: string;
  constructor(dir: string) { this.root = resolve(dir); }
  private path(key: string) { return join(this.root, check(key)); }
  async put(key: string, data: Buffer) { const p = this.path(key); await mkdir(dirname(p), { recursive: true }); await writeFile(p, data, { mode: 0o600 }); }
  async get(key: string) { return readFile(this.path(key)); }
  async delete(key: string) { await rm(this.path(key), { force: true }); }
}

export function createStorage(config: Pick<Config, 'STORAGE_PROVIDER' | 'STORAGE_DIR'>): ObjectStorage {
  return config.STORAGE_PROVIDER === 'memory' ? new MemoryStorage() : new LocalDiskStorage(config.STORAGE_DIR);
}
