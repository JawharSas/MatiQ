/**
 * Postgres for the functions, through the branch's pooled `DATABASE_URL`.
 *
 * - `rpc()` and `from()` answer like PostgREST did through supabase-js
 *   (`{ data, error }`), so the handlers keep their shape. They run as the
 *   database owner: only for `svc_*` functions and reads whose
 *   authorization the handler has already checked.
 * - `asUser()` runs work in a transaction as the signed-in user (role
 *   `authenticated` and their Clerk claims, like a Data API request), so
 *   Row Level Security decides, e.g. the storage rules for the `files` routes.
 */

import { attachDatabasePool } from '@neon/functions';
import pg from 'pg';
import { env } from './env.ts';

// Values come back as PostgREST sent them: bigint and numeric as numbers,
// dates and times as the text Postgres prints.
const asNumber = (value: string) => Number(value);
const asText = (value: string) => value;
const PARSERS: Record<number, (value: string) => unknown> = {
  20: asNumber, // int8
  1700: asNumber, // numeric
  1082: asText, // date
  1114: asText, // timestamp
  1184: asText, // timestamptz
};

let pool: pg.Pool | null = null;

export function database(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: env.databaseUrl(),
      max: 5,
      types: {
        getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
          PARSERS[oid] ?? pg.types.getTypeParser(oid, format)) as typeof pg.types.getTypeParser,
      },
    });
    attachDatabasePool(pool);
  }
  return pool;
}

/** A database error in PostgREST's shape. */
export interface DbError {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
}

export type DbResult<T> = { data: T; error: null } | { data: null; error: DbError };

export function toDbError(error: unknown): DbError {
  const e = error as { message?: string; code?: string; detail?: string; hint?: string };
  return { message: e.message ?? String(error), code: e.code ?? '', details: e.detail ?? null, hint: e.hint ?? null };
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`invalid identifier: ${name}`);
  return `"${name}"`;
}

interface FunctionShape {
  set: boolean;
  rows: boolean;
  void: boolean;
  /** Arguments of type json or jsonb: their values are sent as JSON. */
  json: string[];
}

const shapes = new Map<string, FunctionShape>();

/**
 * How PostgREST would return the function's result (one value, one row, or
 * a list), and which arguments take JSON.
 */
async function functionShape(name: string): Promise<FunctionShape> {
  const known = shapes.get(name);
  if (known) return known;
  const { rows } = await database().query<FunctionShape>(
    `select p.proretset as set,
            (t.typtype = 'c' or p.prorettype = 'record'::regtype) as rows,
            p.prorettype = 'void'::regtype as void,
            coalesce((
              select array_agg(a.name)
                from unnest(
                  p.proargnames,
                  coalesce(p.proallargtypes, p.proargtypes::oid[]),
                  -- No arguments: proargnames is null, and array_fill refuses a null length.
                  coalesce(p.proargmodes, array_fill('i'::"char", array[coalesce(cardinality(p.proargnames), 0)]))
                ) as a(name, type, mode)
               where a.mode in ('i', 'b', 'v') and a.type in ('json'::regtype, 'jsonb'::regtype)
            ), '{}') as json
       from pg_proc p join pg_type t on t.oid = p.prorettype
      where p.pronamespace = 'public'::regnamespace and p.proname = $1
      limit 1`,
    [name],
  );
  if (!rows[0]) throw Object.assign(new Error(`function public.${name} not found`), { code: 'PGRST202' });
  shapes.set(name, rows[0]);
  return rows[0];
}

/**
 * Calls `public.<name>` with named arguments, as PostgREST's `/rpc` did.
 * Untyped like supabase-js without generated types: callers know the shape.
 */
