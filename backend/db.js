import sqlite3 from 'sqlite3';
sqlite3.verbose();

export const db = new sqlite3.Database('./database/pgr_compras.db');

export function initDb(){
  db.serialize(()=>{
    /* ─── Usuarios del sistema ─── */
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT DEFAULT '',
      document_type TEXT DEFAULT 'DUI',
      document_number TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'analista',
      unit_id INTEGER,
      avatar_color TEXT DEFAULT '#0066cc',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(unit_id) REFERENCES units(id)
    )`);

    /* ─── Unidades Solicitantes ─── */
    db.run(`CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      responsible_name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    /* ─── Categorías de Proyectos ─── */
    db.run(`CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#0066cc',
      icon TEXT DEFAULT 'folder',
      description TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    /* ─── Proyectos de Compra ─── */
    db.run(`CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      unit_id INTEGER,
      category_id INTEGER,
      status TEXT DEFAULT 'borrador',
      priority TEXT DEFAULT 'media',
      budget_estimated REAL DEFAULT 0,
      legal_reference TEXT DEFAULT '',
      deadline DATE,
      assigned_to INTEGER,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(unit_id) REFERENCES units(id),
      FOREIGN KEY(category_id) REFERENCES categories(id),
      FOREIGN KEY(assigned_to) REFERENCES users(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    )`);

    /* ─── Correspondencia (Gmail-like) ─── */
    db.run(`CREATE TABLE IF NOT EXISTS correspondences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      body TEXT DEFAULT '',
      from_user_id INTEGER,
      to_user_id INTEGER,
      project_id INTEGER,
      label TEXT DEFAULT 'inbox',
      is_read INTEGER DEFAULT 0,
      is_starred INTEGER DEFAULT 0,
      is_archived INTEGER DEFAULT 0,
      ai_category TEXT DEFAULT '',
      ai_priority TEXT DEFAULT '',
      ai_summary TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(from_user_id) REFERENCES users(id),
      FOREIGN KEY(to_user_id) REFERENCES users(id),
      FOREIGN KEY(project_id) REFERENCES projects(id)
    )`);

    /* ─── Alertas del Sistema ─── */
    db.run(`CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      user_id INTEGER,
      type TEXT DEFAULT 'info',
      title TEXT NOT NULL,
      message TEXT DEFAULT '',
      is_read INTEGER DEFAULT 0,
      trigger_date DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    /* ─── Solicitudes de Compra (Ley LACAP) ─── */
    db.run(`CREATE TABLE IF NOT EXISTS procurement_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      project_id INTEGER,
      unit_id INTEGER,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      legal_basis TEXT DEFAULT 'LACAP Art. 39 - Licitación Pública',
      procurement_type TEXT DEFAULT 'licitacion_publica',
      estimated_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'borrador',
      justification TEXT DEFAULT '',
      created_by INTEGER,
      approved_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(unit_id) REFERENCES units(id),
      FOREIGN KEY(created_by) REFERENCES users(id),
      FOREIGN KEY(approved_by) REFERENCES users(id)
    )`);

    /* ─── Roles del sistema ─── */
    db.run(`CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT DEFAULT '',
      is_system INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    /* ─── Configuración del sistema ─── */
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    /* ─── Eventos / Timeline de Proyectos ─── */
    db.run(`CREATE TABLE IF NOT EXISTS project_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      user_id INTEGER,
      event_type TEXT NOT NULL DEFAULT 'note',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      old_value TEXT DEFAULT '',
      new_value TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    /* ─── Configuración de correo por usuario ─── */
    db.run(`CREATE TABLE IF NOT EXISTS user_email_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      email_address TEXT NOT NULL DEFAULT '',
      imap_host TEXT DEFAULT '',
      imap_port INTEGER DEFAULT 993,
      imap_secure INTEGER DEFAULT 1,
      smtp_host TEXT DEFAULT '',
      smtp_port INTEGER DEFAULT 587,
      smtp_secure INTEGER DEFAULT 1,
      email_password TEXT DEFAULT '',
      provider TEXT DEFAULT 'other',
      is_active INTEGER DEFAULT 0,
      last_sync DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
  });
}

export const all=(sql,p=[])=>new Promise((res,rej)=>db.all(sql,p,(e,r)=>e?rej(e):res(r)));
export const get=(sql,p=[])=>new Promise((res,rej)=>db.get(sql,p,(e,r)=>e?rej(e):res(r)));
export const run=(sql,p=[])=>new Promise((res,rej)=>db.run(sql,p,function(e){if(e)return rej(e);res({lastID:this.lastID,changes:this.changes});}));
