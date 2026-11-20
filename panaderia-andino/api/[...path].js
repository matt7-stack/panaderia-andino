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
  // Las tablas de autenticación se crean mediante migraciones versionadas.
  // No ejecutar DDL en cada request serverless: evita latencia y bloqueos innecesarios.
  return db();
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
  const licenseSystem = String(process.env.LICENSE_SYSTEM_NAME || 'Mattsystem').trim() || 'Mattsystem';
  const rows = await db()`SELECT u.id, u.name, u.email, u.role, u.active, u.business_id, u.is_platform_admin, u.session_version,
      lic.license_code, lic.system_name AS license_system_name, lic.status AS license_status,
      lic.expires_at AS license_expires_at, lic.is_valid AS license_is_valid
    FROM app_users u LEFT JOIN businesses b ON b.id=u.business_id
    LEFT JOIN LATERAL (
      SELECT l.license_code, l.system_name, l.status, l.expires_at,
        (l.status='active' AND (l.expires_at IS NULL OR l.expires_at >= CURRENT_DATE)) AS is_valid
      FROM app_licenses l
      WHERE l.business_id=u.business_id AND LOWER(BTRIM(l.system_name))=LOWER(BTRIM(${licenseSystem}))
      ORDER BY (l.status='active' AND (l.expires_at IS NULL OR l.expires_at >= CURRENT_DATE)) DESC, l.created_at DESC
      LIMIT 1
    ) lic ON TRUE
    WHERE u.id = ${data.sub} AND (u.is_platform_admin=TRUE OR b.active=TRUE) LIMIT 1`;
  const user = rows[0];
  return user && user.active && Number(user.session_version || 0) === Number(data.sv || 0) ? user : null;
}
async function authenticated(req, res, adminOnly = false) {
  if (!sameOrigin(req)) { send(res, 403, { error: 'Solicitud no permitida.' }); return null; }
  await ensureSchema();
  const user = await currentUser(req);
  if (!user) { send(res, 401, { error: 'Iniciá sesión para continuar.' }); return null; }
  try { await db()`UPDATE app_users SET last_seen_at=NOW() WHERE id=${user.id}`; } catch (_) {}
  if (user.is_platform_admin !== true && user.license_is_valid !== true) {
    const status = !user.license_status ? 'missing' : (user.license_status === 'active' ? 'expired' : user.license_status);
    const messages = {
      missing: 'Este negocio todavía no tiene una licencia para Mattsystem. Contactá al administrador para activar el servicio.',
      pending: 'La licencia de este negocio está pendiente de activación.',
      suspended: 'La licencia de este negocio está suspendida. Contactá al administrador.',
      cancelled: 'La licencia de este negocio fue cancelada. Contactá al administrador.',
      expired: 'La licencia de este negocio venció. Renovala para recuperar el acceso.'
    };
    send(res, 403, {
      code: 'LICENSE_INACTIVE',
      error: messages[status] || 'La licencia de este negocio no está habilitada.',
      license: { status, code: user.license_code || null, systemName: user.license_system_name || 'Mattsystem', expiresAt: user.license_expires_at || null }
    });
    return null;
  }
  if (adminOnly && user.is_platform_admin !== true) { send(res, 403, { error: 'Solo el administrador puede acceder a estos datos.' }); return null; }
  return user;
}
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 200;
const publicUser = u => ({
  id:u.id, name:u.name, email:u.email, role:u.role, active:u.active,
  businessId:u.business_id || null, businessName:u.business_name || null,
  isPlatformAdmin:u.is_platform_admin === true,
  license:u.is_platform_admin === true ? null : {
    code:u.license_code || null,
    systemName:u.license_system_name || 'Mattsystem',
    status:!u.license_status ? 'missing' : (u.license_status === 'active' && u.license_is_valid !== true ? 'expired' : u.license_status),
    valid:u.license_is_valid === true,
    expiresAt:u.license_expires_at || null
  },
  createdAt:u.created_at || u.createdAt
});

