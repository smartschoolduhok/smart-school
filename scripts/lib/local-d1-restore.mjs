// Local SQL export restoration only. No network, credentials or remote database calls.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

export function sqlTokens(sql) {
  const tokens = [];
  for (let i = 0; i < sql.length;) {
    const start = i, c = sql[i];
    if (/\s/u.test(c)) { i++; continue; }
    if (c === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === '/' && sql[i + 1] === '*') {
      i += 2; while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      assert.ok(i < sql.length, 'Unterminated SQL comment'); i += 2; continue;
    }
    if (["'", '"', '`', '['].includes(c)) {
      const end = c === '[' ? ']' : c; let closed = false; i++;
      while (i < sql.length) {
        if (sql[i] === end) {
          if (c !== '[' && sql[i + 1] === end) { i += 2; continue; }
          i++; closed = true; break;
        }
        i++;
      }
      assert.ok(closed, 'Unterminated SQL quoted token');
      tokens.push({ start, end: i, kind: c === "'" ? 'literal' : 'identifier', text: sql.slice(start, i) });
    } else if (/[A-Za-z_]/.test(c)) {
      while (i < sql.length && /[A-Za-z_0-9$]/.test(sql[i])) i++;
      tokens.push({ start, end: i, kind: 'word', text: sql.slice(start, i) });
    } else tokens.push({ start, end: ++i, kind: 'symbol', text: c });
  }
  return tokens;
}

export function sqlStatements(sql) {
  const tokens = sqlTokens(sql), statements = [];
  let start = 0, first = 0, depth = 0, trigger = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], word = t.kind === 'word' ? t.text.toUpperCase() : '';
    if (word === 'TRIGGER' && tokens[first]?.text.toUpperCase() === 'CREATE') trigger = true;
    if (trigger) { if (word === 'BEGIN' || word === 'CASE') depth++; else if (word === 'END') depth--; }
    assert.ok(depth >= 0, 'Invalid trigger block');
    if (t.text === ';' && depth === 0) {
      statements.push({ start, end: t.end, tokens: tokens.slice(first, i + 1) });
      start = t.end; first = i + 1; trigger = false;
    }
  }
  assert.equal(first, tokens.length, 'Incomplete SQL export');
  return statements;
}
const quote = s => '"' + s.replaceAll('"', '""') + '"';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Deliberately fail closed for other oversized SQL. This fallback restores
// import_jobs rows without rewriting literals or bypassing financial triggers.
export function prepareLocalRestore(sql) {
  const statements = sqlStatements(sql), oversized = statements.filter(s => Buffer.byteLength(sql.slice(s.start, s.end)) > 100000);
  const baseline = new DatabaseSync(':memory:');
  try {
    baseline.exec(sql);
    const inserts = [];
    for (const statement of oversized) {
      const tokens = statement.tokens;
      assert.equal(tokens[0].text.toUpperCase(), 'INSERT', 'Unsupported oversized statement');
      assert.equal(tokens[1].text.toUpperCase(), 'INTO', 'Unsupported INSERT form');
      const table = tokens[2].text.replaceAll('"', '');
      assert.equal(table, 'import_jobs', 'Unsupported oversized table');
      const single = new DatabaseSync(':memory:');
      try {
        single.exec('PRAGMA foreign_keys=OFF');
        single.exec(baseline.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='import_jobs'").get().sql);
        single.exec(sql.slice(statement.start, statement.end));
        const read = single.prepare('SELECT * FROM import_jobs'); read.setReadBigInts(true);
        const rows = read.all(); assert.equal(rows.length, 1, 'Expected one oversized import_jobs row');
        const columns = single.prepare('PRAGMA table_info(import_jobs)').all().map(c => c.name);
        const row = rows[0]; let bytes = 0;
        const values = columns.map(column => {
          const value = row[column];
          if (value === null) return null;
          if (typeof value === 'bigint') {
            const number = Number(value);
            assert.ok(Number.isSafeInteger(number) && BigInt(number) === value, 'Lossy INTEGER binding'); bytes += 8; return number;
          }
          if (typeof value === 'number') { assert.ok(Number.isFinite(value), 'Non-finite REAL'); bytes += 8; return value; }
          if (typeof value === 'string') {
            const encoded = Buffer.from(value);
            assert.ok(encoded.length < 2000000, 'TEXT exceeds D1 limit');
            assert.ok(new TextDecoder('utf-8', { fatal: true }).decode(encoded) === value, 'Lossy TEXT binding');
            bytes += encoded.length; return value;
          }
          assert.ok(value instanceof Uint8Array, 'Unsupported SQLite type');
          assert.ok(value.byteLength < 2000000, 'BLOB exceeds D1 limit'); bytes += value.byteLength; return Uint8Array.from(value);
        });
        assert.ok(columns.length <= 100, 'Too many bound parameters');
        assert.ok(bytes + columns.length * 9 < 2000000, 'Row exceeds D1 limit');
        inserts.push({ sql: `INSERT INTO import_jobs (${columns.map(quote).join(',')}) VALUES (${columns.map((_,i) => '?'+(i+1)).join(',')})`, values, bytes });
      } finally { single.close(); }
    }
    let offset = 0, baseSql = '';
    for (const statement of oversized) { baseSql += sql.slice(offset, statement.start); offset = statement.end; }
    baseSql += sql.slice(offset);
    return { baseSql, inserts, statementCount: statements.length, baseStatementCount: statements.length - oversized.length };
  } finally { baseline.close(); }
}

export async function contentSnapshot(read) {
  const schema = (await read('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name'))
    .filter(r => !r.name.startsWith('_cf_') && !r.name.startsWith('sqlite_stat'))
    .map(r => ({ ...r, sql: r.sql === null ? null : sqlTokens(r.sql).map(t => [t.kind, t.text]) }));
  const tables = {};
  for (const { name } of schema.filter(r => r.type === 'table')) {
    const columns = await read(`PRAGMA table_xinfo(${quote(name)})`);
    const fields = columns.filter(c => c.hidden !== 1).map(c => c.name);
    const rows = await read('SELECT ' + fields.flatMap((c,i) => [
      `typeof(${quote(c)}) AS t${i}`,
      `CASE typeof(${quote(c)}) WHEN 'null' THEN NULL WHEN 'integer' THEN CAST(${quote(c)} AS TEXT) WHEN 'real' THEN printf('%!.17g',${quote(c)}) ELSE hex(${quote(c)}) END AS v${i}`,
    ]).join(',') + ' FROM ' + quote(name));
    const content = rows.map(r => JSON.stringify(fields.map((_,i) => [r['t'+i],r['v'+i]]))).sort();
    tables[name] = { columns, count: content.length, hash: digest(content), content };
  }
  return { schema, tables, foreignKeys: await read('PRAGMA foreign_key_check') };
}
export function assertSameContent(before, after) {
  assert.equal(digest(before.schema), digest(after.schema), 'Logical schema changed');
  assert.deepEqual(Object.keys(before.tables), Object.keys(after.tables), 'Tables changed');
  for (const name of Object.keys(before.tables)) {
    const a = before.tables[name], b = after.tables[name];
    assert.equal(digest(a.columns), digest(b.columns), 'Columns changed: '+name);
    assert.equal(a.count, b.count, 'Row count changed: '+name);
    assert.equal(a.hash, b.hash, 'Content hash changed: '+name);
    assert.ok(JSON.stringify(a.content) === JSON.stringify(b.content), 'Full content changed: '+name);
  }
  assert.equal(before.foreignKeys.length, 0); assert.equal(after.foreignKeys.length, 0);
}
