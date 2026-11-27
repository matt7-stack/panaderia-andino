'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'api/[...path].js',
  'api/business/receivables.js',
  'api/admin/business-addons.js',
  'app.bundle.html',
  'operations-tools.js',
  'admin-nav.js',
  'employee-access.js',
  'erp-modules.js',
  'migrations/009_optional_receivables_addon.sql',
  'migrations/013_receivables_idempotency.sql',
  'migrations/014_expand_industry_templates.sql',
  'migrations/015_receivables_payment_idempotency_guard.sql',
  'migrations/016_receivables_direct_debt_link.sql',
  'migrations/024_branches_delivery.sql',
  'migrations/025_default_branch_on_business_create.sql',
  'migrations/027_admin_private_finance_notes.sql',
  'migrations/028_query_performance_indexes.sql',
  'migrations/029_tenant_rls_runtime_backups_ip_throttle.sql',
  'migrations/030_supervisor_employee_rls.sql',
  'migrations/031_login_rate_limit_rls.sql',
  'migrations/032_login_ip_rls_compatibility.sql',
  'migrations/036_employee_offboarding.sql',
  'migrations/037_license_write_restrictions.sql',
  'migrations/038_platform_managed_entitlements.sql',
  'migrations/039_owner_supervisor_employee_rls.sql',
  'migrations/040_employee_offboarding_rejection.sql',
  'migrations/041_user_scoped_notifications_rls.sql',
  'migrations/043_multiple_expiry_alert_days.sql',
  'migrations/044_web_push_subscriptions.sql',
  'migrations/045_api_global_rate_limits.sql',
  'migrations/046_license_catalog_branches_delivery.sql',
  'migrations/047_license_plan_device_limits.sql',
  'migrations/048_industry_library_templates.sql',
  'migrations/052_versioned_releases.sql',
  'migrations/055_version_acknowledgement_guards.sql',
  'migrations/056_device_registration_and_limits.sql',
  'manifest.webmanifest',
  'vercel.json',
  'sw.js'
];

for (const relative of requiredFiles) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) throw new Error('Falta el archivo requerido: ' + relative);
}

for (const relative of ['api/[...path].js','api/business/receivables.js','api/admin/business-addons.js','admin-nav.js','employee-access.js','erp-modules.js','operations-tools.js','business-improvements.js']) {
  const absolute = path.join(root, relative);
  new vm.Script(fs.readFileSync(absolute, 'utf8'), { filename: absolute });
}

const apiPath = path.join(root, 'api/[...path].js');
const receivablesApiPath = path.join(root, 'api/business/receivables.js');
const addonsApiPath = path.join(root, 'api/admin/business-addons.js');
const erpPath = path.join(root, 'erp-modules.js');
const receivablesMigrationPath = path.join(root, 'migrations/015_receivables_payment_idempotency_guard.sql');

const htmlPath = path.join(root, 'app.bundle.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const operationsToolsSource = fs.readFileSync(path.join(root, 'operations-tools.js'), 'utf8');
const serviceWorkerSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
if (!html.includes('<script src="/operations-tools.js?v=2" defer></script>') ||
    !serviceWorkerSource.includes("'/operations-tools.js?v=2'") ||
    !serviceWorkerSource.includes("mattsystem-pwa-v24")) {
  throw new Error('Las herramientas del negocio deben cargarse y quedar disponibles en la caché PWA sin conexión.');
}
for (const marker of ["task_create","task_status","attachment_add","import_rows","mattsystem_tools_cache_v2:","mattsystem-offline-tools","addEventListener('online',syncQueue)","nav.hidden=!currentUser","scopeKey:scope","idb.all(scope)","xlsx-0.20.3","file.size>5*1024*1024","window.PanaderiaAuth?window.PanaderiaAuth.user:currentUser","cache=emptyCache();throw error","canViewAttachments()","canAddAttachment()","importTargets()"]) {
  if (!operationsToolsSource.includes(marker)) throw new Error('Falta una función de herramientas del negocio o sincronización: ' + marker);
}
const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\bsrc\s*=/i.test(match[1]))
  .map(match => match[2]);

if (!inlineScripts.length) throw new Error('No se encontraron scripts de aplicación para validar.');
inlineScripts.forEach((source, index) => {
  new vm.Script(source, { filename: 'app.bundle.html:inline-script-' + (index + 1) });
});

const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const securityHeaders = vercelConfig.headers?.[0]?.headers || [];
const cspReportOnly = securityHeaders.find(header => header.key === 'Content-Security-Policy-Report-Only')?.value || '';
if (!cspReportOnly.includes("default-src 'self'") ||
    !cspReportOnly.includes("frame-ancestors 'none'") ||
    !cspReportOnly.includes("script-src 'self'") ||
    !cspReportOnly.includes('https://cdn.jsdelivr.net')) {
  throw new Error('Falta una política CSP en modo Report-Only para medir compatibilidad antes de endurecer la política aplicada.');
}
for (const relative of ['manifest.webmanifest', 'vercel.json']) {
  JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}