module.exports = async function handler(req, res) {
  const path = new URL(req.url, `https://${req.headers.host || 'localhost'}`).pathname;
  try {
    if(path==='/api/support/tickets'){
      const user=await authenticated(req,res,false);if(!user)return;
      const sql=db();
      if(req.method==='GET'){
        const rows=user.is_platform_admin===true
          ? await sql`SELECT t.*,b.name AS business_name,u.name AS creator_name,(SELECT COALESCE(json_agg(json_build_object('id',r.id,'message',r.message,'is_admin',r.is_admin,'created_at',r.created_at,'author_name',au.name) ORDER BY r.created_at),'[]'::json) FROM app_support_replies r JOIN app_users au ON au.id=r.author_user_id WHERE r.ticket_id=t.id) AS replies FROM app_support_tickets t JOIN businesses b ON b.id=t.business_id JOIN app_users u ON u.id=t.created_by ORDER BY t.updated_at DESC LIMIT 200`
          : await sql`SELECT t.*,b.name AS business_name,u.name AS creator_name,(SELECT COALESCE(json_agg(json_build_object('id',r.id,'message',r.message,'is_admin',r.is_admin,'created_at',r.created_at,'author_name',au.name) ORDER BY r.created_at),'[]'::json) FROM app_support_replies r JOIN app_users au ON au.id=r.author_user_id WHERE r.ticket_id=t.id) AS replies FROM app_support_tickets t JOIN businesses b ON b.id=t.business_id JOIN app_users u ON u.id=t.created_by WHERE t.business_id=${user.business_id} ORDER BY t.updated_at DESC LIMIT 100`;
        return send(res,200,{tickets:rows});
      }
      if(req.method==='POST'){
        if(user.is_platform_admin===true||!user.business_id)return send(res,403,{error:'Solo las cuentas de negocio pueden crear solicitudes.'});
        const input=body(req),subject=String(input.subject||'').trim().slice(0,120),message=String(input.message||'').trim().slice(0,3000);
        if(!subject||!message)return send(res,400,{error:'Completá el asunto y el mensaje.'});
        const rows=await sql`INSERT INTO app_support_tickets(business_id,created_by,subject,message) VALUES(${user.business_id},${user.id},${subject},${message}) RETURNING *`;
        return send(res,201,{ticket:rows[0]});
      }
      if(req.method==='PATCH'){
        if(user.is_platform_admin!==true)return send(res,403,{error:'Solo el administrador puede cambiar el estado.'});
        const input=body(req),id=String(input.id||''),status=String(input.status||'');
        if(!['open','in_progress','resolved','closed'].includes(status))return send(res,400,{error:'Estado no válido.'});
        const rows=await sql`UPDATE app_support_tickets SET status=${status},updated_at=NOW() WHERE id=${id} RETURNING *`;
        if(!rows.length)return send(res,404,{error:'Solicitud no encontrada.'});
        return send(res,200,{ticket:rows[0]});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if(path==='/api/support/tickets/reply'){
      const user=await authenticated(req,res,false);if(!user)return;
      if(req.method!=='POST')return send(res,405,{error:'Método no permitido.'});
      const input=body(req),ticketId=String(input.ticketId||''),message=String(input.message||'').trim().slice(0,3000);
      if(!ticketId||!message)return send(res,400,{error:'Falta la solicitud o el mensaje.'});
      const sql=db();
      const tickets=user.is_platform_admin===true
        ? await sql`SELECT id FROM app_support_tickets WHERE id=${ticketId}`
        : await sql`SELECT id FROM app_support_tickets WHERE id=${ticketId} AND business_id=${user.business_id}`;
      if(!tickets.length)return send(res,404,{error:'Solicitud no encontrada.'});
      const rows=await sql`INSERT INTO app_support_replies(ticket_id,author_user_id,message,is_admin) VALUES(${ticketId},${user.id},${message},${user.is_platform_admin===true}) RETURNING *`;
      await sql`UPDATE app_support_tickets SET updated_at=NOW(),status=CASE WHEN ${user.is_platform_admin===true} AND status='open' THEN 'in_progress' ELSE status END WHERE id=${ticketId}`;
      return send(res,201,{reply:rows[0]});
    }
    if(path==='/api/admin/licenses'){
      const admin=await authenticated(req,res,true);if(!admin)return;
      const sql=db();
      if(req.method==='GET'){
        await sql`UPDATE app_licenses SET status='expired',updated_at=NOW() WHERE status='active' AND expires_at<CURRENT_DATE`;
        const rows=await sql`SELECT l.*,b.name AS business_name,b.ruc AS business_ruc,COALESCE((SELECT SUM(p.amount) FROM app_license_payments p WHERE p.license_id=l.id),0)::numeric AS paid_total,COALESCE((SELECT json_agg(json_build_object('id',p.id,'amount',p.amount,'payment_type',p.payment_type,'paid_at',p.paid_at,'reference',p.reference) ORDER BY p.paid_at DESC) FROM app_license_payments p WHERE p.license_id=l.id),'[]'::json) AS payments FROM app_licenses l JOIN businesses b ON b.id=l.business_id ORDER BY l.created_at DESC LIMIT 500`;
        return send(res,200,{licenses:rows,totals:{count:rows.length,active:rows.filter(x=>x.status==='active').length,monthly:rows.filter(x=>x.status==='active').reduce((n,x)=>n+Number(x.monthly_amount||0),0)}});
      }
      if(req.method==='POST'){
        const input=body(req),businessId=String(input.businessId||''),systemName=String(input.systemName||'Mattsystem').trim().slice(0,100),plan=String(input.plan||'basic'),status=String(input.status||'pending');
        const setup=Math.max(0,Number(input.setupAmount)||0),monthly=Math.max(0,Number(input.monthlyAmount)||0),billingDay=Math.min(28,Math.max(1,Number(input.billingDay)||1));
        if(!/^[0-9a-f-]{36}$/i.test(businessId)||!['basic','professional','enterprise'].includes(plan)||!['pending','active','suspended'].includes(status)||!Number.isFinite(setup)||!Number.isFinite(monthly))return send(res,400,{error:'Datos de licencia no válidos.'});
        const business=await sql`SELECT id FROM businesses WHERE id=${businessId} LIMIT 1`;
        if(!business.length)return send(res,404,{error:'El negocio seleccionado no existe.'});
        const code='MTS-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();
        const rows=await sql`INSERT INTO app_licenses(business_id,license_code,system_name,plan,status,expires_at,setup_amount,monthly_amount,billing_day,contract_reference,notes,created_by) VALUES(${businessId},${code},${systemName},${plan},${status},${input.expiresAt||null},${setup},${monthly},${billingDay},${String(input.contractReference||'').slice(0,120)},${String(input.notes||'').slice(0,1000)},${admin.id}) RETURNING *`;
        return send(res,201,{license:rows[0]});
      }
      if(req.method==='PATCH'){
        const input=body(req),id=String(input.id||'');
        if(input.action==='renew'){
          const expiresAt=String(input.expiresAt||''),amount=Number(input.amount??0);
          const parsedDate=new Date(expiresAt+'T00:00:00Z');
          if(!id||!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)||Number.isNaN(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==expiresAt||expiresAt<=new Date().toISOString().slice(0,10)||!Number.isFinite(amount)||amount<0)
            return send(res,400,{error:'Ingresá una fecha futura válida y un importe igual o mayor que cero.'});
          const rows=await sql`
            WITH renewed AS (
              UPDATE app_licenses SET status='active',expires_at=${expiresAt},updated_at=NOW()
              WHERE id=${id} RETURNING *
            ),
            payment AS (
              INSERT INTO app_license_payments(license_id,amount,payment_type,period_start,period_end,reference,notes,created_by)
              SELECT id,${amount},'monthly',CURRENT_DATE,${expiresAt},'Renovación de licencia','Pago registrado al renovar la licencia.',${admin.id}
              FROM renewed WHERE ${amount}>0 RETURNING id
            )
            SELECT renewed.*,(SELECT COUNT(*)::int FROM payment) AS payment_recorded FROM renewed
          `;
          if(!rows.length)return send(res,404,{error:'Licencia no encontrada.'});
          return send(res,200,{license:rows[0],paymentRecorded:Number(rows[0].payment_recorded||0)>0});
        }
        const status=String(input.status||'');
        if(!id||!['pending','active','suspended','cancelled','expired'].includes(status))return send(res,400,{error:'Estado de licencia no válido.'});
        const rows=await sql`UPDATE app_licenses SET status=${status},updated_at=NOW() WHERE id=${id} RETURNING *`;
        if(!rows.length)return send(res,404,{error:'Licencia no encontrada.'});
        return send(res,200,{license:rows[0]});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if(path==='/api/admin/license-payments'){
      const admin=await authenticated(req,res,true);if(!admin)return;
      if(req.method!=='POST')return send(res,405,{error:'Método no permitido.'});
      const input=body(req),licenseId=String(input.licenseId||''),amount=Number(input.amount),type=String(input.paymentType||'monthly');
      if(!licenseId||!Number.isFinite(amount)||amount<=0||!['setup','monthly','extra'].includes(type))return send(res,400,{error:'Datos de pago no válidos.'});
      const sql=db(),exists=await sql`SELECT id FROM app_licenses WHERE id=${licenseId}`;
      if(!exists.length)return send(res,404,{error:'Licencia no encontrada.'});
      const rows=await sql`INSERT INTO app_license_payments(license_id,amount,payment_type,period_start,period_end,reference,notes,created_by) VALUES(${licenseId},${amount},${type},${input.periodStart||null},${input.periodEnd||null},${String(input.reference||'').slice(0,120)},${String(input.notes||'').slice(0,500)},${admin.id}) RETURNING *`;
      return send(res,201,{payment:rows[0]});
    }
    if(path==='/api/admin/overview'){
      const admin=await authenticated(req,res,true);if(!admin)return;
      if(req.method!=='GET')return send(res,405,{error:'Método no permitido.'});
      const sql=db();
      const businesses=await sql`SELECT b.id,b.name,b.active,b.created_at,MAX(u.last_seen_at) AS last_seen_at,COUNT(u.id)::int AS users,COUNT(*) FILTER(WHERE u.active)::int AS active_users FROM businesses b LEFT JOIN app_users u ON u.business_id=b.id GROUP BY b.id ORDER BY b.created_at DESC`;
      const ticketCounts=await sql`SELECT status,COUNT(*)::int AS total FROM app_support_tickets GROUP BY status`;
      return send(res,200,{businesses,ticketCounts,totals:{businesses:businesses.length,active:businesses.filter(x=>x.active).length,inactive:businesses.filter(x=>!x.active).length,needsAttention:businesses.filter(x=>x.active&&(!x.last_seen_at||Date.now()-new Date(x.last_seen_at).getTime()>30*86400000)).length}});
    }
    if(path==='/api/notification-preferences'){
      const user=await authenticated(req,res,false);if(!user)return;
      const sql=db();
      if(req.method==='GET'){
        const rows=await sql`SELECT preferences FROM app_notification_preferences WHERE user_id=${user.id}`;
        return send(res,200,{preferences:rows[0]?.preferences||{system:true,financial:true,support:true}});
      }
      if(req.method==='PUT'){
        const p=body(req).preferences||{};
        const preferences={system:p.system!==false,financial:p.financial!==false,support:p.support!==false};
        const rows=await sql`INSERT INTO app_notification_preferences(user_id,preferences,updated_at) VALUES(${user.id},${JSON.stringify(preferences)}::jsonb,NOW()) ON CONFLICT(user_id) DO UPDATE SET preferences=EXCLUDED.preferences,updated_at=NOW() RETURNING preferences`;
        return send(res,200,{preferences:rows[0].preferences});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if(path==='/api/admin/trash'){
      const admin=await authenticated(req,res,true);if(!admin)return;
      const sql=db();
      if(req.method==='GET'){
        const rows=await sql`SELECT id,entity_type,entity_id,business_id,payload,deleted_at FROM app_trash WHERE restored_at IS NULL ORDER BY deleted_at DESC LIMIT 200`;
        return send(res,200,{items:rows});
      }
      if(req.method==='POST'){
        const input=body(req),id=String(input.id||'');
        if(input.action!=='restore'||!id)return send(res,400,{error:'Acción no válida.'});
        const rows=await sql`SELECT * FROM app_trash WHERE id=${id} AND restored_at IS NULL`;
        if(!rows.length)return send(res,404,{error:'Elemento no disponible.'});
        const item=rows[0],p=item.payload||{};
        if(item.entity_type==='business'){
          const restored=await sql`UPDATE businesses SET active=TRUE,updated_at=NOW() WHERE id=${item.entity_id} RETURNING id`;
          if(!restored.length)return send(res,409,{error:'El negocio ya no existe; no se puede restaurar automáticamente.'});
        }else if(item.entity_type==='user'){
          const restored=await sql`UPDATE app_users SET active=TRUE,session_version=session_version+1 WHERE id=${item.entity_id} AND is_platform_admin=FALSE RETURNING id`;
          if(!restored.length)return send(res,409,{error:'El usuario no existe o no se puede restaurar.'});
        }else if(item.entity_type==='announcement'){
          const title=String(p.title||''),message=String(p.message||''),businessId=p.business_id||item.business_id||null;
          if(!title||!message)return send(res,409,{error:'No se pudo recuperar el contenido del comunicado.'});
          if(businessId)await sql`INSERT INTO app_notifications(business_id,user_id,type,title,message) SELECT ${businessId},u.id,'admin_message',${title},${message} FROM app_users u WHERE u.business_id=${businessId} AND u.active=TRUE`;
          else await sql`INSERT INTO app_notifications(business_id,user_id,type,title,message) SELECT NULL,u.id,'admin_message',${title},${message} FROM app_users u WHERE u.active=TRUE AND u.is_platform_admin=FALSE`;
        }
        await sql`UPDATE app_trash SET restored_at=NOW() WHERE id=${id}`;
        return send(res,200,{ok:true});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/support' && req.method === 'GET') {
      const sql=db();
      const rows=await sql`SELECT whatsapp_phone,enabled,welcome_message,display_name FROM app_platform_settings WHERE setting_key='support' LIMIT 1`;
      const row=rows[0]||{whatsapp_phone:'595987426497',enabled:true,welcome_message:'Hola, necesito ayuda con el sistema.',display_name:'Soporte técnico Mattsystem'};
      const localPhone=String(row.whatsapp_phone||'').startsWith('595')?'0'+String(row.whatsapp_phone).slice(3):String(row.whatsapp_phone||'');
      return send(res,200,{settings:{phone:row.whatsapp_phone,phoneDisplay:localPhone,enabled:row.enabled===true,message:row.welcome_message,displayName:row.display_name}});
    }
    if (path === '/api/admin/support-settings') {
      const admin=await authenticated(req,res,true);if(!admin)return;
      const sql=db();
      if(req.method==='GET'){
        const rows=await sql`SELECT whatsapp_phone,enabled,welcome_message,display_name FROM app_platform_settings WHERE setting_key='support' LIMIT 1`;
        const row=rows[0]||{whatsapp_phone:'595987426497',enabled:true,welcome_message:'Hola, necesito ayuda con el sistema.',display_name:'Soporte técnico Mattsystem'};
        const localPhone=String(row.whatsapp_phone||'').startsWith('595')?'0'+String(row.whatsapp_phone).slice(3):String(row.whatsapp_phone||'');
        return send(res,200,{settings:{phone:row.whatsapp_phone,phoneDisplay:localPhone,enabled:row.enabled===true,message:row.welcome_message,displayName:row.display_name}});
      }
      if(req.method==='PUT'){
        const input=body(req);let phone=String(input.phone||'').replace(/[^0-9]/g,'');
        if(phone.startsWith('0'))phone='595'+phone.slice(1);else if(!phone.startsWith('595'))phone='595'+phone;
        const displayName=String(input.displayName||'').trim().slice(0,80);
        const message=String(input.message||'').trim().slice(0,500);
        const enabled=input.enabled===true;
        if(phone.length<11||phone.length>15||!displayName||!message)return send(res,400,{error:'Ingresá un número válido, el nombre de soporte y un mensaje inicial.'});
        const rows=await sql`INSERT INTO app_platform_settings(setting_key,whatsapp_phone,enabled,welcome_message,display_name,updated_by,updated_at)
          VALUES('support',${phone},${enabled},${message},${displayName},${admin.id},NOW())
          ON CONFLICT(setting_key) DO UPDATE SET whatsapp_phone=EXCLUDED.whatsapp_phone,enabled=EXCLUDED.enabled,welcome_message=EXCLUDED.welcome_message,display_name=EXCLUDED.display_name,updated_by=EXCLUDED.updated_by,updated_at=NOW()
          RETURNING whatsapp_phone,enabled,welcome_message,display_name`;
        const row=rows[0];const phoneDisplay=String(row.whatsapp_phone).startsWith('595')?'0'+String(row.whatsapp_phone).slice(3):row.whatsapp_phone;
        await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(NULL,${admin.id},'platform.support_updated','platform_setting','support',${JSON.stringify({enabled:row.enabled,displayName:row.display_name})}::jsonb)`;
        return send(res,200,{ok:true,settings:{phone:row.whatsapp_phone,phoneDisplay,enabled:row.enabled,message:row.welcome_message,displayName:row.display_name}});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/auth/status' && req.method === 'GET') {
      const sql = await ensureSchema();
      const rows = await sql`SELECT COUNT(*)::int AS count FROM app_users WHERE is_platform_admin=TRUE`;
      return send(res, 200, { adminExists:Number(rows[0].count)>0 });
    }
    if (path === '/api/auth/me' && req.method === 'GET') {
      await ensureSchema(); const user = await currentUser(req);
      return user ? send(res,200,{authenticated:true,user:publicUser(user)}) : send(res,401,{authenticated:false});
    }
    if (path === '/api/auth/logout' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, { error: 'Solicitud no permitida.' });
      // El cierre debe borrar la cookie inmediatamente y no depender de Neon.
      return send(res, 200, { ok: true, authenticated: false }, {
        'Set-Cookie': [clearCookie, 'pa_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT'],
        'Clear-Site-Data': '"cache"',
        'Pragma': 'no-cache'
      });
    }
    if (path === '/api/auth/bootstrap' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res,403,{error:'Solicitud no permitida.'});
      const sql = await ensureSchema();
      const existing = await sql`SELECT id FROM app_users WHERE is_platform_admin=TRUE LIMIT 1`;
      if (existing.length) return send(res,409,{error:'La cuenta administradora ya fue activada. Iniciá sesión.'});
      const input = body(req); const token = String(input.token || '');
      if (token.length < 32) return send(res,403,{error:'El enlace de activación no es válido.'});
      const email = String(input.email || '').trim().toLowerCase(); const name = String(input.name || '').trim().slice(0,70); const password = input.password;
      if (!validEmail(email) || !name || !validPassword(password)) return send(res,400,{error:'Completá nombre, correo válido y una contraseña de al menos 12 caracteres.'});
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const claimed = await sql`UPDATE app_admin_setup_tokens SET used_at=NOW() WHERE token_hash=${tokenHash} AND used_at IS NULL AND expires_at>NOW() RETURNING token_hash`;
      if (!claimed.length) return send(res,403,{error:'El enlace venció o ya fue utilizado. Solicitá uno nuevo.'});
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
      if (attempts[0]?.locked_until && new Date(attempts[0].locked_until).getTime()>Date.now()) {
        try { await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details,ip_address) VALUES(NULL,NULL,'auth.login_blocked','authentication',NULL,${JSON.stringify({email,failures:Number(attempts[0].failures||0)})}::jsonb,${req.headers['x-forwarded-for']?.split(',')[0]?.trim()||null})`; } catch (logError) { console.error('No se pudo registrar el bloqueo de acceso:',logError); }
        return send(res,429,{error:'Demasiados intentos. Probá nuevamente dentro de unos minutos.'});
      }
      const licenseSystem = String(process.env.LICENSE_SYSTEM_NAME || 'Mattsystem').trim() || 'Mattsystem';
      const rows = await sql`SELECT u.id,u.name,u.email,u.password_hash,u.role,u.active,u.business_id,u.is_platform_admin,u.session_version,
          lic.license_code, lic.system_name AS license_system_name, lic.status AS license_status,
          lic.expires_at AS license_expires_at, lic.is_valid AS license_is_valid
        FROM app_users u
        LEFT JOIN LATERAL (
          SELECT l.license_code,l.system_name,l.status,l.expires_at,
            (l.status='active' AND (l.expires_at IS NULL OR l.expires_at >= CURRENT_DATE)) AS is_valid
          FROM app_licenses l
          WHERE l.business_id=u.business_id AND LOWER(BTRIM(l.system_name))=LOWER(BTRIM(${licenseSystem}))
          ORDER BY (l.status='active' AND (l.expires_at IS NULL OR l.expires_at >= CURRENT_DATE)) DESC, l.created_at DESC
          LIMIT 1
        ) lic ON TRUE
        WHERE lower(u.email)=${email} LIMIT 1`; const u = rows[0];
      if (!u || !u.active || !(await verifyPassword(password,u.password_hash))) {
        await sql`INSERT INTO app_login_attempts(email,failures,locked_until,updated_at) VALUES(${email},1,NULL,NOW()) ON CONFLICT(email) DO UPDATE SET failures=CASE WHEN app_login_attempts.updated_at<NOW()-INTERVAL '15 minutes' THEN 1 ELSE app_login_attempts.failures+1 END, locked_until=CASE WHEN (CASE WHEN app_login_attempts.updated_at<NOW()-INTERVAL '15 minutes' THEN 1 ELSE app_login_attempts.failures+1 END)>=6 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END, updated_at=NOW()`;
        try { await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details,ip_address) VALUES(NULL,NULL,'auth.login_failed','authentication',NULL,${JSON.stringify({email})}::jsonb,${req.headers['x-forwarded-for']?.split(',')[0]?.trim()||null})`; } catch (logError) { console.error('No se pudo registrar el intento fallido:',logError); }
        return send(res,401,{error:'Correo o contraseña incorrectos.'});
      }
      await sql`DELETE FROM app_login_attempts WHERE email=${email}`;
      try { await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details,ip_address) VALUES(${u.business_id||null},${u.id},'auth.login_success','authentication',${u.id},${JSON.stringify({email:u.email})}::jsonb,${req.headers['x-forwarded-for']?.split(',')[0]?.trim()||null})`; } catch (logError) { console.error('No se pudo registrar el acceso:',logError); }
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
    if (path === '/api/admin/security') {
      const admin=await authenticated(req,res,true); if(!admin) return;
      const sql=db();
      if(req.method==='GET'){
        const [counts,attempts,events,users]=await Promise.all([
          sql`SELECT COUNT(*)::int AS total_users,COUNT(*) FILTER(WHERE active=TRUE)::int AS active_users,COUNT(*) FILTER(WHERE active=FALSE)::int AS inactive_users FROM app_users WHERE is_platform_admin=FALSE`,
          sql`SELECT email,failures,locked_until,updated_at FROM app_login_attempts WHERE failures>0 ORDER BY updated_at DESC LIMIT 100`,
          sql`SELECT l.id,l.action,l.details,l.ip_address,l.created_at,u.name AS user_name,u.email AS user_email,b.name AS business_name FROM app_audit_logs l LEFT JOIN app_users u ON u.id=l.actor_user_id LEFT JOIN businesses b ON b.id=l.business_id WHERE l.action IN ('auth.login_success','auth.login_failed','auth.login_blocked') ORDER BY l.created_at DESC LIMIT 100`,
          sql`SELECT u.id,u.name,u.email,u.role,u.active,b.name AS business_name FROM app_users u LEFT JOIN businesses b ON b.id=u.business_id WHERE u.is_platform_admin=FALSE ORDER BY u.active DESC,u.name`
        ]);
        const totals=await sql`SELECT COUNT(*) FILTER(WHERE action='auth.login_success' AND created_at>NOW()-INTERVAL '24 hours')::int AS successful_24h,COUNT(*) FILTER(WHERE action IN ('auth.login_failed','auth.login_blocked') AND created_at>NOW()-INTERVAL '24 hours')::int AS failed_24h FROM app_audit_logs WHERE action IN ('auth.login_success','auth.login_failed','auth.login_blocked')`;
        return send(res,200,{summary:{...(counts[0]||{}),...(totals[0]||{}),locked_accounts:attempts.filter(x=>x.locked_until&&new Date(x.locked_until).getTime()>Date.now()).length},attempts,events,users});
      }
      if(req.method==='POST'){
        const input=body(req),userId=String(input.userId||'');
        if(!userId||userId===admin.id)return send(res,400,{error:'Seleccioná otro usuario. No podés revocar tu propia sesión desde este apartado.'});
        const rows=await sql`UPDATE app_users SET session_version=session_version+1 WHERE id=${userId} AND is_platform_admin=FALSE RETURNING id,name,email,business_id`;
        if(!rows.length)return send(res,404,{error:'No se encontró el usuario o no se puede revocar su sesión.'});
        const target=rows[0];
        await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(${target.business_id||null},${admin.id},'auth.sessions_revoked','user',${target.id},${JSON.stringify({name:target.name,email:target.email})}::jsonb)`;
        return send(res,200,{ok:true,message:'Se revocaron las sesiones activas del usuario.',user:{id:target.id,name:target.name,email:target.email}});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/admin/businesses') {
      const admin=await authenticated(req,res,true); if(!admin) return;
      const sql=db();
      if(req.method==='GET'){
        const rows=await sql`SELECT b.id,b.name,b.slug,b.active,b.address,b.phone,b.email,b.ruc,b.owner_name,b.created_at,b.updated_at,
          (SELECT COUNT(*)::int FROM app_users u WHERE u.business_id=b.id) AS user_count,
          (SELECT COUNT(*)::int FROM app_users u WHERE u.business_id=b.id AND u.active=TRUE) AS active_user_count,
          (SELECT COUNT(DISTINCT lower(trim(item->>'party')))::int FROM app_state st CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(st.data->'invoices')='array' THEN st.data->'invoices' ELSE '[]'::jsonb END) item WHERE st.business_id=b.id AND COALESCE(trim(item->>'party'),'')<>'') AS customer_count,
          (SELECT COUNT(*)::int FROM app_products p WHERE p.business_id=b.id) AS product_count,
          (SELECT COUNT(*)::int FROM app_state st CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(st.data->'invoices')='array' THEN st.data->'invoices' ELSE '[]'::jsonb END) item WHERE st.business_id=b.id  ) AS sales_count,
          (SELECT COUNT(*)::int FROM app_purchases p WHERE p.business_id=b.id) AS purchase_count,
          (SELECT COALESCE(SUM((item->>'amount')::numeric),0)::numeric(14,2) FROM app_state st CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(st.data->'movements')='array' THEN st.data->'movements' ELSE '[]'::jsonb END) item WHERE st.business_id=b.id AND item->>'type'='income') AS recorded_income,
          (SELECT COALESCE(SUM((item->>'amount')::numeric),0)::numeric(14,2) FROM app_state st CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(st.data->'movements')='array' THEN st.data->'movements' ELSE '[]'::jsonb END) item WHERE st.business_id=b.id AND item->>'type'='expense') AS recorded_expenses,
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
        const rows=await sql`WITH created AS (
          INSERT INTO businesses(id,name,slug,active,address,phone,email,ruc,owner_name)
          VALUES(${id},${name},${slug},TRUE,${String(input.address||'').slice(0,250)},${String(input.phone||'').slice(0,60)},${String(input.email||'').slice(0,254)},${String(input.ruc||'').slice(0,40)},${String(input.ownerName||'').slice(0,120)})
          RETURNING *
        ), state_created AS (
          INSERT INTO app_state(data,business_id) SELECT '{}'::jsonb,id FROM created ON CONFLICT(business_id) DO NOTHING RETURNING business_id
        ), audit_created AS (
          INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details)
          SELECT id,${admin.id},'business.created','business',id,${JSON.stringify({name,slug})}::jsonb FROM created RETURNING id
        )
        SELECT * FROM created`;
        return send(res,201,{business:rows[0]});
      }
      if(req.method==='PATCH'){
        const input=body(req); const id=String(input.id||''); if(!id) return send(res,400,{error:'Falta el identificador de la panadería.'});
        if(typeof input.active==='boolean'){
          const rows=await sql`WITH changed AS (
            UPDATE businesses SET active=${input.active},updated_at=NOW() WHERE id=${id} RETURNING *
          ), revoked AS (
            UPDATE app_users SET session_version=session_version+1 WHERE business_id=${id} AND is_platform_admin=FALSE RETURNING id
          ), audit AS (
            INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details)
            SELECT id,${admin.id},CASE WHEN ${input.active} THEN 'business.reactivated' ELSE 'business.deactivated' END,
              'business',id,${JSON.stringify({active:input.active})}::jsonb FROM changed RETURNING id
          )
          SELECT * FROM changed`;
          if(!rows[0]) return send(res,404,{error:'No se encontró la panadería.'});
          return send(res,200,{business:rows[0],message:input.active?'Panadería reactivada.':'Panadería desactivada. El acceso de sus usuarios quedó bloqueado.'});
        }
        const rows=await sql`WITH changed AS (
          UPDATE businesses SET name=COALESCE(${input.name===undefined?null:String(input.name).trim().slice(0,120)},name),
            address=COALESCE(${input.address===undefined?null:String(input.address).slice(0,250)},address),
            phone=COALESCE(${input.phone===undefined?null:String(input.phone).slice(0,60)},phone),
            email=COALESCE(${input.email===undefined?null:String(input.email).slice(0,254)},email),
            ruc=COALESCE(${input.ruc===undefined?null:String(input.ruc).slice(0,40)},ruc),
            owner_name=COALESCE(${input.ownerName===undefined?null:String(input.ownerName).slice(0,120)},owner_name),
            updated_at=NOW() WHERE id=${id} RETURNING *
        ), audit AS (
          INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details)
          SELECT id,${admin.id},'business.updated','business',id,'{}'::jsonb FROM changed RETURNING id
        )
        SELECT * FROM changed`;
        if(!rows[0]) return send(res,404,{error:'No se encontró la panadería.'});
        return send(res,200,{business:rows[0]});
      }
      if(req.method==='DELETE'){
        const id=String(body(req).id||'');
        if(!id) return send(res,400,{error:'Falta el identificador de la panadería.'});
        const business=await sql`SELECT id,name,active FROM businesses WHERE id=${id} LIMIT 1`;
        if(!business[0]) return send(res,404,{error:'No se encontró la panadería.'});
        if(business[0].active) return send(res,409,{error:'Primero desactivá la panadería. Después podrás solicitar su eliminación definitiva.'});
        const snapshot=await sql`SELECT * FROM businesses WHERE id=${id} LIMIT 1`;
        await sql`INSERT INTO app_trash(entity_type,entity_id,business_id,payload,deleted_by) VALUES('business',${id},${id},${JSON.stringify(snapshot[0])}::jsonb,${admin.id})`;
        await sql`UPDATE businesses SET active=FALSE,updated_at=NOW() WHERE id=${id}`;
        return send(res,200,{ok:true,deleted:false,trashed:true,message:'Negocio enviado a la papelera. Sus datos y usuarios se conservaron y puede restaurarse.'});
        const result=await sql`WITH target AS (
          SELECT id FROM businesses WHERE id=${id} AND active=FALSE
        ), usage AS (
          SELECT
            (SELECT COUNT(*) FROM app_customers WHERE business_id=${id}) +
            (SELECT COUNT(*) FROM app_suppliers WHERE business_id=${id}) +
            (SELECT COUNT(*) FROM app_products WHERE business_id=${id}) +
            (SELECT COUNT(*) FROM app_inventory_movements WHERE business_id=${id}) +
            (SELECT COUNT(*) FROM app_purchases WHERE business_id=${id}) +
            (SELECT COUNT(*) FROM app_sales WHERE business_id=${id}) +
            (SELECT COUNT(*) FROM app_cash_sessions WHERE business_id=${id}) +
            (SELECT COUNT(*) FROM app_recipes WHERE business_id=${id}) +
            (SELECT COUNT(*) FROM app_production_batches WHERE business_id=${id}) +
            (SELECT COUNT(*) FROM app_financial_entries WHERE business_id=${id}) +
            (SELECT COUNT(*) FROM app_sale_items WHERE business_id=${id}) +
            (SELECT COUNT(*) FROM app_purchase_items WHERE business_id=${id}) +
            (SELECT COUNT(*) FROM app_recipe_ingredients WHERE business_id=${id}) +
            (SELECT COUNT(*) FROM app_cash_movements WHERE business_id=${id}) AS records
        ), eligible AS (
          SELECT target.id FROM target CROSS JOIN usage WHERE usage.records=0
        ), deleted_audit AS (
          DELETE FROM app_audit_logs WHERE business_id IN (SELECT id FROM eligible) RETURNING id
        ), deleted_backups AS (
          DELETE FROM app_backup_log WHERE business_id IN (SELECT id FROM eligible) RETURNING id
        ), deleted_users AS (
          DELETE FROM app_users WHERE business_id IN (SELECT id FROM eligible) AND is_platform_admin=FALSE
            AND (SELECT COUNT(*) FROM deleted_audit)>=0 RETURNING id
        ), deleted_business AS (
          DELETE FROM businesses WHERE id IN (SELECT id FROM eligible)
            AND (SELECT COUNT(*) FROM deleted_users)>=0
            AND (SELECT COUNT(*) FROM deleted_backups)>=0 RETURNING id
        )
        SELECT EXISTS(SELECT 1 FROM deleted_business) AS deleted,
          (SELECT records FROM usage) AS records`;
        if(!result[0]?.deleted) return send(res,409,{error:'No se puede eliminar definitivamente: la panadería tiene registros operativos o ya no está disponible. Se conservaron sus datos. Podés mantenerla desactivada.',records:Number(result[0]?.records||0)});
        return send(res,200,{ok:true,deleted:true,message:'Panadería eliminada definitivamente. Solo se permite esta acción cuando no existen registros operativos.'});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/admin/clients') {
      const admin=await authenticated(req,res,true); if(!admin) return;
      if(req.method!=='GET')return send(res,405,{error:'Método no permitido.'});
      const sql=db();
      const rows=await sql`SELECT b.id AS business_id,b.name AS business_name,MIN(item->>'party') AS customer_name,COUNT(*)::int AS note_count,COALESCE(SUM(NULLIF(item->>'amount','')::numeric),0)::numeric(14,2) AS note_total,MAX(NULLIF(item->>'date','')::date) AS last_note_date FROM app_state st JOIN businesses b ON b.id=st.business_id CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(st.data->'invoices')='array' THEN st.data->'invoices' ELSE '[]'::jsonb END) item WHERE COALESCE(trim(item->>'party'),'')<>'' GROUP BY b.id,b.name,lower(trim(item->>'party')) ORDER BY b.name,customer_name LIMIT 1000`;
      return send(res,200,{clients:rows});
    }
    if (path === '/api/admin/activity') {
      const admin=await authenticated(req,res,true); if(!admin) return;
      const sql=db();
      if(req.method==='GET'){
        const rows=await sql`SELECT l.id,l.action,l.entity_type,l.entity_id,l.details,l.created_at,u.name AS actor_name,u.email AS actor_email,b.name AS business_name FROM app_audit_logs l LEFT JOIN app_users u ON u.id=l.actor_user_id LEFT JOIN businesses b ON b.id=l.business_id ORDER BY l.created_at DESC LIMIT 250`;
        const notifications=await sql`SELECT n.id,n.title,n.message,n.type,n.read_at,n.created_at FROM app_notifications n WHERE n.user_id=${admin.id} AND n.type='system_activity' ORDER BY n.created_at DESC LIMIT 100`;
        return send(res,200,{activities:rows,notifications});
      }
      if(req.method==='DELETE'){
        const target=String(body(req).target||'');
        if(target==='history'){
          const removed=await sql`DELETE FROM app_audit_logs RETURNING id`;
          return send(res,200,{ok:true,deleted:removed.length,target});
        }
        if(target==='alerts'){
          const removed=await sql`DELETE FROM app_notifications WHERE user_id=${admin.id} AND type='system_activity' RETURNING id`;
          return send(res,200,{ok:true,deleted:removed.length,target});
        }
        return send(res,400,{error:'Seleccioná si querés eliminar el historial o las alertas.'});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/admin/notifications') {
      const admin=await authenticated(req,res,true); if(!admin) return;
      const sql=db();
      if(req.method==='GET'){
        const rows=await sql`SELECT (ARRAY_AGG(n.id::text ORDER BY n.id))[1] AS id,n.title,n.message,n.business_id,b.name AS business_name,MIN(n.created_at) AS created_at,COUNT(*)::int AS recipients,COUNT(n.read_at)::int AS read_count FROM app_notifications n LEFT JOIN businesses b ON b.id=n.business_id WHERE n.type='admin_message' GROUP BY n.title,n.message,n.business_id,b.name,n.created_at ORDER BY n.created_at DESC LIMIT 100`;
        return send(res,200,{notifications:rows});
      }
      if(req.method==='POST'){
        const input=body(req); const title=String(input.title||'').trim().slice(0,100); const message=String(input.message||'').trim().slice(0,2000);
        const businessId=input.businessId==='all'?'':String(input.businessId||'');
        if(!title||!message) return send(res,400,{error:'Completá el título y el mensaje.'});
        let rows;
        if(businessId){
          const target=await sql`SELECT id,name FROM businesses WHERE id=${businessId} AND active=TRUE LIMIT 1`;
          if(!target.length) return send(res,404,{error:'La panadería seleccionada no existe o está inactiva.'});
          rows=await sql`INSERT INTO app_notifications(business_id,user_id,type,title,message) SELECT ${businessId},u.id,'admin_message',${title},${message} FROM app_users u WHERE u.business_id=${businessId} AND u.active=TRUE AND u.is_platform_admin=FALSE RETURNING id`;
          if(!rows.length) return send(res,409,{error:'La panadería seleccionada no tiene usuarios activos que puedan recibir el aviso.'});
          await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(${businessId},${admin.id},'notification.sent','notification',${rows[0].id},${JSON.stringify({title,recipients:rows.length,target:target[0].name})}::jsonb)`;
        } else {
          rows=await sql`INSERT INTO app_notifications(business_id,user_id,type,title,message) SELECT NULL,u.id,'admin_message',${title},${message} FROM app_users u WHERE u.active=TRUE AND u.is_platform_admin=FALSE RETURNING id`;
          if(!rows.length) return send(res,409,{error:'No hay usuarios activos en ninguna panadería para recibir el aviso.'});
          await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(NULL,${admin.id},'notification.sent','notification',${rows[0].id},${JSON.stringify({title,recipients:rows.length,target:'all'})}::jsonb)`;
        }
        return send(res,201,{ok:true,recipients:rows.length});
      }
      if(req.method==='PATCH'||req.method==='DELETE'){
        const input=body(req),id=String(input.id||''); if(!id)return send(res,400,{error:'Falta la notificación.'});
        const found=await sql`SELECT id,business_id,title,message,created_at FROM app_notifications WHERE id=${id} AND type='admin_message' LIMIT 1`;
        if(!found.length)return send(res,404,{error:'No se encontró el comunicado.'});
        const item=found[0];
        if(req.method==='PATCH'){
          const title=String(input.title||'').trim().slice(0,100),message=String(input.message||'').trim().slice(0,2000);
          if(!title||!message)return send(res,400,{error:'El título y el mensaje son obligatorios.'});
          const changed=await sql`UPDATE app_notifications SET title=${title},message=${message} WHERE type='admin_message' AND business_id IS NOT DISTINCT FROM ${item.business_id} AND created_at=${item.created_at} AND title=${item.title} AND message=${item.message} RETURNING id`;
          await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(${item.business_id},${admin.id},'notification.updated','notification',${id},${JSON.stringify({title,recipients:changed.length})}::jsonb)`;
          return send(res,200,{ok:true,updated:changed.length});
        }
        await sql`INSERT INTO app_trash(entity_type,entity_id,business_id,payload,deleted_by) SELECT 'announcement',${id},business_id,jsonb_build_object('title',title,'message',message,'created_at',created_at),${admin.id} FROM app_notifications WHERE id=${id} AND type='admin_message'`;
        const removed=await sql`DELETE FROM app_notifications AS target USING app_notifications AS seed WHERE seed.id::text=${id} AND target.type='admin_message' AND target.business_id IS NOT DISTINCT FROM seed.business_id AND target.created_at=seed.created_at AND target.title=seed.title AND target.message=seed.message RETURNING target.id`;
        if(!removed.length)return send(res,404,{error:'El comunicado ya no existe o fue eliminado.'});
        await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(${item.business_id},${admin.id},'notification.deleted','notification',${id},${JSON.stringify({recipients:removed.length})}::jsonb)`;
        return send(res,200,{ok:true,deleted:removed.length});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/notifications') {
      const user=await authenticated(req,res,false); if(!user) return;
      const sql=db();
      if(req.method==='GET'){
        const rows=await sql`SELECT n.id,n.type,n.title,n.message,n.read_at,n.created_at,b.name AS business_name FROM app_notifications n LEFT JOIN businesses b ON b.id=n.business_id WHERE n.user_id=${user.id} AND CASE WHEN n.type='system_activity' OR n.type='admin_message' THEN COALESCE((SELECT (p.preferences->>'system')::boolean FROM app_notification_preferences p WHERE p.user_id=${user.id}),TRUE) WHEN n.type='financial' THEN COALESCE((SELECT (p.preferences->>'financial')::boolean FROM app_notification_preferences p WHERE p.user_id=${user.id}),TRUE) ELSE COALESCE((SELECT (p.preferences->>'support')::boolean FROM app_notification_preferences p WHERE p.user_id=${user.id}),TRUE) END ORDER BY n.created_at DESC LIMIT 100`;
        return send(res,200,{notifications:rows});
      }
      if(req.method==='PATCH'){
        const id=String(body(req).id||''); if(!id) return send(res,400,{error:'Falta la notificación.'});
        const rows=await sql`UPDATE app_notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=${id} AND user_id=${user.id} RETURNING id,read_at`;
        if(!rows.length) return send(res,404,{error:'No se encontró la notificación.'});
        return send(res,200,{ok:true,notification:rows[0]});
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
        if(!businessId) return send(res,400,{error:'Seleccioná la panadería a la que pertenecerá el usuario.'});
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
        const id=String(body(req).id||''); if(!id||id===admin.id)return send(res,400,{error:'No se puede eliminar la cuenta administradora.'});
        const target=await sql`SELECT u.*,to_jsonb(u)-'password_hash' AS safe_payload FROM app_users u WHERE u.id=${id} AND u.is_platform_admin=FALSE LIMIT 1`;
        if(!target.length)return send(res,404,{error:'No se encontró ese usuario.'});
        await sql`INSERT INTO app_trash(entity_type,entity_id,business_id,payload,deleted_by) VALUES('user',${id},${target[0].business_id},${JSON.stringify(target[0].safe_payload)}::jsonb,${admin.id})`;
        await sql`UPDATE app_users SET active=FALSE,session_version=session_version+1 WHERE id=${id} AND is_platform_admin=FALSE`;
        return send(res,200,{ok:true,trashed:true,message:'Usuario desactivado y enviado a la papelera. Puede restaurarse.'});
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

    if (path === '/api/data' && req.method === 'GET' && new URL(req.url, `https://${req.headers.host || 'localhost'}`).searchParams.has('catalogBusinessId')) {
      const businessId=String(new URL(req.url, `https://${req.headers.host || 'localhost'}`).searchParams.get('catalogBusinessId')||'').trim();
      if(!businessId) return send(res,400,{error:'Falta identificar la panadería.'});
      const sql=db();
      const rows=await sql`SELECT b.id,b.name,b.address,b.phone,st.data,st.updated_at FROM businesses b LEFT JOIN app_state st ON st.business_id=b.id WHERE b.id=${businessId} AND b.active=TRUE LIMIT 1`;
      if(!rows.length) return send(res,404,{error:'No se encontró una panadería activa.'});
      const data=rows[0].data&&typeof rows[0].data==='object'?rows[0].data:{};
      const products=(Array.isArray(data.products)?data.products:[]).filter(p=>p&&p.active!==false).map(p=>({
        id:String(p.id||''),name:String(p.name||'').slice(0,100),category:String(p.category||'').slice(0,60),
        description:String(p.description||'').slice(0,300),price:Math.max(0,Number(p.price)||0),
        available:typeof p.available==='boolean'?p.available:Number(p.stock||0)>0
      })).filter(p=>p.name);
      return send(res,200,{business:{id:rows[0].id,name:rows[0].name,address:rows[0].address||'',phone:rows[0].phone||''},products,updatedAt:rows[0].updated_at||null},{'Cache-Control':'no-store, max-age=0'});
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
        if(user.is_platform_admin!==true){
          const biz=await sql`SELECT name FROM businesses WHERE id=${businessId} LIMIT 1`;
          const title='Actividad en '+(biz[0]?.name||'una panadería');
          const message=user.name+' ('+user.email+') modificó información operativa. Revisá el historial para ver cuándo ocurrió.';
          await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details,ip_address) VALUES(${businessId},${user.id},'business.data_updated','business_data',${businessId},${JSON.stringify({businessName:biz[0]?.name||'',updatedAt:saved[0]?.updated_at||null})}::jsonb,${req.headers['x-forwarded-for']?.split(',')[0]?.trim()||null})`;
          await sql`INSERT INTO app_notifications(business_id,user_id,type,title,message) SELECT ${businessId},u.id,'system_activity',${title},${message} FROM app_users u WHERE u.is_platform_admin=TRUE AND u.active=TRUE AND NOT EXISTS (SELECT 1 FROM app_notifications n WHERE n.user_id=u.id AND n.type='system_activity' AND n.title=${title} AND n.message=${message} AND n.created_at>NOW()-INTERVAL '2 minutes')`;
        }
        return send(res,200,{ok:true,updatedAt:saved[0]?.updated_at||null});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    return send(res,404,{error:'Ruta no encontrada.'});
  } catch (err) {
    if (err && err.code==='23505') {
      const constraint=String(err.constraint||'');
      if (constraint.includes('businesses_slug')) return send(res,409,{error:'Ya existe una panadería con un nombre similar. Cambiá el nombre e intentá nuevamente.'});
      if (constraint.includes('app_users_email')) return send(res,409,{error:'Ya existe un usuario con ese correo.'});
      return send(res,409,{error:'Ya existe un registro con esos datos. Revisá los campos e intentá nuevamente.'});
    }
    console.error('API error:',err);
    return send(res,500,{error:'No se pudo completar la solicitud. Verificá la conexión de la base de datos.'});
  }
};
