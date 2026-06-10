import { Pool } from 'pg';
import Database from 'better-sqlite3';
import { URL } from 'url';
import path from 'path';
import fs from 'fs';
import { TABLES } from './schemas.js';
import { createLogger } from '../utils/index.js';
import { parseConnectionURI, adaptQuery, ConnectionURI } from './utils.js';

const logger = createLogger('database');

type QueryResultRow = Record<string, any>;

interface UnifiedQueryResult<T = QueryResultRow> {
  rows: T[];
  rowCount: number;
  command?: string;
}

type DBDialect = 'postgres' | 'sqlite';

type DSNModifier = (url: URL, query: URLSearchParams) => void;

type Transaction = {
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  execute: (query: string, params?: any[]) => Promise<UnifiedQueryResult<any>>;
};

export class DB {
  private static instance: DB;
  private db!: Pool | Database.Database;
  private static initialised: boolean = false;
  private static dialect: DBDialect;
  private uri!: ConnectionURI;
  private dsnModifiers: DSNModifier[] = [];

  private constructor() {}

  static getInstance(): DB {
    if (!this.instance) this.instance = new DB();
    return this.instance;
  }

  isInitialised(): boolean { return DB.initialised; }
  getDialect(): DBDialect { return DB.dialect; }
  isSQLite(): boolean { return this.getDialect() === 'sqlite'; }

  getRowsAffected(result: any): number {
    if (this.isSQLite()) return result.changes || result.rowCount || 0;
    return result.rowCount || 0;
  }

  async initialise(uri: string, dsnModifiers: DSNModifier[] = []): Promise<void> {
    if (DB.initialised) return;
    try {
      this.uri = parseConnectionURI(uri);
      this.dsnModifiers = dsnModifiers;
      await this.open();
      await this.ping();

      for (const [name, schema] of Object.entries(TABLES)) {
        await this.execute(`CREATE TABLE IF NOT EXISTS ${name} (${schema})`);
      }

      if (this.uri.dialect === 'sqlite') {
        (this.db as Database.Database).pragma('busy_timeout = 5000');
        (this.db as Database.Database).pragma('foreign_keys = ON');
        (this.db as Database.Database).pragma('synchronous = OFF');
        (this.db as Database.Database).pragma('journal_mode = WAL');
      }

      DB.initialised = true;
      DB.dialect = this.uri.dialect;
      logger.info('Database initialised');
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  async open(): Promise<void> {
    if (this.uri.dialect === 'postgres') {
      this.db = new Pool({ connectionString: this.uri.url.toString() });
    } else {
      const dir = path.dirname(this.uri.filename);
      if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.db = new Database(this.uri.filename);
    }
  }

  async close(): Promise<void> {
    if (this.uri.dialect === 'postgres') await (this.db as Pool).end();
    else (this.db as Database.Database).close();
  }

  async ping(): Promise<void> {
    if (this.uri.dialect === 'postgres') {
      await (this.db as Pool).query('SELECT 1');
    } else {
      (this.db as Database.Database).prepare('SELECT 1').get();
    }
  }

  async execute(query: string, params?: any[]): Promise<any> {
    const q = adaptQuery(query, this.uri.dialect);
    if (this.uri.dialect === 'postgres') {
      return (this.db as Pool).query(q, params);
    } else {
      return (this.db as Database.Database).prepare(q).run(params || []);
    }
  }

  async query<T = any>(query: string, params?: any[]): Promise<T[]> {
    const q = adaptQuery(query, this.uri.dialect);
    if (this.uri.dialect === 'postgres') {
      return (await (this.db as Pool).query(q, params)).rows;
    } else {
      return (this.db as Database.Database).prepare(q).all(params || []) as T[];
    }
  }

  async begin(): Promise<Transaction> {
    if (this.uri.dialect === 'postgres') {
      const client = await (this.db as Pool).connect();
      await client.query('BEGIN');
      let done = false;
      const finish = () => { if (!done) { done = true; client.release(); } };

      return {
        commit: async () => { try { await client.query('COMMIT'); } finally { finish(); } },
        rollback: async () => { try { await client.query('ROLLBACK'); } finally { finish(); } },
        execute: async (q: string, p?: any[]) => {
          const r = await client.query(adaptQuery(q, 'postgres'), p);
          return { rows: r.rows, rowCount: r.rowCount || 0, command: r.command };
        },
      };
    } else {
      (this.db as Database.Database).exec('BEGIN');
      let done = false;

      return {
        commit: async () => { if (!done) { (this.db as Database.Database).exec('COMMIT'); done = true; } },
        rollback: async () => { if (!done) { (this.db as Database.Database).exec('ROLLBACK'); done = true; } },
        execute: async (q: string, p?: any[]) => {
          if (done) throw new Error('Transaction already finalised');
          const stmt = (this.db as Database.Database).prepare(adaptQuery(q, 'sqlite'));
          const cmd = q.trim().split(' ')[0].toUpperCase();

          if (['INSERT','UPDATE','DELETE'].includes(cmd)) {
            const r = stmt.run(p || []);
            return { rows: [], rowCount: r.changes || 0, command: cmd };
          } else {
            const rows = stmt.all(p || []) as any[];
            return { rows, rowCount: rows.length, command: cmd };
          }
        },
      };
    }
  }
}