const apiSource = fs.readFileSync(apiPath, 'utf8');
if (!apiSource.includes("path === '/api/business/tools'") ||
    !apiSource.includes("role==='admin'}::boolean OR role='employee'") ||
    !apiSource.includes("'business.tools.import_rows'") ||
    !apiSource.includes("nextTools.tasks[index].assignedToUserId||'')!==String(user.id)")) {
  throw new Error('Las herramientas deben validar el rol, limitar responsables y auditar las importaciones.');
}
if (!apiSource.includes("canViewAttachments,canAddAttachment,importTargets") ||
    !apiSource.includes("const canAddAttachment=moduleEnabled('movements')") ||
    !apiSource.includes("const importTargets=manager?")) {
  throw new Error('La API debe exponer capacidades según licencia y permisos para ocultar acciones no autorizadas.');
}
if (!apiSource.includes("WHERE app_state.updated_at IS NOT DISTINCT FROM") ||
    !apiSource.includes("fileBytes.subarray(0,5).toString('ascii')==='%PDF-'") ||
    !apiSource.includes("configured.filter(key=>key==='dashboard')") ||
    !apiSource.includes("const [orders,customers,products,branches,events]") ||
    !apiSource.includes("input.name===undefined}::boolean") ||
    !apiSource.includes("input.address===undefined}::boolean") ||
    !apiSource.includes("input.phone===undefined}::boolean") ||
    !apiSource.includes("input.managerName===undefined}::boolean") ||
    !apiSource.includes("typeof input.active==='boolean'}::boolean")) {
  throw new Error('La API debe evitar sobrescrituras concurrentes, validar archivos, respetar módulos y tipar condiciones SQL.');
}
if (!html.includes('id="businessDevicesPanel"') && !html.includes("id='businessDevicesPanel'")) {
  throw new Error('El panel de licencia debe permitir al dueño revisar y revocar dispositivos autorizados.');
}
if (!html.includes("api('/api/business/devices')") ||
    !html.includes('data-revoke-device') ||
    !html.includes('loadBusinessDevices()')) {
  throw new Error('La interfaz del dueño debe consultar y revocar dispositivos mediante la API protegida.');
}
const deviceMigration = fs.readFileSync(path.join(root, 'migrations/056_device_registration_and_limits.sql'), 'utf8');
if (!apiSource.includes('user_limit,device_limit,modules,annual_discount_percent,permanent_price,full_sale_price,module_prices,updated_at')) {
  throw new Error('La respuesta al guardar planes debe devolver el límite de dispositivos actualizado.');
}
if (!apiSource.includes('device_limit,modules,module_prices FROM app_license_plan_settings') ||
    !apiSource.includes('planModulePrices[module.module_key]')) {
  throw new Error('La emisión de licencias debe calcular los módulos extra con los precios definidos para ese plan.');
}
if (!apiSource.includes('device_limit,modules,module_prices FROM app_license_plan_settings') ||
    !apiSource.includes('planRows[0].device_limit') ||
    apiSource.includes("SELECT device_limit FROM app_license_settings WHERE setting_key='default'")) {
  throw new Error('La emisión de licencias debe heredar el límite de dispositivos del plan seleccionado; NULL representa ilimitado.');
}
if (!apiSource.includes('ROW_NUMBER() OVER(ORDER BY last_seen_at DESC,first_seen_at ASC,id ASC)') ||
    !apiSource.includes('device_rank<=${Number(user.device_limit)}') ||
    !apiSource.includes('Revalidar el dispositivo en cada petición')) {
  throw new Error('Las sesiones ya abiertas deben respetar revocaciones y reducciones del límite de dispositivos.');
}
if (!deviceMigration.includes('app_device_registrations') ||
    !deviceMigration.includes('ENABLE ROW LEVEL SECURITY') ||
    !deviceMigration.includes('FORCE ROW LEVEL SECURITY') ||
    !deviceMigration.includes('mattsystem_devices_select') ||
    !deviceMigration.includes('UNIQUE (business_id, device_hash)') ||
    !apiSource.includes('deviceTokenCookie(req)') ||
    !apiSource.includes('app_device_registrations') ||
    !apiSource.includes('DEVICE_LIMIT_REACHED') ||
    !apiSource.includes("path==='/api/business/devices'") ||
    !apiSource.includes("user.role!=='admin'") ||
    !apiSource.includes('deviceTokenCookieHeader(issuedDeviceToken)')) {
  throw new Error('El límite de dispositivos debe registrarse por negocio, aplicarse al iniciar sesión y permitir revocación segura por el dueño.');
}

const authSource = fs.readFileSync(path.join(root, 'js/auth.js'), 'utf8');
if (!apiSource.includes("code:'EXPECTED_VERSION_REQUIRED'") ||
    !apiSource.includes("code:'DATA_VERSION_CONFLICT'") ||
    !apiSource.includes("WHERE app_state.updated_at IS NOT DISTINCT FROM ${expectedUpdatedAt}") ||
    !html.includes('expectedUpdatedAt: cloudUpdatedAt') ||
    !html.includes("localStorage.setItem(STORAGE_KEY + '_conflict_backup'") ||
    !html.includes("cloudConflict || cloudSaving") ||
    !authSource.includes("error.code === 'DATA_VERSION_CONFLICT'")) {
  throw new Error('El guardado general debe usar control de concurrencia optimista y conservar los cambios locales ante un conflicto.');
}
if (operationsToolsSource.includes('mattsystem_tools_cache_v1') ||
    operationsToolsSource.includes('window.PanaderiaAuth?.user||currentUser')) {
  throw new Error('La caché offline no debe reutilizar datos antiguos ni conservar el usuario anterior tras cerrar sesión.');
}
if (operationsToolsSource.includes('xlsx@0.18.5') ||
    !operationsToolsSource.includes('xlsx-0.20.3/package/dist/xlsx.full.min.js')) {
  throw new Error('La importación Excel debe usar la versión oficial actualizada de SheetJS.');
}
const csvParserMatch = operationsToolsSource.match(/const parseCSV = text => \{([\s\S]*?)\n  \};/);
if (!csvParserMatch) throw new Error('No se encontró el lector CSV.');
const parseCSV = new Function('text', csvParserMatch[1]);
const semicolonCsv = parseCSV('nombre;importe;concepto\nPanadería;100000;"Venta; mostrador"');
if (semicolonCsv.length !== 1 || semicolonCsv[0].importe !== '100000' || semicolonCsv[0].concepto !== 'Venta; mostrador') {
  throw new Error('El lector CSV debe interpretar separadores regionales y campos entre comillas.');
}
const commaCsv = parseCSV('name,amount\nPan,100000');
if (commaCsv.length !== 1 || commaCsv[0].amount !== '100000') throw new Error('El lector CSV debe admitir archivos separados por coma.');

