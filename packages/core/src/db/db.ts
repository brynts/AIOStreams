import { Pool, Client, QueryResult } from 'pg';
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
    if (!this.instance) {
      this.instance = new DB();
    }
    return this.instance;
  }

  isInitialised(): boolean {
    return DB.initialised;
  }

  getDialect(): DBDialect {
    return DB.dialect;
  }

  isSQLite(): boolean {
    return this.getDialect() === 'sqlite';
  }

  getRowsAffected(result: any): number {
    if (this.isSQLite()) {
      return result.changes || result.rowCount || 0;
    }
    return result.rowCount || 0;
  }

  async initialise(
    uri: string,
    dsnModifiers: DSNModifier[] = []
  ): Promise<void> {
    if (DB.initialised) {
      return;
    }
    try {
      this.uri = parseConnectionURI(uri);
      this.dsnModifiers = dsnModifiers;
      await this.open();
      await this.ping();

      // create tables
      for (const [name, schema] of Object.entries(TABLES)) {
        const createTableQuery = `CREATE TABLE IF NOT EXISTS ${name} (${schema})`;
        await this.execute(createTableQuery);
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
      const pool = new Pool({
        connectionString: this.uri.url.toString(),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });
      this.db = pool;
    } else if (this.uri.dialect === 'sqlite') {
      const parentDir = path.dirname(this.uri.filename);
      if (parentDir && !fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      logger.debug(`Opening SQLite database: ${this.uri.filename}`);

      this.db = new Database(this.uri.filename);
    }
  }

  async close(): Promise<void> {
    if (this.uri.dialect === 'postgres') {
      await (this.db as Pool).end();
    } else if (this.uri.dialect === 'sqlite') {
      (this.db as Database.Database).close();
    }
  }

  async ping(): Promise<void> {
    if (this.uri.dialect === 'postgres') {
      await (this.db as Pool).query('SELECT 1');
    } else if (this.uri.dialect === 'sqlite') {
      (this.db as Database.Database).prepare('SELECT 1').get();
    }
  }

  async execute(query: string, params?: any[]): Promise<any> {
    const adaptedQuery = adaptQuery(query, this.uri.dialect);

    if (this.uri.dialect === 'postgres') {
      return (this.db as Pool).query(adaptedQuery, params);
    } else if (this.uri.dialect === 'sqlite') {
      const stmt = (this.db as Database.Database).prepare(adaptedQuery);
      return stmt.run(params || []);
    }
    throw new Error('Unsupported dialect');
  }

  async query(query: string, params?: any[]): Promise<any[]> {
    const adaptedQuery = adaptQuery(query, this.uri.dialect);

    if (this.uri.dialect === 'postgres') {
      const result = await (this.db as Pool).query(adaptedQuery, params);
      return result.rows;
    } else if (this.uri.dialect === 'sqlite') {
      const stmt = (this.db as Database.Database).prepare(adaptedQuery);
      return stmt.all(params || []);
    }
    return [];
  }

  async begin(): Promise<Transaction> {
    if (this.uri.dialect === 'postgres') {
      const client = await (this.db as Pool).connect();
      await client.query('BEGIN');

      let finalised = false;

      const finalise = () => {
        if (!finalised) {
          finalised = true;
          client.release();
        }
      };

      return {
        commit: async () => {
          try {
            await client.query('COMMIT');
          } finally {
            finalise();
          }
        },
        rollback: async () => {
          try {
            await client.query('ROLLBACK');
          } finally {
            finalise();
          }
        },
        execute: async (query: string, params?: any[]): Promise<UnifiedQueryResult> => {
          const result = await client.query(adaptQuery(query, 'postgres'), params);
          return {
            rows: result.rows,
            rowCount: result.rowCount || 0,
            command: result.command,
          };
        },
      };
    } else if (this.uri.dialect === 'sqlite') {
      (this.db as Database.Database).exec('BEGIN');
      let isFinalised = false;

      return {
        commit: async () => {
          if (isFinalised) return;
          (this.db as Database.Database).exec('COMMIT');
          isFinalised = true;
        },
        rollback: async () => {
          if (isFinalised) return;
          (this.db as Database.Database).exec('ROLLBACK');
          isFinalised = true;
        },
        execute: async (query: string, params?: any[]): Promise<UnifiedQueryResult> => {
          if (isFinalised) {
            throw new Error('Transaction has already been finalised.');
          }
          const adaptedQuery = adaptQuery(query, 'sqlite');
          const command = adaptedQuery.trim().split(' ')[0].toUpperCase();
          const stmt = (this.db as Database.Database).prepare(adaptedQuery);

          if (['INSERT', 'UPDATE', 'DELETE'].includes(command)) {
            const result = stmt.run(params || []);
            return {
              rows: [],
              rowCount: result.changes || 0,
              command,
            };
          } else {
            const rows = stmt.all(params || []);
            return {
              rows,
              rowCount: rows.length,
              command,
            };
          }
        },
      };
    }
    throw new Error('Unsupported transaction dialect');
  }
}
