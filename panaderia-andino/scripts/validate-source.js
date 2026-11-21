'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const requireContract = (condition, message) => {
  if (!condition) throw new Error('Falla de seguridad/funcionalidad: ' + message);
};

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'api/[...path].js',
  'app.bundle.html',
  'employee-access.js',
  'js/runtime-enhancements.js',
  'erp-modules.js',
  'manifest.webmanifest',
  'vercel.json',
  'sw.js',
  'migrations/004_platform_settings_trials_permissions.sql',
  'migrations/005_platform_support_settings.sql',
  'migrations/006_operational_integrity_and_tenant_constraints.sql',
  'migrations/007_employee_license_limit_guard.sql',
  'migrations/009_signed_tenant_context.sql',
  'migrations/010_auth_admin_rls.sql',
  'migrations/011_runtime_role_set_option.sql',
];

for (const relative of requiredFiles) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) throw new Error('Falta el archivo requerido: ' + relative);
}

const redundantApiEntrypoints = ["api/business/erp.js","api/business/license.js","api/business/employee-data.js","api/business/users.js","api/licenses/activate.js","api/admin/licenses.js","api/admin/licenses/trial.js","api/admin/license-payments.js","api/admin/overview.js","api/admin/clients.js","api/admin/notifications.js","api/admin/security.js","api/admin/support-settings.js","api/admin/trash.js","api/admin/activity.js","api/notification-preferences.js","api/notifications.js","api/support.js","api/support/tickets.js","api/support/tickets/reply.js"];
requireContract(redundantApiEntrypoints.every(file => !fs.existsSync(path.join(root,file))), 'las rutas API deben centralizarse para respetar el máximo de 12 funciones de Vercel Hobby.');

const apiPath = path.join(root, 'api/[...path].js');
new vm.Script(fs.readFileSync(apiPath, 'utf8'), { filename: apiPath });

const employeePath = path.join(root, 'employee-access.js');
new vm.Script(fs.readFileSync(employeePath, 'utf8'), { filename: employeePath });
const runtimeEnhancementsPath = path.join(root, 'js/runtime-enhancements.js');
new vm.Script(fs.readFileSync(runtimeEnhancementsPath, 'utf8'), { filename: runtimeEnhancementsPath });

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
const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
requireContract(Array.isArray(vercelConfig.rewrites) && vercelConfig.rewrites.some(rule => rule.source === "/api/:first/:rest+" && String(rule.destination).includes("__route_path")), "Vercel debe reenviar rutas API anidadas a la función central sin crear funciones adicionales.");
requireContract(Array.isArray(vercelConfig.headers) && vercelConfig.headers.some(rule => rule.source === "/(.*)" && ["X-Content-Type-Options","X-Frame-Options","Referrer-Policy","Strict-Transport-Security","Permissions-Policy"].every(key => rule.headers.some(header => header.key === key))), "todas las respuestas deben incluir encabezados HTTP de seguridad del navegador.");

if (!html.includes('/employee-access.js')) throw new Error('La interfaz no carga el módulo de cuentas de empleados.');
if (!html.includes('/js/runtime-enhancements.js')) throw new Error('La interfaz no carga el diagnóstico de conexión y mejoras responsive.');
if (!html.includes('/erp-modules.js')) throw new Error('La interfaz no carga los módulos ERP.');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
new vm.Script(serviceWorker, { filename: path.join(root, 'sw.js') });
if (!serviceWorker.includes("'/employee-access.js'") || !serviceWorker.includes("'/erp-modules.js'") || !serviceWorker.includes("'/js/runtime-enhancements.js'")) throw new Error('La caché PWA no incluye todos los módulos JavaScript.');
if (!fs.readFileSync(apiPath, 'utf8').includes('/api/business/employee-data')) {
  throw new Error('No está implementado el endpoint de datos con permisos para empleados.');
}


const apiSource = fs.readFileSync(apiPath, 'utf8');
requireContract(apiSource.includes("searchParams.get('__route_path')") && apiSource.includes('routedPath.startsWith(routePrefix + \'/\')'), 'la API debe validar el prefijo antes de aceptar la ruta anidada reenviada.');
const employeeAccessPath = path.join(root, 'employee-access.js');
const employeeAccess = fs.readFileSync(employeeAccessPath, 'utf8');
new vm.Script(employeeAccess, { filename: employeeAccessPath });
const dashboardPath = path.join(root, 'js/dashboard.js');
const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');
new vm.Script(dashboardSource, { filename: dashboardPath });
const erpPath = path.join(root, 'erp-modules.js');
const erpSource = fs.readFileSync(erpPath, 'utf8');
new vm.Script(erpSource, { filename: erpPath });

