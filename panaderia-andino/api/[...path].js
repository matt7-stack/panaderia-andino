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

// El esquema multi-negocio se administra mediante migraciones versionadas,
// nunca creando tablas paralelas ni modificando datos en cada petición.
async function ensureSchema() { return db(); }

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
  return 'scrypt$32768$' + salt.toString('hex') + '$' + Buffer.from(result).toString('hex');
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
function sessionCookie(id, version = 0) {
  const payload = Buffer.from(JSON.stringify({ sub: id, ver: Number(version) || 0, exp: Date.now() + 31536000000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret('SESSION_SECRET')).update(payload).digest('base64url');
  return 'pa_session=' + encodeURIComponent(payload + '.' + sig) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000';
}
const clearCookie = 'pa_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

async function currentUser(req) {
  const token = cookie(req);
  if (!token) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra) return null;
  const expected = crypto.createHmac('sha256', secret('SESSION_SECRET')).update(payload).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (_) { return null; }
  if (!data.sub || !Number.isFinite(data.exp) || data.exp < Date.now()) return null;
  const rows = await db()`SELECT u.id,u.name,u.email,u.role,u.active,u.business_id,u.is_platform_admin,u.session_version,
    CASE WHEN u.is_platform_admin THEN TRUE ELSE COALESCE(b.active,FALSE) END AS business_active
    FROM app_users u LEFT JOIN businesses b ON b.id=u.business_id WHERE u.id=${data.sub} LIMIT 1`;
  const user = rows[0];
  if (!user || !user.active || !user.business_active) return null;
  if (Number(data.ver || 0) !== Number(user.session_version || 0)) return null;
  return user;
}
async function authenticated(req, res, platformAdminOnly = false) {
  if (!sameOrigin(req)) { send(res, 403, { error: 'Solicitud no permitida.' }); return null; }
  await ensureSchema();
  const user = await currentUser(req);
  if (!user) { send(res, 401, { error: 'Iniciá sesión para continuar.' }); return null; }
  if (platformAdminOnly && user.is_platform_admin !== true) {
    send(res, 403, { error: 'Solo el administrador global puede acceder a esta función.' });
    return null;
  }
  return user;
}
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 200;
const publicUser = u => ({
  id: u.id, name: u.name, email: u.email, role: u.role, active: u.active,
  businessId: u.business_id || null, businessName: u.business_name || null,
  isPlatformAdmin: u.is_platform_admin === true, createdAt: u.created_at || u.createdAt
});
const publicSessionUser = u => ({
  id: u.id, name: u.name, email: u.email, role: u.role, active: u.active,
  businessId: u.business_id || null, isPlatformAdmin: u.is_platform_admin === true
});
function slugify(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
async function selectedBusiness(req, user) {
  if (!user.is_platform_admin) {
    const rows = await db()`SELECT id,name,slug,active FROM businesses WHERE id=${user.business_id} AND active=TRUE LIMIT 1`;
    return rows[0] || null;
  }
  const url = new URL(req.url, 'https://' + (req.headers.host || 'localhost'));
  const id = String(req.headers['x-business-id'] || url.searchParams.get('businessId') || '').trim();
  if (!id) return null;
  const rows = await db()`SELECT id,name,slug,active FROM businesses WHERE id=${id} AND active=TRUE LIMIT 1`;
  return rows[0] || null;
}

module.exports = async function handler(req, res) {
  const path = new URL(req.url, 'https://' + (req.headers.host || 'localhost')).pathname;
  try {
    if (path === '/api/auth/status' && req.method === 'GET') {
      const sql = await ensureSchema();
      const rows = await sql`SELECT COUNT(*)::int AS count FROM app_users WHERE is_platform_admin=TRUE`;
      return send(res, 200, { adminExists: Number(rows[0].count) > 0 });
    }
    if (path === '/api/auth/me' && req.method === 'GET') {
      await ensureSchema();
      const user = await currentUser(req);
      return user ? send(res, 200, { authenticated: true, user: publicSessionUser(user) }) : send(res, 401, { authenticated: false });
    }
    if (path === '/api/auth/logout' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, { error: 'Solicitud no permitida.' });
      return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
    }
    if (path === '/api/auth/bootstrap' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, { error: 'Solicitud no permitida.' });
      const sql = await ensureSchema();
      const existing = await sql`SELECT id FROM app_users WHERE is_platform_admin=TRUE LIMIT 1`;
      if (existing.length) return send(res, 409, { error: 'La cuenta administradora ya fue activada. Iniciá sesión.' });
      const input = body(req);
      const token = String(input.token || '');
      const expected = process.env.ADMIN_BOOTSTRAP_TOKEN || '';
      if (!expected || token.length < 32 || !safeEqual(token, expected)) return send(res, 403, { error: 'El enlace de activación no es válido.' });
      const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
      const name = String(input.name || '').trim().slice(0, 70);
      const password = input.password;
      if (!validEmail(email) || !name || !validPassword(password)) return send(res, 400, { error: 'Completá tu nombre y una contraseña de al menos 12 caracteres.' });
      const id = crypto.randomUUID();
      const passwordHash = await hashPassword(password);
      const rows = await sql`INSERT INTO app_users (id,name,email,password_hash,role,active,business_id,is_platform_admin)
        VALUES (${id},${name},${email},${passwordHash},'admin',TRUE,NULL,TRUE)
        RETURNING id,name,email,role,active,business_id,is_platform_admin,session_version`;
      return send(res, 201, { user: publicSessionUser(rows[0]) }, { 'Set-Cookie': sessionCookie(id, rows[0].session_version) });
    }
    if (path === '/api/auth/recover' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, { error: 'Solicitud no permitida.' });
      const sql = await ensureSchema();
      const input = body(req);
      const token = String(input.token || '');
      const password = input.password;
      if (!/^[a-f0-9]{64}$/i.test(token)) return send(res, 400, { error: 'El enlace no es válido o ya venció. Solicitá uno nuevo.' });
      if (!validPassword(password)) return send(res, 400, { error: 'La contraseña debe tener al menos 12 caracteres.' });
      const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
      const passwordHash = await hashPassword(password);
      const rows = await sql`
        WITH consumed AS (
          UPDATE admin_password_resets r
          SET used_at=NOW()
          FROM app_users u
          WHERE r.token_hash=${tokenHash}
            AND r.user_id=u.id
            AND u.is_platform_admin=TRUE
            AND u.active=TRUE
            AND r.used_at IS NULL
            AND r.expires_at>NOW()
          RETURNING r.user_id
        )
        UPDATE app_users u
        SET password_hash=${passwordHash}, session_version=COALESCE(u.session_version,0)+1
        FROM consumed c
        WHERE u.id=c.user_id AND u.is_platform_admin=TRUE
        RETURNING u.id
      `;
      if (!rows.length) return send(res, 400, { error: 'El enlace no es válido o ya fue utilizado. Solicitá uno nuevo.' });
      return send(res, 200, { ok: true, message: 'Contraseña actualizada. Ya podés iniciar sesión.' }, { 'Set-Cookie': clearCookie });
    }

    if (path === '/api/auth/login' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, { error: 'Solicitud no permitida.' });
      const sql = await ensureSchema();
      const input = body(req);
      const email = String(input.email || '').trim().toLowerCase();
      const password = String(input.password || '');
      if (!email || !password) return send(res, 400, { error: 'Ingresá tu correo y contraseña.' });
      const attempts = await sql`SELECT failures,locked_until FROM app_login_attempts WHERE email=${email} LIMIT 1`;
      if (attempts[0]?.locked_until && new Date(attempts[0].locked_until).getTime() > Date.now()) return send(res, 429, { error: 'Demasiados intentos. Probá nuevamente dentro de unos minutos.' });
      const rows = await sql`SELECT u.id,u.name,u.email,u.password_hash,u.role,u.active,u.business_id,u.is_platform_admin,u.session_version,
        CASE WHEN u.is_platform_admin THEN TRUE ELSE COALESCE(b.active,FALSE) END AS business_active
        FROM app_users u LEFT JOIN businesses b ON b.id=u.business_id WHERE u.email=${email} LIMIT 1`;
      const u = rows[0];
      if (!u || !u.active || !u.business_active || !(await verifyPassword(password, u.password_hash))) {
        await sql`INSERT INTO app_login_attempts(email,failures,locked_until,updated_at) VALUES(${email},1,NULL,NOW())
          ON CONFLICT(email) DO UPDATE SET
          failures=CASE WHEN app_login_attempts.updated_at<NOW()-INTERVAL '15 minutes' THEN 1 ELSE app_login_attempts.failures+1 END,
          locked_until=CASE WHEN (CASE WHEN app_login_attempts.updated_at<NOW()-INTERVAL '15 minutes' THEN 1 ELSE app_login_attempts.failures+1 END)>=6 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END,
          updated_at=NOW()`;
        return send(res, 401, { error: 'Correo o contraseña incorrectos.' });
      }
      await sql`DELETE FROM app_login_attempts WHERE email=${email}`;
      return send(res, 200, { user: publicSessionUser(u) }, { 'Set-Cookie': sessionCookie(u.id, u.session_version) });
    }

    if (path === '/api/admin/businesses') {
      const admin = await authenticated(req, res, true);
      if (!admin) return;
      const sql = db();
      if (req.method === 'GET') {
        const rows = await sql`SELECT b.id,b.name,b.slug,b.active,b.created_at,
          COUNT(u.id)::int AS user_count
          FROM businesses b LEFT JOIN app_users u ON u.business_id=b.id
          GROUP BY b.id ORDER BY b.created_at ASC`;
        return send(res, 200, { businesses: rows.map(b => ({
          id:b.id,name:b.name,slug:b.slug,active:b.active,createdAt:b.created_at,userCount:b.user_count
        })) });
      }
      if (req.method === 'POST') {
        const input = body(req);
        const name = String(input.name || '').trim().slice(0, 100);
        const slug = slugify(input.slug || name);
        if (!name || !slug) return send(res, 400, { error: 'Ingresá un nombre válido para el negocio.' });
        const id = crypto.randomUUID();
        const rows = await sql`INSERT INTO businesses(id,name,slug,active) VALUES(${id},${name},${slug},TRUE)
          RETURNING id,name,slug,active,created_at`;
        const b = rows[0];
        return send(res, 201, { business: { id:b.id,name:b.name,slug:b.slug,active:b.active,createdAt:b.created_at,userCount:0 } });
      }
      if (req.method === 'PATCH') {
        const input = body(req);
        const id = String(input.id || '');
        if (!id) return send(res, 400, { error: 'Indicá el negocio que querés modificar.' });
        if (typeof input.active === 'boolean') {
          const rows = await sql`UPDATE businesses SET active=${input.active} WHERE id=${id} RETURNING id,name,slug,active,created_at`;
          if (!rows[0]) return send(res, 404, { error: 'No se encontró el negocio.' });
          return send(res, 200, { business: { id:rows[0].id,name:rows[0].name,slug:rows[0].slug,active:rows[0].active,createdAt:rows[0].created_at } });
        }
        const name = String(input.name || '').trim().slice(0, 100);
        const slug = slugify(input.slug || name);
        if (!name || !slug) return send(res, 400, { error: 'Ingresá un nombre válido para el negocio.' });
        const rows = await sql`UPDATE businesses SET name=${name},slug=${slug} WHERE id=${id} RETURNING id,name,slug,active,created_at`;
        if (!rows[0]) return send(res, 404, { error: 'No se encontró el negocio.' });
        return send(res, 200, { business: { id:rows[0].id,name:rows[0].name,slug:rows[0].slug,active:rows[0].active,createdAt:rows[0].created_at } });
      }
      return send(res, 405, { error: 'Método no permitido.' });
    }

    if (path === '/api/admin/users') {
      const admin = await authenticated(req, res, true);
      if (!admin) return;
      const sql = db();
      if (req.method === 'GET') {
        const rows = await sql`SELECT u.id,u.name,u.email,u.role,u.active,u.created_at,u.business_id,u.is_platform_admin,b.name AS business_name
          FROM app_users u LEFT JOIN businesses b ON b.id=u.business_id
          ORDER BY CASE WHEN u.is_platform_admin THEN 0 ELSE 1 END,u.created_at ASC`;
        return send(res, 200, { users: rows.map(publicUser) });
      }
      if (req.method === 'POST') {
        const input = body(req);
        const name = String(input.name || '').trim().slice(0, 70);
        const email = String(input.email || '').trim().toLowerCase();
        const password = input.password;
        const role = input.role === 'supervisor' ? 'supervisor' : 'employee';
        const businessId = String(input.businessId || '').trim();
        if (!name || !validEmail(email) || !validPassword(password) || !businessId) {
          return send(res, 400, { error: 'Completá nombre, correo, contraseña (mínimo 12 caracteres) y negocio.' });
        }
        const business = await sql`SELECT id FROM businesses WHERE id=${businessId} AND active=TRUE LIMIT 1`;
        if (!business[0]) return send(res, 400, { error: 'Seleccioná un negocio activo.' });
        const id = crypto.randomUUID();
        const hash = await hashPassword(password);
        const rows = await sql`INSERT INTO app_users(id,name,email,password_hash,role,active,business_id,is_platform_admin)
          VALUES(${id},${name},${email},${hash},${role},TRUE,${businessId},FALSE)
          RETURNING id,name,email,role,active,created_at,business_id,is_platform_admin`;
        return send(res, 201, { user: publicUser(rows[0]) });
      }
      if (req.method === 'PATCH') {
        const input = body(req);
        const id = String(input.id || '');
        if (!id) return send(res, 400, { error: 'Datos de usuario incompletos.' });
        if (Object.prototype.hasOwnProperty.call(input, 'password')) {
          if (!validPassword(input.password)) return send(res, 400, { error: 'La nueva contraseña debe tener entre 12 y 200 caracteres.' });
          const passwordHash = await hashPassword(input.password);
          const rows = await sql`UPDATE app_users SET password_hash=${passwordHash},session_version=session_version+1
            WHERE id=${id} AND is_platform_admin=FALSE RETURNING id,name,email,role,active,created_at,business_id,is_platform_admin`;
          if (!rows[0]) return send(res, 404, { error: 'No se encontró ese usuario o no se puede modificar.' });
          return send(res, 200, { user: publicUser(rows[0]), passwordReset: true });
        }
        if (typeof input.active !== 'boolean') return send(res, 400, { error: 'Indicá si el usuario debe estar activo o inactivo.' });
        const rows = await sql`UPDATE app_users SET active=${input.active},
          session_version=CASE WHEN ${input.active}=FALSE THEN session_version+1 ELSE session_version END
          WHERE id=${id} AND is_platform_admin=FALSE RETURNING id,name,email,role,active,created_at,business_id,is_platform_admin`;
        if (!rows[0]) return send(res, 404, { error: 'No se encontró ese usuario o no se puede modificar.' });
        return send(res, 200, { user: publicUser(rows[0]) });
      }
      if (req.method === 'DELETE') {
        const id = String(body(req).id || '');
        if (!id) return send(res, 400, { error: 'Indicá el usuario que querés eliminar.' });
        const rows = await sql`DELETE FROM app_users WHERE id=${id} AND is_platform_admin=FALSE RETURNING id`;
        if (!rows.length) return send(res, 404, { error: 'No se encontró ese usuario o no se puede eliminar.' });
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: 'Método no permitido.' });
    }

    if (path === '/api/admin/reset-data') {
      const admin = await authenticated(req, res, true);
      if (!admin) return;
      if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido.' });
      const input = body(req);
      if (input.confirm !== true) return send(res, 400, { error: 'Confirmá la limpieza de datos.' });
      const business = await selectedBusiness(req, admin);
      if (!business) return send(res, 400, { error: 'Seleccioná primero un negocio activo.' });
      const sql = db();
      const rows = await sql`SELECT data FROM app_state WHERE business_id=${business.id} LIMIT 1`;
      const current = rows[0]?.data && typeof rows[0].data === 'object' && !Array.isArray(rows[0].data) ? rows[0].data : {};
      const data = { ...current, movements: [], invoices: [], employees: [], employeePayments: [] };
      delete data.users;
      const serialized = JSON.stringify(data);
      const saved = await sql`INSERT INTO app_state(data,updated_by,updated_at,business_id)
        VALUES(${serialized}::jsonb,${admin.id},NOW(),${business.id})
        ON CONFLICT(business_id) DO UPDATE SET data=EXCLUDED.data,updated_by=EXCLUDED.updated_by,updated_at=NOW()
        RETURNING updated_at`;
      return send(res, 200, { ok: true, data, businessId: business.id, updatedAt: saved[0]?.updated_at || null });
    }

    if (path === '/api/data') {
      const user = await authenticated(req, res, false);
      if (!user) return;
      const business = await selectedBusiness(req, user);
      if (!business) return send(res, 400, { error: user.is_platform_admin ? 'Seleccioná primero un negocio activo.' : 'El negocio de tu cuenta no está disponible.' });
      const sql = db();
      if (req.method === 'GET') {
        const rows = await sql`SELECT data,updated_at FROM app_state WHERE business_id=${business.id} LIMIT 1`;
        return send(res, 200, { data: rows[0] ? rows[0].data : null, businessId: business.id, businessName: business.name, updatedAt: rows[0] ? rows[0].updated_at : null });
      }
      if (req.method === 'PUT') {
        const input = body(req);
        if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data)) return send(res, 400, { error: 'No se recibieron datos válidos.' });
        const data = { ...input.data };
        delete data.users;
        const serialized = JSON.stringify(data);
        if (Buffer.byteLength(serialized, 'utf8') > 900000) return send(res, 413, { error: 'El volumen de datos supera el límite permitido.' });
        const saved = await sql`INSERT INTO app_state(data,updated_by,updated_at,business_id)
          VALUES(${serialized}::jsonb,${user.id},NOW(),${business.id})
          ON CONFLICT(business_id) DO UPDATE SET data=EXCLUDED.data,updated_by=EXCLUDED.updated_by,updated_at=NOW()
          RETURNING updated_at`;
        return send(res, 200, { ok: true, businessId: business.id, updatedAt: saved[0]?.updated_at || null });
      }
      return send(res, 405, { error: 'Método no permitido.' });
    }

    return send(res, 404, { error: 'Ruta no encontrada.' });
  } catch (err) {
    if (err && err.code === '23505') return send(res, 409, { error: 'Ya existe un usuario o negocio con ese correo o identificador.' });
    if (err && err.code === '23503') return send(res, 400, { error: 'El negocio indicado no existe o no puede utilizarse.' });
    return send(res, 500, { error: 'No se pudo completar la solicitud. Verificá la conexión de la base de datos.' });
  }
};
