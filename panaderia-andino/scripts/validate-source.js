'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'api/[...path].js',
  'api/business/receivables.js',
  'api/admin/business-addons.js',
  'app.bundle.html',
  'employee-access.js',
  'erp-modules.js',
  'migrations/009_optional_receivables_addon.sql',
  'migrations/013_receivables_idempotency.sql',
  'migrations/014_expand_industry_templates.sql',
  'migrations/015_receivables_payment_idempotency_guard.sql',
  'migrations/016_receivables_direct_debt_link.sql',
  'manifest.webmanifest',
  'vercel.json',
  'sw.js'
];

for (const relative of requiredFiles) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) throw new Error('Falta el archivo requerido: ' + relative);
}

for (const relative of ['api/[...path].js','api/business/receivables.js','api/admin/business-addons.js','employee-access.js','erp-modules.js']) {
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
if (!html.includes('saveBusinessAddons')) throw new Error('La administración no incluye controles de complementos.');

process.stdout.write('Validación estática correcta: API, interfaz, permisos de empleados y JSON.\n');
