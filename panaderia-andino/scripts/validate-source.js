'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'api/[...path].js',
  'app.bundle.html',
  'employee-access.js',
  'erp-modules.js',
  'manifest.webmanifest',
  'vercel.json',
  'sw.js',
  'migrations/004_platform_settings_trials_permissions.sql',
  'migrations/005_platform_support_settings.sql',
  'migrations/006_operational_integrity_and_tenant_constraints.sql',
  'migrations/007_employee_license_limit_guard.sql',
  'api/business/erp.js',
  'api/business/license.js',
  'api/business/employee-data.js',
  'api/business/users.js',
  'api/licenses/activate.js',
  'api/admin/licenses.js',
  'api/admin/licenses/trial.js',
  'api/admin/license-payments.js',
  'api/admin/overview.js',
  'api/admin/clients.js',
  'api/admin/notifications.js',
  'api/admin/security.js',
  'api/admin/support-settings.js',
  'api/admin/trash.js',
  'api/admin/activity.js',
  'api/notification-preferences.js',
  'api/notifications.js',
  'api/support.js',
  'api/support/tickets.js',
  'api/support/tickets/reply.js'
];

for (const relative of requiredFiles) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) throw new Error('Falta el archivo requerido: ' + relative);
}

const apiPath = path.join(root, 'api/[...path].js');
new vm.Script(fs.readFileSync(apiPath, 'utf8'), { filename: apiPath });

const employeePath = path.join(root, 'employee-access.js');
new vm.Script(fs.readFileSync(employeePath, 'utf8'), { filename: employeePath });

