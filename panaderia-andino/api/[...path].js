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
  const rows = await db()`SELECT u.id, u.name, u.email, u.role, u.active, u.business_id, u.is_platform_admin, u.session_version, u.permissions,
      lic.license_code, lic.system_name AS license_system_name, lic.status AS license_status,
      lic.expires_at AS license_expires_at, lic.is_valid AS license_is_valid, lic.modules AS license_modules,
      bc.industry_key AS business_industry, bc.config_mode AS business_config_mode, bc.modules AS business_modules
    FROM app_users u LEFT JOIN businesses b ON b.id=u.business_id
    LEFT JOIN app_business_config bc ON bc.business_id=u.business_id
    LEFT JOIN LATERAL (
      SELECT l.license_code, l.system_name, l.status, l.expires_at, l.modules,
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
  permissions:u.permissions && typeof u.permissions==='object' ? u.permissions : {},
  isPlatformAdmin:u.is_platform_admin === true,
  businessConfig:u.is_platform_admin === true || !u.business_industry ? null : {
    industry:u.business_industry,
    mode:u.business_config_mode || 'legacy',
    configuredModules:Array.isArray(u.business_modules)?u.business_modules:[],
    licensedModules:Array.isArray(u.license_modules)?u.license_modules:null,
    modules:Array.isArray(u.business_modules)
      ? (Array.isArray(u.license_modules) ? u.business_modules.filter(key=>u.license_modules.includes(key)) : u.business_modules)
      : null
  },
  license:u.is_platform_admin === true ? null : {
    code:u.license_code || null,
    systemName:u.license_system_name || 'Mattsystem',
    status:!u.license_status ? 'missing' : (u.license_status === 'active' && u.license_is_valid !== true ? 'expired' : u.license_status),
    valid:u.license_is_valid === true,
    expiresAt:u.license_expires_at || null,
    modules:Array.isArray(u.license_modules) ? u.license_modules : null
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
    if(path==='/api/license/info'){
      const user=await authenticated(req,res,false);if(!user)return;
      if(user.is_platform_admin===true||!user.business_id)return send(res,403,{error:'Esta información está disponible desde una cuenta vinculada a un negocio.'});
      const sql=db();
      const licenseSystem=String(process.env.LICENSE_SYSTEM_NAME||'Mattsystem').trim()||'Mattsystem';
      const rows=await sql`SELECT l.license_code,l.system_name,l.plan,
        CASE WHEN l.status='active' AND l.expires_at<CURRENT_DATE THEN 'expired' ELSE l.status END AS effective_status,
        l.sold_at,l.created_at,l.expires_at,l.setup_amount,l.monthly_amount,l.billing_day,
        l.contract_reference,l.is_trial,l.trial_started_at,l.trial_days,l.device_limit,l.user_limit
        FROM app_licenses l
        WHERE l.business_id=${user.business_id} AND LOWER(BTRIM(l.system_name))=LOWER(BTRIM(${licenseSystem}))
        ORDER BY (l.status='active' AND (l.expires_at IS NULL OR l.expires_at>=CURRENT_DATE)) DESC,l.created_at DESC
        LIMIT 1`;
      if(!rows.length)return send(res,404,{error:'No encontramos una licencia asociada a este negocio. Contactá al administrador.'});
      const license=rows[0];
      return send(res,200,{license:{...license,days_remaining:license.expires_at?Math.max(0,Math.ceil((new Date(license.expires_at+'T00:00:00Z')-new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z'))/86400000)):null}});
    }
    if(path==='/api/admin/license-settings'){
      const admin=await authenticated(req,res,true);if(!admin)return;
      const sql=db();
      if(req.method==='GET'){
        const rows=await sql`SELECT trial_enabled,trial_days,device_limit,activation_mode,currency_mode,billing_mode FROM app_license_settings WHERE setting_key='default' LIMIT 1`;
        const row=rows[0]||{trial_enabled:true,trial_days:7,device_limit:3,activation_mode:'manual',currency_mode:'both',billing_mode:'both'};
        return send(res,200,{settings:{trialEnabled:row.trial_enabled===true,trialDays:Number(row.trial_days||7),deviceLimit:row.device_limit===null?null:Number(row.device_limit),activationMode:row.activation_mode,currencyMode:row.currency_mode,billingMode:row.billing_mode}});
      }
      if(req.method==='PUT'){
        const input=body(req),trialEnabled=input.trialEnabled===true,trialDays=Number(input.trialDays),deviceLimit=input.deviceLimit===null?null:Number(input.deviceLimit);
        if(!Number.isInteger(trialDays)||trialDays<1||trialDays>90||!(deviceLimit===null||(Number.isInteger(deviceLimit)&&deviceLimit>=1&&deviceLimit<=100)))return send(res,400,{error:'La duración debe ser de 1 a 90 días y el límite de dispositivos de 1 a 100 (o sin límite).'});
        const rows=await sql`INSERT INTO app_license_settings(setting_key,trial_enabled,trial_days,device_limit,updated_by,updated_at) VALUES('default',${trialEnabled},${trialDays},${deviceLimit},${admin.id},NOW()) ON CONFLICT(setting_key) DO UPDATE SET trial_enabled=EXCLUDED.trial_enabled,trial_days=EXCLUDED.trial_days,device_limit=EXCLUDED.device_limit,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING trial_enabled,trial_days,device_limit,activation_mode,currency_mode,billing_mode`;
        const row=rows[0];return send(res,200,{settings:{trialEnabled:row.trial_enabled===true,trialDays:Number(row.trial_days),deviceLimit:row.device_limit===null?null:Number(row.device_limit),activationMode:row.activation_mode,currencyMode:row.currency_mode,billingMode:row.billing_mode}});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if(path==='/api/admin/licenses'){
      const admin=await authenticated(req,res,true);if(!admin)return;
      const sql=db();
      if(req.method==='GET'){
        const rows=await sql`SELECT l.*,CASE WHEN l.status='active' AND l.expires_at<CURRENT_DATE THEN 'expired' ELSE l.status END AS effective_status,b.name AS business_name,b.ruc AS business_ruc,COALESCE((SELECT SUM(p.amount) FROM app_license_payments p WHERE p.license_id=l.id),0)::numeric AS paid_total,COALESCE((SELECT json_agg(json_build_object('id',p.id,'amount',p.amount,'payment_type',p.payment_type,'paid_at',p.paid_at,'reference',p.reference) ORDER BY p.paid_at DESC) FROM app_license_payments p WHERE p.license_id=l.id),'[]'::json) AS payments FROM app_licenses l JOIN businesses b ON b.id=l.business_id ORDER BY l.created_at DESC LIMIT 500`;
        return send(res,200,{licenses:rows,totals:{count:rows.length,active:rows.filter(x=>x.effective_status==='active').length,monthly:rows.filter(x=>x.effective_status==='active').reduce((n,x)=>n+Number(x.monthly_amount||0),0)}});
      }
      if(req.method==='POST'){
        const input=body(req),businessId=String(input.businessId||''),systemName=String(input.systemName||'Mattsystem').trim().slice(0,100),plan=String(input.plan||'basic'),status=String(input.status||'pending');
        const setup=Number(input.setupAmount??0),monthly=Number(input.monthlyAmount??0),billingDay=Number(input.billingDay??1),expiresAt=input.expiresAt?String(input.expiresAt):null;
        const parsedExpiry=expiresAt?new Date(expiresAt+'T00:00:00Z'):null;
        if(!/^[0-9a-f-]{36}$/i.test(businessId)||!['basic','professional','enterprise'].includes(plan)||!['pending','active','suspended'].includes(status)||!Number.isFinite(setup)||setup<0||!Number.isFinite(monthly)||monthly<0||!Number.isInteger(billingDay)||billingDay<1||billingDay>28||(expiresAt&&(!/^\\d{4}-\\d{2}-\\d{2}$/.test(expiresAt)||Number.isNaN(parsedExpiry.getTime())||parsedExpiry.toISOString().slice(0,10)!==expiresAt)))return send(res,400,{error:'Datos de licencia no válidos. Revisá importes, día de cobro y vencimiento.'});
        const business=await sql`SELECT id FROM businesses WHERE id=${businessId} LIMIT 1`;
        if(!business.length)return send(res,404,{error:'El negocio seleccionado no existe.'});
        const code='MTS-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();
        const rows=await sql`INSERT INTO app_licenses(business_id,license_code,system_name,plan,status,expires_at,setup_amount,monthly_amount,billing_day,contract_reference,notes,created_by,modules) VALUES(${businessId},${code},${systemName},${plan},${status},${expiresAt},${setup},${monthly},${billingDay},${String(input.contractReference||'').slice(0,120)},${String(input.notes||'').slice(0,1000)},${admin.id},(SELECT modules FROM app_business_config WHERE business_id=${businessId})) RETURNING *`;
        return send(res,201,{license:rows[0]});
      }
      if(req.method==='PATCH'){
        const input=body(req),id=String(input.id||'');
        if(input.action==='modules'){
          const modules=[...new Set((Array.isArray(input.modules)?input.modules:[]).map(x=>String(x).trim()).filter(Boolean))];
          if(!id||!modules.length||modules.length>50)return send(res,400,{error:'Seleccioná al menos un módulo válido.'});
          const valid=await sql`SELECT module_key FROM app_module_catalog WHERE active=TRUE AND module_key IN (SELECT jsonb_array_elements_text(${JSON.stringify(modules)}::jsonb))`;
          if(valid.length!==modules.length)return send(res,400,{error:'La selección contiene módulos no disponibles.'});
          const license=await sql`SELECT business_id FROM app_licenses WHERE id=${id} LIMIT 1`;
          if(!license.length)return send(res,404,{error:'Licencia no encontrada.'});
          const config=await sql`SELECT modules FROM app_business_config WHERE business_id=${license[0].business_id} LIMIT 1`;
          const configured=Array.isArray(config[0]?.modules)?config[0].modules:[];
          if(modules.some(key=>!configured.includes(key)))return send(res,409,{error:'Primero agregá esos módulos a la configuración comercial del negocio.'});
          const rows=await sql`UPDATE app_licenses SET modules=${JSON.stringify(modules)}::jsonb,updated_at=NOW() WHERE id=${id} RETURNING *`;
          await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(${license[0].business_id},${admin.id},'license.modules_updated','license',${id},${JSON.stringify({modules})}::jsonb)`;
          return send(res,200,{license:rows[0]});
        }
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
        if(status==='active'){const current=await sql`SELECT expires_at<CURRENT_DATE AS expired FROM app_licenses WHERE id=${id} LIMIT 1`;if(!current.length)return send(res,404,{error:'Licencia no encontrada.'});if(current[0].expired===true)return send(res,409,{error:'La licencia ya venció. Usá Renovar para establecer una nueva fecha antes de reactivar el acceso.'});}
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
      const rows = await sql`SELECT u.id,u.name,u.email,u.password_hash,u.role,u.active,u.business_id,u.is_platform_admin,u.session_version,u.permissions,
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
    if (path === '/api/admin/module-catalog') {
      const admin=await authenticated(req,res,true); if(!admin)return;
      const sql=db();
      if(req.method==='GET'){
        const modules=await sql`SELECT module_key,title,description,category,monthly_price,setup_price,active,implemented,sort_order FROM app_module_catalog ORDER BY sort_order,title`;
        const templates=await sql`SELECT industry_key,module_key,enabled_by_default FROM app_industry_templates ORDER BY industry_key,module_key`;
        return send(res,200,{modules,templates});
      }
      if(req.method==='PUT'){
        const input=body(req),items=Array.isArray(input.modules)?input.modules:[input];
        if(!items.length||items.length>100)return send(res,400,{error:'No hay precios válidos para actualizar.'});
        for(const item of items){
          const key=String(item.moduleKey||'').trim();
          const monthly=Number(item.monthlyPrice),setup=Number(item.setupPrice);
          if(!key||!Number.isFinite(monthly)||monthly<0||!Number.isFinite(setup)||setup<0)return send(res,400,{error:'Revisá los precios de los módulos.'});
          const moduleRow=await sql`SELECT implemented FROM app_module_catalog WHERE module_key=${key} LIMIT 1`;
          if(!moduleRow.length)return send(res,404,{error:'No se encontró el módulo '+key+'.'});
          if(moduleRow[0].implemented!==true&&(item.active===true||monthly>0||setup>0))return send(res,409,{error:'El módulo '+key+' todavía no está implementado y no puede comercializarse.'});
          const rows=await sql`UPDATE app_module_catalog SET monthly_price=${monthly},setup_price=${setup},active=CASE WHEN ${typeof item.active==='boolean'} AND implemented=TRUE THEN ${item.active} ELSE active END,updated_by=${admin.id},updated_at=NOW() WHERE module_key=${key} RETURNING module_key`;
          if(!rows.length)return send(res,404,{error:'No se encontró el módulo '+key+'.'});
        }
        await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(NULL,${admin.id},'commercial.catalog_updated','module_catalog','catalog',${JSON.stringify({moduleKeys:items.map(item=>String(item.moduleKey||''))})}::jsonb)`;
        const modules=await sql`SELECT module_key,title,description,category,monthly_price,setup_price,active,implemented,sort_order FROM app_module_catalog ORDER BY sort_order,title`;
        return send(res,200,{ok:true,modules});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/admin/commercial-settings') {
      const admin=await authenticated(req,res,true); if(!admin)return;
      const sql=db();
      if(req.method==='GET'){
        const rows=await sql`SELECT monthly_base,annual_discount_percent,permanent_price,full_sale_price,setup_fee,currency FROM app_commercial_settings WHERE setting_key='default' LIMIT 1`;
        return send(res,200,{settings:rows[0]||null});
      }
      if(req.method==='PUT'){
        const input=body(req);
        const values={monthlyBase:Number(input.monthlyBase),annualDiscountPercent:Number(input.annualDiscountPercent),permanentPrice:Number(input.permanentPrice),fullSalePrice:Number(input.fullSalePrice),setupFee:Number(input.setupFee)};
        if(Object.values(values).some(v=>!Number.isFinite(v)||v<0)||values.annualDiscountPercent>100)return send(res,400,{error:'Los importes deben ser positivos y el descuento anual no puede superar 100%.'});
        const currency=String(input.currency||'PYG').trim().toUpperCase();
        if(!/^[A-Z]{3}$/.test(currency))return send(res,400,{error:'Moneda no válida.'});
        const rows=await sql`UPDATE app_commercial_settings SET monthly_base=${values.monthlyBase},annual_discount_percent=${values.annualDiscountPercent},permanent_price=${values.permanentPrice},full_sale_price=${values.fullSalePrice},setup_fee=${values.setupFee},currency=${currency},updated_by=${admin.id},updated_at=NOW() WHERE setting_key='default' RETURNING monthly_base,annual_discount_percent,permanent_price,full_sale_price,setup_fee,currency`;
        await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(NULL,${admin.id},'commercial.pricing_updated','commercial_settings','default',${JSON.stringify(values)}::jsonb)`;
        return send(res,200,{settings:rows[0]});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/admin/business-config') {
      const admin=await authenticated(req,res,true); if(!admin)return;
      const sql=db();
      if(req.method==='GET'){
        const url=new URL(req.url,`https://${req.headers.host||'localhost'}`),businessId=String(url.searchParams.get('businessId')||'');
        if(!/^[0-9a-f-]{36}$/i.test(businessId))return send(res,400,{error:'Seleccioná un negocio válido.'});
        const rows=await sql`SELECT b.id AS business_id,b.name AS business_name,bc.industry_key,bc.config_mode,bc.modules,bc.updated_at FROM businesses b LEFT JOIN app_business_config bc ON bc.business_id=b.id WHERE b.id=${businessId} LIMIT 1`;
        if(!rows.length)return send(res,404,{error:'No se encontró el negocio.'});
        const catalog=await sql`SELECT module_key,title,description,category,monthly_price,setup_price,active,sort_order FROM app_module_catalog WHERE active=TRUE ORDER BY sort_order,title`;
        return send(res,200,{config:rows[0],modules:catalog});
      }
      if(req.method==='PUT'){
        const input=body(req),businessId=String(input.businessId||''),industry=String(input.industry||''),mode=String(input.configMode||''),modules=[...new Set((Array.isArray(input.modules)?input.modules:[]).map(x=>String(x).trim()).filter(Boolean))];
        const industries=['panaderias','minimercados','tiendas','restaurantes','comercios_generales','distribuidoras'];
        if(!/^[0-9a-f-]{36}$/i.test(businessId)||!industries.includes(industry)||!['template','custom','hybrid'].includes(mode)||!modules.length||modules.length>50)return send(res,400,{error:'La configuración del negocio no es válida.'});
        const valid=await sql`SELECT module_key FROM app_module_catalog WHERE active=TRUE AND module_key IN (SELECT jsonb_array_elements_text(${JSON.stringify(modules)}::jsonb))`;
        if(valid.length!==modules.length)return send(res,400,{error:'La selección contiene módulos inexistentes o desactivados.'});
        if(!modules.includes('dashboard'))modules.push('dashboard');
        if(modules.some(key=>['sales','inventory','purchases','recipes','production'].includes(key))&&!modules.includes('products'))return send(res,400,{error:'Los módulos de ventas, inventario, compras y producción requieren Productos y costos.'});
        const business=await sql`SELECT id FROM businesses WHERE id=${businessId} LIMIT 1`;
        if(!business.length)return send(res,404,{error:'No se encontró el negocio.'});
        const rows=await sql`INSERT INTO app_business_config(business_id,industry_key,config_mode,modules,created_by,updated_by)
          VALUES(${businessId},${industry},${mode},${JSON.stringify(modules)}::jsonb,${admin.id},${admin.id})
          ON CONFLICT(business_id) DO UPDATE SET industry_key=EXCLUDED.industry_key,config_mode=EXCLUDED.config_mode,modules=EXCLUDED.modules,updated_by=EXCLUDED.updated_by,updated_at=NOW()
          RETURNING business_id,industry_key,config_mode,modules,updated_at`;
        await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(${businessId},${admin.id},'business.modules_updated','business',${businessId},${JSON.stringify({industry,mode,modules})}::jsonb)`;
        return send(res,200,{config:rows[0]});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/admin/quotations') {
      const admin=await authenticated(req,res,true); if(!admin)return;
      const sql=db();
      if(req.method==='GET'){
        const rows=await sql`SELECT q.*,b.name AS business_name FROM app_quotations q LEFT JOIN businesses b ON b.id=q.business_id ORDER BY q.created_at DESC LIMIT 300`;
        return send(res,200,{quotations:rows});
      }
      if(req.method==='POST'){
        const input=body(req),prospectName=String(input.prospectName||'').trim().slice(0,120),prospectEmail=String(input.prospectEmail||'').trim().slice(0,254);
        const industry=String(input.industry||''),mode=String(input.configMode||''),plan=String(input.planType||'monthly');
        const modules=[...new Set((Array.isArray(input.modules)?input.modules:[]).map(x=>String(x).trim()).filter(Boolean))];
        const industries=['panaderias','minimercados','tiendas','restaurantes','comercios_generales','distribuidoras'];
        if(!prospectName||!industries.includes(industry)||!['template','custom','hybrid'].includes(mode)||!['monthly','annual','permanent','full_sale'].includes(plan)||!modules.length||modules.length>50)return send(res,400,{error:'Completá el prospecto, rubro, modalidad y módulos.'});
        if(prospectEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prospectEmail))return send(res,400,{error:'Correo electrónico no válido.'});
        const catalog=await sql`SELECT module_key,title,monthly_price,setup_price FROM app_module_catalog WHERE active=TRUE AND module_key IN (SELECT jsonb_array_elements_text(${JSON.stringify(modules)}::jsonb))`;
        if(catalog.length!==modules.length)return send(res,400,{error:'La cotización contiene módulos no disponibles.'});
        const settingsRows=await sql`SELECT monthly_base,annual_discount_percent,permanent_price,full_sale_price,setup_fee,currency FROM app_commercial_settings WHERE setting_key='default' LIMIT 1`;
        const settings=settingsRows[0]||{monthly_base:0,annual_discount_percent:0,permanent_price:0,full_sale_price:0,setup_fee:0,currency:'PYG'};
        const moduleExpansion=input.moduleExpansion===true;
        if(moduleExpansion&&(!input.businessId||!['monthly','annual'].includes(plan)))return send(res,400,{error:'La ampliación de módulos requiere un negocio y una modalidad mensual o anual.'});
        const moduleMonthly=catalog.reduce((n,m)=>n+Number(m.monthly_price||0),0),moduleSetup=catalog.reduce((n,m)=>n+Number(m.setup_price||0),0);
        const monthly=(moduleExpansion?0:Number(settings.monthly_base||0))+moduleMonthly,setup=(moduleExpansion?0:Number(settings.setup_fee||0))+moduleSetup;
        const annual=monthly*12*(1-Number(settings.annual_discount_percent||0)/100);
        if(moduleExpansion&&moduleMonthly<=0&&moduleSetup<=0)return send(res,409,{error:'Configurá un precio mensual o de instalación para este módulo antes de cotizar la ampliación.'});
        const oneTime=plan==='permanent'?Number(settings.permanent_price||0)+setup:plan==='full_sale'?Number(settings.full_sale_price||0)+setup:setup;
        if((plan==='permanent'&&!Number(settings.permanent_price||0))||(plan==='full_sale'&&!Number(settings.full_sale_price||0)))return send(res,409,{error:'Configurá primero el precio de licencia permanente o venta completa en el catálogo comercial.'});
        const businessId=input.businessId?String(input.businessId):null;
        if(businessId&&!/^[0-9a-f-]{36}$/i.test(businessId))return send(res,400,{error:'Negocio asociado a la cotización no válido.'});
        if(moduleExpansion){const exists=await sql`SELECT id FROM businesses WHERE id=${businessId} LIMIT 1`;if(!exists.length)return send(res,404,{error:'No se encontró el negocio para la ampliación.'});}
        const validUntil=input.validUntil?String(input.validUntil):null;
        if(validUntil){const parsed=new Date(validUntil+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==validUntil)return send(res,400,{error:'Fecha de validez de cotización no válida.'});}
        const breakdown={currency:settings.currency||'PYG',monthlyBase:moduleExpansion?0:Number(settings.monthly_base||0),annualDiscountPercent:Number(settings.annual_discount_percent||0),setupFee:moduleExpansion?0:Number(settings.setup_fee||0),modules:catalog.map(m=>({key:m.module_key,title:m.title,monthly:Number(m.monthly_price||0),setup:Number(m.setup_price||0)}))};
        const rows=await sql`INSERT INTO app_quotations(business_id,prospect_name,prospect_email,industry_key,config_mode,modules,plan_type,setup_amount,monthly_amount,annual_amount,currency,valid_until,notes,price_breakdown,created_by)
          VALUES(${businessId},${prospectName},${prospectEmail},${industry},${mode},${JSON.stringify(modules)}::jsonb,${plan},${plan==='monthly'||plan==='annual'?setup:oneTime},${plan==='monthly'?monthly:0},${plan==='annual'?annual:0},${settings.currency||'PYG'},${validUntil},${String(input.notes||'').slice(0,2000)},${JSON.stringify(breakdown)}::jsonb,${admin.id}) RETURNING *`;
        await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(${businessId},${admin.id},'commercial.quotation_created','quotation',${rows[0].id},${JSON.stringify({prospectName,industry,plan,modules,moduleExpansion})}::jsonb)`;
        return send(res,201,{quotation:rows[0],totals:{setup:plan==='monthly'||plan==='annual'?setup:oneTime,monthly:plan==='monthly'?monthly:0,annual:plan==='annual'?annual:0,currency:settings.currency||'PYG'},pricingConfigured:catalog.some(m=>Number(m.monthly_price||0)>0||Number(m.setup_price||0)>0)||(moduleExpansion?false:Number(settings.monthly_base||0)>0||Number(settings.setup_fee||0)>0)||((plan==='permanent'&&Number(settings.permanent_price||0)>0)||(plan==='full_sale'&&Number(settings.full_sale_price||0)>0))});
      }
      if(req.method==='PATCH'){
        const input=body(req),id=String(input.id||''),status=String(input.status||'');
        if(!/^[0-9a-f-]{36}$/i.test(id)||!['sent','accepted','rejected','expired'].includes(status))return send(res,400,{error:'Estado de cotización no válido.'});
        const rows=await sql`UPDATE app_quotations SET status=${status},updated_at=NOW() WHERE id=${id} AND status IN ('draft','sent') RETURNING *`;
        if(!rows.length)return send(res,404,{error:'Cotización no encontrada o ya cerrada.'});
        return send(res,200,{quotation:rows[0]});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/business/module-requests') {
      const user=await authenticated(req,res,false);if(!user)return;
      if(user.is_platform_admin===true||!user.business_id||!['admin','supervisor'].includes(user.role))return send(res,403,{error:'Solo el administrador o supervisor del negocio puede solicitar módulos.'});
      const sql=db();
      if(req.method==='GET'){
        const rows=await sql`SELECT r.*,m.title AS module_title FROM app_module_requests r JOIN app_module_catalog m ON m.module_key=r.module_key WHERE r.business_id=${user.business_id} ORDER BY r.created_at DESC LIMIT 100`;
        return send(res,200,{requests:rows});
      }
      if(req.method==='POST'){
        const input=body(req),key=String(input.moduleKey||'').trim(),notes=String(input.notes||'').trim().slice(0,1000);
        const module=await sql`SELECT module_key FROM app_module_catalog WHERE module_key=${key} AND active=TRUE LIMIT 1`;
        if(!module.length)return send(res,404,{error:'Módulo no disponible.'});
        const config=await sql`SELECT modules FROM app_business_config WHERE business_id=${user.business_id} LIMIT 1`;
        const licensed=user.license_modules;
        const configHas=Array.isArray(config[0]?.modules)&&config[0].modules.includes(key);
        const licenseAllows=!Array.isArray(licensed)||licensed.includes(key);
        if(configHas&&licenseAllows)return send(res,409,{error:'Este módulo ya está habilitado.'});
        const pending=await sql`SELECT id FROM app_module_requests WHERE business_id=${user.business_id} AND module_key=${key} AND status IN ('requested','quoted') LIMIT 1`;
        if(pending.length)return send(res,409,{error:'Ya existe una solicitud abierta para este módulo.'});
        const rows=await sql`INSERT INTO app_module_requests(business_id,module_key,requested_by,notes) VALUES(${user.business_id},${key},${user.id},${notes}) RETURNING *`;
        if(!rows.length)return send(res,409,{error:'No se pudo registrar la solicitud.'});
        await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(${user.business_id},${user.id},'business.module_requested','module_request',${rows[0].id},${JSON.stringify({moduleKey:key})}::jsonb)`;
        return send(res,201,{request:rows[0]});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/admin/module-requests') {
      const admin=await authenticated(req,res,true);if(!admin)return;
      const sql=db();
      if(req.method==='GET'){
        const rows=await sql`SELECT r.*,m.title AS module_title,b.name AS business_name,u.name AS requester_name,bc.industry_key,bc.config_mode FROM app_module_requests r JOIN app_module_catalog m ON m.module_key=r.module_key JOIN businesses b ON b.id=r.business_id LEFT JOIN app_users u ON u.id=r.requested_by LEFT JOIN app_business_config bc ON bc.business_id=b.id ORDER BY r.created_at DESC LIMIT 300`;
        return send(res,200,{requests:rows});
      }
      if(req.method==='PATCH'){
        const input=body(req),id=String(input.id||''),action=String(input.action||'');
        if(!/^[0-9a-f-]{36}$/i.test(id)||!['approve','reject','quote'].includes(action))return send(res,400,{error:'Acción de solicitud no válida.'});
        const requestRows=await sql`SELECT * FROM app_module_requests WHERE id=${id} AND status IN ('requested','quoted') LIMIT 1`;
        if(!requestRows.length)return send(res,404,{error:'Solicitud no encontrada o ya procesada.'});
        const request=requestRows[0];
        if(action==='quote'){
          const quotationId=String(input.quotationId||'');
          if(quotationId&&!/^[0-9a-f-]{36}$/i.test(quotationId))return send(res,400,{error:'Referencia de cotización no válida.'});
          if(quotationId){
            const quote=await sql`SELECT id FROM app_quotations WHERE id=${quotationId} AND (business_id=${request.business_id} OR business_id IS NULL) LIMIT 1`;
            if(!quote.length)return send(res,404,{error:'No se encontró la cotización asociada.'});
          }
          const rows=await sql`UPDATE app_module_requests SET status='quoted',quotation_id=COALESCE(NULLIF(${quotationId},'')::uuid,quotation_id),reviewed_by=${admin.id},notes=CASE WHEN ${String(input.notes||'').trim()}='' THEN notes ELSE ${String(input.notes||'').trim().slice(0,1000)} END,updated_at=NOW() WHERE id=${id} RETURNING *`;
          return send(res,200,{request:rows[0]});
        }
        if(action==='reject'){
          const rows=await sql`UPDATE app_module_requests SET status='rejected',reviewed_by=${admin.id},updated_at=NOW() WHERE id=${id} RETURNING *`;
          return send(res,200,{request:rows[0]});
        }
        const license=await sql`SELECT id,modules FROM app_licenses WHERE business_id=${request.business_id} AND status='active' AND (expires_at IS NULL OR expires_at>=CURRENT_DATE) ORDER BY created_at DESC LIMIT 1`;
        if(!license.length)return send(res,409,{error:'El negocio necesita una licencia activa antes de habilitar módulos.'});
        const config=await sql`SELECT modules FROM app_business_config WHERE business_id=${request.business_id} LIMIT 1`;
        const configured=Array.isArray(config[0]?.modules)?config[0].modules:[];
        const licensed=Array.isArray(license[0].modules)?license[0].modules:configured;
        const nextConfig=[...new Set([...configured,request.module_key])],nextLicense=[...new Set([...licensed,request.module_key])];
        const rows=await sql`WITH config_updated AS (
          UPDATE app_business_config SET modules=${JSON.stringify(nextConfig)}::jsonb,updated_by=${admin.id},updated_at=NOW()
          WHERE business_id=${request.business_id} RETURNING business_id
        ), license_updated AS (
          UPDATE app_licenses SET modules=${JSON.stringify(nextLicense)}::jsonb,updated_at=NOW()
          WHERE id=${license[0].id} AND business_id IN (SELECT business_id FROM config_updated) RETURNING id
        ), request_updated AS (
          UPDATE app_module_requests SET status='approved',reviewed_by=${admin.id},updated_at=NOW()
          WHERE id=${id} AND EXISTS(SELECT 1 FROM license_updated) RETURNING *
        )
        SELECT * FROM request_updated`;
        if(!rows.length)return send(res,409,{error:'No se pudo aplicar la ampliación de forma consistente. Verificá la licencia y la configuración.'});
        await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(${request.business_id},${admin.id},'business.module_enabled','module',${request.module_key},${JSON.stringify({requestId:id})}::jsonb)`;
        return send(res,200,{request:rows[0],enabledModule:request.module_key});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/admin/businesses') {
      const admin=await authenticated(req,res,true); if(!admin) return;
      const sql=db();
      if(req.method==='GET'){
        const rows=await sql`SELECT b.id,b.name,b.slug,b.active,b.address,b.phone,b.email,b.ruc,b.owner_name,b.created_at,b.updated_at,
          bc.industry_key,bc.config_mode,bc.modules AS configured_modules,
          (SELECT COUNT(*)::int FROM app_users u WHERE u.business_id=b.id) AS user_count,
          (SELECT COUNT(*)::int FROM app_users u WHERE u.business_id=b.id AND u.active=TRUE) AS active_user_count,
          (SELECT COUNT(DISTINCT lower(trim(item->>'party')))::int FROM app_state st CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(st.data->'invoices')='array' THEN st.data->'invoices' ELSE '[]'::jsonb END) item WHERE st.business_id=b.id AND COALESCE(trim(item->>'party'),'')<>'') AS customer_count,
          (SELECT CASE WHEN jsonb_typeof(st.data->'products')='array' THEN jsonb_array_length(st.data->'products') ELSE 0 END::int FROM app_state st WHERE st.business_id=b.id LIMIT 1) AS product_count,
          (SELECT COUNT(*)::int FROM app_state st CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(st.data->'invoices')='array' THEN st.data->'invoices' ELSE '[]'::jsonb END) item WHERE st.business_id=b.id  ) AS sales_count,
          (SELECT CASE WHEN jsonb_typeof(st.data->'purchases')='array' THEN jsonb_array_length(st.data->'purchases') ELSE 0 END::int FROM app_state st WHERE st.business_id=b.id LIMIT 1) AS purchase_count,
          (SELECT COALESCE(SUM((item->>'amount')::numeric),0)::numeric(14,2) FROM app_state st CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(st.data->'movements')='array' THEN st.data->'movements' ELSE '[]'::jsonb END) item WHERE st.business_id=b.id AND item->>'type'='income') AS recorded_income,
          (SELECT COALESCE(SUM((item->>'amount')::numeric),0)::numeric(14,2) FROM app_state st CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(st.data->'movements')='array' THEN st.data->'movements' ELSE '[]'::jsonb END) item WHERE st.business_id=b.id AND item->>'type'='expense') AS recorded_expenses,
          (SELECT COALESCE(SUM(COALESCE(NULLIF(item->>'total','')::numeric,NULLIF(item->>'totalAmount','')::numeric,NULLIF(item->>'amount','')::numeric,0)),0)::numeric(14,2) FROM app_state st CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(st.data->'invoices')='array' THEN st.data->'invoices' ELSE '[]'::jsonb END) item WHERE st.business_id=b.id AND COALESCE(item->>'status','completed') NOT IN ('cancelled','void')) AS sales_total,
          (SELECT updated_at FROM app_state st WHERE st.business_id=b.id LIMIT 1) AS last_sync
          FROM businesses b LEFT JOIN app_business_config bc ON bc.business_id=b.id
          WHERE NOT EXISTS (SELECT 1 FROM app_trash t WHERE t.entity_type='business' AND t.entity_id=b.id::text AND t.restored_at IS NULL) ORDER BY b.created_at DESC`;
        return send(res,200,{businesses:rows});
      }
      if(req.method==='POST'){
        const input=body(req); const name=String(input.name||'').trim().slice(0,120);
        const slug=String(input.slug||name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);
        const industry=String(input.industry||'comercios_generales'),configMode=String(input.configMode||'template');
        const industries=['panaderias','minimercados','tiendas','restaurantes','comercios_generales','distribuidoras'];
        if(!name||!slug) return send(res,400,{error:'Ingresá el nombre del negocio.'});
        if(!industries.includes(industry)||!['template','custom','hybrid'].includes(configMode))return send(res,400,{error:'Seleccioná un rubro y una modalidad de configuración válidos.'});
        let selectedModules=[...new Set((Array.isArray(input.modules)?input.modules:[]).map(x=>String(x).trim()).filter(Boolean))];
        if(configMode==='custom'&&!selectedModules.length)return send(res,400,{error:'En configuración personalizada seleccioná al menos un módulo.'});
        if(!selectedModules.length){
          const defaults=await sql`SELECT module_key FROM app_industry_templates WHERE industry_key=${industry} AND enabled_by_default=TRUE ORDER BY module_key`;
          selectedModules=defaults.map(row=>row.module_key);
        }
        const validModules=await sql`SELECT module_key FROM app_module_catalog WHERE active=TRUE AND module_key IN (SELECT jsonb_array_elements_text(${JSON.stringify(selectedModules)}::jsonb))`;
        if(!selectedModules.length||validModules.length!==selectedModules.length)return send(res,400,{error:'Seleccioná al menos un módulo válido.'});
        if(!selectedModules.includes('dashboard'))selectedModules.push('dashboard');
        if(selectedModules.some(key=>['sales','inventory','purchases','recipes','production'].includes(key))&&!selectedModules.includes('products'))return send(res,400,{error:'Los módulos de ventas, inventario, compras y producción requieren Productos y costos.'});
        const quotationId=String(input.quotationId||'');
        if(quotationId&&!/^[0-9a-f-]{36}$/i.test(quotationId))return send(res,400,{error:'Referencia de cotización no válida.'});
        if(quotationId){const quote=await sql`SELECT id FROM app_quotations WHERE id=${quotationId} AND business_id IS NULL AND status IN ('draft','sent','accepted') LIMIT 1`;if(!quote.length)return send(res,404,{error:'No se encontró una cotización abierta para vincular.'});}
        const id=crypto.randomUUID();
        const rows=await sql`WITH created AS (
          INSERT INTO businesses(id,name,slug,active,address,phone,email,ruc,owner_name)
          VALUES(${id},${name},${slug},TRUE,${String(input.address||'').slice(0,250)},${String(input.phone||'').slice(0,60)},${String(input.email||'').slice(0,254)},${String(input.ruc||'').slice(0,40)},${String(input.ownerName||'').slice(0,120)})
          RETURNING *
        ), state_created AS (
          INSERT INTO app_state(data,business_id) SELECT '{}'::jsonb,id FROM created ON CONFLICT(business_id) DO NOTHING RETURNING business_id
        ), config_created AS (
          INSERT INTO app_business_config(business_id,industry_key,config_mode,modules,created_by,updated_by)
          SELECT id,${industry},${configMode},${JSON.stringify(selectedModules)}::jsonb,${admin.id},${admin.id} FROM created RETURNING business_id
        ), quote_linked AS (
          UPDATE app_quotations SET business_id=(SELECT id FROM created),status=CASE WHEN status='accepted' THEN 'converted' ELSE status END,updated_at=NOW()
          WHERE id=NULLIF(${quotationId},'')::uuid AND (business_id IS NULL OR business_id=(SELECT id FROM created)) RETURNING id
        ), audit_created AS (
          INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details)
          SELECT id,${admin.id},'business.created','business',id,${JSON.stringify({name,slug,industry,configMode,modules:selectedModules,quotationId:quotationId||null})}::jsonb FROM created RETURNING id
        )
        SELECT * FROM created`;
        return send(res,201,{business:rows[0],configuration:{industry,configMode,modules:selectedModules},licenseCreated:false});
      }
      if(req.method==='PATCH'){
        const input=body(req); const id=String(input.id||''); if(!id) return send(res,400,{error:'Falta el identificador del negocio.'});
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
          if(!rows[0]) return send(res,404,{error:'No se encontró el negocio.'});
          return send(res,200,{business:rows[0],message:input.active?'Negocios reactivada.':'Negocio desactivado. El acceso de sus usuarios quedó bloqueado.'});
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
        if(!rows[0]) return send(res,404,{error:'No se encontró el negocio.'});
        return send(res,200,{business:rows[0]});
      }
      if(req.method==='DELETE'){
        const id=String(body(req).id||'').trim();
        if(!id) return send(res,400,{error:'Falta el identificador del negocio.'});
        const business=await sql`SELECT id,name,active FROM businesses WHERE id=${id} LIMIT 1`;
        if(!business[0]) return send(res,404,{error:'No se encontró el negocio.'});
        const alreadyArchived=await sql`SELECT id FROM app_trash WHERE entity_type='business' AND entity_id=${id} AND restored_at IS NULL LIMIT 1`;
        if(alreadyArchived.length) return send(res,409,{error:'Este negocio ya está en la papelera. Podés restaurarlo desde Administración.'});
        const snapshot=await sql`SELECT * FROM businesses WHERE id=${id} LIMIT 1`;
        await sql`INSERT INTO app_trash(entity_type,entity_id,business_id,payload,deleted_by) VALUES('business',${id},${id},${JSON.stringify(snapshot[0])}::jsonb,${admin.id})`;
        await sql`UPDATE businesses SET active=FALSE,updated_at=NOW() WHERE id=${id}`;
        await sql`UPDATE app_users SET session_version=session_version+1 WHERE business_id=${id} AND is_platform_admin=FALSE`;
        await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(${id},${admin.id},'business.trashed','business',${id},${JSON.stringify({name:business[0].name})}::jsonb)`;
        return send(res,200,{ok:true,deleted:false,trashed:true,message:'Negocio movido a la papelera. Sus datos se conservaron y puede restaurarse.'});
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
          if(!target.length) return send(res,404,{error:'El negocio seleccionado no existe o está inactiva.'});
          rows=await sql`INSERT INTO app_notifications(business_id,user_id,type,title,message) SELECT ${businessId},u.id,'admin_message',${title},${message} FROM app_users u WHERE u.business_id=${businessId} AND u.active=TRUE AND u.is_platform_admin=FALSE RETURNING id`;
          if(!rows.length) return send(res,409,{error:'El negocio seleccionado no tiene usuarios activos que puedan recibir el aviso.'});
          await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details) VALUES(${businessId},${admin.id},'notification.sent','notification',${rows[0].id},${JSON.stringify({title,recipients:rows.length,target:target[0].name})}::jsonb)`;
        } else {
          rows=await sql`INSERT INTO app_notifications(business_id,user_id,type,title,message) SELECT NULL,u.id,'admin_message',${title},${message} FROM app_users u WHERE u.active=TRUE AND u.is_platform_admin=FALSE RETURNING id`;
          if(!rows.length) return send(res,409,{error:'No hay usuarios activos en ningun negocio para recibir el aviso.'});
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
    // [deploy] Gestión de empleados aislada por negocio y limitada por licencia.
    if (path === '/api/business/users') {
      const user = await authenticated(req,res,false); if (!user) return;
      if (user.is_platform_admin === true || user.role !== 'supervisor' || !user.business_id)
        return send(res,403,{error:'Solo el Supervisor del negocio puede administrar sus empleados.'});
      const sql = db();
      const permissionKeys = ['sales.view','sales.create','sales.cancel','products.view','products.manage','inventory.view','inventory.manage','customers.view','customers.manage','suppliers.view','suppliers.manage','purchases.view','purchases.create','cash.view','cash.manage','cash.open','cash.close','recipes.view','recipes.manage','production.view','production.manage','reports.view','reports.export'];
      if (req.method === 'GET') {
        const rows = await sql`SELECT id,name,email,role,active,permissions,created_at FROM app_users WHERE business_id=${user.business_id} AND is_platform_admin=FALSE AND role='employee' ORDER BY created_at DESC`;
        const lic = await sql`SELECT plan,user_limit FROM app_licenses WHERE business_id=${user.business_id} AND status='active' AND (expires_at IS NULL OR expires_at>=CURRENT_DATE) ORDER BY created_at DESC LIMIT 1`;
        const plan=lic[0]?.plan||'basic',limit=lic[0]?.user_limit ?? (plan==='basic'?1:(plan==='professional'?4:null));
        const count=await sql`SELECT COUNT(*)::int AS total FROM app_users WHERE business_id=${user.business_id} AND role='employee' AND active=TRUE`;
        return send(res,200,{employees:rows,limits:{plan,employeeLimit:limit,activeEmployees:Number(count[0]?.total||0),remaining:limit===null?null:Math.max(0,limit-Number(count[0]?.total||0))}});
      }
      if (req.method === 'POST') {
        const input=body(req),name=String(input.name||'').trim().slice(0,70),email=String(input.email||'').trim().toLowerCase(),password=input.password;
        if(!name||!validEmail(email)||!validPassword(password))return send(res,400,{error:'Completá nombre, correo y contraseña (mínimo 12 caracteres).'});
        const lic=await sql`SELECT plan,user_limit FROM app_licenses WHERE business_id=${user.business_id} AND status='active' AND (expires_at IS NULL OR expires_at>=CURRENT_DATE) ORDER BY created_at DESC LIMIT 1`;
        const plan=lic[0]?.plan||'basic',limit=lic[0]?.user_limit ?? (plan==='basic'?1:(plan==='professional'?4:null));
        const count=await sql`SELECT COUNT(*)::int AS total FROM app_users WHERE business_id=${user.business_id} AND role='employee' AND active=TRUE`;
        if(limit!==null&&Number(count[0]?.total||0)>=limit)return send(res,409,{error:'Alcanzaste el límite de empleados de tu plan. Podés ampliar tu licencia desde el administrador.'});
        const requested=input.permissions&&typeof input.permissions==='object'&&!Array.isArray(input.permissions)?input.permissions:{};
        const permissions={}; for(const key of permissionKeys) permissions[key]=requested[key]===true;
        const id=crypto.randomUUID(),hash=await hashPassword(password);
        const rows=await sql`INSERT INTO app_users(id,name,email,password_hash,role,active,business_id,is_platform_admin,permissions) VALUES(${id},${name},${email},${hash},'employee',TRUE,${user.business_id},FALSE,${JSON.stringify(permissions)}::jsonb) RETURNING id,name,email,role,active,permissions,created_at`;
        return send(res,201,{employee:rows[0]});
      }
      if (req.method === 'PATCH') {
        const input=body(req),id=String(input.id||'');
        if(!id)return send(res,400,{error:'Falta identificar al empleado.'});
        const target=await sql`SELECT id FROM app_users WHERE id=${id} AND business_id=${user.business_id} AND role='employee' AND is_platform_admin=FALSE LIMIT 1`;
        if(!target.length)return send(res,404,{error:'No se encontró el empleado de este negocio.'});
        if(typeof input.active==='boolean'){
          if(input.active){
            const lic=await sql`SELECT plan,user_limit FROM app_licenses WHERE business_id=${user.business_id} AND status='active' AND (expires_at IS NULL OR expires_at>=CURRENT_DATE) ORDER BY created_at DESC LIMIT 1`;
            const plan=lic[0]?.plan||'basic',limit=lic[0]?.user_limit ?? (plan==='basic'?1:(plan==='professional'?4:null));
            const count=await sql`SELECT COUNT(*)::int AS total FROM app_users WHERE business_id=${user.business_id} AND role='employee' AND active=TRUE AND id<>${id}`;
            if(limit!==null&&Number(count[0]?.total||0)>=limit)return send(res,409,{error:'No se puede reactivar: el negocio alcanzó el límite de empleados de su licencia.'});
          }
          const rows=await sql`UPDATE app_users SET active=${input.active},session_version=session_version+1 WHERE id=${id} AND business_id=${user.business_id} RETURNING id,name,email,role,active,permissions,created_at`;
          return send(res,200,{employee:rows[0]});
        }
        if(input.permissions&&typeof input.permissions==='object'&&!Array.isArray(input.permissions)){
          const permissions={}; for(const key of permissionKeys) permissions[key]=input.permissions[key]===true;
          const rows=await sql`UPDATE app_users SET permissions=${JSON.stringify(permissions)}::jsonb,session_version=session_version+1 WHERE id=${id} AND business_id=${user.business_id} RETURNING id,name,email,role,active,permissions,created_at`;
          return send(res,200,{employee:rows[0]});
        }
        return send(res,400,{error:'No se recibieron permisos o estado válidos.'});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/admin/users') {
      const admin = await authenticated(req,res,true); if (!admin) return;
      const sql = db();
      if (req.method === 'GET') {
        const rows = await sql`SELECT u.id,u.name,u.email,u.role,u.active,u.business_id,u.is_platform_admin,u.created_at,b.name AS business_name FROM app_users u LEFT JOIN businesses b ON b.id=u.business_id WHERE NOT EXISTS (SELECT 1 FROM app_trash t WHERE t.entity_type='user' AND t.entity_id=u.id::text AND t.restored_at IS NULL) AND (u.business_id IS NULL OR NOT EXISTS (SELECT 1 FROM app_trash bt WHERE bt.entity_type='business' AND bt.entity_id=u.business_id::text AND bt.restored_at IS NULL)) ORDER BY u.is_platform_admin DESC,u.created_at ASC`;
        return send(res,200,{users:rows.map(publicUser)});
      }
      if (req.method === 'POST') {
        const input=body(req); const name=String(input.name||'').trim().slice(0,70); const email=String(input.email||'').trim().toLowerCase(); const password=input.password; const role=['admin','supervisor','employee'].includes(input.role)?input.role:'employee'; let businessId=String(input.businessId||'');
        if (!name || !validEmail(email) || !validPassword(password)) return send(res,400,{error:'Completá nombre, correo y contraseña (mínimo 12 caracteres).'});
        if(!businessId) return send(res,400,{error:'Seleccioná el negocio a la que pertenecerá el usuario.'});
        const business=await sql`SELECT id FROM businesses WHERE id=${businessId} AND active=TRUE LIMIT 1`; if(!business.length) return send(res,400,{error:'El negocio seleccionado no existe o está inactiva.'});
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
        const alreadyArchived=await sql`SELECT id FROM app_trash WHERE entity_type='user' AND entity_id=${id} AND restored_at IS NULL LIMIT 1`;
        if(alreadyArchived.length)return send(res,409,{error:'Este usuario ya está en la papelera.'});
        await sql`INSERT INTO app_trash(entity_type,entity_id,business_id,payload,deleted_by) VALUES('user',${id},${target[0].business_id},${JSON.stringify(target[0].safe_payload)}::jsonb,${admin.id})`;
        await sql`UPDATE app_users SET active=FALSE,session_version=session_version+1 WHERE id=${id} AND is_platform_admin=FALSE`;
        return send(res,200,{ok:true,trashed:true,message:'Usuario movido a la papelera. Sus sesiones fueron revocadas y puede restaurarse.'});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/admin/reset-data') {
      const admin = await authenticated(req,res,true); if (!admin) return;
      if (req.method !== 'POST') return send(res,405,{error:'Método no permitido.'});
      const sql=db();
      let businessId=String(req.headers['x-business-id']||'');
      if(!businessId){const first=await sql`SELECT id FROM businesses WHERE active=TRUE ORDER BY created_at ASC LIMIT 1`;businessId=first[0]?.id||'';}
      if(!businessId) return send(res,400,{error:'No hay negocios registrados.'});
      const rows=await sql`SELECT data FROM app_state WHERE business_id=${businessId} LIMIT 1`;
      const current=rows[0]?.data&&typeof rows[0].data==='object'&&!Array.isArray(rows[0].data)?rows[0].data:{};
      const data={...current,movements:[],invoices:[],employees:[],employeePayments:[]}; delete data.users;
      const serialized=JSON.stringify(data);
      const saved=await sql`INSERT INTO app_state(data,updated_by,business_id,updated_at) VALUES(${serialized}::jsonb,${admin.id},${businessId},NOW()) ON CONFLICT(business_id) DO UPDATE SET data=EXCLUDED.data,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING updated_at`;
      return send(res,200,{ok:true,data,updatedAt:saved[0]?.updated_at||null});
    }

    if (path === '/api/business/erp') {
      const user = await authenticated(req,res,false); if (!user) return;
      const sql = db();
      const businessId = user.is_platform_admin === true ? String(req.headers['x-business-id'] || '') : String(user.business_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(businessId)) return send(res,400,{error:'Seleccioná un negocio válido.'});
      const businesses = await sql`SELECT id FROM businesses WHERE id=${businessId} AND active=TRUE AND NOT EXISTS (SELECT 1 FROM app_trash t WHERE t.entity_type='business' AND t.entity_id=businesses.id::text AND t.restored_at IS NULL) LIMIT 1`;
      if (!businesses.length) return send(res,404,{error:'El negocio no existe o está desactivado.'});
      const permissions = user.permissions && typeof user.permissions === 'object' && !Array.isArray(user.permissions) ? user.permissions : {};
      const manager = user.is_platform_admin === true || user.role === 'admin' || user.role === 'supervisor';
      const can = key => manager || permissions[key] === true;
      const canAny = keys => keys.some(can);
      const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
      const input = req.method === 'GET' ? {} : body(req);
      const module = String(req.method === 'GET' ? url.searchParams.get('module') || '' : input.module || url.searchParams.get('module') || '').toLowerCase();
      if(user.is_platform_admin!==true){
        const moduleConfig=await sql`SELECT bc.modules AS configured_modules,lic.modules AS licensed_modules
          FROM app_business_config bc
          LEFT JOIN LATERAL (SELECT l.modules FROM app_licenses l WHERE l.business_id=bc.business_id AND LOWER(BTRIM(l.system_name))=LOWER(BTRIM(${String(process.env.LICENSE_SYSTEM_NAME||'Mattsystem')})) ORDER BY (l.status='active' AND (l.expires_at IS NULL OR l.expires_at>=CURRENT_DATE)) DESC,l.created_at DESC LIMIT 1) lic ON TRUE
          WHERE bc.business_id=${businessId} LIMIT 1`;
        const config=moduleConfig[0];
        if(config&&Array.isArray(config.configured_modules)&&!config.configured_modules.includes(module))return send(res,403,{code:'MODULE_NOT_INCLUDED',error:'Este módulo no está incluido en la configuración contratada. Solicitá una ampliación al administrador.'});
        if(config&&Array.isArray(config.licensed_modules)&&!config.licensed_modules.includes(module))return send(res,403,{code:'MODULE_NOT_LICENSED',error:'Este módulo no está habilitado en la licencia de tu negocio. Contactá al administrador.'});
      }

      const readPermissions = {
        products:['products.view','products.manage','sales.create','purchases.create','inventory.manage','recipes.manage','production.manage'], sales:['sales.view'], inventory:['inventory.view','inventory.manage'],
        customers:['customers.view','customers.manage'], suppliers:['suppliers.view','suppliers.manage'],
        purchases:['purchases.view','purchases.create'], recipes:['recipes.view','recipes.manage'],
        production:['production.view','production.manage'], cash:['cash.view','cash.manage','cash.open','cash.close'],
        reports:['reports.view','reports.export']
      };
      const writePermissions = {
        products:['products.manage'], sales:['sales.create'], inventory:['inventory.manage'],
        customers:['customers.manage'], suppliers:['suppliers.manage'], purchases:['purchases.create'],
        recipes:['recipes.manage'], production:['production.manage'], cash:['cash.manage','cash.open','cash.close'], reports:['reports.export']
      };
      if (!readPermissions[module]) return send(res,400,{error:'Módulo ERP no válido.'});
      if (req.method === 'GET') {
        if (!canAny(readPermissions[module])) return send(res,403,{error:'No tenés permiso para consultar este módulo.'});
        if (module === 'products') {
          const full=can('products.view')||can('products.manage');
          const rows=full
            ? await sql`SELECT id,sku,name,category,unit,sale_price,cost_price,stock,min_stock,active,created_at,updated_at FROM app_products WHERE business_id=${businessId} ORDER BY name LIMIT 2000`
            : await sql`SELECT id,name,unit,sale_price,stock,min_stock,active FROM app_products WHERE business_id=${businessId} AND active=TRUE ORDER BY name LIMIT 2000`;
          return send(res,200,{products:rows});
        }
        if (module === 'customers') {
          const rows=await sql`SELECT id,name,document,phone,email,address,notes,active,created_at,updated_at FROM app_customers WHERE business_id=${businessId} ORDER BY name LIMIT 2000`;
          return send(res,200,{customers:rows});
        }
        if (module === 'suppliers') {
          const rows=await sql`SELECT id,name,ruc,phone,email,address,notes,active,created_at,updated_at FROM app_suppliers WHERE business_id=${businessId} ORDER BY name LIMIT 2000`;
          return send(res,200,{suppliers:rows});
        }
        if (module === 'sales') {
          const rows=await sql`SELECT s.*,c.name AS customer_name,COALESCE((SELECT json_agg(json_build_object('id',i.id,'product_id',i.product_id,'description',i.description,'quantity',i.quantity,'unit_price',i.unit_price,'unit_cost',i.unit_cost,'line_total',i.line_total) ORDER BY i.created_at) FROM app_sale_items i WHERE i.business_id=s.business_id AND i.sale_id=s.id),'[]'::json) AS items FROM app_sales s LEFT JOIN app_customers c ON c.business_id=s.business_id AND c.id=s.customer_id WHERE s.business_id=${businessId} ORDER BY s.created_at DESC LIMIT 500`;
          return send(res,200,{sales:rows});
        }
        if (module === 'purchases') {
          const rows=await sql`SELECT p.*,s.name AS supplier_name,COALESCE((SELECT json_agg(json_build_object('id',i.id,'product_id',i.product_id,'description',i.description,'quantity',i.quantity,'unit_cost',i.unit_cost,'line_total',i.line_total) ORDER BY i.created_at) FROM app_purchase_items i WHERE i.business_id=p.business_id AND i.purchase_id=p.id),'[]'::json) AS items FROM app_purchases p LEFT JOIN app_suppliers s ON s.business_id=p.business_id AND s.id=p.supplier_id WHERE p.business_id=${businessId} ORDER BY p.created_at DESC LIMIT 500`;
          return send(res,200,{purchases:rows});
        }
        if (module === 'inventory') {
          const rows=await sql`SELECT m.*,p.name AS product_name,p.sku FROM app_inventory_movements m JOIN app_products p ON p.business_id=m.business_id AND p.id=m.product_id WHERE m.business_id=${businessId} ORDER BY m.created_at DESC LIMIT 1000`;
          const products=await sql`SELECT id,name,sku,stock,min_stock,unit,cost_price FROM app_products WHERE business_id=${businessId} AND active=TRUE ORDER BY name`;
          return send(res,200,{movements:rows,products});
        }
        if (module === 'recipes') {
          const rows=await sql`SELECT r.*,p.name AS product_name,COALESCE((SELECT json_agg(json_build_object('id',ri.id,'product_id',ri.product_id,'product_name',ip.name,'quantity',ri.quantity,'unit',ri.unit) ORDER BY ip.name) FROM app_recipe_ingredients ri JOIN app_products ip ON ip.business_id=ri.business_id AND ip.id=ri.product_id WHERE ri.business_id=r.business_id AND ri.recipe_id=r.id),'[]'::json) AS ingredients FROM app_recipes r LEFT JOIN app_products p ON p.business_id=r.business_id AND p.id=r.product_id WHERE r.business_id=${businessId} ORDER BY r.name LIMIT 1000`;
          const products=await sql`SELECT id,name,unit,cost_price,stock FROM app_products WHERE business_id=${businessId} AND active=TRUE ORDER BY name`;
          return send(res,200,{recipes:rows,products});
        }
        if (module === 'production') {
          const rows=await sql`SELECT b.*,r.name AS recipe_name,p.name AS product_name FROM app_production_batches b LEFT JOIN app_recipes r ON r.business_id=b.business_id AND r.id=b.recipe_id LEFT JOIN app_products p ON p.business_id=b.business_id AND p.id=COALESCE(b.product_id,r.product_id) WHERE b.business_id=${businessId} ORDER BY b.created_at DESC LIMIT 500`;
          const recipes=await sql`SELECT id,name,product_id,yield_quantity FROM app_recipes WHERE business_id=${businessId} AND active=TRUE ORDER BY name`;
          return send(res,200,{batches:rows,recipes});
        }
        if (module === 'cash') {
          const [sessions,movements]=await Promise.all([
            sql`SELECT * FROM app_cash_sessions WHERE business_id=${businessId} ORDER BY opened_at DESC LIMIT 200`,
            sql`SELECT m.*,s.status AS session_status FROM app_cash_movements m JOIN app_cash_sessions s ON s.business_id=m.business_id AND s.id=m.cash_session_id WHERE m.business_id=${businessId} ORDER BY m.created_at DESC LIMIT 1000`
          ]);
          return send(res,200,{sessions,movements});
        }
        if (module === 'reports') {
          const rows=await sql`SELECT to_char(months.month,'YYYY-MM') AS month,
            (SELECT COALESCE(SUM(s.total),0) FROM app_sales s WHERE s.business_id=${businessId} AND s.status='completed' AND date_trunc('month',s.created_at)=months.month) AS sales,
            (SELECT COALESCE(SUM(i.quantity*i.unit_cost),0) FROM app_sale_items i JOIN app_sales s ON s.business_id=i.business_id AND s.id=i.sale_id WHERE i.business_id=${businessId} AND s.status='completed' AND date_trunc('month',s.created_at)=months.month) AS cost_of_goods,
            (SELECT COALESCE(SUM(e.amount),0) FROM app_financial_entries e WHERE e.business_id=${businessId} AND e.entry_type='expense' AND date_trunc('month',e.created_at)=months.month) AS expenses,
            (SELECT COALESCE(SUM(e.amount),0) FROM app_financial_entries e WHERE e.business_id=${businessId} AND e.entry_type='income' AND lower(e.category) NOT IN ('ventas','venta') AND date_trunc('month',e.created_at)=months.month) AS other_income,
            (SELECT COALESCE(SUM(s.total),0) FROM app_sales s WHERE s.business_id=${businessId} AND s.status='completed' AND date_trunc('month',s.created_at)=months.month)
              +(SELECT COALESCE(SUM(e.amount),0) FROM app_financial_entries e WHERE e.business_id=${businessId} AND e.entry_type='income' AND lower(e.category) NOT IN ('ventas','venta') AND date_trunc('month',e.created_at)=months.month)
              -(SELECT COALESCE(SUM(i.quantity*i.unit_cost),0) FROM app_sale_items i JOIN app_sales s ON s.business_id=i.business_id AND s.id=i.sale_id WHERE i.business_id=${businessId} AND s.status='completed' AND date_trunc('month',s.created_at)=months.month)
              -(SELECT COALESCE(SUM(e.amount),0) FROM app_financial_entries e WHERE e.business_id=${businessId} AND e.entry_type='expense' AND date_trunc('month',e.created_at)=months.month) AS net_profit
            FROM generate_series(date_trunc('month',CURRENT_DATE)-INTERVAL '11 months',date_trunc('month',CURRENT_DATE),INTERVAL '1 month') months(month) ORDER BY months.month`;
          return send(res,200,{months:rows,calculation:'Ventas + otros ingresos - costo histórico de productos vendidos - gastos registrados.'});
        }
      }
      if (req.method === 'POST') {
        if (!canAny(writePermissions[module])) return send(res,403,{error:'No tenés permiso para registrar cambios en este módulo.'});
        if (module === 'products') {
          const name=String(input.name||'').trim().slice(0,120),sku=String(input.sku||'').trim().slice(0,60)||null;
          const salePrice=Number(input.salePrice??0),costPrice=Number(input.costPrice??0),minStock=Number(input.minStock??0);
          if(!name||![salePrice,costPrice,minStock].every(Number.isFinite)||salePrice<0||costPrice<0||minStock<0)return send(res,400,{error:'Datos del producto no válidos.'});
          const rows=await sql`INSERT INTO app_products(business_id,sku,name,category,unit,sale_price,cost_price,stock,min_stock) VALUES(${businessId},${sku},${name},${String(input.category||'').trim().slice(0,80)||null},${String(input.unit||'unidad').trim().slice(0,24)},${salePrice},${costPrice},0,${minStock}) RETURNING *`;
          return send(res,201,{product:rows[0]});
        }
        if (module === 'customers') {
          const name=String(input.name||'').trim().slice(0,120);if(!name)return send(res,400,{error:'Ingresá el nombre del cliente.'});
          const rows=await sql`INSERT INTO app_customers(business_id,name,document,phone,email,address,notes) VALUES(${businessId},${name},${String(input.document||'').trim().slice(0,40)||null},${String(input.phone||'').trim().slice(0,60)||null},${String(input.email||'').trim().slice(0,254)||null},${String(input.address||'').trim().slice(0,250)||null},${String(input.notes||'').trim().slice(0,1000)||null}) RETURNING *`;
          return send(res,201,{customer:rows[0]});
        }
        if (module === 'suppliers') {
          const name=String(input.name||'').trim().slice(0,120);if(!name)return send(res,400,{error:'Ingresá el nombre del proveedor.'});
          const rows=await sql`INSERT INTO app_suppliers(business_id,name,ruc,phone,email,address,notes) VALUES(${businessId},${name},${String(input.ruc||'').trim().slice(0,40)||null},${String(input.phone||'').trim().slice(0,60)||null},${String(input.email||'').trim().slice(0,254)||null},${String(input.address||'').trim().slice(0,250)||null},${String(input.notes||'').trim().slice(0,1000)||null}) RETURNING *`;
          return send(res,201,{supplier:rows[0]});
        }
        if (module === 'inventory') {
          const productId=String(input.productId||''),type=String(input.movementType||''),quantity=Number(input.quantity),unitCost=Number(input.unitCost||0);
          if(!productId||!['entry','exit','adjustment','waste'].includes(type)||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitCost)||unitCost<0)return send(res,400,{error:'Datos de movimiento de inventario no válidos.'});
          const products=await sql`SELECT id,stock FROM app_products WHERE id=${productId} AND business_id=${businessId} LIMIT 1`;
          if(!products.length)return send(res,404,{error:'Producto no encontrado en este negocio.'});
          const oldStock=Number(products[0].stock||0),newStock=type==='entry'?oldStock+quantity:(type==='adjustment'?quantity:oldStock-quantity),movementQuantity=type==='adjustment'?Math.abs(quantity-oldStock):quantity;
          if(newStock<0)return send(res,409,{error:'No hay existencias suficientes para ese movimiento.'});
          if(movementQuantity<=0)return send(res,400,{error:'El ajuste no cambia las existencias actuales.'});
          const rows=await sql`WITH changed AS (UPDATE app_products SET stock=${newStock},cost_price=CASE WHEN (${type}='entry' OR (${type}='adjustment' AND ${newStock}>${oldStock})) AND ${newStock}>0 THEN ((stock*cost_price)+(${movementQuantity}*${unitCost}))/${newStock} ELSE cost_price END,updated_at=NOW() WHERE id=${productId} AND business_id=${businessId} AND (${type} NOT IN ('exit','waste') OR stock>=${quantity}) RETURNING id),
            movement AS (INSERT INTO app_inventory_movements(business_id,product_id,movement_type,quantity,unit_cost,reference,notes,actor_user_id)
              SELECT ${businessId},id,${type},${movementQuantity},${unitCost},${String(input.reference||'').slice(0,120)||null},${String(input.notes||'').slice(0,1000)||null},${user.id} FROM changed RETURNING *)
            SELECT * FROM movement`;
          return send(res,201,{movement:rows[0],stock:newStock});
        }
        if (module === 'sales') {
          const raw=Array.isArray(input.items)?input.items:[];if(!raw.length||raw.length>100)return send(res,400,{error:'Agregá entre 1 y 100 artículos a la venta.'});
          const items=raw.map(item=>({product_id:item.productId?String(item.productId):null,description:String(item.description||'').trim().slice(0,160),quantity:Number(item.quantity),unit_price:Number(item.unitPrice)}));
          if(items.some(item=>!item.description||!Number.isFinite(item.quantity)||item.quantity<=0||!Number.isFinite(item.unit_price)||item.unit_price<0))return send(res,400,{error:'Hay artículos con descripción, cantidad o precio no válidos.'});
          const productIds=[...new Set(items.filter(item=>item.product_id).map(item=>item.product_id))];
          const products=productIds.length?await sql`SELECT id,name,stock,cost_price FROM app_products WHERE business_id=${businessId} AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(productIds)}::jsonb))`:[];
          if(products.length!==productIds.length)return send(res,400,{error:'Uno o más productos no pertenecen a este negocio.'});
          const byId=new Map(products.map(product=>[String(product.id),product]));
          const required=new Map();for(const item of items)if(item.product_id)required.set(item.product_id,(required.get(item.product_id)||0)+item.quantity);
          for(const [id,qty] of required){if(Number(byId.get(id).stock||0)<qty)return send(res,409,{error:'Existencias insuficientes para '+byId.get(id).name+'.'});}
          const customerId=String(input.customerId||'')||null;
          if(customerId){const customer=await sql`SELECT id FROM app_customers WHERE id=${customerId} AND business_id=${businessId} AND active=TRUE LIMIT 1`;if(!customer.length)return send(res,400,{error:'El cliente no pertenece a este negocio o está inactivo.'});}
          const payload=items.map(item=>({...item,unit_cost:item.product_id?Number(byId.get(item.product_id).cost_price||0):0}));
          const subtotal=items.reduce((sum,item)=>sum+item.quantity*item.unit_price,0),discount=Number(input.discount||0);
          if(!Number.isFinite(discount)||discount<0||discount>subtotal)return send(res,400,{error:'El descuento no puede superar el subtotal.'});
          const total=subtotal-discount,saleNumber='VTA-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(2).toString('hex').toUpperCase(),paymentMethod=String(input.paymentMethod||'').slice(0,40)||null;
          const payloadJson=JSON.stringify(payload);
          const rows=await sql`WITH locked_products AS MATERIALIZED (
              SELECT id,stock FROM app_products WHERE business_id=${businessId} AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(productIds)}::jsonb)) FOR UPDATE
            ), stock_check AS (
              SELECT NOT EXISTS (SELECT 1 FROM (SELECT x.product_id::uuid AS product_id,SUM(x.quantity) AS quantity FROM jsonb_to_recordset(${payloadJson}::jsonb) AS x(product_id text,quantity numeric) WHERE x.product_id IS NOT NULL GROUP BY x.product_id) requested
                LEFT JOIN locked_products lp ON lp.id=requested.product_id WHERE lp.id IS NULL OR lp.stock<requested.quantity) AS ok
            ), sale AS (
              INSERT INTO app_sales(business_id,customer_id,sale_number,status,subtotal,discount,total,payment_method,notes,actor_user_id)
              SELECT ${businessId},${customerId},${saleNumber},'completed',${subtotal},${discount},${total},${paymentMethod},${String(input.notes||'').slice(0,1000)||null},${user.id} FROM stock_check WHERE ok RETURNING id
            ), item_rows AS (
              INSERT INTO app_sale_items(business_id,sale_id,product_id,description,quantity,unit_price,unit_cost,line_total)
              SELECT ${businessId},sale.id,NULLIF(x.product_id,'')::uuid,x.description,x.quantity,x.unit_price,x.unit_cost,x.quantity*x.unit_price
              FROM sale CROSS JOIN jsonb_to_recordset(${payloadJson}::jsonb) AS x(product_id text,description text,quantity numeric,unit_price numeric,unit_cost numeric)
              RETURNING product_id,quantity,unit_cost
            ), stock AS (
              UPDATE app_products p SET stock=p.stock-i.quantity,updated_at=NOW() FROM (SELECT product_id,SUM(quantity) AS quantity FROM item_rows WHERE product_id IS NOT NULL GROUP BY product_id) i
              WHERE i.product_id=p.id AND p.business_id=${businessId} RETURNING p.id
            ), movement AS (
              INSERT INTO app_inventory_movements(business_id,product_id,movement_type,quantity,unit_cost,reference,actor_user_id)
              SELECT ${businessId},i.product_id,'exit',i.quantity,i.unit_cost,${saleNumber},${user.id}
              FROM item_rows i WHERE i.product_id IS NOT NULL RETURNING id
            ), cash AS (
              INSERT INTO app_cash_movements(business_id,cash_session_id,movement_type,category,description,amount,payment_method,reference,actor_user_id)
              SELECT ${businessId},cs.id,'income','Ventas','Venta '||${saleNumber},${total},${paymentMethod},${saleNumber},${user.id}
              FROM sale JOIN app_cash_sessions cs ON cs.business_id=${businessId} AND cs.status='open'
              WHERE lower(COALESCE(${paymentMethod},'')) IN ('efectivo','cash') RETURNING id
            )
            SELECT sale.id,stock_check.ok FROM stock_check LEFT JOIN sale ON TRUE`;
          if(!rows[0]?.id)return send(res,409,{error:'No se pudo registrar la venta: el stock cambió o no hay existencias suficientes.'});
          return send(res,201,{saleId:rows[0].id,saleNumber,subtotal,discount,total});
        }
        if (module === 'purchases') {
          const raw=Array.isArray(input.items)?input.items:[];if(!raw.length||raw.length>100)return send(res,400,{error:'Agregá entre 1 y 100 artículos a la compra.'});
          const items=raw.map(item=>({product_id:item.productId?String(item.productId):null,description:String(item.description||'').trim().slice(0,160),quantity:Number(item.quantity),unit_cost:Number(item.unitCost)}));
          if(items.some(item=>!item.description||!Number.isFinite(item.quantity)||item.quantity<=0||!Number.isFinite(item.unit_cost)||item.unit_cost<0))return send(res,400,{error:'Hay artículos con descripción, cantidad o costo no válidos.'});
          const supplierId=String(input.supplierId||'')||null;
          if(supplierId){const supplier=await sql`SELECT id FROM app_suppliers WHERE id=${supplierId} AND business_id=${businessId} AND active=TRUE LIMIT 1`;if(!supplier.length)return send(res,400,{error:'El proveedor no pertenece a este negocio o está inactivo.'});}
          const subtotal=items.reduce((sum,item)=>sum+item.quantity*item.unit_cost,0),purchaseNumber=String(input.documentNumber||'').trim().slice(0,80)||('COMP-'+Date.now().toString(36).toUpperCase());
          const payload=JSON.stringify(items);
          const rows=await sql`WITH purchase AS (
              INSERT INTO app_purchases(business_id,supplier_id,document_number,status,subtotal,total,due_date,notes,actor_user_id)
              VALUES(${businessId},${supplierId},${purchaseNumber},'received',${subtotal},${subtotal},NULLIF(${String(input.dueDate||'')},'')::date,${String(input.notes||'').slice(0,1000)||null},${user.id}) RETURNING id
            ), item_rows AS (
              INSERT INTO app_purchase_items(business_id,purchase_id,product_id,description,quantity,unit_cost,line_total)
              SELECT ${businessId},purchase.id,NULLIF(x.product_id,'')::uuid,x.description,x.quantity,x.unit_cost,x.quantity*x.unit_cost
              FROM purchase CROSS JOIN jsonb_to_recordset(${payload}::jsonb) AS x(product_id text,description text,quantity numeric,unit_cost numeric)
              RETURNING product_id,quantity,unit_cost
            ), stock AS (
              UPDATE app_products p SET stock=p.stock+i.quantity,cost_price=CASE WHEN p.stock+i.quantity>0 THEN ((p.stock*p.cost_price)+(i.quantity*i.unit_cost))/(p.stock+i.quantity) ELSE p.cost_price END,updated_at=NOW()
              FROM (SELECT product_id,SUM(quantity) AS quantity,SUM(quantity*unit_cost)/NULLIF(SUM(quantity),0) AS unit_cost FROM item_rows WHERE product_id IS NOT NULL GROUP BY product_id) i
              WHERE i.product_id=p.id AND p.business_id=${businessId} RETURNING p.id
            ), movement AS (
              INSERT INTO app_inventory_movements(business_id,product_id,movement_type,quantity,unit_cost,reference,actor_user_id)
              SELECT ${businessId},i.product_id,'entry',i.quantity,i.unit_cost,${purchaseNumber},${user.id}
              FROM item_rows i WHERE i.product_id IS NOT NULL RETURNING id
            )
            SELECT purchase.id FROM purchase`;
          if(!rows.length)return send(res,409,{error:'No se pudo registrar la compra.'});
          return send(res,201,{purchaseId:rows[0].id,documentNumber:purchaseNumber,total:subtotal});
        }
        if (module === 'recipes') {
          const name=String(input.name||'').trim().slice(0,120),yieldQuantity=Number(input.yieldQuantity||1),ingredients=Array.isArray(input.ingredients)?input.ingredients:[];
          if(!name||!Number.isFinite(yieldQuantity)||yieldQuantity<=0||!ingredients.length)return send(res,400,{error:'Completá el nombre, rendimiento e ingredientes de la receta.'});
          const normalized=ingredients.map(item=>({product_id:String(item.productId||''),quantity:Number(item.quantity),unit:String(item.unit||'unidad').slice(0,24)}));
          if(normalized.some(item=>!item.product_id||!Number.isFinite(item.quantity)||item.quantity<=0))return send(res,400,{error:'Hay ingredientes no válidos.'});
          const productId=String(input.productId||'')||null,recipeId=crypto.randomUUID();
          const rows=await sql`WITH recipe AS (
              INSERT INTO app_recipes(id,business_id,product_id,name,yield_quantity,instructions)
              VALUES(${recipeId},${businessId},${productId},${name},${yieldQuantity},${String(input.instructions||'').slice(0,3000)||null}) RETURNING id
            ), ingredients AS (
              INSERT INTO app_recipe_ingredients(business_id,recipe_id,product_id,quantity,unit)
              SELECT ${businessId},recipe.id,x.product_id::uuid,x.quantity,x.unit
              FROM recipe CROSS JOIN jsonb_to_recordset(${JSON.stringify(normalized)}::jsonb) AS x(product_id text,quantity numeric,unit text)
              RETURNING id
            )
            SELECT recipe.id FROM recipe`;
          return send(res,201,{recipeId:rows[0].id});
        }
        if (module === 'production') {
          const recipeId=String(input.recipeId||'')||null,productId=String(input.productId||'')||null,planned=Number(input.plannedQuantity);
          if(!Number.isFinite(planned)||planned<=0||(!recipeId&&!productId))return send(res,400,{error:'Seleccioná una receta o producto e ingresá una cantidad válida.'});
          const rows=await sql`INSERT INTO app_production_batches(business_id,recipe_id,product_id,planned_quantity,status,notes,actor_user_id)
            VALUES(${businessId},${recipeId},${productId},${planned},'planned',${String(input.notes||'').slice(0,1000)||null},${user.id}) RETURNING *`;
          return send(res,201,{batch:rows[0]});
        }
        if (module === 'cash') {
          const action=String(input.action||'movement');
          if(action==='open'){
            if(!can('cash.open'))return send(res,403,{error:'No tenés permiso para abrir caja.'});
            const amount=Number(input.openingAmount||0);if(!Number.isFinite(amount)||amount<0)return send(res,400,{error:'Importe inicial no válido.'});
            const rows=await sql`INSERT INTO app_cash_sessions(business_id,opened_by,opening_amount,status)
              SELECT ${businessId},${user.id},${amount},'open'
              WHERE NOT EXISTS(SELECT 1 FROM app_cash_sessions WHERE business_id=${businessId} AND status='open') RETURNING *`;
            if(!rows.length)return send(res,409,{error:'Ya existe una caja abierta para este negocio.'});
            return send(res,201,{session:rows[0]});
          }
          if(action==='movement'){
            if(!can('cash.manage'))return send(res,403,{error:'No tenés permiso para registrar movimientos de caja.'});
            const type=String(input.movementType||''),amount=Number(input.amount);
            if(!['income','expense'].includes(type)||!Number.isFinite(amount)||amount<=0||!String(input.category||'').trim()||!String(input.description||'').trim())return send(res,400,{error:'Completá tipo, categoría, descripción e importe válido.'});
            const session=await sql`SELECT id FROM app_cash_sessions WHERE business_id=${businessId} AND status='open' ORDER BY opened_at DESC LIMIT 1`;
            if(!session.length)return send(res,409,{error:'No hay una caja abierta.'});
            const rows=await sql`WITH movement AS (INSERT INTO app_cash_movements(business_id,cash_session_id,movement_type,category,description,amount,payment_method,reference,actor_user_id)
              VALUES(${businessId},${session[0].id},${type},${String(input.category).trim().slice(0,80)},${String(input.description).trim().slice(0,160)},${amount},${String(input.paymentMethod||'').slice(0,40)||null},${String(input.reference||'').slice(0,120)||null},${user.id}) RETURNING *),
              entry AS (INSERT INTO app_financial_entries(business_id,entry_type,category,description,amount,payment_method,reference,paid_at,actor_user_id)
                SELECT business_id,movement_type,category,description,amount,payment_method,reference,NOW(),actor_user_id FROM movement RETURNING id)
              SELECT * FROM movement`;
            return send(res,201,{movement:rows[0]});
          }
          if(action==='close'){
            if(!can('cash.close'))return send(res,403,{error:'No tenés permiso para cerrar caja.'});
            const sessionId=String(input.sessionId||''),closingAmount=Number(input.closingAmount);
            if(!sessionId||!Number.isFinite(closingAmount)||closingAmount<0)return send(res,400,{error:'Ingresá el importe contado al cerrar la caja.'});
            const rows=await sql`WITH totals AS (
                SELECT COALESCE(SUM(CASE WHEN movement_type='income' THEN amount ELSE -amount END),0) AS net
                FROM app_cash_movements WHERE business_id=${businessId} AND cash_session_id=${sessionId}
              )
              UPDATE app_cash_sessions cs SET status='closed',closed_by=${user.id},closed_at=NOW(),closing_amount=${closingAmount},
                expected_amount=cs.opening_amount+totals.net,difference=${closingAmount}-(cs.opening_amount+totals.net)
              FROM totals WHERE cs.id=${sessionId} AND cs.business_id=${businessId} AND cs.status='open' RETURNING cs.*`;
            if(!rows.length)return send(res,404,{error:'No se encontró una caja abierta para cerrar.'});
            return send(res,200,{session:rows[0]});
          }
          return send(res,400,{error:'Acción de caja no válida.'});
        }
      }
      if (req.method === 'PATCH') {
        const id=String(input.id||'');if(!id)return send(res,400,{error:'Falta el identificador del registro.'});
        if(module==='products'&&can('products.manage')){
          const rows=await sql`UPDATE app_products SET name=COALESCE(NULLIF(${String(input.name||'').trim().slice(0,120)},''),name),sku=CASE WHEN ${input.sku===undefined} THEN sku ELSE NULLIF(${String(input.sku||'').trim().slice(0,60)},'') END,category=CASE WHEN ${input.category===undefined} THEN category ELSE NULLIF(${String(input.category||'').trim().slice(0,80)},'') END,unit=COALESCE(NULLIF(${String(input.unit||'').trim().slice(0,24)},''),unit),sale_price=CASE WHEN ${input.salePrice===undefined} THEN sale_price ELSE ${Number(input.salePrice)} END,cost_price=CASE WHEN ${input.costPrice===undefined} THEN cost_price ELSE ${Number(input.costPrice)} END,min_stock=CASE WHEN ${input.minStock===undefined} THEN min_stock ELSE ${Number(input.minStock)} END,active=CASE WHEN ${typeof input.active==='boolean'} THEN ${input.active} ELSE active END,updated_at=NOW() WHERE id=${id} AND business_id=${businessId} RETURNING *`;
          if(!rows.length)return send(res,404,{error:'Producto no encontrado.'});return send(res,200,{product:rows[0]});
        }
        if(module==='customers'&&can('customers.manage')){
          const rows=await sql`UPDATE app_customers SET name=COALESCE(NULLIF(${String(input.name||'').trim().slice(0,120)},''),name),phone=CASE WHEN ${input.phone===undefined} THEN phone ELSE NULLIF(${String(input.phone||'').slice(0,60)},'') END,email=CASE WHEN ${input.email===undefined} THEN email ELSE NULLIF(${String(input.email||'').slice(0,254)},'') END,active=CASE WHEN ${typeof input.active==='boolean'} THEN ${input.active} ELSE active END,updated_at=NOW() WHERE id=${id} AND business_id=${businessId} RETURNING *`;
          if(!rows.length)return send(res,404,{error:'Cliente no encontrado.'});return send(res,200,{customer:rows[0]});
        }
        if(module==='suppliers'&&can('suppliers.manage')){
          const rows=await sql`UPDATE app_suppliers SET name=COALESCE(NULLIF(${String(input.name||'').trim().slice(0,120)},''),name),phone=CASE WHEN ${input.phone===undefined} THEN phone ELSE NULLIF(${String(input.phone||'').slice(0,60)},'') END,email=CASE WHEN ${input.email===undefined} THEN email ELSE NULLIF(${String(input.email||'').slice(0,254)},'') END,active=CASE WHEN ${typeof input.active==='boolean'} THEN ${input.active} ELSE active END,updated_at=NOW() WHERE id=${id} AND business_id=${businessId} RETURNING *`;
          if(!rows.length)return send(res,404,{error:'Proveedor no encontrado.'});return send(res,200,{supplier:rows[0]});
        }
        if(module==='sales'&&input.action==='cancel'&&can('sales.cancel')){
          const rows=await sql`WITH cancelled AS (UPDATE app_sales SET status='cancelled' WHERE id=${id} AND business_id=${businessId} AND status='completed' RETURNING id,sale_number,total,payment_method),
            items AS (SELECT product_id,SUM(quantity) AS quantity,CASE WHEN SUM(quantity)>0 THEN SUM(quantity*unit_cost)/SUM(quantity) ELSE 0 END AS unit_cost FROM app_sale_items WHERE business_id=${businessId} AND sale_id IN (SELECT id FROM cancelled) AND product_id IS NOT NULL GROUP BY product_id),
            stock AS (UPDATE app_products p SET stock=p.stock+i.quantity,updated_at=NOW() FROM items i WHERE p.id=i.product_id AND p.business_id=${businessId} RETURNING p.id),
            movements AS (INSERT INTO app_inventory_movements(business_id,product_id,movement_type,quantity,unit_cost,reference,actor_user_id) SELECT ${businessId},i.product_id,'entry',i.quantity,i.unit_cost,'Anulación de venta '||${id},${user.id} FROM items i RETURNING id),
            cash_refund AS (INSERT INTO app_cash_movements(business_id,cash_session_id,movement_type,category,description,amount,payment_method,reference,actor_user_id)
              SELECT ${businessId},cs.id,'expense','Anulación de venta','Devolución de venta '||c.sale_number,c.total,c.payment_method,c.sale_number,${user.id}
              FROM cancelled c JOIN app_cash_sessions cs ON cs.business_id=${businessId} AND cs.status='open'
              WHERE lower(COALESCE(c.payment_method,'')) IN ('efectivo','cash') AND c.total>0 RETURNING id)
            SELECT id FROM cancelled`;
          if(!rows.length)return send(res,404,{error:'Venta no encontrada o ya anulada.'});return send(res,200,{ok:true});
        }
        if(module==='purchases'&&input.action==='cancel'&&can('purchases.create')){
          const items=await sql`SELECT i.product_id,SUM(i.quantity) AS quantity,CASE WHEN SUM(i.quantity)>0 THEN SUM(i.quantity*i.unit_cost)/SUM(i.quantity) ELSE 0 END AS unit_cost,p.created_at AS purchase_created_at FROM app_purchase_items i JOIN app_purchases p ON p.business_id=i.business_id AND p.id=i.purchase_id WHERE i.business_id=${businessId} AND i.purchase_id=${id} AND i.product_id IS NOT NULL GROUP BY i.product_id,p.created_at`;
          const productIds=[...new Set(items.map(item=>String(item.product_id)))];
          if(productIds.length){const products=await sql`SELECT id,stock,name FROM app_products WHERE business_id=${businessId} AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(productIds)}::jsonb))`;const available=new Map(products.map(p=>[String(p.id),Number(p.stock||0)]));for(const item of items){if((available.get(String(item.product_id))||0)<Number(item.quantity))return send(res,409,{error:'No se puede anular: el stock comprado ya fue utilizado.'});}
            const used=await sql`SELECT 1 FROM app_inventory_movements m JOIN app_purchases p ON p.business_id=m.business_id AND p.id=${id} WHERE m.business_id=${businessId} AND m.product_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(productIds)}::jsonb)) AND m.created_at>p.created_at AND m.movement_type IN ('exit','waste','adjustment') LIMIT 1`;
            if(used.length)return send(res,409,{error:'No se puede anular esta compra porque hubo ventas, consumos o ajustes posteriores de sus productos.'});}
          const rows=await sql`WITH cancelled AS (UPDATE app_purchases SET status='cancelled' WHERE id=${id} AND business_id=${businessId} AND status='received' RETURNING id),
            purchase_items AS (SELECT product_id,SUM(quantity) AS quantity,CASE WHEN SUM(quantity)>0 THEN SUM(quantity*unit_cost)/SUM(quantity) ELSE 0 END AS unit_cost FROM app_purchase_items WHERE business_id=${businessId} AND purchase_id IN (SELECT id FROM cancelled) AND product_id IS NOT NULL GROUP BY product_id),
            stock AS (UPDATE app_products p SET stock=p.stock-i.quantity,cost_price=CASE WHEN p.stock>i.quantity AND p.stock>0 THEN GREATEST(0,((p.stock*p.cost_price)-(i.quantity*i.unit_cost))/(p.stock-i.quantity)) ELSE 0 END,updated_at=NOW() FROM purchase_items i WHERE p.id=i.product_id AND p.business_id=${businessId} RETURNING p.id),
            movements AS (INSERT INTO app_inventory_movements(business_id,product_id,movement_type,quantity,unit_cost,reference,actor_user_id) SELECT ${businessId},i.product_id,'exit',i.quantity,i.unit_cost,'Anulación de compra '||${id},${user.id} FROM purchase_items i RETURNING id)
            SELECT id FROM cancelled`;
          if(!rows.length)return send(res,404,{error:'Compra no encontrada o ya anulada.'});return send(res,200,{ok:true});
        }
        if(module==='recipes'&&can('recipes.manage')){
          const rows=await sql`UPDATE app_recipes SET name=COALESCE(NULLIF(${String(input.name||'').trim().slice(0,120)},''),name),yield_quantity=CASE WHEN ${input.yieldQuantity===undefined} THEN yield_quantity ELSE ${Number(input.yieldQuantity)} END,instructions=CASE WHEN ${input.instructions===undefined} THEN instructions ELSE NULLIF(${String(input.instructions||'').slice(0,3000)},'') END,active=CASE WHEN ${typeof input.active==='boolean'} THEN ${input.active} ELSE active END,updated_at=NOW() WHERE id=${id} AND business_id=${businessId} RETURNING *`;
          if(!rows.length)return send(res,404,{error:'Receta no encontrada.'});return send(res,200,{recipe:rows[0]});
        }
        if(module==='production'&&can('production.manage')){
          if(input.action==='complete'){
            const produced=Number(input.producedQuantity),waste=Number(input.wasteQuantity||0),consumed=produced+waste;
            if(!Number.isFinite(produced)||produced<=0||!Number.isFinite(waste)||waste<0)return send(res,400,{error:'Ingresá cantidades producidas y de merma válidas.'});
            const batchCheck=await sql`SELECT b.id,COALESCE(b.product_id,r.product_id) AS product_id FROM app_production_batches b LEFT JOIN app_recipes r ON r.business_id=b.business_id AND r.id=b.recipe_id WHERE b.id=${id} AND b.business_id=${businessId} AND b.status IN ('planned','in_progress') LIMIT 1`;
            if(!batchCheck.length)return send(res,404,{error:'Lote no encontrado o ya finalizado.'});
            if(!batchCheck[0].product_id)return send(res,400,{error:'El lote no tiene un producto de salida asociado.'});
            const rows=await sql`WITH batch AS MATERIALIZED (
                SELECT b.id,b.business_id,b.recipe_id,COALESCE(b.product_id,r.product_id) AS product_id,COALESCE(r.yield_quantity,1) AS yield_quantity
                FROM app_production_batches b LEFT JOIN app_recipes r ON r.business_id=b.business_id AND r.id=b.recipe_id
                WHERE b.id=${id} AND b.business_id=${businessId} AND b.status IN ('planned','in_progress') FOR UPDATE OF b
              ), ingredient_need AS MATERIALIZED (
                SELECT ri.product_id,SUM(ri.quantity*(${consumed}/NULLIF(batch.yield_quantity,0))) AS quantity
                FROM batch JOIN app_recipe_ingredients ri ON ri.business_id=batch.business_id AND ri.recipe_id=batch.recipe_id
                GROUP BY ri.product_id
              ), locked_products AS MATERIALIZED (
                SELECT p.id,p.stock,p.cost_price FROM app_products p JOIN ingredient_need i ON i.product_id=p.id
                WHERE p.business_id=${businessId} FOR UPDATE OF p
              ), stock_check AS (
                SELECT EXISTS(SELECT 1 FROM batch WHERE product_id IS NOT NULL)
                  AND NOT EXISTS(SELECT 1 FROM ingredient_need i LEFT JOIN locked_products lp ON lp.id=i.product_id WHERE lp.id IS NULL OR lp.stock<i.quantity)
                  AND NOT EXISTS(SELECT 1 FROM ingredient_need i WHERE i.product_id=(SELECT product_id FROM batch)) AS ok
              ), consumed_rows AS (
                UPDATE app_products p SET stock=p.stock-i.quantity,updated_at=NOW()
                FROM ingredient_need i,locked_products lp,stock_check sc
                WHERE p.id=i.product_id AND p.business_id=${businessId} AND lp.id=p.id AND sc.ok
                RETURNING p.id,i.quantity,p.cost_price
              ), output_product AS (
                UPDATE app_products p SET stock=p.stock+${produced},cost_price=CASE WHEN p.stock+${produced}>0
                  THEN ((p.stock*p.cost_price)+COALESCE((SELECT SUM(c.quantity*c.cost_price) FROM consumed_rows c),0))/(p.stock+${produced})
                  ELSE p.cost_price END,updated_at=NOW()
                FROM batch,stock_check sc WHERE p.id=batch.product_id AND p.business_id=${businessId} AND sc.ok RETURNING p.id
              ), batch_done AS (
                UPDATE app_production_batches b SET status='completed',produced_quantity=${produced},waste_quantity=${waste},
                  started_at=COALESCE(started_at,NOW()),completed_at=NOW()
                FROM batch,stock_check sc WHERE b.id=batch.id AND sc.ok RETURNING b.id
              ), consumption_movements AS (
                INSERT INTO app_inventory_movements(business_id,product_id,movement_type,quantity,unit_cost,reference,actor_user_id)
                SELECT ${businessId},c.id,'exit',c.quantity,c.cost_price,'Producción '||${id},${user.id} FROM consumed_rows c RETURNING id
              ), output_movements AS (
                INSERT INTO app_inventory_movements(business_id,product_id,movement_type,quantity,unit_cost,reference,actor_user_id)
                SELECT ${businessId},o.id,'entry',${produced},COALESCE((SELECT SUM(c.quantity*c.cost_price) FROM consumed_rows c)/NULLIF(${produced},0),0),'Producción '||${id},${user.id}
                FROM output_product o RETURNING id
              )
              SELECT stock_check.ok,batch_done.id FROM stock_check LEFT JOIN batch_done ON TRUE`;
            if(!rows[0]?.ok)return send(res,409,{error:'No hay stock suficiente de ingredientes o el producto de salida no es válido.'});
            if(!rows[0]?.id)return send(res,409,{error:'No se pudo finalizar el lote.'});
            return send(res,200,{ok:true,batchId:rows[0].id,producedQuantity:produced,wasteQuantity:waste});
          }
          const status=String(input.status||'');if(!['in_progress','cancelled'].includes(status))return send(res,400,{error:'Estado de producción no válido.'});
          const rows=await sql`UPDATE app_production_batches SET status=${status},started_at=CASE WHEN ${status}='in_progress' THEN COALESCE(started_at,NOW()) ELSE started_at END WHERE id=${id} AND business_id=${businessId} AND status IN ('planned','in_progress') RETURNING *`;
          if(!rows.length)return send(res,404,{error:'Lote no encontrado o ya finalizado.'});return send(res,200,{batch:rows[0]});
        }
        return send(res,403,{error:'No tenés permiso para modificar este registro.'});
      }
      if (req.method === 'DELETE') {
        const id=String(input.id||'');if(!id)return send(res,400,{error:'Falta el identificador del registro.'});
        if(module==='products'&&can('products.manage')){const rows=await sql`UPDATE app_products SET active=FALSE,updated_at=NOW() WHERE id=${id} AND business_id=${businessId} RETURNING id`;return send(res,rows.length?200:404,{ok:rows.length>0});}
        if(module==='customers'&&can('customers.manage')){const rows=await sql`UPDATE app_customers SET active=FALSE,updated_at=NOW() WHERE id=${id} AND business_id=${businessId} RETURNING id`;return send(res,rows.length?200:404,{ok:rows.length>0});}
        if(module==='suppliers'&&can('suppliers.manage')){const rows=await sql`UPDATE app_suppliers SET active=FALSE,updated_at=NOW() WHERE id=${id} AND business_id=${businessId} RETURNING id`;return send(res,rows.length?200:404,{ok:rows.length>0});}
        if(module==='recipes'&&can('recipes.manage')){const rows=await sql`UPDATE app_recipes SET active=FALSE,updated_at=NOW() WHERE id=${id} AND business_id=${businessId} RETURNING id`;return send(res,rows.length?200:404,{ok:rows.length>0});}
        return send(res,403,{error:'No tenés permiso para eliminar este registro.'});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/business/employee-data') {
      const user = await authenticated(req,res,false); if (!user) return;
      if (user.is_platform_admin === true || user.role !== 'employee' || !user.business_id)
        return send(res,403,{error:'Este servicio está reservado para cuentas de empleado vinculadas a un negocio.'});
      const permissions = user.permissions && typeof user.permissions === 'object' && !Array.isArray(user.permissions) ? user.permissions : {};
      const can = key => permissions[key] === true;
      const canAny = keys => keys.some(can);
      const sql = db();
      const moduleRows=await sql`SELECT bc.modules AS configured_modules,lic.modules AS licensed_modules FROM app_business_config bc
        LEFT JOIN LATERAL (SELECT l.modules FROM app_licenses l WHERE l.business_id=bc.business_id AND LOWER(BTRIM(l.system_name))=LOWER(BTRIM(${String(process.env.LICENSE_SYSTEM_NAME||'Mattsystem')})) ORDER BY (l.status='active' AND (l.expires_at IS NULL OR l.expires_at>=CURRENT_DATE)) DESC,l.created_at DESC LIMIT 1) lic ON TRUE
        WHERE bc.business_id=${user.business_id} LIMIT 1`;
      const configured=moduleRows[0]?.configured_modules,licensed=moduleRows[0]?.licensed_modules;
      const enabledModules=Array.isArray(configured)?(Array.isArray(licensed)?configured.filter(key=>licensed.includes(key)):configured):null;
      const moduleEnabled=key=>!Array.isArray(enabledModules)||enabledModules.includes(key);
      if (req.method === 'GET') {
        const rows = await sql`SELECT st.data,st.updated_at,b.id AS business_id,b.name AS business_name,b.address AS business_address,b.phone AS business_phone,b.email AS business_email,b.ruc AS business_ruc,b.owner_name AS business_owner
          FROM businesses b LEFT JOIN app_state st ON st.business_id=b.id
          WHERE b.id=${user.business_id} AND b.active=TRUE LIMIT 1`;
        if (!rows.length) return send(res,404,{error:'El negocio no está disponible.'});
        const source = rows[0].data && typeof rows[0].data === 'object' && !Array.isArray(rows[0].data) ? rows[0].data : {};
        const data = { business:{id:rows[0].business_id,name:rows[0].business_name,address:rows[0].business_address||'',phone:rows[0].business_phone||'',email:rows[0].business_email||'',ruc:rows[0].business_ruc||'',owner:rows[0].business_owner||''} };
        if (moduleEnabled('invoices') && canAny(['sales.view','sales.create','sales.cancel','reports.view'])) data.invoices = can('sales.view') || can('reports.view') ? (Array.isArray(source.invoices)?source.invoices:[]) : [];
        if (moduleEnabled('products') && canAny(['products.view','products.manage','inventory.view','inventory.manage','reports.view'])) data.products = Array.isArray(source.products)?source.products:[];
        if (moduleEnabled('movements') && canAny(['cash.view','cash.manage','reports.view'])) data.movements = Array.isArray(source.movements)?source.movements:[];
        if (moduleEnabled('inventory') && canAny(['inventory.view','inventory.manage','reports.view'])) data.productMovements = Array.isArray(source.productMovements)?source.productMovements:[];
        if (moduleEnabled('customers') && canAny(['customers.view','customers.manage'])) data.customers = Array.isArray(source.customers)?source.customers:[];
        if (moduleEnabled('suppliers') && canAny(['suppliers.view','suppliers.manage'])) data.suppliers = Array.isArray(source.suppliers)?source.suppliers:[];
        if (moduleEnabled('purchases') && canAny(['purchases.view','purchases.create','reports.view'])) data.purchases = Array.isArray(source.purchases)?source.purchases:[];
        if (moduleEnabled('recipes') && canAny(['recipes.view','recipes.manage'])) data.recipes = Array.isArray(source.recipes)?source.recipes:[];
        if (moduleEnabled('production') && canAny(['production.view','production.manage'])) data.productionBatches = Array.isArray(source.productionBatches)?source.productionBatches:[];
        if (moduleEnabled('reports') && canAny(['reports.view'])) {
          data.categories = source.categories && typeof source.categories === 'object' ? source.categories : {};
          data.paymentMethods = Array.isArray(source.paymentMethods)?source.paymentMethods:[];
        }
        return send(res,200,{data,updatedAt:rows[0].updated_at||null},{'Cache-Control':'no-store, max-age=0'});
      }
      if (req.method === 'PUT') {
        const input = body(req);
        if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data)) return send(res,400,{error:'No se recibieron datos válidos.'});
        const incoming = input.data;
        if (Buffer.byteLength(JSON.stringify(incoming),'utf8') > 900000) return send(res,413,{error:'El volumen de datos supera el límite permitido.'});
        const currentRows = await sql`SELECT data FROM app_state WHERE business_id=${user.business_id} LIMIT 1`;
        const current = currentRows[0]?.data && typeof currentRows[0].data === 'object' && !Array.isArray(currentRows[0].data) ? currentRows[0].data : {};
        const next = {...current};
        const savedFields = [];
        const appendOnly = key => {
          const oldItems = Array.isArray(current[key]) ? current[key] : [];
          const seen = new Set(oldItems.map(item=>String(item?.id||'')));
          const additions = [];
          for (const item of (Array.isArray(incoming[key]) ? incoming[key] : [])) {
            const id = String(item?.id || '');
            if (item && id && !seen.has(id)) { seen.add(id); additions.push(item); }
          }
          if (additions.length) { next[key] = oldItems.concat(additions); savedFields.push(key); }
        };
        if (moduleEnabled('invoices') && can('sales.create')) appendOnly('invoices');
        if (moduleEnabled('invoices') && can('sales.cancel') && Array.isArray(incoming.invoices)) {
          const requested = new Set(incoming.invoices.filter(item=>item && item.status==='cancelled').map(item=>String(item.id||'')));
          const oldItems = Array.isArray(next.invoices) ? next.invoices : (Array.isArray(current.invoices)?current.invoices:[]);
          let changed = false;
          next.invoices = oldItems.map(item => {
            if (requested.has(String(item?.id||'')) && item?.status !== 'cancelled') { changed=true; return {...item,status:'cancelled'}; }
            return item;
          });
          if (changed) { if (!savedFields.includes('invoices')) savedFields.push('invoices'); }
        }
        if (moduleEnabled('products') && can('products.manage') && Array.isArray(incoming.products)) {
          next.products = incoming.products.filter(item=>item&&String(item.name||'').trim()).slice(0,5000);
          savedFields.push('products');
        }
        if (moduleEnabled('movements') && can('cash.manage')) appendOnly('movements');
        if (moduleEnabled('inventory') && can('inventory.manage')) appendOnly('productMovements');
        if (moduleEnabled('customers') && can('customers.manage') && Array.isArray(incoming.customers)) { next.customers=incoming.customers.filter(item=>item&&String(item.name||'').trim()).slice(0,5000); savedFields.push('customers'); }
        if (moduleEnabled('suppliers') && can('suppliers.manage') && Array.isArray(incoming.suppliers)) { next.suppliers=incoming.suppliers.filter(item=>item&&String(item.name||'').trim()).slice(0,2000); savedFields.push('suppliers'); }
        if (moduleEnabled('purchases') && can('purchases.create')) appendOnly('purchases');
        if (moduleEnabled('recipes') && can('recipes.manage') && Array.isArray(incoming.recipes)) { next.recipes=incoming.recipes.filter(item=>item&&String(item.name||'').trim()).slice(0,2000); savedFields.push('recipes'); }
        if (moduleEnabled('production') && can('production.manage')) appendOnly('productionBatches');
        if (!savedFields.length) return send(res,403,{error:'Tu cuenta no tiene permisos de escritura para los cambios enviados.'});
        const serialized = JSON.stringify(next);
        const saved = await sql`INSERT INTO app_state(data,updated_by,business_id,updated_at) VALUES(${serialized}::jsonb,${user.id},${user.business_id},NOW())
          ON CONFLICT(business_id) DO UPDATE SET data=EXCLUDED.data,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING updated_at`;
        await sql`INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details,ip_address)
          VALUES(${user.business_id},${user.id},'employee.data_updated','business_data',${user.business_id},${JSON.stringify({savedFields})}::jsonb,${req.headers['x-forwarded-for']?.split(',')[0]?.trim()||null})`;
        return send(res,200,{ok:true,savedFields,updatedAt:saved[0]?.updated_at||null});
      }
      return send(res,405,{error:'Método no permitido.'});
    }
    if (path === '/api/data' && req.method === 'GET' && new URL(req.url, `https://${req.headers.host || 'localhost'}`).searchParams.has('catalogBusinessId')) {
      const businessId=String(new URL(req.url, `https://${req.headers.host || 'localhost'}`).searchParams.get('catalogBusinessId')||'').trim();
      if(!businessId) return send(res,400,{error:'Falta identificar el negocio.'});
      const sql=db();
      const rows=await sql`SELECT b.id,b.name,b.address,b.phone,st.data,st.updated_at FROM businesses b LEFT JOIN app_state st ON st.business_id=b.id WHERE b.id=${businessId} AND b.active=TRUE LIMIT 1`;
      if(!rows.length) return send(res,404,{error:'No se encontró un negocio activa.'});
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
      if(!businessId) return send(res,400,{error:'No hay un negocio asignado a esta cuenta.'});
      // [deploy] Los empleados no pueden leer ni reemplazar el estado operativo completo.
      // Hasta que exista un modelo de operaciones individuales con autorización por módulo,
      // se aplica denegación por defecto para evitar escalar permisos manipulando /api/data.
      if(user.is_platform_admin!==true && user.role!=='supervisor')
        return send(res,403,{error:'Tu cuenta de empleado no tiene acceso directo a los datos generales. Solicitá al Supervisor los permisos o una operación habilitada.'});
      const allowed=await sql`SELECT id FROM businesses WHERE id=${businessId} AND active=TRUE LIMIT 1`;
      if(!allowed.length) return send(res,404,{error:'El negocio seleccionado no existe o está inactiva.'});
      let enabledBusinessModules=null;
      if(user.is_platform_admin!==true){
        const moduleRows=await sql`SELECT bc.modules AS configured_modules,lic.modules AS licensed_modules
          FROM app_business_config bc
          LEFT JOIN LATERAL (SELECT l.modules FROM app_licenses l WHERE l.business_id=bc.business_id AND LOWER(BTRIM(l.system_name))=LOWER(BTRIM(${String(process.env.LICENSE_SYSTEM_NAME||'Mattsystem')})) ORDER BY (l.status='active' AND (l.expires_at IS NULL OR l.expires_at>=CURRENT_DATE)) DESC,l.created_at DESC LIMIT 1) lic ON TRUE
          WHERE bc.business_id=${businessId} LIMIT 1`;
        if(Array.isArray(moduleRows[0]?.configured_modules)){
          const configured=moduleRows[0].configured_modules,licensed=moduleRows[0].licensed_modules;
          enabledBusinessModules=Array.isArray(licensed)?configured.filter(key=>licensed.includes(key)):configured;
        }
      }
      const moduleEnabled=key=>!Array.isArray(enabledBusinessModules)||enabledBusinessModules.includes(key);
      if(req.method==='GET'){
        const rows=await sql`SELECT st.data,st.updated_at,b.id AS business_id,b.name AS business_name,b.address AS business_address,b.phone AS business_phone,b.email AS business_email,b.ruc AS business_ruc,b.owner_name AS business_owner FROM app_state st JOIN businesses b ON b.id=st.business_id WHERE st.business_id=${businessId} LIMIT 1`;
        if(!rows.length)return send(res,200,{data:null,updatedAt:null},{'Cache-Control':'no-store, max-age=0'});
        const row=rows[0], data=row.data&&typeof row.data==='object'?row.data:{};
        // El registro businesses es la fuente principal de identidad del negocio.
        // Los datos operativos (productos, facturas, movimientos) permanecen en app_state.
        data.business={...(data.business&&typeof data.business==='object'?data.business:{}),id:row.business_id,name:row.business_name,address:row.business_address||'',phone:row.business_phone||'',email:row.business_email||'',ruc:row.business_ruc||'',owner:row.business_owner||''};
        const visibleData={...data};
        const fieldsByModule={movements:['movements','categories','paymentMethods'],invoices:['invoices'],products:['products'],inventory:['productMovements'],customers:['customers'],suppliers:['suppliers'],purchases:['purchases'],recipes:['recipes'],production:['productionBatches'],employees:['employees','employeePayments']};
        for(const [moduleKey,fields] of Object.entries(fieldsByModule))if(!moduleEnabled(moduleKey))for(const field of fields)delete visibleData[field];
        if(!moduleEnabled('movements')&&!moduleEnabled('invoices')){delete visibleData.categories;delete visibleData.paymentMethods;}
        return send(res,200,{data:visibleData,updatedAt:row.updated_at},{'Cache-Control':'no-store, max-age=0'});
      }
      if(req.method==='PUT'){
        const input=body(req); if(!input.data||typeof input.data!=='object'||Array.isArray(input.data)) return send(res,400,{error:'No se recibieron datos válidos.'});
        const data={...input.data}; delete data.users;
        if(Array.isArray(enabledBusinessModules)){
          const currentRows=await sql`SELECT data FROM app_state WHERE business_id=${businessId} LIMIT 1`;
          const current=currentRows[0]?.data&&typeof currentRows[0].data==='object'&&!Array.isArray(currentRows[0].data)?currentRows[0].data:{};
          const fieldsByModule={movements:['movements'],invoices:['invoices'],products:['products'],inventory:['productMovements'],customers:['customers'],suppliers:['suppliers'],purchases:['purchases'],recipes:['recipes'],production:['productionBatches'],employees:['employees','employeePayments']};
          for(const [moduleKey,fields] of Object.entries(fieldsByModule))if(!moduleEnabled(moduleKey))for(const field of fields){if(Object.prototype.hasOwnProperty.call(current,field))data[field]=current[field];else delete data[field];}
          if(!moduleEnabled('movements')&&!moduleEnabled('invoices'))for(const field of ['categories','paymentMethods']){if(Object.prototype.hasOwnProperty.call(current,field))data[field]=current[field];else delete data[field];}
        }
        const serialized=JSON.stringify(data);
        if(Buffer.byteLength(serialized,'utf8')>900000) return send(res,413,{error:'El volumen de datos supera el límite permitido.'});
        const saved=await sql`INSERT INTO app_state(data,updated_by,business_id,updated_at) VALUES(${serialized}::jsonb,${user.id},${businessId},NOW()) ON CONFLICT(business_id) DO UPDATE SET data=EXCLUDED.data,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING updated_at`;
        if(user.is_platform_admin!==true){
          const biz=await sql`SELECT name FROM businesses WHERE id=${businessId} LIMIT 1`;
          const title='Actividad en '+(biz[0]?.name||'un negocio');
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
      if (constraint.includes('businesses_slug')) return send(res,409,{error:'Ya existe un negocio con un nombre similar. Cambiá el nombre e intentá nuevamente.'});
      if (constraint.includes('app_users_email')) return send(res,409,{error:'Ya existe un usuario con ese correo.'});
      return send(res,409,{error:'Ya existe un registro con esos datos. Revisá los campos e intentá nuevamente.'});
    }
    console.error('API error:',err);
    return send(res,500,{error:'No se pudo completar la solicitud. Verificá la conexión de la base de datos.'});
  }
};