const uncastBooleanCase = [...apiSource.matchAll(/CASE WHEN \$\{([^}]+)\}(?=\s*(?:THEN|AND|OR))/g)];
if (uncastBooleanCase.length) {
  throw new Error('Todas las condiciones CASE parametrizadas deben declarar el tipo booleano para evitar errores SQL 42P18.');
}
const securityMigration = fs.readFileSync(path.join(root, 'migrations/029_tenant_rls_runtime_backups_ip_throttle.sql'), 'utf8');
if (!apiSource.includes('DATABASE_URL_RUNTIME || process.env.DATABASE_URL') ||
    !apiSource.includes('raw.transaction([contextQuery(context), query])') ||
    !apiSource.includes('runWithRequestContext: callback => requestContext.run({}, callback)') ||
    !apiSource.includes("!['GET','HEAD','OPTIONS'].includes(requestMethod) && !sameOrigin(req)") ||
    !apiSource.includes("const address = String(req.headers['x-real-ip'] || '').trim()") ||
    !apiSource.includes("set_config('app.ip_hash'")) {
  throw new Error('La API debe usar el rol de ejecución, contexto de negocio, CSRF global y límites de intentos por IP.');
}
if (!securityMigration.includes('ENABLE ROW LEVEL SECURITY') ||
    !securityMigration.includes('FORCE ROW LEVEL SECURITY') ||
    !securityMigration.includes('app_current_business_id') ||
    !securityMigration.includes('mattsystem_users_select') ||
    !securityMigration.includes('mattsystem_support_replies_select') ||
    !fs.readFileSync(path.join(root, 'migrations/030_supervisor_employee_rls.sql'), 'utf8').includes('app_can_manage_employees') ||
    !fs.readFileSync(path.join(root, 'migrations/031_login_rate_limit_rls.sql'), 'utf8').includes('mattsystem_login_ip_attempts_scope')) {
  throw new Error('Falta la migración de aislamiento RLS por negocio y permisos del supervisor.');
}
if (!apiSource.includes("path === '/api/business/backups'") ||
    !apiSource.includes("path === '/api/internal/backup'") ||
    !apiSource.includes('app_login_ip_attempts') ||
    !apiSource.includes("encode(digest(convert_to(payload::text,'UTF8'),'sha256'),'hex')")) {
  throw new Error('Faltan los endpoints de copia/restauración, respaldo automático o control de intentos por IP.');
}
for (const relative of ['api/business/receivables.js','api/admin/business-addons.js']) {
  const specializedSource = fs.readFileSync(path.join(root, relative), 'utf8');
  if (!specializedSource.includes('runWithRequestContext') || !specializedSource.includes('core._internal.sameOrigin(req)')) {
    throw new Error('La ruta especializada debe ejecutar consultas dentro del contexto de seguridad: ' + relative);
  }
}
if (!html.includes('id="adminBackupList"') ||
    !html.includes('id="refreshAdminBackups"') ||
    !html.includes('data-restore-backup')) {
  throw new Error('Falta la interfaz de historial y restauración de copias de seguridad.');
}
const deploymentConfig = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const backupSchedules = deploymentConfig.schedules || {};
const backupCron = (deploymentConfig.crons || []).some(item => item.path === '/api/internal/backup' && item.schedule === '0 5 * * *');
const securityHeaders = deploymentConfig.headers.find(item => item.source === '/(.*)')?.headers || [];
const cspValue = securityHeaders.find(item => item.key === 'Content-Security-Policy')?.value || '';
if (!cspValue.includes("form-action 'self'") || !cspValue.includes('upgrade-insecure-requests')) {
  throw new Error('La política CSP debe limitar el envío de formularios y forzar recursos HTTPS.');
}
if (!backupCron && (!backupSchedules['mattsystem-daily-backup'] || backupSchedules['mattsystem-daily-backup'].path !== '/api/internal/backup' || backupSchedules['mattsystem-daily-backup'].schedule !== '0 2 * * *' || backupSchedules['mattsystem-daily-backup'].timezone !== 'America/Asuncion' || backupSchedules['mattsystem-daily-backup'].requestMethod !== 'GET')) {
  throw new Error('Falta programar el respaldo automático diario y las alertas de vencimiento.');
}
if (!apiSource.includes('function parseMoney(value)') ||
    !apiSource.includes('function validISODate(value)') ||
    !apiSource.includes('amount=parseMoney(input.amount)')) {
  throw new Error('Los importes deben normalizar separadores de miles y las fechas financieras deben validarse estrictamente.');
}
if (!html.includes('id="adminFinanceAmount" inputmode="decimal"') ||
    !html.includes("amount:document.getElementById('adminFinanceAmount').value")) {
  throw new Error('El formulario financiero del administrador debe enviar el importe sin convertirlo a número decimal antes de normalizarlo.');
}
if (!fs.readFileSync(erpPath, 'utf8').includes('Gestión operativa')) {
  throw new Error('La navegación debe identificar claramente el módulo Gestión operativa.');
}
if (!apiSource.includes("const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])") ||
    !apiSource.includes('if (!origin) return safeMethods.has(method)') ||
    !apiSource.includes("fetchSite === 'cross-site'")) {
  throw new Error('La protección CSRF debe rechazar solicitudes mutables sin Origin y solicitudes cross-site.');
}
const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const globalHeaderSet = new Map((vercelConfig.headers.find(item => item.source === '/(.*)')?.headers || []).map(item => [item.key.toLowerCase(), item.value]));
for (const key of ['x-content-type-options','x-frame-options','referrer-policy','permissions-policy','strict-transport-security','content-security-policy']) {
  if (!globalHeaderSet.has(key)) throw new Error('Falta el encabezado de seguridad global: ' + key);
}

if (!html.includes('/employee-access.js')) throw new Error('La interfaz no carga el módulo de cuentas de empleados.');
if (!html.includes('/erp-modules.js')) throw new Error('La interfaz no carga los módulos ERP.');
if (!html.includes('/admin-nav.js')) throw new Error('La interfaz no carga la navegación administrativa agrupada.');
if (!html.includes('data-open-quick-note')) throw new Error('El atajo de nueva nota no abre su ventana emergente.');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
new vm.Script(serviceWorker, { filename: path.join(root, 'sw.js') });
if (!serviceWorker.includes("'/employee-access.js'") || !serviceWorker.includes("'/erp-modules.js'") || !serviceWorker.includes("'/admin-nav.js'")) throw new Error('La caché PWA no incluye todos los módulos JavaScript.');
if (!fs.readFileSync(apiPath, 'utf8').includes('/api/business/employee-data')) {
  throw new Error('No está implementado el endpoint de datos con permisos para empleados.');
}