// RLS: el contexto PostgreSQL debe estar firmado con HMAC y no puede confiar en GUC manipulables.
const signedContextMigration = fs.readFileSync(path.join(root, 'migrations/009_signed_tenant_context.sql'), 'utf8');
requireContract(apiSource.includes('TENANT_CONTEXT_SECRET') && apiSource.includes('app.context_signature') && apiSource.includes("crypto.createHmac('sha256'"), 'el contexto de tenant enviado a PostgreSQL debe estar firmado con HMAC.');
const runtimeRoleMigration = fs.readFileSync(path.join(root, 'migrations/011_runtime_role_set_option.sql'), 'utf8');
requireContract(apiSource.includes("set_config('role', 'mattsystem_app', true)") && runtimeRoleMigration.includes('SET TRUE') && runtimeRoleMigration.includes('mattsystem_app'), 'cada transacción autenticada debe cambiar al rol PostgreSQL sin BYPASSRLS antes de consultar datos del negocio.');
requireContract(signedContextMigration.includes('tenant_context_is_valid') && signedContextMigration.includes('public.hmac') && signedContextMigration.includes('SECURITY DEFINER'), 'PostgreSQL debe verificar la firma HMAC antes de confiar en el contexto RLS.');
const rlsRoleMigration = fs.readFileSync(path.join(root, 'migrations/008_tenant_rls_enforcement.sql'), 'utf8');
requireContract(rlsRoleMigration.includes('CREATE ROLE mattsystem_app NOLOGIN NOSUPERUSER NOBYPASSRLS') && rlsRoleMigration.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES') && rlsRoleMigration.includes('WITH INHERIT FALSE, SET TRUE'), 'la migración RLS debe crear el rol de mínimo privilegio, conceder solo permisos operativos y permitir SET ROLE transaccional.');
requireContract(rlsRoleMigration.includes('role_is_unsafe') && !rlsRoleMigration.includes('ALTER ROLE mattsystem_app') && rlsRoleMigration.includes('CREATE ROLE mattsystem_app NOLOGIN NOSUPERUSER NOBYPASSRLS'), 'la migración debe validar el rol sin requerir privilegios SUPERUSER para ALTER ROLE.');
requireContract(signedContextMigration.includes('REVOKE ALL ON app_private.tenant_context_secret FROM PUBLIC, mattsystem_app'), 'el rol de aplicación no debe poder leer el secreto HMAC.');
const authRlsMigration = fs.readFileSync(path.join(root, 'migrations/010_auth_admin_rls.sql'), 'utf8');
requireContract(authRlsMigration.includes('app_auth_user_by_id') && authRlsMigration.includes('app_auth_user_by_email') && authRlsMigration.includes('SECURITY DEFINER'), 'el login y la sesión deben consultar identidad mediante funciones protegidas.');
requireContract(authRlsMigration.includes('ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY') && authRlsMigration.includes('ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY') && authRlsMigration.includes('ALTER TABLE public.app_licenses ENABLE ROW LEVEL SECURITY'), 'usuarios, negocios y licencias deben tener RLS habilitado.');
requireContract(authRlsMigration.includes('ALTER TABLE public.app_admin_setup_tokens ENABLE ROW LEVEL SECURITY') && authRlsMigration.includes('ALTER TABLE public.admin_password_resets ENABLE ROW LEVEL SECURITY') && authRlsMigration.includes('ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY'), 'tokens y esquema interno deben quedar cerrados al rol de aplicación.');
requireContract(apiSource.includes('app_auth_user_by_id') && apiSource.includes('app_auth_user_by_email') && apiSource.includes('app_auth_claim_setup_token'), 'las rutas de autenticación deben utilizar funciones protegidas y no leer tablas sensibles directamente.');

// Sesiones: firma segura, cookie HttpOnly/Secure y revocación por session_version.
requireContract(/HttpOnly; Secure; SameSite=Lax/.test(apiSource), 'la cookie de sesión debe ser HttpOnly, Secure y SameSite=Lax.');
requireContract(/Number\(user\.session_version\s*\|\|\s*0\)\s*===\s*Number\(data\.sv\s*\|\|\s*0\)/.test(apiSource), 'la sesión debe validar session_version.');
requireContract(/\/api\/admin\/database-info[\s\S]{0,350}?authenticated\(req,res,true\)/.test(apiSource), 'el diagnóstico de base de datos debe usar autenticación de administrador y respetar revocaciones.');
const bootstrapStart = apiSource.indexOf("if (path === '/api/auth/bootstrap' && req.method === 'POST')");
const bootstrapEnd = apiSource.indexOf("if (path === '/api/auth/login'", bootstrapStart);
const bootstrapBlock = bootstrapStart >= 0 && bootstrapEnd > bootstrapStart ? apiSource.slice(bootstrapStart, bootstrapEnd) : '';
const sessionSecretCheck = bootstrapBlock.indexOf("secret('SESSION_SECRET')");
const setupTokenClaim = bootstrapBlock.indexOf('app_auth_claim_setup_token');
requireContract(sessionSecretCheck >= 0 && setupTokenClaim > sessionSecretCheck, 'el alta inicial debe validar SESSION_SECRET antes de consumir el token.');
requireContract(/app_auth_claim_setup_token[\s\S]{0,450}?requestContext\.enterWith\(\{ businessId:'', userId:id, isPlatformAdmin:true \}\)[\s\S]{0,250}?INSERT INTO app_users/.test(apiSource), 'el alta inicial debe firmar el contexto de administrador antes de insertar la primera cuenta.');

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

const businessCreateStart = apiSource.indexOf("if (path === '/api/admin/businesses') {");
const businessCreateEnd = apiSource.indexOf("if (path === '/api/admin/clients')", businessCreateStart);
const businessCreateBlock = businessCreateStart >= 0 && businessCreateEnd > businessCreateStart ? apiSource.slice(businessCreateStart, businessCreateEnd) : ''; 
const businessPostStart = businessCreateBlock.indexOf("if(req.method==='POST'){");
const businessPostEnd = businessCreateBlock.indexOf("if(req.method==='PATCH')", businessPostStart);
const businessPostBlock = businessPostStart >= 0 && businessPostEnd > businessPostStart ? businessCreateBlock.slice(businessPostStart, businessPostEnd) : '';
requireContract(!!businessPostBlock && !businessPostBlock.includes('INSERT INTO app_licenses'), 'crear un negocio no debe generar ni asignar una licencia automáticamente.');
requireContract(html.includes('El negocio se crea sin licencia') && html.includes('Crear licencia comercial') && html.includes('Iniciar prueba gratuita'), 'la administración debe separar alta de negocio, licencia comercial y prueba gratuita.');
requireContract(html.includes("businessLicenseNav.hidden = user.isPlatformAdmin === true || !['admin','supervisor'].includes(user.role)") && html.includes('id="page-licencia"'), 'el apartado Plan y licencia debe estar visible para las cuentas de negocio y oculto al administrador de plataforma sin negocio seleccionado.');
requireContract(/!\['admin','supervisor'\]\.includes\(user\.role\)/.test(apiSource) && !apiSource.includes('code:license.license_code'), 'los datos económicos y el código de licencia no deben exponerse a empleados ni cuentas no autorizadas.');
requireContract(apiSource.includes("const canViewBusinessLicense = u => u.is_platform_admin !== true && ['admin','supervisor'].includes(u.role)") && apiSource.includes('code:canViewBusinessLicense(u) ? (u.license_code || null) : null') && apiSource.includes("code: ['admin','supervisor'].includes(user.role) ? (user.license_code || null) : null"), 'las respuestas de sesión y licencia inactiva deben ocultar código, vencimiento y límites a los empleados.');
requireContract(/setup_amount,monthly_amount,billing_day,contract_reference/.test(apiSource) && /setupAmount:Number\(license\.setup_amount\|\|0\)/.test(apiSource) && /monthlyAmount:Number\(license\.monthly_amount\|\|0\)/.test(apiSource), 'la cuenta del cliente debe recibir los importes, día de facturación y referencia contractual de su licencia.');
requireContract(html.includes('Costo de instalación') && html.includes('Abono mensual') && html.includes('Día de facturación') && html.includes('Referencia de contrato'), 'el apartado Plan y licencia debe mostrar las condiciones económicas y contractuales vigentes.');
requireContract(html.includes('mattsystem-connection-status') && html.includes('min-height:44px') && html.includes('font-size:16px') && html.includes('@media(max-width:767.98px)'), 'la interfaz debe incluir estado de servidor y controles accesibles adaptados a móviles.');
requireContract(runtimeEnhancementsPath && fs.readFileSync(runtimeEnhancementsPath,'utf8').includes("const CHECK_URL = '/api/auth/status'") && fs.readFileSync(runtimeEnhancementsPath,'utf8').includes('AbortController'), 'la conexión con el servidor debe verificarse con timeout y sin almacenar respuestas privadas en caché.');
requireContract(apiSource.includes("if (path === '/api/business/erp')") && erpSource.includes("'/api/business/erp?module='"), 'la interfaz ERP debe estar conectada a su ruta autenticada del servidor.');
requireContract(serviceWorker.includes("mattsystem-pwa-v9") && serviceWorker.includes("'/erp-modules.js'") && serviceWorker.includes("'/js/runtime-enhancements.js'"), 'el despliegue debe invalidar la caché PWA anterior y precargar las mejoras responsive y de conexión.');

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
requireContract((apiSource.includes('ORDER BY l.created_at DESC, l.id DESC') || authRlsMigration.includes('ORDER BY l.created_at DESC,l.id DESC')) && (authRlsMigration.match(/ORDER BY l.created_at DESC,l.id DESC/g)||[]).length>=2, 'la licencia más reciente debe ser la autoridad para evitar reactivar licencias antiguas suspendidas o vencidas.');
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