export async function rpc<T = any>(name: string, args: Record<string, unknown> = {}): Promise<DbResult<T>> {
  try {
    const shape = await functionShape(name);
    const keys = Object.keys(args).filter((key) => args[key] !== undefined);
    const call = `public.${identifier(name)}(${keys.map((key, i) => `${identifier(key)} => $${i + 1}`).join(', ')})`;
    // node-postgres would send a JS array as a Postgres array; JSON arguments get JSON.
    const values = keys.map((key) => (shape.json.includes(key) && args[key] !== null ? JSON.stringify(args[key]) : args[key]));
    if (shape.set || shape.rows) {
      const { rows } = await database().query(`select * from ${call}`, values);
      if (shape.rows) return { data: (shape.set ? rows : (rows[0] ?? null)) as T, error: null };
      return { data: rows.map((row) => Object.values(row)[0]) as T, error: null };
    }
    const { rows } = await database().query(`select ${call} as value`, values);
    return { data: (shape.void ? null : (rows[0]?.value ?? null)) as T, error: null };
  } catch (error) {
    return { data: null, error: toDbError(error) };
  }
}

// Rows are untyped, as supabase-js returned them.
type Row = Record<string, any>;

/** The part of PostgREST's query builder the functions use: select, eq, order, single. */
export class Query implements PromiseLike<DbResult<Row[]>> {
  private columns = '*';
  private readonly filters: [string, unknown][] = [];
  private readonly orders: string[] = [];
  private readonly table: string;

  constructor(table: string) {
    this.table = table;
  }

  select(columns = '*'): this {
    this.columns = columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}): this {
    this.orders.push(`${identifier(column)} ${options.ascending === false ? 'desc' : 'asc'}`);
    return this;
  }

  private sql(): { text: string; values: unknown[] } {
    const columns = this.columns.trim() === '*' ? '*' : this.columns.split(',').map((column) => identifier(column.trim())).join(', ');
    const where = this.filters.map(([column], i) => `${identifier(column)} = $${i + 1}`);
    return {
      text: `select ${columns} from public.${identifier(this.table)}${where.length ? ` where ${where.join(' and ')}` : ''}${
        this.orders.length ? ` order by ${this.orders.join(', ')}` : ''
      }`,
      values: this.filters.map(([, value]) => value),
    };
  }

  private async rows(limit?: number): Promise<DbResult<Row[]>> {
    try {
      const { text, values } = this.sql();
      const { rows } = await database().query(limit ? `${text} limit ${limit}` : text, values);
      return { data: rows, error: null };
    } catch (error) {
      return { data: null, error: toDbError(error) };
    }
  }

  /** One row or null; more than one is an error. */
  async maybeSingle(): Promise<DbResult<Row | null>> {
    const result = await this.rows(2);
    if (result.error) return result;
    if (result.data.length > 1) return { data: null, error: { message: 'more than one row', code: 'PGRST116', details: null, hint: null } };
    return { data: result.data[0] ?? null, error: null };
  }

  /** Exactly one row. */
  async single(): Promise<DbResult<Row>> {
    const result = await this.maybeSingle();
    if (result.error) return result;
    if (!result.data) return { data: null, error: { message: 'no rows', code: 'PGRST116', details: null, hint: null } };
    return { data: result.data, error: null };
  }

  then<A = DbResult<Row[]>, B = never>(
    onfulfilled?: ((value: DbResult<Row[]>) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.rows().then(onfulfilled, onrejected);
  }
}

export function from(table: string): Query {
  return new Query(table);
}

/** What a request contributes to "as the user" work: the token's claims and the request itself. */
export interface UserRequest {
  claims: Record<string, unknown>;
  method: string;
  headers: Record<string, string>;
}

/**
 * Runs `work` in one transaction as the signed-in user. Row Level Security
 * applies (`app.uid()` reads the Clerk claims); an error rolls everything
 * back, including what `work` did elsewhere before throwing.
 */
export async function asUser<T>(request: UserRequest, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try {
    await client.query('begin');
    // pg_session_jwt loads on first use and would drop claims set before it.
    await client.query('select auth.session()');
    await client.query(
      `select set_config('request.jwt.claims', $1, true),
              set_config('request.method', $2, true),
              set_config('request.headers', $3, true)`,
      [JSON.stringify(request.claims), request.method, JSON.stringify(request.headers)],
    );
    await client.query('set local role authenticated');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