if (!fs.readFileSync(apiPath, 'utf8').includes('module.exports._internal')) throw new Error('Faltan helpers compartidos para las rutas especializadas.');
if (!fs.readFileSync(receivablesApiPath, 'utf8').includes('app_receivable_payments')) throw new Error('La API de cuentas por cobrar no está conectada a pagos.');
if (!fs.readFileSync(receivablesApiPath, 'utf8').includes('app_receivable_audit')) throw new Error('La API de cuentas por cobrar no consulta la auditoría.');
if (!fs.readFileSync(apiPath, 'utf8').includes('last_name')) throw new Error('El módulo de clientes no integra los apellidos.');
if (!fs.readFileSync(apiPath, 'utf8').includes('receivables.view') || !fs.readFileSync(apiPath, 'utf8').includes('receivables.manage')) throw new Error('La API de empleados no reconoce los permisos de cuentas por cobrar.');
if (!fs.readFileSync(receivablesMigrationPath, 'utf8').includes('pg_advisory_xact_lock')) throw new Error('Falta el bloqueo de idempotencia para pagos concurrentes.');
if (!fs.readFileSync(path.join(root, 'migrations/016_receivables_direct_debt_link.sql'), 'utf8').includes('receivable_debt_id')) throw new Error('Los movimientos financieros no quedan enlazados directamente a la deuda.');
if (!fs.readFileSync(erpPath, 'utf8').includes('receivablesSearch')) throw new Error('Falta la búsqueda del historial de cuentas por cobrar.');
if (!fs.readFileSync(addonsApiPath, 'utf8').includes('app_business_addons')) throw new Error('La API de complementos no está conectada a la base de datos.');
if (!fs.readFileSync(erpPath, 'utf8').includes("receivables:{title:'Cuentas por cobrar'")) throw new Error('La interfaz ERP no incluye cuentas por cobrar.');
if (!fs.readFileSync(erpPath, 'utf8').includes("branches:{title:'Sucursales'")) throw new Error('La interfaz ERP no incluye sucursales.');
if (!fs.readFileSync(erpPath, 'utf8').includes("delivery:{title:'Pedidos y entregas'")) throw new Error('La interfaz ERP no incluye pedidos y entregas.');
if (!fs.readFileSync(apiPath, 'utf8').includes('app_delivery_orders') || !fs.readFileSync(apiPath, 'utf8').includes('app_branches')) throw new Error('La API no está conectada a sucursales y pedidos.');
if (!fs.readFileSync(path.join(root, 'migrations/024_branches_delivery.sql'), 'utf8').includes('app_delivery_events')) throw new Error('Falta el historial de eventos de entrega.');
if (!fs.readFileSync(path.join(root, 'migrations/025_default_branch_on_business_create.sql'), 'utf8').includes('app_business_default_branch_trigger')) throw new Error('Falta la creación automática de la sucursal principal.');
if (!html.includes("const link = event.target.closest('[data-page-link]')")) throw new Error('La navegación no admite enlaces dinámicos agregados después de la carga inicial.');
if (!html.includes('id="licenseActivationPanel" hidden') || !html.includes('id="requestLicenseActivation"')) throw new Error('Falta el acceso visible a la solicitud de activación de licencia en Info.');
if (!html.includes('id="licenseVerifyForm"') || !html.includes('id="licenseCodeInput"')) throw new Error('Falta el formulario para verificar el código de licencia en Info.');
if (!html.includes('data-update-business-license')) throw new Error('Falta la acción administrativa para actualizar la licencia desde Negocios.');
if (!fs.readFileSync(apiPath, 'utf8').includes("if(path==='/api/license/verify-code')")) throw new Error('Falta el endpoint seguro para verificar el código de licencia del negocio.');
if (!fs.readFileSync(apiPath, 'utf8').includes("if(path==='/api/admin/business-license')")) throw new Error('Falta el endpoint administrativo para actualizar licencias existentes.');
if (!html.includes('activationButton.hidden=!trialLicense')) throw new Error('El botón de activación debe mostrarse solo durante la prueba gratuita.');
if (!fs.readFileSync(apiPath, 'utf8').includes("is_trial:license.is_trial===true||license.is_trial==='true'")) throw new Error('La API debe normalizar el estado de prueba de licencia.');
if (!fs.readFileSync(erpPath, 'utf8').includes('#page-erp .page-heading h1')) throw new Error('Gestión operativa no tiene alineación de textos adaptada.');
if (!html.includes('saveBusinessAddons')) throw new Error('La administración no incluye controles de complementos.');

function collectServerlessFiles(directory, relative = '') {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    const nextRelative = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) return collectServerlessFiles(absolute, nextRelative);
    if (!entry.isFile() || !/\.(?:js|mjs|cjs|ts)$/.test(entry.name) || entry.name.startsWith('_')) return [];
    return [nextRelative];
  });
}

const serverlessFiles = collectServerlessFiles(path.join(root, 'api'));
if (serverlessFiles.length > 12) {
  throw new Error('Vercel Hobby admite como máximo 12 Serverless Functions; se detectaron ' + serverlessFiles.length + ': ' + serverlessFiles.join(', '));
}
for (const requiredRoute of ['/api/auth/login', '/api/auth/me', '/api/admin/businesses', '/api/admin/users', '/api/admin/reset-data', '/api/data']) {
  if (!fs.readFileSync(path.join(root, 'api/[...path].js'), 'utf8').includes(requiredRoute)) {
    throw new Error('La ruta API consolidada no contiene el endpoint requerido: ' + requiredRoute);
  }
}