const htmlPath = path.join(root, 'app.bundle.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\bsrc\s*=/i.test(match[1]))
  .map(match => match[2]);

if (!inlineScripts.length) throw new Error('No se encontraron scripts de aplicación para validar.');
inlineScripts.forEach((source, index) => {
  new vm.Script(source, { filename: 'app.bundle.html:inline-script-' + (index + 1) });
});

for (const relative of ['manifest.webmanifest', 'vercel.json']) {
  JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}

if (!html.includes('/employee-access.js')) throw new Error('La interfaz no carga el módulo de cuentas de empleados.');
if (!html.includes('/erp-modules.js')) throw new Error('La interfaz no carga los módulos ERP.');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
new vm.Script(serviceWorker, { filename: path.join(root, 'sw.js') });
if (!serviceWorker.includes("'/employee-access.js'") || !serviceWorker.includes("'/erp-modules.js'")) throw new Error('La caché PWA no incluye todos los módulos JavaScript.');
if (!fs.readFileSync(apiPath, 'utf8').includes('/api/business/employee-data')) {
  throw new Error('No está implementado el endpoint de datos con permisos para empleados.');
}


const apiSource = fs.readFileSync(apiPath, 'utf8');
const employeeAccessPath = path.join(root, 'employee-access.js');
const employeeAccess = fs.readFileSync(employeeAccessPath, 'utf8');
new vm.Script(employeeAccess, { filename: employeeAccessPath });
const dashboardPath = path.join(root, 'js/dashboard.js');
const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');
new vm.Script(dashboardSource, { filename: dashboardPath });
const erpPath = path.join(root, 'erp-modules.js');
const erpSource = fs.readFileSync(erpPath, 'utf8');
new vm.Script(erpSource, { filename: erpPath });
const requireContract = (condition, message) => {
  if (!condition) throw new Error('Falla de seguridad/funcionalidad: ' + message);
};

// Sesiones: firma segura, cookie HttpOnly/Secure y revocación por session_version.
requireContract(/HttpOnly; Secure; SameSite=Lax/.test(apiSource), 'la cookie de sesión debe ser HttpOnly, Secure y SameSite=Lax.');
requireContract(/Number\(user\.session_version\s*\|\|\s*0\)\s*===\s*Number\(data\.sv\s*\|\|\s*0\)/.test(apiSource), 'la sesión debe validar session_version.');
requireContract(/\/api\/admin\/database-info[\s\S]{0,350}?authenticated\(req,res,true\)/.test(apiSource), 'el diagnóstico de base de datos debe usar autenticación de administrador y respetar revocaciones.');
requireContract(/\/api\/auth\/bootstrap[\s\S]{0,300}?secret\('SESSION_SECRET'\)[\s\S]{0,900}?UPDATE app_admin_setup_tokens/.test(apiSource), 'el alta inicial debe validar SESSION_SECRET antes de consumir el token.');

// Roles: solo supervisor administra empleados; empleado queda restringido a su cuenta y permisos.
requireContract(/user\.role\s*!==\s*'supervisor'\s*\|\|\s*!user\.business_id/.test(apiSource), 'la gestión de empleados debe quedar reservada al supervisor del negocio.');
requireContract(apiSource.includes('WHERE business_id=${user.business_id}') && apiSource.includes('is_platform_admin=FALSE AND role=\'employee\''), 'la lista de empleados debe limitarse al negocio autenticado.');
requireContract(/user\.role\s*!==\s*'employee'\s*\|\|\s*!user\.business_id/.test(apiSource), 'los datos de empleado deben validar rol y negocio.');
requireContract(/user\.role!=='supervisor'/.test(apiSource), 'los empleados no deben usar el endpoint general de datos del negocio.');

// Aislamiento multiempresa: los usuarios no administradores no pueden elegir el business_id del request.
requireContract(/const businessId = user\.is_platform_admin === true \? String\(req\.headers\['x-business-id'\] \|\| ''\) : String\(user\.business_id \|\| ''\)/.test(apiSource), 'el negocio debe derivarse de la sesión para usuarios de negocio.');
requireContract(/WHERE b\.id=\$\{user\.business_id\} AND b\.active=TRUE/.test(apiSource) && /LEFT JOIN app_state st ON st\.business_id=b\.id/.test(apiSource), 'la lectura de estado de empleado debe estar limitada por business_id.');
requireContract(/WHERE id=\$\{productId\} AND business_id=\$\{businessId\}/.test(apiSource), 'las operaciones ERP deben comprobar pertenencia del producto al negocio.');
requireContract(/WHERE s\.business_id=\$\{businessId\}/.test(apiSource), 'las consultas de ventas deben estar aisladas por negocio.');

// El supervisor es el administrador operativo del negocio; la cuenta de plataforma sigue separada.
requireContract(/!\['admin','supervisor'\]\.includes\(user\.role\).*#configuracion/.test(html), 'el supervisor debe poder abrir la configuración del negocio.');
requireContract(/Solo el Supervisor o Administrador del negocio puede eliminar pagos/.test(html), 'los controles de pagos deben reconocer al supervisor.');
requireContract(html.includes('isPlatformAdmin !== true && ![\'admin\',\'supervisor\'].includes'), 'las acciones de negocio no deben confundirse con el administrador de plataforma.');


// Integridad operativa y confidencialidad financiera por permiso.
requireContract(/FOR UPDATE/.test(apiSource.slice(apiSource.indexOf("if (module === 'inventory')", apiSource.indexOf("if (req.method === 'POST')")))), 'los movimientos de inventario deben bloquear la fila y calcular el stock dentro de la transacción.');
requireContract(/CASE WHEN \$\{can\('products\.view'\) \|\| can\('reports\.view'\)\} THEN i\.unit_cost ELSE NULL END/.test(apiSource), 'el coste de artículos vendidos debe ocultarse a empleados sin permiso financiero.');
requireContract(/CASE WHEN \$\{canSeeCosts\} THEN m\.unit_cost ELSE NULL END/.test(apiSource), 'el coste de movimientos de inventario debe respetar permisos.');
requireContract(/CASE WHEN \$\{canSeeCosts\} THEN cost_price ELSE NULL END AS cost_price/.test(apiSource), 'los productos asociados a recetas no deben revelar costes sin permiso.');
requireContract(/const \{cost_price,\.\.\.safeProduct\}=product/.test(apiSource), 'el endpoint de empleado debe ocultar costes de producto sin permiso.');

requireContract(/open_cash AS MATERIALIZED[\s\S]{0,250}?FOR UPDATE/.test(apiSource), 'las ventas en efectivo deben reservar una caja abierta de forma concurrente.');
requireContract(/EXISTS\(SELECT 1 FROM open_cash\)/.test(apiSource), 'no deben registrarse ventas en efectivo sin caja abierta.');
requireContract(/refund_entry AS \(INSERT INTO app_financial_entries/.test(apiSource), 'la anulación de una venta en efectivo debe quedar reflejada en los informes financieros.');

// Un permiso de operación no concede automáticamente acceso al historial financiero.
requireContract(apiSource.includes("purchases:['purchases.view']"), 'el historial de compras requiere purchases.view.');
requireContract(/if \(canAny\(\['purchases\.view','reports\.view'\]\)\) data\.purchases/.test(apiSource), 'los empleados sin permiso de consulta no deben recibir el historial de compras.');
requireContract(/if \(canAny\(\['cash\.view','reports\.view'\]\)\) data\.movements/.test(apiSource), 'los empleados sin permiso de consulta no deben recibir el historial de caja.');
requireContract(/can\('cash\.view'\)\s*\?\s*sql`SELECT \* FROM app_cash_sessions[\s\S]{0,220}?status='open'/.test(apiSource), 'sin cash.view solo se puede consultar la sesión abierta necesaria para operar.');
requireContract(/purchases:\{title:'Compras',read:\['purchases\.view'\]/.test(erpSource), 'la interfaz debe separar registrar compras de consultar su historial.');
requireContract(erpSource.includes("const canView=allowed('cash.view')"), 'la interfaz debe ocultar el historial de caja sin cash.view.');

// Activación de licencias: autenticación vigente, rol autorizado, pertenencia al negocio y límite de intentos.
requireContract(/path===\'\/api\/licenses\/activate\'[\s\S]{0,900}?currentUser\(req\)/.test(apiSource), 'la activación de licencia debe exigir una sesión autenticada.');
requireContract(/user\.is_platform_admin===true\|\|!user\.business_id\|\|!\['admin','supervisor'\]\.includes\(user\.role\)/.test(apiSource), 'solo el administrador o supervisor del negocio puede activar la licencia.');
requireContract(/business_id=\$\{user\.business_id\}[\s\S]{0,220}?UPPER\(BTRIM\(license_code\)\)=\$\{code\}/.test(apiSource), 'el código debe pertenecer al negocio autenticado.');
requireContract(/is_trial=FALSE AND status IN \('pending','active','expired'\)/.test(apiSource), 'la activación no debe convertir una prueba gratuita, suspensión o cancelación en licencia comercial.');
requireContract(apiSource.includes("path==='/api/admin/licenses/trial'") && apiSource.includes("'license.trial_started'") && !apiSource.includes('const startTrial='), 'la prueba gratuita debe iniciarse desde una acción administrativa independiente, nunca al crear el negocio.');
requireContract(apiSource.includes("path==='/api/business/license'") && apiSource.includes('trialStartedAt:license.trial_started_at'), 'la cuenta del negocio debe poder consultar su plan y vigencia aun cuando la licencia haya vencido.');
requireContract(html.includes('id="page-licencia"') && html.includes('businessLicenseActivationForm') && html.includes('id="businessLicenseNav"'), 'el cliente debe tener un apartado permanente para consultar y activar su licencia.');
requireContract(html.includes('id="licenseStartTrial"') && html.includes("/api/admin/licenses/trial") && !html.includes('simpleStartTrial'), 'el inicio de prueba gratuita debe estar separado del alta del negocio y de la creación de licencia comercial.');
requireContract(apiSource.includes("attemptKey='license:'+user.id") && apiSource.includes('app_login_attempts'), 'los intentos de activación deben tener protección contra fuerza bruta.');
requireContract(html.includes('function showLicenseActivation') && html.includes('/api/licenses/activate'), 'el usuario debe poder ingresar su licencia después del inicio de sesión.');
requireContract(/showLicenseActivation\(user, messages\[status\]/.test(html), 'una licencia vencida o pendiente debe mostrar la pantalla de activación, no volver al login.');
requireContract(/Solo el administrador o supervisor del negocio puede activar la licencia/.test(html), 'los empleados deben ser dirigidos a su supervisor para activar la licencia.');

requireContract(html.includes("const link = event.target.closest('[data-page-link=\"erp\"]')") && html.includes("pageNavigate('erp')"), 'la navegación al módulo ERP agregado dinámicamente debe funcionar mediante delegación de eventos.');
requireContract(apiSource.includes('WITH active_license AS') && apiSource.includes('employee_rows AS') && apiSource.includes('employee_count AS'), 'la consulta del límite de empleados debe resolverse en una sola consulta a Neon.');
const employeeLimitMigration = fs.readFileSync(path.join(root, 'migrations/007_employee_license_limit_guard.sql'), 'utf8');
requireContract(employeeLimitMigration.includes('active_employee_count') && employeeLimitMigration.includes('employee_license_limit_reached') && employeeLimitMigration.includes('app_users_employee_license_limit'), 'la base debe aplicar el límite de empleados incluso ante altas concurrentes.');
requireContract(apiSource.includes("plan==='basic'?1:(plan==='professional'?4:null)"), 'los planes deben conservar sus límites de empleados definidos.');
requireContract(apiSource.includes('user_limit,device_limit') && apiSource.includes('${userLimit},${deviceLimit}'), 'cada licencia nueva debe guardar sus límites efectivos.');
requireContract(!/if\(req\.method==='GET'\)\{\s*await sql`UPDATE app_licenses/.test(apiSource), 'consultar licencias no debe modificar datos.');
requireContract(apiSource.includes('LICENSE_SYSTEM_NAME') && apiSource.includes('licenseSystem.toLowerCase()'), 'la activación debe usar el mismo identificador de producto que el inicio de sesión.');
requireContract(apiSource.split('ORDER BY l.created_at DESC, l.id DESC').length - 1 >= 2, 'la licencia más reciente debe ser la autoridad para evitar reactivar licencias antiguas suspendidas o vencidas.');
requireContract(employeeAccess.includes("setTimeout(resolve, 900)") && employeeAccess.includes("transient"), 'la consulta de empleados debe reintentar fallos transitorios de conexión una sola vez.');
requireContract(employeeAccess.includes("error.message || 'Revisá la conexión"), 'la pantalla debe mostrar el error real de consulta en lugar de un mensaje genérico.');
const integrityMigration = fs.readFileSync(path.join(root, 'migrations/006_operational_integrity_and_tenant_constraints.sql'), 'utf8');
requireContract((integrityMigration.match(/VALIDATE CONSTRAINT/g) || []).length >= 6, 'las seis relaciones compuestas entre negocios deben quedar validadas.');
requireContract(/CREATE UNIQUE INDEX IF NOT EXISTS app_cash_sessions_one_open_per_business/.test(integrityMigration), 'la base debe impedir más de una caja abierta por negocio.');
requireContract(apiSource.includes("input.action==='change_plan'") && apiSource.includes('dataPreserved:true'), 'la actualización de plan debe conservar el negocio y sus datos.');
requireContract(apiSource.includes('/^\\d{4}-\\d{2}-\\d{2}$/'), 'la creación de licencias debe aceptar y validar fechas ISO YYYY-MM-DD.');
requireContract(html.includes('/(\\d+)$/'), 'la numeración de facturas debe detectar el sufijo numérico para evitar repetir el correlativo.');
requireContract(employeeLimitMigration.includes('active_employee_count < v_limit'), 'la base debe impedir superar el límite de empleados por concurrencia.');
requireContract(!apiSource.includes("if(!businessId){const first=await sql"), 'una operación destructiva nunca debe elegir automáticamente el primer negocio.');
requireContract(apiSource.includes('expectedUpdatedAt') && apiSource.includes('DATA_VERSION_CONFLICT') && apiSource.includes('IS NOT DISTINCT FROM'), 'las escrituras de datos compartidos deben rechazar actualizaciones obsoletas.');
requireContract(apiSource.includes('Seleccioná explícitamente el negocio que querés administrar.') && !apiSource.includes("if(user.is_platform_admin===true&&!businessId)"), 'el administrador de plataforma debe seleccionar el negocio y nunca operar por defecto sobre el primero.');
requireContract(dashboardSource.includes('expectedUpdatedAt: cloudUpdatedAt') && dashboardSource.includes("error.code === 'DATA_VERSION_CONFLICT'"), 'el cliente debe enviar la versión actual y proteger los cambios locales ante conflictos.');

requireContract(apiSource.includes("La limpieza integral está temporalmente deshabilitada"), 'la limpieza de datos incompleta debe permanecer bloqueada hasta ser transaccional.');
requireContract(html.includes('Limpieza integral temporalmente deshabilitada') && html.includes('disabled title="La limpieza integral'), 'la interfaz no debe ofrecer una limpieza parcial como si fuera integral.');
requireContract(!fs.readFileSync(path.join(root, 'js/auth.js'), 'utf8').includes('Negocios Andino'), 'el acceso debe utilizar la marca Mattsystem y no el nombre anterior.');
requireContract(!fs.readFileSync(path.join(root, 'js/dashboard.js'), 'utf8').includes('Negocios Andino'), 'el panel y sus exportaciones deben utilizar la marca Mattsystem.');

process.stdout.write('Validación estática correcta: API, interfaz, permisos de empleados y JSON.\n');
