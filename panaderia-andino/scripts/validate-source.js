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
  'migrations/006_operational_integrity_and_tenant_constraints.sql'
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
requireContract(/WHERE business_id=\$\{user\.business_id\} AND is_platform_admin=FALSE AND role='employee'/.test(apiSource), 'la lista de empleados debe limitarse al negocio autenticado.');
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

const integrityMigration = fs.readFileSync(path.join(root, 'migrations/006_operational_integrity_and_tenant_constraints.sql'), 'utf8');
requireContract((integrityMigration.match(/VALIDATE CONSTRAINT/g) || []).length >= 6, 'las seis relaciones compuestas entre negocios deben quedar validadas.');
requireContract(/CREATE UNIQUE INDEX IF NOT EXISTS app_cash_sessions_one_open_per_business/.test(integrityMigration), 'la base debe impedir más de una caja abierta por negocio.');
process.stdout.write('Validación estática correcta: API, interfaz, permisos de empleados y JSON.\n');