const privateFinanceApi = fs.readFileSync(apiPath, 'utf8');
const privateFinanceMigration = fs.readFileSync(path.join(root, 'migrations/027_admin_private_finance_notes.sql'), 'utf8');
if (!privateFinanceApi.includes("if(path==='/api/admin/private-finance')") || !privateFinanceApi.includes("authenticated(req,res,true)")) throw new Error('Las finanzas privadas deben estar protegidas por autenticación exclusiva del administrador.');
if (!privateFinanceMigration.includes('app_admin_private_notes') || !privateFinanceMigration.includes('app_admin_finance_entries')) throw new Error('Falta la migración de notas y finanzas privadas del administrador.');
if (!html.includes('id="adminPrivateNoteForm"') || !html.includes('id="adminPrivateFinanceForm"')) throw new Error('Faltan los formularios privados del administrador.');
const healthMigration = fs.readFileSync(path.join(root, 'migrations/053_system_health_observability.sql'), 'utf8');
if (!html.includes('id="adminHealthNav"') || !html.includes('id="page-salud-sistema"') ||
    !html.includes("if (page === 'salud-sistema' && currentUser?.isPlatformAdmin !== true) return;") ||
    !html.includes("if (page === 'salud-sistema') refreshAdminHealth(true);") ||
    !html.includes("window.PanaderiaAuth.api('/api/admin/health')") ||
    !html.includes("window.PanaderiaAuth.api('/api/admin/security')") ||
    !html.includes("window.PanaderiaAuth.api('/api/admin/overview')") ||
    !html.includes('id="healthHistory"') || !html.includes('id="healthAlerts"') ||
    !html.includes('id="healthActiveTrials"') || !html.includes('id="healthUserLimitExceeded"') ||
    !html.includes('id="healthSuspendedLicenses"') || !html.includes('id="healthDeviceLimits"') ||
    !html.includes('id="healthDailyTrend"') || !html.includes('id="healthWeeklyTrend"') || !html.includes('id="healthMonthlyTrend"') ||
    !html.includes('id="healthLatestDeploymentUrl"') || !html.includes('id="healthLatestDeploymentCommit"') ||
    !apiSource.includes("process.env.VERCEL_PROJECT_NAME") || !apiSource.includes('No se pudo verificar Vercel') ||
    !html.includes('id="healthDeviceControl"') || !html.includes('id="healthLockedAccounts"') ||
    !html.includes('id="healthBackupMissingBusinesses"') || !html.includes('id="healthLatestDeployment"') ||
    !html.includes('id="healthModules"') || !html.includes('id="healthVersions"') ||
    !html.includes('id="healthInvalidReleaseArtifacts"') || !html.includes('id="healthModulesUnimplemented"') ||
    !apiSource.includes('active_unimplemented') || !apiSource.includes('invalid_artifacts') ||
    !apiSource.includes('pending_business_updates') || !apiSource.includes('pending_upgrade_requests') ||
    !apiSource.includes('getVercelDeploymentHealth') || !apiSource.includes('VERCEL_API_TOKEN') ||
    !apiSource.includes('healthMigrationApplied') || !apiSource.includes('businesses_missing_backup') ||
    !apiSource.includes('locked_accounts') || !apiSource.includes('deviceLimits:') ||
    !apiSource.includes("VALUES(NULL,'failed'") ||
    !apiSource.includes("date_trunc('day'") || !apiSource.includes("date_trunc('week'") || !apiSource.includes("date_trunc('month'") ||
    !apiSource.includes('active_trials') || !apiSource.includes('user_limit_exceeded') || !apiSource.includes('payments_30d') ||
    !apiSource.includes('status=\'suspended\'') || !apiSource.includes('device_limits_configured') ||
    !html.includes("reportHealthEvent('js_error'") || !html.includes("reportHealthEvent('api_error'") ||
    !apiSource.includes("if (path === '/api/admin/health')") ||
    !apiSource.includes("if (path === '/api/health/events')") ||
    !apiSource.includes('percentile_cont(0.95)') ||
    !apiSource.includes("'api_request'") ||
    !html.includes('healthRequestSample') ||
    !apiSource.includes("providerSnapshots:'not_verified'") ||
    !apiSource.includes('healthSnapshot:healthStatus') ||
    !apiSource.includes('healthAlerts:healthAlerts.length') ||
    !apiSource.includes("'13 months'") ||
    !healthMigration.includes('app_health_events') ||
    !healthMigration.includes('app_health_snapshots') ||
    !healthMigration.includes('mattsystem_health_events_tenant_insert') ||
    !healthMigration.includes('mattsystem_health_snapshots_admin') ||
    !html.includes("'adminHealthNav'")) {
  throw new Error('El Panel de salud debe incluir telemetría autenticada, diagnósticos, historial y controles RLS exclusivos.');
}
if (html.includes('id="adminCenterCards"')) throw new Error('El Centro de gestión todavía contiene accesos rápidos que fueron solicitados eliminar.');
if (!html.includes('id="adminPrivateBalanceTotal"')) throw new Error('Falta el resumen mensual privado en la pantalla principal del administrador.');

const securityApi = fs.readFileSync(apiPath, 'utf8');
const securityHtml = fs.readFileSync(path.join(root, 'app.bundle.html'), 'utf8');
const securityEmployeeAccess = fs.readFileSync(path.join(root, 'employee-access.js'), 'utf8');
const hardeningMigration = fs.readFileSync(path.join(root, 'migrations/033_security_price_stock_and_ip_rls.sql'), 'utf8');
const signedContextMigration = fs.readFileSync(path.join(root, 'migrations/034_signed_tenant_context.sql'), 'utf8');
const licensePolicyMigration = fs.readFileSync(path.join(root, 'migrations/037_license_write_restrictions.sql'), 'utf8');
const entitlementPolicyMigration = fs.readFileSync(path.join(root, 'migrations/038_platform_managed_entitlements.sql'), 'utf8');
const erpPostStart = securityApi.indexOf("if (req.method === 'POST')", securityApi.indexOf("if (path === '/api/business/erp')"));
const salesStart = securityApi.indexOf("if (module === 'sales')", erpPostStart);
const salesEnd = securityApi.indexOf("if (module === 'purchases')", salesStart);
const salesBlock = salesStart >= 0 && salesEnd > salesStart ? securityApi.slice(salesStart, salesEnd) : '';
const inventoryStart = securityApi.indexOf("if (module === 'inventory')", securityApi.indexOf("if (req.method === 'POST')", securityApi.indexOf("if (path === '/api/business/erp')")));
const inventoryEnd = securityApi.indexOf("if (module === 'sales')", inventoryStart);
const inventoryBlock = inventoryStart >= 0 && inventoryEnd > inventoryStart ? securityApi.slice(inventoryStart, inventoryEnd) : '';
const deliveryStart = securityApi.indexOf("if (module === 'delivery')", securityApi.indexOf("if (req.method === 'POST')", securityApi.indexOf("if (path === '/api/business/erp')")));
const deliveryEnd = securityApi.indexOf("if (module === 'products')", deliveryStart);
const deliveryBlock = deliveryStart >= 0 && deliveryEnd > deliveryStart ? securityApi.slice(deliveryStart, deliveryEnd) : '';
if (!salesBlock.includes('sale_price') || !salesBlock.includes('canOverrideSalePrice') || !salesBlock.includes('canDiscountSale')) throw new Error('Las ventas deben validar el precio contra el catálogo y exigir permiso para cambiar precios o descuentos.');
if (!securityApi.includes("set_config('role', 'mattsystem_app', true)") || !securityApi.includes('usesRuntimeRole')) throw new Error('La conexión de producción debe forzar el rol SQL de mínimos privilegios cuando no se usa DATABASE_URL_RUNTIME.');
if (!securityApi.includes("set_config('app.context_signature'") || !securityApi.includes('TENANT_CONTEXT_SECRET') || !signedContextMigration.includes('tenant_context_is_valid') || !signedContextMigration.includes('app_context_public_catalog_business_id')) throw new Error('El contexto de tenant debe estar firmado y todas las políticas RLS deben validarlo.');
if (!deliveryBlock.includes('sale_price') || !deliveryBlock.includes('canOverrideDeliveryPrice') || !deliveryBlock.includes('canDiscountDelivery')) throw new Error('Los pedidos deben validar el precio contra el catálogo y exigir permiso para cambiar precios o descuentos.');
if (!inventoryBlock.includes('FOR UPDATE') || !inventoryBlock.includes('c.new_stock>=0')) throw new Error('Los movimientos de inventario deben bloquear la fila y evitar stock negativo de forma atómica.');
if (!hardeningMigration.includes('ENABLE ROW LEVEL SECURITY') || !hardeningMigration.includes('app_login_ip_attempts_scope') || !hardeningMigration.includes('stock >= 0')) throw new Error('Falta la migración de RLS para intentos por IP y la restricción de stock no negativo.');
if (!securityHtml.includes('logoPreview.replaceChildren()') || !securityHtml.includes('safeLogoSource') || securityHtml.includes('logoPreview.innerHTML = state.business.logo')) throw new Error('La vista previa del logo debe usar DOM seguro y validar el origen de la imagen.');
if (!securityEmployeeAccess.includes('sales.price_override') || !securityEmployeeAccess.includes('sales.discount') || !securityEmployeeAccess.includes('delivery.price_override') || !securityApi.includes("'sales.price_override'") || !securityApi.includes("'delivery.price_override'")) throw new Error('Faltan los permisos explícitos para modificar precios y aplicar descuentos en la interfaz y en el servidor.');
if (!licensePolicyMigration.includes('DROP POLICY IF EXISTS mattsystem_tenant_insert ON public.app_licenses') ||
    !licensePolicyMigration.includes('CREATE POLICY mattsystem_license_insert_admin') ||
    !licensePolicyMigration.includes('CREATE POLICY mattsystem_license_update_admin') ||
    !licensePolicyMigration.includes('CREATE POLICY mattsystem_license_delete_admin') ||
    (licensePolicyMigration.match(/app_is_platform_admin\(\)/g) || []).length < 4) {
  throw new Error('Solo el administrador de plataforma puede crear, modificar o eliminar licencias.');
}
for (const policyName of [
  'mattsystem_business_config_insert_admin',
  'mattsystem_business_config_update_admin',
  'mattsystem_business_config_delete_admin',
  'mattsystem_business_addons_insert_admin',
  'mattsystem_business_addons_update_admin',
  'mattsystem_business_addons_delete_admin'
]) {
  if (!entitlementPolicyMigration.includes('CREATE POLICY ' + policyName)) throw new Error('Falta restringir al administrador de plataforma: ' + policyName);
}
if (!securityApi.includes("if (!email || email.length > 254 || !password || password.length > 200)")) {
  throw new Error('El login debe limitar la longitud de correo y contraseña para evitar entradas excesivas.');
}
if (!securityApi.includes('Number(users[0].session_version || 0) !== Number(session.sv || 0)')) {
  throw new Error('El diagnóstico de base de datos debe respetar la revocación de sesiones.');
}
if (!securityEmployeeAccess.includes('await promptEvent.prompt()')) {
  throw new Error('La instalación PWA manual debe esperar el resultado del navegador.');
}
const appFullHtml = fs.readFileSync(path.join(root, 'app.full.html'), 'utf8');
if (appFullHtml.includes('logoPreview.innerHTML = state.business.logo') || !appFullHtml.includes('safeLogoSource')) throw new Error('La página alternativa app.full.html también debe proteger la vista previa del logo.');

