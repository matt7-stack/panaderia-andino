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
  'sw.js'
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

process.stdout.write('Validación estática correcta: API, interfaz, permisos de empleados y JSON.\n');
