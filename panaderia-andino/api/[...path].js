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
  await sql`CREATE TABLE IF NOT EXISTS businesses (id UUID PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`INSERT INTO businesses (id,name,slug,active) VALUES ('00000000-0000-4000-8000-000000000001','Panadería Andino','panaderia-andino',TRUE) ON CONFLICT (id) DO NOTHING`;
  await sql`CREATE TABLE IF NOT EXISTS app_users (id UUID PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','supervisor','employee')), active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id)`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`UPDATE app_users SET business_id='00000000-0000-4000-8000-000000000001' WHERE business_id IS NULL`;
  await sql`ALTER TABLE app_users ALTER COLUMN business_id SET NOT NULL`;
  await sql`UPDATE app_users SET is_platform_admin=TRUE WHERE role='admin' AND LOWER(email)=LOWER(${String(process.env.ADMIN_EMAIL || '')}) AND ${Boolean(process.env.ADMIN_EMAIL)}`;
  await sql`CREATE TABLE IF NOT EXISTS app_state (id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id=1), data JSONB NOT NULL, updated_by UUID, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`ALTER TABLE app_state ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id)`;
  await sql`ALTER TABLE app_state DROP CONSTRAINT IF EXISTS app_state_id_check`;
  await sql`CREATE SEQUENCE IF NOT EXISTS app_state_id_seq START WITH 2`;
  await sql`ALTER TABLE app_state ALTER COLUMN id SET DEFAULT nextval('app_state_id_seq')`;
  await sql`UPDATE app_state SET business_id='00000000-0000-4000-8000-000000000001' WHERE business_id IS NULL`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS app_state_business_id_uidx ON app_state(business_id)`;
  await sql`ALTER TABLE app_state ALTER COLUMN business_id SET NOT NULL`;
  await sql`CREATE TABLE IF NOT EXISTS app_login_attempts (email TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, locked_until TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`DROP INDEX IF EXISTS app_users_single_admin`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS app_users_single_admin_per_business ON app_users(business_id) WHERE role='admin'`;
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
  const rows = await db()`SELECT u.id, u.name, u.email, u.role, u.active, u.business_id, u.is_platform_admin, b.name AS business_name FROM app_users u JOIN businesses b ON b.id=u.business_id WHERE u.id = ${data.sub} AND b.active=TRUE LIMIT 1`;
  return rows[0] && rows[0].active ? rows[0] : null;
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
const publicUser = u => ({ id:u.id, name:u.name, email:u.email, role:u.role, active:u.active, createdAt:u.created_at || u.createdAt });

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
      const rows = await sql`INSERT INTO app_users (id,name,email,password_hash,role,active,business_id,is_platform_admin) VALUES (${id},${name},${email},${passwordHash},'admin',TRUE,'00000000-0000-4000-8000-000000000001',TRUE) RETURNING id,name,email,role,active,business_id,is_platform_admin`;
      return send(res,201,{user:rows[0]},{'Set-Cookie':sessionCookie(id)});
    }
    if (path === '/api/auth/login' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res,403,{error:'Solicitud no permitida.'});
      const sql = await ensureSchema(); const input = body(req); const email = String(input.email || '').trim().toLowerCase(); const password = String(input.password || '');
      if (!email || !password) return send(res,400,{error:'Ingresá tu correo y contraseña.'});
      const attempts = await sql`SELECT failures,locked_until FROM app_login_attempts WHERE email=${email} LIMIT 1`;
      if (attempts[0]?.locked_until && new Date(attempts[0].locked_until).getTime()>Date.now()) return send(res,429,{error:'Demasiados intentos. Probá nuevamente dentro de unos minutos.'});
      const rows = await sql`SELECT u.id,u.name,u.email,u.password_hash,u.role,u.active,u.business_id,u.is_platform_admin,b.name AS business_name FROM app_users u JOIN businesses b ON b.id=u.business_id AND b.active=TRUE WHERE u.email=${email} LIMIT 1`; const u = rows[0];
      if (!u || !u.active || !(await verifyPassword(password,u.password_hash))) {
        await sql`INSERT INTO app_login_attempts(email,failures,locked_until,updated_at) VALUES(${email},1,NULL,NOW()) ON CONFLICT(email) DO UPDATE SET failures=CASE WHEN app_login_attempts.updated_at<NOW()-INTERVAL '15 minutes' THEN 1 ELSE app_login_attempts.failures+1 END, locked_until=CASE WHEN (CASE WHEN app_login_attempts.updated_at<NOW()-INTERVAL '15 minutes' THEN 1 ELSE app_login_attempts.failures+1 END)>=6 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END, updated_at=NOW()`;
        return send(res,401,{error:'Correo o contraseña incorrectos.'});
      }
      await sql`DELETE FROM app_login_attempts WHERE email=${email}`;
      return send(res,200,{user:{id:u.id,name:u.name,email:u.email,role:u.role,active:u.active,business_id:u.business_id,is_platform_admin:u.is_platform_admin,business_name:u.business_name}},{'Set-Cookie':sessionCookie(u.id)});
    }
    if (path === '/api/auth/signup' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res,403,{error:'Solicitud no permitida.'});
      const sql = await ensureSchema(); const input=body(req);
      const businessName=String(input.businessName||'').trim().slice(0,100);
      const name=String(input.name||'').trim().slice(0,70);
      const email=String(input.email||'').trim().toLowerCase(); const password=input.password;
      if (!businessName || !name || !validEmail(email) || !validPassword(password)) return send(res,400,{error:'Completá el nombre del negocio, tu nombre, correo y contraseña de al menos 12 caracteres.'});
      const businessId=crypto.randomUUID(); const userId=crypto.randomUUID();
      const slug=(businessName.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'panaderia')+'-'+crypto.randomBytes(4).toString('hex');
      const passwordHash=await hashPassword(password);
      await sql`INSERT INTO businesses(id,name,slug,active) VALUES(${businessId},${businessName},${slug},TRUE)`;
      try {
        const rows=await sql`INSERT INTO app_users(id,name,email,password_hash,role,active,business_id,is_platform_admin) VALUES(${userId},${name},${email},${passwordHash},'admin',TRUE,${businessId},FALSE) RETURNING id,name,email,role,active,business_id,is_platform_admin`;
        return send(res,201,{user:rows[0]},{'Set-Cookie':sessionCookie(userId)});
      } catch (error) {
        await sql`DELETE FROM businesses WHERE id=${businessId}`;
        throw error;
      }
    }
    if (path.startsWith('/api/platform/')) {
      const platformUser=await authenticated(req,res,false); if (!platformUser) return;
      if (!platformUser.is_platform_admin) return send(res,403,{error:'Solo el administrador de la plataforma puede gestionar panaderías.'});
      const sql=db();
      if (path === '/api/platform/businesses' && req.method === 'GET') {
        const rows=await sql`SELECT b.id,b.name,b.slug,b.active,b.created_at,COUNT(DISTINCT u.id)::int AS user_count,(SELECT email FROM app_users WHERE business_id=b.id AND role='admin' ORDER BY created_at ASC LIMIT 1) AS owner_email FROM businesses b LEFT JOIN app_users u ON u.business_id=b.id GROUP BY b.id ORDER BY b.created_at DESC`;
        return send(res,200,{businesses:rows});
      }
      if (path === '/api/platform/businesses' && req.method === 'POST') {
        const input=body(req); const businessName=String(input.businessName||'').trim().slice(0,100); const name=String(input.name||'').trim().slice(0,70);
        const email=String(input.email||'').trim().toLowerCase(); const password=input.password;
        if (!businessName || !name || !validEmail(email) || !validPassword(password)) return send(res,400,{error:'Completá negocio, responsable, correo y contraseña de al menos 12 caracteres.'});
        const businessId=crypto.randomUUID(); const userId=crypto.randomUUID();
        const slug=(businessName.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'panaderia')+'-'+crypto.randomBytes(4).toString('hex');
        const passwordHash=await hashPassword(password);
        await sql`INSERT INTO businesses(id,name,slug,active) VALUES(${businessId},${businessName},${slug},TRUE)`;
        try {
          await sql`INSERT INTO app_users(id,name,email,password_hash,role,active,business_id,is_platform_admin) VALUES(${userId},${name},${email},${passwordHash},'admin',TRUE,${businessId},FALSE)`;
        } catch(error) { await sql`DELETE FROM businesses WHERE id=${businessId}`; throw error; }
        return send(res,201,{ok:true,business:{id:businessId,name:businessName,slug,active:true},owner:{name,email}});
      }
      if (path === '/api/platform/businesses' && req.method === 'PATCH') {
        const input=body(req); const id=String(input.id||'');
        if (!id || typeof input.active!=='boolean') return send(res,400,{error:'Indicá la panadería y su estado.'});
        if (id===platformUser.business_id && input.active===false) return send(res,400,{error:'No podés suspender el negocio principal que administra la plataforma.'});
        const rows=await sql`UPDATE businesses SET active=${input.active} WHERE id=${id} RETURNING id,name,slug,active,created_at`;
        if (!rows[0]) return send(res,404,{error:'No se encontró la panadería.'});
        return send(res,200,{business:rows[0]});
      }
      return send(res,404,{error:'Ruta de plataforma no encontrada.'});
    }
    if (path === '/api/admin/users') {
      const admin = await authenticated(req,res,true); if (!admin) return;
      const sql = db();
      if (req.method === 'GET') {
        const rows = await sql`SELECT id,name,email,role,active,created_at FROM app_users WHERE business_id=${admin.business_id} ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,created_at ASC`;
        return send(res,200,{users:rows.map(publicUser)});
      }
      if (req.method === 'POST') {
        const input=body(req); const name=String(input.name||'').trim().slice(0,70); const email=String(input.email||'').trim().toLowerCase(); const password=input.password; const role=input.role==='supervisor'?'supervisor':'employee';
        if (!name || !validEmail(email) || !validPassword(password)) return send(res,400,{error:'Completá nombre, correo y contraseña (mínimo 12 caracteres).'});
        const id=crypto.randomUUID(); const hash=await hashPassword(password);
        const rows=await sql`INSERT INTO app_users(id,name,email,password_hash,role,active,business_id) VALUES(${id},${name},${email},${hash},${role},TRUE,${admin.business_id}) RETURNING id,name,email,role,active,created_at`;
        return send(res,201,{user:publicUser(rows[0])});
      }
      if (req.method === 'PATCH') {
        const input=body(req); const id=String(input.id||''); if (!id || typeof input.active!=='boolean') return send(res,400,{error:'Datos de usuario incompletos.'});
        const rows=await sql`UPDATE app_users SET active=${input.active} WHERE id=${id} AND role<>'admin' AND business_id=${admin.business_id} RETURNING id,name,email,role,active,created_at`;
        if (!rows[0]) return send(res,404,{error:'No se encontró ese usuario o no se puede modificar.'});
        return send(res,200,{user:publicUser(rows[0])});
      }
      if (req.method === 'DELETE') {
        const id=String(body(req).id||''); if (!id || id===admin.id) return send(res,400,{error:'No se puede eliminar la cuenta administradora.'});
        const rows=await sql`DELETE FROM app_users WHERE id=${id} AND role<>'admin' AND business_id=${admin.business_id} RETURNING id`;
        if (!rows.length) return send(res,404,{error:'No se encontró ese usuario o no se puede eliminar.'});
        return send(res,200,{ok:true});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/admin/reset-data') {
      const admin = await authenticated(req,res,true); if (!admin) return;
      if (req.method !== 'POST') return send(res,405,{error:'Método no permitido.'});
      const input = body(req);
      if (input.confirm !== true) return send(res,400,{error:'Confirmá la limpieza de datos.'});
      const sql = db();
      const rows = await sql`SELECT data FROM app_state WHERE business_id=${admin.business_id} LIMIT 1`;
      const current = rows[0]?.data && typeof rows[0].data === 'object' && !Array.isArray(rows[0].data) ? rows[0].data : {};
      const data = { ...current, movements: [], invoices: [], employees: [], employeePayments: [] };
      delete data.users;
      const serialized = JSON.stringify(data);
      const saved = await sql`INSERT INTO app_state(data,updated_by,updated_at,business_id) VALUES(${serialized}::jsonb,${admin.id},NOW(),${admin.business_id}) ON CONFLICT(business_id) DO UPDATE SET data=EXCLUDED.data,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING updated_at`;
      return send(res,200,{ok:true,data,updatedAt:saved[0]?.updated_at || null});
    }
    if (path === '/api/data') {
      const user = await authenticated(req,res,false); if (!user) return;
      const sql=db();
      if (req.method==='GET') {
        const rows=await sql`SELECT data,updated_at FROM app_state WHERE business_id=${user.business_id} LIMIT 1`;
        return send(res,200,{data:rows[0]?rows[0].data:null,updatedAt:rows[0]?rows[0].updated_at:null});
      }
      if (req.method==='PUT') {
        const input=body(req); if (!input.data || typeof input.data!=='object' || Array.isArray(input.data)) return send(res,400,{error:'No se recibieron datos válidos.'});
        const data={...input.data}; delete data.users; const serialized=JSON.stringify(data);
        if (Buffer.byteLength(serialized,'utf8')>900000) return send(res,413,{error:'El volumen de datos supera el límite permitido.'});
        if (data.business && typeof data.business.name === 'string') { const businessName=data.business.name.trim().slice(0,100); if (businessName) await sql`UPDATE businesses SET name=${businessName} WHERE id=${user.business_id}`; }
        const saved=await sql`INSERT INTO app_state(data,updated_by,updated_at,business_id) VALUES(${serialized}::jsonb,${user.id},NOW(),${user.business_id}) ON CONFLICT(business_id) DO UPDATE SET data=EXCLUDED.data,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING updated_at`;
        return send(res,200,{ok:true,updatedAt:saved[0]?.updated_at || null});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    return send(res,404,{error:'Ruta no encontrada.'});
  } catch (err) {
    if (err && err.code==='23505') return send(res,409,{error:'Ya existe un usuario con ese correo.'});
    return send(res,500,{error:'No se pudo completar la solicitud. Verificá la conexión de la base de datos.'});
  }
};
