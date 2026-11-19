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
  // Schema changes are deployed only through versioned migrations.
  const sql = db();
  await sql`CREATE TABLE IF NOT EXISTS app_login_attempts (email TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, locked_until TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
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
function sessionCookie(id, sessionVersion = 0) {
  const payload = Buffer.from(JSON.stringify({ sub: id, sv: sessionVersion || 0, exp: Date.now() + 31536000000 })).toString('base64url');
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
  const rows = await db()`SELECT id, name, email, role, active, business_id, is_platform_admin, session_version FROM app_users WHERE id = ${data.sub} LIMIT 1`;
  const user = rows[0];
  return user && user.active && Number(user.session_version || 0) === Number(data.sv || 0) ? user : null;
}
async function authenticated(req, res, adminOnly = false) {
  if (!sameOrigin(req)) { send(res, 403, { error: 'Solicitud no permitida.' }); return null; }
  await ensureSchema();
  const user = await currentUser(req);
  if (!user) { send(res, 401, { error: 'Iniciá sesión para continuar.' }); return null; }
  if (adminOnly && user.is_platform_admin !== true) { send(res, 403, { error: 'Solo el administrador puede acceder a estos datos.' }); return null; }
  return user;
}
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 200;
const publicUser = u => ({ id:u.id, name:u.name, email:u.email, role:u.role, active:u.active, businessId:u.business_id || null, businessName:u.business_name || null, isPlatformAdmin:u.is_platform_admin === true, createdAt:u.created_at || u.createdAt });

module.exports = async function handler(req, res) {
  const path = new URL(req.url, `https://${req.headers.host || 'localhost'}`).pathname;
  try {
    if (path === '/api/auth/status' && req.method === 'GET') {
      const sql = await ensureSchema();
      const rows = await sql`SELECT COUNT(*)::int AS count FROM app_users WHERE is_platform_admin=TRUE`;
      return send(res, 200, { adminExists:Number(rows[0].count)>0 });
    }
    if (path === '/api/auth/me' && req.method === 'GET') {
      await ensureSchema(); const user = await currentUser(req);
      return user ? send(res,200,{authenticated:true,user:publicUser(user)}) : send(res,401,{authenticated:false});
    }
    if (path === '/api/auth/logout' && (req.method === 'GET' || req.method === 'POST')) {
      // Invalida la sesión en la base de datos, incluso si el navegador no acepta la cookie de borrado.
      await ensureSchema();
      const user = await currentUser(req);
      if (user) {
        await db()`UPDATE app_users SET session_version = COALESCE(session_version,0) + 1 WHERE id = ${user.id}`;
      }
      res.statusCode = 303;
      res.setHeader('Set-Cookie', [
        'pa_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        'pa_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
      ]);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Location', '/?signedout=' + Date.now());
      return res.end();
    }
    if (path === '/api/auth/bootstrap' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res,403,{error:'Solicitud no permitida.'});
      const sql = await ensureSchema();
      const existing = await sql`SELECT id FROM app_users WHERE is_platform_admin=TRUE LIMIT 1`;
      if (existing.length) return send(res,409,{error:'La cuenta administradora ya fue activada. Iniciá sesión.'});
      const input = body(req); const token = String(input.token || ''); const expected = process.env.ADMIN_BOOTSTRAP_TOKEN || '';
      if (!expected || token.length < 32 || !safeEqual(token,expected)) return send(res,403,{error:'El enlace de activación no es válido.'});
      const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase(); const name = String(input.name || '').trim().slice(0,70); const password = input.password;
      if (!validEmail(email) || !name || !validPassword(password)) return send(res,400,{error:'Completá tu nombre y una contraseña de al menos 12 caracteres.'});
      const id = crypto.randomUUID(); const passwordHash = await hashPassword(password);
      const rows = await sql`INSERT INTO app_users (id,name,email,password_hash,role,active,business_id,is_platform_admin) VALUES (${id},${name},${email},${passwordHash},'admin',TRUE,NULL,TRUE) RETURNING id,name,email,role,active,business_id,is_platform_admin`;
      return send(res,201,{user:publicUser(rows[0])},{'Set-Cookie':sessionCookie(id,0)});
    }
    if (path === '/api/auth/login' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res,403,{error:'Solicitud no permitida.'});
      const sql = await ensureSchema(); const input = body(req);
      const email = String(input.email || '').trim().toLowerCase(); const password = String(input.password || '');
      if (!email || !password) return send(res,400,{error:'Ingresá tu correo y contraseña.'});
      const attempts = await sql`SELECT failures,locked_until FROM app_login_attempts WHERE email=${email} LIMIT 1`;
      if (attempts[0]?.locked_until && new Date(attempts[0].locked_until).getTime()>Date.now()) return send(res,429,{error:'Demasiados intentos. Probá nuevamente dentro de unos minutos.'});
      const rows = await sql`SELECT id,name,email,password_hash,role,active,business_id,is_platform_admin,session_version FROM app_users WHERE lower(email)=${email} LIMIT 1`; const u = rows[0];
      if (!u || !u.active || !(await verifyPassword(password,u.password_hash))) {
        await sql`INSERT INTO app_login_attempts(email,failures,locked_until,updated_at) VALUES(${email},1,NULL,NOW()) ON CONFLICT(email) DO UPDATE SET failures=CASE WHEN app_login_attempts.updated_at<NOW()-INTERVAL '15 minutes' THEN 1 ELSE app_login_attempts.failures+1 END, locked_until=CASE WHEN (CASE WHEN app_login_attempts.updated_at<NOW()-INTERVAL '15 minutes' THEN 1 ELSE app_login_attempts.failures+1 END)>=6 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END, updated_at=NOW()`;
        return send(res,401,{error:'Correo o contraseña incorrectos.'});
      }
      await sql`DELETE FROM app_login_attempts WHERE email=${email}`;
      return send(res,200,{user:publicUser(u)},{'Set-Cookie':sessionCookie(u.id,u.session_version)});
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
      const users = await sql`SELECT id,role,active,is_platform_admin FROM app_users WHERE id = ${session.sub} LIMIT 1`;
      if (!users[0] || !users[0].active || users[0].is_platform_admin !== true) {
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
    if (path === '/api/admin/businesses') {
      const admin=await authenticated(req,res,true); if(!admin) return;
      const sql=db();
      if(req.method==='GET'){
        const rows=await sql`SELECT b.id,b.name,b.slug,b.active,b.address,b.phone,b.email,b.ruc,b.owner_name,b.created_at,b.updated_at,
          (SELECT COUNT(*)::int FROM app_users u WHERE u.business_id=b.id) AS user_count,
          (SELECT COUNT(*)::int FROM app_users u WHERE u.business_id=b.id AND u.active=TRUE) AS active_user_count,
          (SELECT COALESCE(SUM(amount),0)::numeric(14,2) FROM app_financial_entries f WHERE f.business_id=b.id AND f.entry_type='income') AS recorded_income,
          (SELECT COALESCE(SUM(amount),0)::numeric(14,2) FROM app_financial_entries f WHERE f.business_id=b.id AND f.entry_type='expense') AS recorded_expenses,
          (SELECT COALESCE(SUM(total),0)::numeric(14,2) FROM app_sales v WHERE v.business_id=b.id AND v.status='completed') AS sales_total,
          (SELECT updated_at FROM app_state st WHERE st.business_id=b.id LIMIT 1) AS last_sync
          FROM businesses b ORDER BY b.created_at DESC`;
        return send(res,200,{businesses:rows});
      }
      if(req.method==='POST'){
        const input=body(req); const name=String(input.name||'').trim().slice(0,120);
        const slug=String(input.slug||name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);
        if(!name||!slug) return send(res,400,{error:'Ingresá el nombre de la panadería.'});
        const id=crypto.randomUUID();
        const rows=await sql`INSERT INTO businesses(id,name,slug,active,address,phone,email,ruc,owner_name) VALUES(${id},${name},${slug},TRUE,${String(input.address||'').slice(0,250)},${String(input.phone||'').slice(0,60)},${String(input.email||'').slice(0,254)},${String(input.ruc||'').slice(0,40)},${String(input.ownerName||'').slice(0,120)}) RETURNING *`;
        await sql`INSERT INTO app_state(data,business_id) VALUES('{}'::jsonb,${id}) ON CONFLICT(business_id) DO NOTHING`;
        await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(${id},${admin.id},'business.created','business',${id},${JSON.stringify({name,slug})}::jsonb)`;
        return send(res,201,{business:rows[0]});
      }
      if(req.method==='PATCH'){
        const input=body(req); const id=String(input.id||''); if(!id) return send(res,400,{error:'Falta el identificador de la panadería.'});
        const rows=await sql`UPDATE businesses SET name=COALESCE(${input.name===undefined?null:String(input.name).trim().slice(0,120)},name), address=COALESCE(${input.address===undefined?null:String(input.address).slice(0,250)},address), phone=COALESCE(${input.phone===undefined?null:String(input.phone).slice(0,60)},phone), email=COALESCE(${input.email===undefined?null:String(input.email).slice(0,254)},email), ruc=COALESCE(${input.ruc===undefined?null:String(input.ruc).slice(0,40)},ruc), owner_name=COALESCE(${input.ownerName===undefined?null:String(input.ownerName).slice(0,120)},owner_name), active=COALESCE(${typeof input.active==='boolean'?input.active:null},active), updated_at=NOW() WHERE id=${id} RETURNING *`;
        if(!rows[0]) return send(res,404,{error:'No se encontró la panadería.'});
        await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(${id},${admin.id},'business.updated','business',${id},${JSON.stringify({active:input.active})}::jsonb)`;
        return send(res,200,{business:rows[0]});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/admin/users') {
      const admin = await authenticated(req,res,true); if (!admin) return;
      const sql = db();
      if (req.method === 'GET') {
        const rows = await sql`SELECT u.id,u.name,u.email,u.role,u.active,u.business_id,u.is_platform_admin,u.created_at,b.name AS business_name FROM app_users u LEFT JOIN businesses b ON b.id=u.business_id ORDER BY u.is_platform_admin DESC,u.created_at ASC`;
        return send(res,200,{users:rows.map(publicUser)});
      }
      if (req.method === 'POST') {
        const input=body(req); const name=String(input.name||'').trim().slice(0,70); const email=String(input.email||'').trim().toLowerCase(); const password=input.password; const role=['admin','supervisor','employee'].includes(input.role)?input.role:'employee'; let businessId=String(input.businessId||'');
        if (!name || !validEmail(email) || !validPassword(password)) return send(res,400,{error:'Completá nombre, correo y contraseña (mínimo 12 caracteres).'});
        if(!businessId){const first=await sql`SELECT id FROM businesses WHERE active=TRUE ORDER BY created_at ASC LIMIT 1`;businessId=first[0]?.id||'';}
        if(!businessId) return send(res,400,{error:'Primero registrá una panadería.'});
        const business=await sql`SELECT id FROM businesses WHERE id=${businessId} AND active=TRUE LIMIT 1`; if(!business.length) return send(res,400,{error:'La panadería seleccionada no existe o está inactiva.'});
        const id=crypto.randomUUID(); const hash=await hashPassword(password);
        const rows=await sql`INSERT INTO app_users(id,name,email,password_hash,role,active,business_id,is_platform_admin) VALUES(${id},${name},${email},${hash},${role},TRUE,${businessId},FALSE) RETURNING id,name,email,role,active,business_id,is_platform_admin,created_at`;
        return send(res,201,{user:publicUser(rows[0])});
      }
      if (req.method === 'PATCH') {
        const input=body(req); const id=String(input.id||''); if (!id || typeof input.active!=='boolean') return send(res,400,{error:'Datos de usuario incompletos.'});
        const rows=await sql`UPDATE app_users SET active=${input.active},session_version=session_version+1 WHERE id=${id} AND is_platform_admin=FALSE RETURNING id,name,email,role,active,business_id,is_platform_admin,created_at`;
        if (!rows[0]) return send(res,404,{error:'No se encontró ese usuario o no se puede modificar.'});
        return send(res,200,{user:publicUser(rows[0])});
      }
      if (req.method === 'DELETE') {
        const id=String(body(req).id||''); if (!id || id===admin.id) return send(res,400,{error:'No se puede eliminar la cuenta administradora.'});
        const rows=await sql`DELETE FROM app_users WHERE id=${id} AND is_platform_admin=FALSE RETURNING id`;
        if (!rows.length) return send(res,404,{error:'No se encontró ese usuario o no se puede eliminar.'});
        return send(res,200,{ok:true});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/admin/reset-data') {
      const admin = await authenticated(req,res,true); if (!admin) return;
      if (req.method !== 'POST') return send(res,405,{error:'Método no permitido.'});
      const sql=db();
      let businessId=String(req.headers['x-business-id']||'');
      if(!businessId){const first=await sql`SELECT id FROM businesses WHERE active=TRUE ORDER BY created_at ASC LIMIT 1`;businessId=first[0]?.id||'';}
      if(!businessId) return send(res,400,{error:'No hay panaderías registradas.'});
      const rows=await sql`SELECT data FROM app_state WHERE business_id=${businessId} LIMIT 1`;
      const current=rows[0]?.data&&typeof rows[0].data==='object'&&!Array.isArray(rows[0].data)?rows[0].data:{};
      const data={...current,movements:[],invoices:[],employees:[],employeePayments:[]}; delete data.users;
      const serialized=JSON.stringify(data);
      const saved=await sql`INSERT INTO app_state(data,updated_by,business_id,updated_at) VALUES(${serialized}::jsonb,${admin.id},${businessId},NOW()) ON CONFLICT(business_id) DO UPDATE SET data=EXCLUDED.data,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING updated_at`;
      return send(res,200,{ok:true,data,updatedAt:saved[0]?.updated_at||null});
    }
    if (path === '/api/data') {
      const user=await authenticated(req,res,false); if(!user) return;
      const sql=db();
      let businessId=user.is_platform_admin===true?String(req.headers['x-business-id']||''):String(user.business_id||'');
      if(user.is_platform_admin===true&&!businessId){const first=await sql`SELECT id FROM businesses WHERE active=TRUE ORDER BY created_at ASC LIMIT 1`;businessId=first[0]?.id||'';}
      if(!businessId) return send(res,400,{error:'No hay una panadería asignada a esta cuenta.'});
      const allowed=await sql`SELECT id FROM businesses WHERE id=${businessId} AND active=TRUE LIMIT 1`;
      if(!allowed.length) return send(res,404,{error:'La panadería seleccionada no existe o está inactiva.'});
      if(req.method==='GET'){
        const rows=await sql`SELECT data,updated_at FROM app_state WHERE business_id=${businessId} LIMIT 1`;
        return send(res,200,{data:rows[0]?rows[0].data:null,updatedAt:rows[0]?rows[0].updated_at:null});
      }
      if(req.method==='PUT'){
        const input=body(req); if(!input.data||typeof input.data!=='object'||Array.isArray(input.data)) return send(res,400,{error:'No se recibieron datos válidos.'});
        const data={...input.data}; delete data.users; const serialized=JSON.stringify(data);
        if(Buffer.byteLength(serialized,'utf8')>900000) return send(res,413,{error:'El volumen de datos supera el límite permitido.'});
        const saved=await sql`INSERT INTO app_state(data,updated_by,business_id,updated_at) VALUES(${serialized}::jsonb,${user.id},${businessId},NOW()) ON CONFLICT(business_id) DO UPDATE SET data=EXCLUDED.data,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING updated_at`;
        return send(res,200,{ok:true,updatedAt:saved[0]?.updated_at||null});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    return send(res,404,{error:'Ruta no encontrada.'});
  } catch (err) {
    if (err && err.code==='23505') return send(res,409,{error:'Ya existe un usuario con ese correo.'});
    return send(res,500,{error:'No se pudo completar la solicitud. Verificá la conexión de la base de datos.'});
  }
};