const erpUiSource = fs.readFileSync(path.join(root, 'erp-modules.js'), 'utf8');
const receivablesSource = fs.readFileSync(path.join(root, 'api/business/receivables.js'), 'utf8');
const pushServiceWorkerSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
if (!erpUiSource.includes("u.role==='admin'") ||
    !erpUiSource.includes("u.role==='supervisor'&&supervisorDefaults.has(key)") ||
    erpUiSource.includes("u.role==='admin'||u.role==='supervisor'")) {
  throw new Error('La interfaz ERP no debe elevar al Supervisor a permisos de Dueño.');
}
if (!receivablesSource.includes("const owner = user.role === 'admin';") ||
    receivablesSource.includes("user.role === 'admin' || user.role === 'supervisor'")) {
  throw new Error('Cuentas por cobrar debe requerir permisos explícitos al Supervisor.');
}
for (const marker of [
  "const canManage=allowed('products.manage')",
  "const canManage=allowed('inventory.manage')",
  "canManage=allowed(manageKey)",
  "const canManage=allowed('purchases.create')",
  "const canManage=allowed('recipes.manage')",
  "const canManage=allowed('production.manage')",
  "const canExport=allowed('reports.export')"
]) {
  if (!erpUiSource.includes(marker)) throw new Error('Falta control visual de permisos en Gestión operativa: ' + marker);
}
if (!pushServiceWorkerSource.includes('const APP_SHELL_PATHS = new Set(') ||
    !pushServiceWorkerSource.includes('if (APP_SHELL_PATHS.has(url.pathname))') ||
    !pushServiceWorkerSource.includes("mattsystem-pwa-v24")) {
  throw new Error('La caché PWA debe reconocer recursos con parámetros de consulta y renovar su versión.');
}


const ownerSupervisorRlsMigration = fs.readFileSync(path.join(root, 'migrations/039_owner_supervisor_employee_rls.sql'), 'utf8');
if (!ownerSupervisorRlsMigration.includes("actor.role IN ('admin', 'supervisor')") ||
    !ownerSupervisorRlsMigration.includes('actor.is_platform_admin = FALSE') ||
    !ownerSupervisorRlsMigration.includes('app_private.tenant_context_is_valid()') ||
    !ownerSupervisorRlsMigration.includes('actor.business_id = public.app_current_business_id()')) {
  throw new Error('La gestión de empleados debe permitir Dueño y Supervisor solo dentro de su negocio y con contexto firmado.');
}


const offboardingMigration = fs.readFileSync(path.join(root, 'migrations/040_employee_offboarding_rejection.sql'), 'utf8');
if (!offboardingMigration.includes("'termination_rejected'") ||
    !apiSource.includes("action==='reject_request'") ||
    !apiSource.includes("'employee_offboarding','Solicitud de baja de empleado'") ||
    !apiSource.includes("n.type='employee_offboarding' THEN") ||
    !apiSource.includes("Ya existe una solicitud de baja pendiente") ||
    !fs.readFileSync(path.join(root, 'employee-access.js'), 'utf8').includes('data-employee-offboarding="reject_request"')) {
  throw new Error('El flujo de bajas debe notificar al Dueño, evitar solicitudes duplicadas y permitir rechazar solicitudes pendientes.');
}


