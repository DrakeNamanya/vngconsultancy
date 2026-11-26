// Creates / upgrades the D1 tables on first use, so a fresh Cloudflare D1 database works without running migrations by hand.
// The SQL comes from migrations/*.sql (single source of truth). Every statement is idempotent; "duplicate column" errors are ignored.
import m1 from '../migrations/0001_init.sql?raw'
import m2 from '../migrations/0002_field_monitoring.sql?raw'

const statements = [m1, m2]
  .flatMap(sql => sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n').split(';'))
  .map(s => s.trim()).filter(Boolean)

let ready: Promise<void> | null = null
export function ensureSchema(db: D1Database): Promise<void> {
  return (ready ||= (async () => {
    const probe: any = await db.prepare("SELECT COUNT(*) n FROM pragma_table_info('submissions') WHERE name='field_status'").first()
    if (probe?.n) return
    // A table called "submissions" that was not created by this app (different columns) cannot be upgraded safely: say so clearly.
    const cols = ((await db.prepare("SELECT name FROM pragma_table_info('submissions')").all()).results as any[]).map(r => r.name)
    if (cols.length && !(cols.includes('form_uid') && cols.includes('lg') && cols.includes('enumerator_id'))) {
      const tables = ((await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()).results as any[]).map(r => r.name)
      throw new Error(`The bound D1 database already has a different "submissions" table (columns: ${cols.join(', ')}; tables: ${tables.join(', ')}). Bind a new, empty D1 database as DB.`)
    }
    for (const s of statements) {
      try { await db.prepare(s).run() } catch (e: any) { if (!/duplicate column|already exists/i.test(String(e?.message || e))) throw e }
    }
  })().catch(e => { ready = null; throw e }))
}
