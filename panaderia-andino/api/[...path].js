'use strict';
const { neon } = require('@neondatabase/serverless');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
let sqlClient;
function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}
async function ensureSchema() {
  const sql = db();
  await sql`CREATE TABLE IF NOT EXISTS app_users (id UUID PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','supervisor','employee')), active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS app_state (id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id=1), data JSONB NOT NULL, updated_by UUID, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS app_login_attempts (email TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, locked_until TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS app_bakeries (id UUID PRIMARY KEY, name TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', ruc TEXT NOT NULL DEFAULT '', active BOOLEAN NOT NULL DEFAULT TRUE, archived BOOLEAN NOT NULL DEFAULT FALSE, created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS app_audit_log (id BIGSERIAL PRIMARY KEY, actor_id UUID, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS bakery_id UUID REFERENCES app_bakeries(id) ON DELETE SET NULL`;
  const roleChecks = await sql`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='app_users'::regclass AND contype='c'`;
  const roleCheck = roleChecks.find(item => String(item.definition||'').includes('role'));
  if (!roleCheck || !String(roleCheck.definition).includes('owner')) {
    if (roleCheck?.conname) await sql`ALTER TABLE app_users DROP CONSTRAINT app_users_role_check`;
    await sql`ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('admin','owner','supervisor','employee'))`;
  }
  await sql`CREATE INDEX IF NOT EXISTS app_users_bakery_idx ON app_users(bakery_id,role,active)`;
  await sql`CREATE TABLE IF NOT EXISTS app_bakery_state (bakery_id UUID PRIMARY KEY REFERENCES app_bakeries(id) ON DELETE CASCADE, data JSONB NOT NULL, updated_by UUID, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS app_notifications (id UUID PRIMARY KEY, bakery_id UUID REFERENCES app_bakeries(id) ON DELETE CASCADE, title TEXT NOT NULL, message TEXT NOT NULL, created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  // One-time migration: preserve the previous shared workspace for existing non-admin accounts.
  const legacyUsers = await sql`SELECT id FROM app_users WHERE role<>'admin' AND bakery_id IS NULL LIMIT 1`;
  if (legacyUsers.length) {
    const legacyRows = await sql`SELECT data FROM app_state WHERE id=1 LIMIT 1`;
    const legacyData = legacyRows[0]?.data && typeof legacyRows[0].data==='object' ? legacyRows[0].data : {};
    const business = legacyData.business && typeof legacyData.business==='object' ? legacyData.business : {};
    const bakeryId = crypto.randomUUID();
    const bakeryName = String(business.name || 'Panadería existente').slice(0,100);
    const ownerName = String(business.owner || 'Responsable').slice(0,100);
    const bakeryEmail = String(business.email || '').slice(0,254);
    const admins = await sql`SELECT id FROM app_users WHERE role='admin' ORDER BY created_at ASC LIMIT 1`;
    await sql`INSERT INTO app_bakeries(id,name,owner,email,phone,address,ruc,created_by) VALUES(${bakeryId},${bakeryName},${ownerName},${bakeryEmail},${String(business.phone||'').slice(0,40)},${String(business.address||'').slice(0,180)},${String(business.ruc||'').slice(0,30)},${admins[0]?.id || null})`;
    await sql`UPDATE app_users SET bakery_id=${bakeryId} WHERE role<>'admin' AND bakery_id IS NULL`;
    await sql`INSERT INTO app_bakery_state(bakery_id,data,updated_at) VALUES(${bakeryId},${JSON.stringify(legacyData)}::jsonb,NOW()) ON CONFLICT(bakery_id) DO NOTHING`;
    await sql`INSERT INTO app_audit_log(actor_id,action,entity_type,entity_id,details) VALUES(${admins[0]?.id || null},'migrated','bakery',${bakeryId},'{"source":"legacy_shared_workspace"}'::jsonb)`;
  }
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS app_users_single_admin ON app_users(role) WHERE role='admin'`;
  return sql;
}
function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(JSON.stringify(data));
}
function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  return {};
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return new URL(origin).host === host; } catch (_) { return false; }
}
function cookie(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === 'pa_session') return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
function secret(key) {
  const value = process.env[key];
  if (!value || value.length < 32) throw new Error('Security configuration missing');
  return value;
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a || '')); const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const result = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$${salt.toString('hex')}$${Buffer.from(result).toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const p = String(stored || '').split('$');
  if (p.length !== 4 || p[0] !== 'scrypt' || p[1] !== '32768') return false;
  try {
    const expected = Buffer.from(p[3], 'hex');
    const actual = Buffer.from(await scrypt(password, Buffer.from(p[2], 'hex'), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }));
    return expected.length === 64 && crypto.timingSafeEqual(actual, expected);
  } catch (_) { return false; }
}
function sessionCookie(id) {
  const payload = Buffer.from(JSON.stringify({ sub: id, exp: Date.now() + 31536000000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret('SESSION_SECRET')).update(payload).digest('base64url');
  return `pa_session=${encodeURIComponent(payload + '.' + sig)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}
const clearCookie = 'pa_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
async function currentUser(req) {
  const token = cookie(req); if (!token) return null;
  const [payload, sig, extra] = token.split('.'); if (!payload || !sig || extra) return null;
  const expected = crypto.createHmac('sha256', secret('SESSION_SECRET')).update(payload).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  let data; try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (_) { return null; }
  if (!data.sub || !Number.isFinite(data.exp) || data.exp < Date.now()) return null;
  const rows = await db()`SELECT u.id,u.name,u.email,u.role,u.active,u.bakery_id,b.active AS bakery_active,b.archived AS bakery_archived FROM app_users u LEFT JOIN app_bakeries b ON b.id=u.bakery_id WHERE u.id = ${data.sub} LIMIT 1`;
  return rows[0] && rows[0].active && (rows[0].role==='admin' || (rows[0].bakery_active && !rows[0].bakery_archived)) ? rows[0] : null;
}
async function authenticated(req, res, adminOnly = false) {
  if (!sameOrigin(req)) { send(res, 403, { error: 'Solicitud no permitida.' }); return null; }
  await ensureSchema();
  const user = await currentUser(req);
  if (!user) { send(res, 401, { error: 'Iniciá sesión para continuar.' }); return null; }
  if (adminOnly && user.role !== 'admin') { send(res, 403, { error: 'Solo el administrador puede acceder a estos datos.' }); return null; }
  return user;
}
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 200;
const publicUser = u => ({ id:u.id, name:u.name, email:u.email, role:u.role, active:u.active, bakeryId:u.bakery_id || u.bakeryId || null, createdAt:u.created_at || u.createdAt });

module.exports = async function handler(req, res) {
  const path = new URL(req.url, `https://${req.headers.host || 'localhost'}`).pathname;
  try {
    if (path === '/api/auth/status' && req.method === 'GET') {
      const sql = await ensureSchema();
      const rows = await sql`SELECT COUNT(*)::int AS count FROM app_users WHERE role='admin'`;
      return send(res, 200, { adminExists:Number(rows[0].count)>0 });
    }
    if (path === '/api/auth/me' && req.method === 'GET') {
      await ensureSchema(); const user = await currentUser(req);
      return user ? send(res,200,{authenticated:true,user}) : send(res,401,{authenticated:false});
    }
    if (path === '/api/auth/logout' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res,403,{error:'Solicitud no permitida.'});
      return send(res,200,{ok:true},{'Set-Cookie':clearCookie});
    }
    if (path === '/api/auth/bootstrap' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res,403,{error:'Solicitud no permitida.'});
      const sql = await ensureSchema();
      const existing = await sql`SELECT id FROM app_users WHERE role='admin' LIMIT 1`;
      if (existing.length) return send(res,409,{error:'La cuenta administradora ya fue activada. Iniciá sesión.'});
      const input = body(req); const token = String(input.token || ''); const expected = process.env.ADMIN_BOOTSTRAP_TOKEN || '';
      if (!expected || token.length < 32 || !safeEqual(token,expected)) return send(res,403,{error:'El enlace de activación no es válido.'});
      const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase(); const name = String(input.name || '').trim().slice(0,70); const password = input.password;
      if (!validEmail(email) || !name || !validPassword(password)) return send(res,400,{error:'Completá tu nombre y una contraseña de al menos 12 caracteres.'});
      const id = crypto.randomUUID(); const passwordHash = await hashPassword(password);
      const rows = await sql`INSERT INTO app_users (id,name,email,password_hash,role,active) VALUES (${id},${name},${email},${passwordHash},'admin',TRUE) RETURNING id,name,email,role,active`;
      return send(res,201,{user:rows[0]},{'Set-Cookie':sessionCookie(id)});
    }
    if (path === '/api/auth/login' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res,403,{error:'Solicitud no permitida.'});
      const sql = await ensureSchema(); const input = body(req); const email = String(input.email || '').trim().toLowerCase(); const password = String(input.password || '');
      if (!email || !password) return send(res,400,{error:'Ingresá tu correo y contraseña.'});
      const attempts = await sql`SELECT failures,locked_until FROM app_login_attempts WHERE email=${email} LIMIT 1`;
      if (attempts[0]?.locked_until && new Date(attempts[0].locked_until).getTime()>Date.now()) return send(res,429,{error:'Demasiados intentos. Probá nuevamente dentro de unos minutos.'});
      const rows = await sql`SELECT u.id,u.name,u.email,u.password_hash,u.role,u.active,u.bakery_id,b.active AS bakery_active,b.archived AS bakery_archived FROM app_users u LEFT JOIN app_bakeries b ON b.id=u.bakery_id WHERE u.email=${email} LIMIT 1`; const u = rows[0];
      if (!u || !u.active || (u.role!=='admin' && (!u.bakery_active || u.bakery_archived)) || !(await verifyPassword(password,u.password_hash))) {
        await sql`INSERT INTO app_login_attempts(email,failures,locked_until,updated_at) VALUES(${email},1,NULL,NOW()) ON CONFLICT(email) DO UPDATE SET failures=CASE WHEN app_login_attempts.updated_at<NOW()-INTERVAL '15 minutes' THEN 1 ELSE app_login_attempts.failures+1 END, locked_until=CASE WHEN (CASE WHEN app_login_attempts.updated_at<NOW()-INTERVAL '15 minutes' THEN 1 ELSE app_login_attempts.failures+1 END)>=6 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END, updated_at=NOW()`;
        return send(res,401,{error:'Correo o contraseña incorrectos.'});
      }
      await sql`DELETE FROM app_login_attempts WHERE email=${email}`;
      return send(res,200,{user:{id:u.id,name:u.name,email:u.email,role:u.role,active:u.active,bakeryId:u.bakery_id || null}},{'Set-Cookie':sessionCookie(u.id)});
    }
    if (path === '/api/admin/database-info' && req.method === 'GET') {
      // Diagnóstico de solo lectura: autentica sin ensureSchema para evitar DDL.
      if (!sameOrigin(req)) return send(res,403,{error:'Solicitud no permitida.'});
      const token = cookie(req);
      const [payload, signature, extra] = token.split('.');
      if (!payload || !signature || extra) return send(res,401,{error:'Iniciá sesión para continuar.'});
      const expected = crypto.createHmac('sha256', secret('SESSION_SECRET')).update(payload).digest('base64url');
      if (!safeEqual(signature, expected)) return send(res,401,{error:'Iniciá sesión para continuar.'});
      let session;
      try { session = JSON.parse(Buffer.from(payload,'base64url').toString('utf8')); } catch (_) {
        return send(res,401,{error:'Iniciá sesión para continuar.'});
      }
      if (!session.sub || !Number.isFinite(session.exp) || session.exp < Date.now()) {
        return send(res,401,{error:'Iniciá sesión para continuar.'});
      }
      const sql = db();
      const users = await sql`SELECT id,role,active FROM app_users WHERE id = ${session.sub} LIMIT 1`;
      if (!users[0] || !users[0].active || users[0].role !== 'admin') {
        return send(res,403,{error:'Solo el administrador puede acceder a este diagnóstico.'});
      }
      const rows = await sql`SELECT current_database() AS database, current_user AS database_role, inet_server_addr()::text AS server_address, inet_server_port() AS server_port, version() AS server_version`;
      let configuredHost = null;
      try { configuredHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : (process.env.PGHOST || process.env.POSTGRES_HOST || null); } catch (_) {}
      const info = rows[0] || {};
      return send(res,200,{
        provider: configuredHost && configuredHost.includes('neon.tech') ? 'Neon' : (configuredHost ? 'PostgreSQL compatible' : 'unknown'),
        configuredHost,
        database: info.database || null,
        databaseRole: info.database_role || null,
        serverAddress: info.server_address || null,
        serverPort: info.server_port || null,
        serverVersion: info.server_version || null,
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
        vercelProject: process.env.VERCEL_PROJECT_NAME || null,
        vercelRegion: process.env.VERCEL_REGION || null,
        deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
        gitCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
        gitBranch: process.env.VERCEL_GIT_COMMIT_REF || null,
        readOnly: true
      });
    }
    if (path === '/api/admin/bakeries') {
      const admin = await authenticated(req,res,true); if (!admin) return;
      const sql = db();
      if (req.method === 'GET') {
        const rows = await sql`SELECT id,name,owner,email,phone,address,ruc,active,archived,created_at,updated_at FROM app_bakeries WHERE archived=FALSE ORDER BY created_at DESC`;
        return send(res,200,{bakeries:rows});
      }
      if (req.method === 'POST') {
        const input=body(req);
        const name=String(input.name||'').trim().slice(0,100);
        const owner=String(input.owner||'').trim().slice(0,100);
        const email=String(input.email||'').trim().toLowerCase().slice(0,254);
        const phone=String(input.phone||'').trim().slice(0,40);
        const address=String(input.address||'').trim().slice(0,180);
        const ruc=String(input.ruc||'').trim().slice(0,30);
        const ownerPassword=input.password;
        if (!name || !owner || !validEmail(email) || !validPassword(ownerPassword)) return send(res,400,{error:'Ingresá nombre, responsable, correo de acceso válido y contraseña de al menos 12 caracteres.'});
        const duplicate=await sql`SELECT id FROM app_users WHERE email=${email} LIMIT 1`;
        if (duplicate.length) return send(res,409,{error:'Ese correo ya tiene una cuenta. Usá otro correo.'});
        const id=crypto.randomUUID(), userId=crypto.randomUUID();
        const passwordHash=await hashPassword(ownerPassword);
        const rows=await sql`INSERT INTO app_bakeries(id,name,owner,email,phone,address,ruc,created_by) VALUES(${id},${name},${owner},${email},${phone},${address},${ruc},${admin.id}) RETURNING id,name,owner,email,phone,address,ruc,active,archived,created_at,updated_at`;
        await sql`INSERT INTO app_users(id,name,email,password_hash,role,active,bakery_id) VALUES(${userId},${owner},${email},${passwordHash},'owner',TRUE,${id})`;
        await sql`INSERT INTO app_audit_log(actor_id,action,entity_type,entity_id,details) VALUES(${admin.id},'created','bakery',${id},${JSON.stringify({name,owner,ownerUserId:userId})}::jsonb)`;
        return send(res,201,{bakery:rows[0],owner:{id:userId,name:owner,email,role:'owner'}});
      }
      if (req.method === 'PATCH') {
        const input=body(req); const id=String(input.id||'');
        if (!id) return send(res,400,{error:'Falta identificar la panadería.'});
        let rows;
        if (typeof input.active === 'boolean' && Object.keys(input).length===2) {
          rows=await sql`UPDATE app_bakeries SET active=${input.active},updated_at=NOW() WHERE id=${id} AND archived=FALSE RETURNING id,name,owner,email,phone,address,ruc,active,archived,created_at,updated_at`;
        } else {
          const name=String(input.name||'').trim().slice(0,100), owner=String(input.owner||'').trim().slice(0,100);
          const email=String(input.email||'').trim().toLowerCase().slice(0,254);
          if (!name || !owner || (email && !validEmail(email))) return send(res,400,{error:'Ingresá el nombre, responsable y un correo válido.'});
          rows=await sql`UPDATE app_bakeries SET name=${name},owner=${owner},email=${email},phone=${String(input.phone||'').trim().slice(0,40)},address=${String(input.address||'').trim().slice(0,180)},ruc=${String(input.ruc||'').trim().slice(0,30)},updated_at=NOW() WHERE id=${id} AND archived=FALSE RETURNING id,name,owner,email,phone,address,ruc,active,archived,created_at,updated_at`;
        }
        if (!rows[0]) return send(res,404,{error:'No se encontró esa panadería.'});
        await sql`INSERT INTO app_audit_log(actor_id,action,entity_type,entity_id,details) VALUES(${admin.id},'updated','bakery',${id},${JSON.stringify({name:rows[0].name,active:rows[0].active})}::jsonb)`;
        return send(res,200,{bakery:rows[0]});
      }
      if (req.method === 'DELETE') {
        const id=String(body(req).id||'');
        if (!id) return send(res,400,{error:'Falta identificar la panadería.'});
        const rows=await sql`UPDATE app_bakeries SET active=FALSE,archived=TRUE,updated_at=NOW() WHERE id=${id} AND archived=FALSE RETURNING id,name`;
        if (!rows[0]) return send(res,404,{error:'No se encontró esa panadería.'});
        await sql`INSERT INTO app_audit_log(actor_id,action,entity_type,entity_id,details) VALUES(${admin.id},'archived','bakery',${id},${JSON.stringify({name:rows[0].name})}::jsonb)`;
        return send(res,200,{ok:true});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/admin/audit') {
      const admin = await authenticated(req,res,true); if (!admin) return;
      if (req.method !== 'GET') return send(res,405,{error:'Método no permitido.'});
      const rows=await db()`SELECT l.id,l.action,l.entity_type,l.entity_id,l.details,l.created_at,u.name AS actor_name FROM app_audit_log l LEFT JOIN app_users u ON u.id=l.actor_id ORDER BY l.created_at DESC LIMIT 100`;
      return send(res,200,{events:rows});
    }
    if (path === '/api/admin/users') {
      const admin = await authenticated(req,res,true); if (!admin) return;
      const sql = db();
      if (req.method === 'GET') {
        const rows = await sql`SELECT id,name,email,role,active,created_at,bakery_id FROM app_users ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,created_at ASC`;
        return send(res,200,{users:rows.map(publicUser)});
      }
      if (req.method === 'POST') {
        const input=body(req); const name=String(input.name||'').trim().slice(0,70); const email=String(input.email||'').trim().toLowerCase(); const password=input.password; const role=input.role==='supervisor'?'supervisor':'employee'; const bakeryId=String(input.bakeryId||'');
        if (!name || !validEmail(email) || !validPassword(password) || !bakeryId) return send(res,400,{error:'Completá nombre, correo, contraseña y panadería.'});
        const bakery=await sql`SELECT id FROM app_bakeries WHERE id=${bakeryId} AND active=TRUE AND archived=FALSE LIMIT 1`; if(!bakery.length) return send(res,404,{error:'Seleccioná una panadería activa.'});
        const id=crypto.randomUUID(); const hash=await hashPassword(password);
        const rows=await sql`INSERT INTO app_users(id,name,email,password_hash,role,active,bakery_id) VALUES(${id},${name},${email},${hash},${role},TRUE,${bakeryId}) RETURNING id,name,email,role,active,created_at,bakery_id`;
        await sql`INSERT INTO app_audit_log(actor_id,action,entity_type,entity_id,details) VALUES(${admin.id},'created','user',${id},${JSON.stringify({name,email,role,bakeryId})}::jsonb)`;
        return send(res,201,{user:publicUser(rows[0])});
      }
      if (req.method === 'PATCH') {
        const input=body(req); const id=String(input.id||''); if (!id || typeof input.active!=='boolean') return send(res,400,{error:'Datos de usuario incompletos.'});
        const rows=await sql`UPDATE app_users SET active=${input.active} WHERE id=${id} AND role<>'admin' RETURNING id,name,email,role,active,created_at`;
        if (!rows[0]) return send(res,404,{error:'No se encontró ese usuario o no se puede modificar.'});
        await sql`INSERT INTO app_audit_log(actor_id,action,entity_type,entity_id,details) VALUES(${admin.id},'status_changed','user',${id},${JSON.stringify({active:input.active})}::jsonb)`;
        return send(res,200,{user:publicUser(rows[0])});
      }
      if (req.method === 'DELETE') {
        const id=String(body(req).id||''); if (!id || id===admin.id) return send(res,400,{error:'No se puede eliminar la cuenta administradora.'});
        const rows=await sql`DELETE FROM app_users WHERE id=${id} AND role<>'admin' RETURNING id`;
        if (!rows.length) return send(res,404,{error:'No se encontró ese usuario o no se puede eliminar.'});
        await sql`INSERT INTO app_audit_log(actor_id,action,entity_type,entity_id,details) VALUES(${admin.id},'deleted','user',${id},'{}'::jsonb)`;
        return send(res,200,{ok:true});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/bakery/users') {
      const user=await authenticated(req,res,false); if(!user) return;
      if (!user.bakery_id || !['owner','supervisor'].includes(user.role)) return send(res,403,{error:'No tenés permisos para administrar usuarios de una panadería.'});
      const sql=db();
      if(req.method==='GET') {
        const rows=await sql`SELECT id,name,email,role,active,created_at,bakery_id FROM app_users WHERE bakery_id=${user.bakery_id} ORDER BY created_at ASC`;
        return send(res,200,{users:rows.map(publicUser)});
      }
      if(req.method==='POST') {
        const input=body(req), name=String(input.name||'').trim().slice(0,70), email=String(input.email||'').trim().toLowerCase(), password=input.password;
        const role=input.role==='supervisor' && user.role==='owner'?'supervisor':'employee';
        if(!name || !validEmail(email) || !validPassword(password)) return send(res,400,{error:'Completá nombre, correo y contraseña de al menos 12 caracteres.'});
        const duplicate=await sql`SELECT id FROM app_users WHERE email=${email} LIMIT 1`; if(duplicate.length) return send(res,409,{error:'Ese correo ya está registrado.'});
        const id=crypto.randomUUID(), hash=await hashPassword(password);
        const rows=await sql`INSERT INTO app_users(id,name,email,password_hash,role,active,bakery_id) VALUES(${id},${name},${email},${hash},${role},TRUE,${user.bakery_id}) RETURNING id,name,email,role,active,created_at,bakery_id`;
        await sql`INSERT INTO app_audit_log(actor_id,action,entity_type,entity_id,details) VALUES(${user.id},'created','user',${id},${JSON.stringify({name,email,role,bakeryId:user.bakery_id})}::jsonb)`;
        return send(res,201,{user:publicUser(rows[0])});
      }
      if(req.method==='PATCH') {
        const input=body(req); if(!input.id || typeof input.active!=='boolean') return send(res,400,{error:'Datos de usuario incompletos.'});
        const allowed=user.role==='owner' ? ['supervisor','employee'] : ['employee'];
        const rows=await sql`UPDATE app_users SET active=${input.active} WHERE id=${input.id} AND bakery_id=${user.bakery_id} AND role=ANY(${allowed}) RETURNING id,name,email,role,active,created_at,bakery_id`;
        if(!rows[0]) return send(res,404,{error:'No se encontró ese usuario o no podés modificarlo.'});
        await sql`INSERT INTO app_audit_log(actor_id,action,entity_type,entity_id,details) VALUES(${user.id},'status_changed','user',${input.id},${JSON.stringify({active:input.active})}::jsonb)`;
        return send(res,200,{user:publicUser(rows[0])});
      }
      if(req.method==='DELETE') {
        const input=body(req), allowed=user.role==='owner'?['supervisor','employee']:['employee'];
        const rows=await sql`DELETE FROM app_users WHERE id=${input.id} AND bakery_id=${user.bakery_id} AND role=ANY(${allowed}) RETURNING id`;
        if(!rows.length) return send(res,404,{error:'No se encontró ese usuario o no podés eliminarlo.'});
        await sql`INSERT INTO app_audit_log(actor_id,action,entity_type,entity_id,details) VALUES(${user.id},'deleted','user',${input.id},'{}'::jsonb)`;
        return send(res,200,{ok:true});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/notifications') {
      const user=await authenticated(req,res,false); if(!user) return;
      const sql=db();
      if(req.method==='GET') {
        const rows=user.role==='admin'
          ? await sql`SELECT n.id,n.bakery_id,n.title,n.message,n.created_at,b.name AS bakery_name FROM app_notifications n LEFT JOIN app_bakeries b ON b.id=n.bakery_id ORDER BY n.created_at DESC LIMIT 200`
          : await sql`SELECT id,title,message,created_at FROM app_notifications WHERE bakery_id IS NULL OR bakery_id=${user.bakery_id} ORDER BY created_at DESC LIMIT 100`;
        return send(res,200,{notifications:rows});
      }
      if(req.method==='POST' && user.role==='admin') {
        const input=body(req), title=String(input.title||'').trim().slice(0,120), message=String(input.message||'').trim().slice(0,3000), bakeryId=input.bakeryId||null;
        if(!title || !message) return send(res,400,{error:'Completá el título y el mensaje.'});
        if(bakeryId) { const found=await sql`SELECT id FROM app_bakeries WHERE id=${bakeryId} AND archived=FALSE`; if(!found.length) return send(res,404,{error:'Panadería no encontrada.'}); }
        const id=crypto.randomUUID();
        await sql`INSERT INTO app_notifications(id,bakery_id,title,message,created_by) VALUES(${id},${bakeryId},${title},${message},${user.id})`;
        await sql`INSERT INTO app_audit_log(actor_id,action,entity_type,entity_id,details) VALUES(${user.id},'created','notification',${id},${JSON.stringify({title,bakeryId})}::jsonb)`;
        return send(res,201,{ok:true,id});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/admin/reset-data') {
      const admin = await authenticated(req,res,true); if (!admin) return;
      if (req.method !== 'POST') return send(res,405,{error:'Método no permitido.'});
      const input = body(req);
      if (input.confirm !== true) return send(res,400,{error:'Confirmá la limpieza de datos.'});
      const sql = db();
      const rows = await sql`SELECT data FROM app_state WHERE id=1 LIMIT 1`;
      const current = rows[0]?.data && typeof rows[0].data === 'object' && !Array.isArray(rows[0].data) ? rows[0].data : {};
      const data = { ...current, movements: [], invoices: [], employees: [], employeePayments: [] };
      delete data.users;
      const serialized = JSON.stringify(data);
      const saved = await sql`INSERT INTO app_state(id,data,updated_by,updated_at) VALUES(1,${serialized}::jsonb,${admin.id},NOW()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING updated_at`;
      return send(res,200,{ok:true,data,updatedAt:saved[0]?.updated_at || null});
    }
    if (path === '/api/data') {
      const user = await authenticated(req,res,false); if (!user) return;
      const sql=db();
      if(user.role==='admin') {
        if (req.method==='GET') { const rows=await sql`SELECT data,updated_at FROM app_state WHERE id=1 LIMIT 1`; return send(res,200,{data:rows[0]?rows[0].data:null,updatedAt:rows[0]?rows[0].updated_at:null}); }
        if (req.method==='PUT') {
          const input=body(req); if(!input.data || typeof input.data!=='object' || Array.isArray(input.data)) return send(res,400,{error:'No se recibieron datos válidos.'});
          const data={...input.data}; delete data.users; const serialized=JSON.stringify(data);
          if(Buffer.byteLength(serialized,'utf8')>900000) return send(res,413,{error:'El volumen de datos supera el límite permitido.'});
          const saved=await sql`INSERT INTO app_state(id,data,updated_by,updated_at) VALUES(1,${serialized}::jsonb,${user.id},NOW()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING updated_at`;
          return send(res,200,{ok:true,updatedAt:saved[0]?.updated_at || null});
        }
      } else {
        if(!user.bakery_id) return send(res,403,{error:'Tu cuenta todavía no está vinculada a una panadería. Contactá al administrador.'});
        const bakery=await sql`SELECT id FROM app_bakeries WHERE id=${user.bakery_id} AND active=TRUE AND archived=FALSE LIMIT 1`;
        if(!bakery.length) return send(res,403,{error:'El acceso a esta panadería está suspendido. Contactá al administrador.'});
        if(req.method==='GET') { const rows=await sql`SELECT data,updated_at FROM app_bakery_state WHERE bakery_id=${user.bakery_id} LIMIT 1`; return send(res,200,{data:rows[0]?.data || null,updatedAt:rows[0]?.updated_at || null}); }
        if(req.method==='PUT') {
          const input=body(req); if(!input.data || typeof input.data!=='object' || Array.isArray(input.data)) return send(res,400,{error:'No se recibieron datos válidos.'});
          const data={...input.data}; delete data.users; const serialized=JSON.stringify(data);
          if(Buffer.byteLength(serialized,'utf8')>900000) return send(res,413,{error:'El volumen de datos supera el límite permitido.'});
          const saved=await sql`INSERT INTO app_bakery_state(bakery_id,data,updated_by,updated_at) VALUES(${user.bakery_id},${serialized}::jsonb,${user.id},NOW()) ON CONFLICT(bakery_id) DO UPDATE SET data=EXCLUDED.data,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING updated_at`;
          return send(res,200,{ok:true,updatedAt:saved[0]?.updated_at || null});
        }
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    return send(res,404,{error:'Ruta no encontrada.'});
  } catch (err) {
    if (err && err.code==='23505') return send(res,409,{error:'Ya existe un usuario con ese correo.'});
    return send(res,500,{error:'No se pudo completar la solicitud. Verificá la conexión de la base de datos.'});
  }
};