const notificationRlsMigration = fs.readFileSync(path.join(root, 'migrations/041_user_scoped_notifications_rls.sql'), 'utf8');
if (!notificationRlsMigration.includes('user_id = public.app_context_user_id()') ||
    !notificationRlsMigration.includes('public.app_is_platform_admin()') ||
    !notificationRlsMigration.includes('CREATE POLICY mattsystem_notifications_user_select')) {
  throw new Error('Las notificaciones deben quedar aisladas por destinatario y por administrador de plataforma.');
}

if (!html.includes('id="adminBackupBusiness"') ||
    !html.includes("headers:{'x-business-id':businessId}") ||
    !html.includes("headers:{'x-business-id':businessId}, body: JSON.stringify({ action: 'restore'") ||
    !html.includes('Seleccioná un negocio para consultar su historial')) {
  throw new Error('Las copias de seguridad deben exigir un negocio y enviar su identificador en consulta, creación y restauración.');
}
if (!html.includes("m.active!==false&&!allowed.has(m.module_key)")) {
  throw new Error('Las cotizaciones deben ofrecer todos los módulos activos que no estén incluidos en el plan.');
}
if (!html.includes("m.active!==false&&!included.includes(m.module_key)") ||
    !apiSource.includes("implemented=TRUE AND module_key IN (SELECT jsonb_array_elements_text") ||
    !apiSource.includes("catalog.commercial_mode='addon'")) {
  throw new Error('Las licencias deben permitir contratar módulos implementados excluidos del plan sin registrar módulos core como complementos opcionales.');
}
const employeePwaSource = fs.readFileSync(path.join(root, 'employee-access.js'), 'utf8');
if (!employeePwaSource.includes("document.getElementById('mattsystemPwaBanner')") ||
    !employeePwaSource.includes('automaticBanner.remove()') ||
    !employeePwaSource.includes("button.id = 'installAppPwaButton'") ||
    !employeePwaSource.includes("window.addEventListener('beforeinstallprompt'") ||
    !employeePwaSource.includes("const fixedBottom = style.position === 'fixed'")) {
  throw new Error('La instalación PWA debe quedar disponible manualmente en Novedades y versiones, sin banners automáticos.');
}


const appBundleSource = fs.readFileSync(path.join(root, 'app.bundle.html'), 'utf8');
if (!apiSource.includes("req.method==='DELETE'") ||
    !apiSource.includes("'commercial.quotation_deleted'") ||
    !appBundleSource.includes('data-quote-delete') ||
    !appBundleSource.includes("method:'DELETE'")) {
  throw new Error('Las cotizaciones deben poder eliminarse desde la interfaz con confirmación y registro de auditoría.');
}
if (!apiSource.includes("durationType==='custom_days'") ||
    !apiSource.includes('durationDays<=3650') ||
    !apiSource.includes('requestedTrialDays>3650') ||
    !appBundleSource.includes('id="licenseCustomDaysWrap"') ||
    !appBundleSource.includes('id="businessTrialDays" type="number" class="form-control" min="1" max="3650"')) {
  throw new Error('Las licencias y pruebas deben admitir duraciones personalizadas de 1 a 3650 días.');
}
if (!apiSource.includes('Tu licencia vence HOY') ||
    !apiSource.includes('Licencia vence hoy') ||
    !apiSource.includes('WHERE ${settings.enabled===true} AND renewal_date')) {
  throw new Error('Las notificaciones críticas de vencimiento deben llegar el mismo día al negocio y al administrador.');
}
if (appBundleSource.includes('showBanner(mobileDevice?')) {
  throw new Error('No debe mostrarse el aviso automático de instalación PWA; la instalación es manual.');
}


const cronBearerPatternCount = (apiSource.match(/replace\(\/\^Bearer\\s\+\/i/g) || []).length;
if (!apiSource.includes("const previewRequiresRuntime = process.env.VERCEL_ENV === 'preview';") ||
    !apiSource.includes('refusing to fall back to DATABASE_URL') ||
    cronBearerPatternCount !== 1) {
  throw new Error('Preview debe fallar de forma cerrada contra una DB genérica y el parser Bearer del cron debe aceptar el encabezado estándar.');
}
const quotationDeleteStart = apiSource.indexOf("if(req.method==='DELETE'){", apiSource.indexOf("if (path === '/api/admin/quotations')"));
const quotationDeleteEnd = apiSource.indexOf("if(req.method==='PATCH'){", quotationDeleteStart);
const quotationDeleteCode = apiSource.slice(quotationDeleteStart, quotationDeleteEnd);
if (!quotationDeleteCode.includes('WITH deleted AS') ||
    !quotationDeleteCode.includes('INSERT INTO app_audit_logs') ||
    !quotationDeleteCode.includes('FROM deleted')) {
  throw new Error('La eliminación y auditoría de cotizaciones deben ejecutarse atómicamente.');
}
const securityMigration042 = fs.readFileSync(path.join(root, 'migrations/042_audit_log_immutability_and_quote_delete_scope.sql'), 'utf8');
if (!securityMigration042.includes('ALTER POLICY mattsystem_tenant_update ON public.app_audit_logs') ||
    !securityMigration042.includes('ALTER POLICY mattsystem_tenant_delete ON public.app_audit_logs') ||
    !securityMigration042.includes('ALTER POLICY mattsystem_tenant_delete ON public.app_quotations')) {
  throw new Error('El registro de auditoría debe ser inmutable para negocios y la eliminación de cotizaciones exclusiva del administrador de plataforma.');
}

const workflowPath = path.resolve(root, '../.github/workflows/validate.yml');
const workflowSource = fs.readFileSync(workflowPath, 'utf8');
if (!workflowSource.includes('feat/employee-offboarding-2026-11-26')) {
  throw new Error('La rama activa de QA debe ejecutar la validación de GitHub Actions en cada push.');
}


const expirySettingsMigration = fs.readFileSync(path.join(root, 'migrations/043_multiple_expiry_alert_days.sql'), 'utf8');
if (!expirySettingsMigration.includes('alert_days integer[]') ||
    !expirySettingsMigration.includes('alert_days_before') ||
    !apiSource.includes('alertDays.includes(daysLeft)') ||
    !apiSource.includes('ON CONFLICT(entity_type,entity_id,due_date,alert_days_before) DO NOTHING') ||
    !apiSource.includes('alert_days,updated_by,updated_at') ||
    !appBundleSource.includes('placeholder="7, 3, 0"') ||
    !appBundleSource.includes('JSON.stringify({kind:\'settings\',enabled,alertDays})')) {
  throw new Error('Las alertas múltiples deben ser configurables, independientes y no duplicarse.');
}


const webPushMigration = fs.readFileSync(path.join(root, 'migrations/044_web_push_subscriptions.sql'), 'utf8');
const packageSource = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!webPushMigration.includes('app_push_subscriptions') ||
    !apiSource.includes("require('web-push')") ||
    !apiSource.includes("path==='/api/push/public-key'") ||
    !apiSource.includes("path==='/api/push/subscriptions'") ||
    !apiSource.includes('sendWebPush(sql,sent.map') ||
    !pushServiceWorkerSource.includes("self.addEventListener('push'") ||
    !appBundleSource.includes('id="devicePushToggle"') ||
    !appBundleSource.includes("pushManager.subscribe") ||
    !packageSource.dependencies['web-push']) {
  throw new Error('Las notificaciones push deben guardar suscripciones privadas y enviarse en segundo plano.');
}

const deviceLimitMigration = fs.readFileSync(path.join(root, 'migrations/047_license_plan_device_limits.sql'), 'utf8');
if (!deviceLimitMigration.includes('ADD COLUMN IF NOT EXISTS device_limit') ||
    !deviceLimitMigration.includes('BETWEEN 1 AND 100') ||
    !deviceLimitMigration.includes("INSERT INTO public.schema_migrations(version)")) {
  throw new Error('La migración de límites de dispositivos debe validar el rango y registrar su versión.');
}

const industryKeys = [
  'despensas_minimercados','tiendas_ropa_calzados','ferreterias','electronica_tecnologia',
  'comercios_generales','panaderias','restaurantes','cafeterias_bares','carnicerias_pollerias',
  'fruterias_verdulerias','talleres_mecanicos','barberias_peluquerias','centros_estetica',
  'reparacion_celulares_computadoras','empresas_servicios'
];
const industryMigration = fs.readFileSync(path.join(root, 'migrations/048_industry_library_templates.sql'), 'utf8');
if (industryKeys.some(key => !html.includes(key) || !apiSource.includes(key) || !industryMigration.includes(key))) {
  throw new Error('La biblioteca de rubros debe estar sincronizada entre interfaz, API y migración.');
}
if (!html.includes("industrySelect.value==='otro_rubro'") || !html.includes('Otro rubro / configuración personalizada')) {
  throw new Error('Debe existir una ruta de configuración para negocios de otros rubros.');
}


const versionMigration = fs.readFileSync(path.join(root, 'migrations/052_versioned_releases.sql'), 'utf8');
if (!versionMigration.includes('app_releases') ||
    !versionMigration.includes('app_business_versions') ||
    !versionMigration.includes('app_version_upgrade_requests') ||
    !versionMigration.includes('app_business_version_history') ||
    !versionMigration.includes('artifact_content text') ||
    !versionMigration.includes('app_is_platform_admin()') ||
    !apiSource.includes("path === '/api/admin/releases'") ||
    !apiSource.includes("path.startsWith('/api/releases/')") ||
    !apiSource.includes("path === '/api/admin/business-versions'") ||
    !apiSource.includes("path === '/api/admin/version-upgrades'") ||
    !apiSource.includes("path === '/api/business/version'") ||
    !apiSource.includes('crypto.createHash') ||
    !apiSource.includes('runtime_compatible') ||
    !apiSource.includes('client_accepted_at') ||
    !apiSource.includes('app_business_version_history') ||
    !appBundleSource.includes('id="adminVersionCenter"') ||
    !appBundleSource.includes('id="businessInitialVersion"') ||
    !appBundleSource.includes('id="versionUpdateAllMonthly"') ||
    !appBundleSource.includes('data-permanent-version') ||
    !appBundleSource.includes('data-rollback-version') ||
    !appBundleSource.includes('mattsystem-version') ||
    !appBundleSource.includes("crypto.subtle.digest('SHA-256'")) {
  throw new Error('Falta el catálogo de versiones, la asignación por negocio o la autorización de mejoras permanentes.');
}

const releaseArtifactSource = fs.readFileSync(path.join(root, 'releases/2.0.1/app.bundle.html'), 'utf8');
if (!releaseArtifactSource.startsWith('<!-- Mattsystem | Versión 2.0.1 |')) {
  throw new Error('El paquete histórico 2.0.1 debe conservar su identificador de versión.');
}
const releaseArtifactSha256 = crypto.createHash('sha256').update(releaseArtifactSource, 'utf8').digest('hex');
const releaseArtifactBytes = Buffer.byteLength(releaseArtifactSource, 'utf8');
if (!versionMigration.includes(releaseArtifactSha256) || !versionMigration.includes(String(releaseArtifactBytes) + ",true,'published',true")) {
  throw new Error('El checksum y tamaño del release 2.0.1 no coinciden con la migración.');
}

const commercialSecurityMigration = fs.readFileSync(path.join(root, 'migrations/054_commercial_catalog_rls_and_migration_ledger.sql'), 'utf8');
if (!commercialSecurityMigration.includes('ALTER TABLE public.app_commercial_other_prices ENABLE ROW LEVEL SECURITY') ||
    !commercialSecurityMigration.includes('ALTER TABLE public.app_commercial_other_prices FORCE ROW LEVEL SECURITY') ||
    !commercialSecurityMigration.includes('USING (public.app_is_platform_admin())') ||
    !commercialSecurityMigration.includes('actor_user_id = public.app_context_user_id()') ||
    !commercialSecurityMigration.includes("VALUES ('052_versioned_releases')")) {
  throw new Error('El catálogo comercial debe estar aislado por RLS, la telemetría debe usar identidad firmada y la migración 052 debe estar registrada.');
}

const versionAckGuardMigration = fs.readFileSync(path.join(root, 'migrations/055_version_acknowledgement_guards.sql'), 'utf8');
if (!versionAckGuardMigration.includes('app_guard_business_version_tenant_ack') ||
    !versionAckGuardMigration.includes('app_guard_version_upgrade_tenant_ack') ||
    !versionAckGuardMigration.includes('app_guard_business_version_history_insert') ||
    !versionAckGuardMigration.includes("NEW.status <> 'applied'") ||
    !versionAckGuardMigration.includes("NEW.change_reason <> 'runtime_acknowledged'")) {
  throw new Error('Los negocios solo pueden confirmar la versión asignada; no pueden modificar aprobaciones, pagos ni el historial de versiones.');
}

process.stdout.write('Release 2.0.1 SHA-256: ' + releaseArtifactSha256 + ' (' + releaseArtifactBytes + ' bytes).\\n');
process.stdout.write('Validación estática correcta: API, interfaz, permisos, PWA, JSON y límite Vercel (' + serverlessFiles.length + '/12 funciones).\\n');
