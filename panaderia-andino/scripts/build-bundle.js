'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const bundlePath = path.join(root, 'app.bundle.html');
const authPath = path.join(root, 'js', 'auth.js');
const dashboardPath = path.join(root, 'js', 'dashboard.js');

let html = fs.readFileSync(bundlePath, 'utf8');
const auth = fs.readFileSync(authPath, 'utf8').trim();
const dashboard = fs.readFileSync(dashboardPath, 'utf8').trim();

new vm.Script(auth, { filename: 'js/auth.js' });
new vm.Script(dashboard, { filename: 'js/dashboard.js' });

const inlineScriptPattern = /<script>([\s\S]*?)<\/script>/g;
const inlineScripts = [...html.matchAll(inlineScriptPattern)];
if (inlineScripts.length < 2) {
  throw new Error(`Se esperaban al menos 2 bloques JavaScript inline y se encontraron ${inlineScripts.length}. No se modificó el paquete.`);
}

let index = 0;
html = html.replace(inlineScriptPattern, () => {
  const source = index++ === 0 ? auth : dashboard;
  return source ? `<script>\n${source}\n</script>` : inlineScripts[index - 1][0];
});

html = html
  .replace('<meta name="description" content="Sistema de gestión para Panadería Andino: dashboard, ingresos, gastos, notas y configuración.">', '<meta name="description" content="Sistema de gestión para panaderías: ingresos, gastos, notas, empleados y administración.">')
  .replace('<meta name="application-name" content="Panadería Andino">', '<meta name="application-name" content="Gestión Panadería">')
  .replace('<meta name="apple-mobile-web-app-title" content="Panadería Andino">', '<meta name="apple-mobile-web-app-title" content="Gestión Panadería">')
  .replace('<title>Panadería Andino | Gestión</title>', '<title>Gestión Panadería</title>')
  .replace('aria-label="Panadería Andino, inicio"', 'aria-label="Gestión Panadería, inicio"')
  .replace('<span class="brand-name">Panadería<br>Andino</span>', '<span class="brand-name">Gestión<br>Panadería</span>')
  .replace('<span>Panadería Andino</span><i class="bi bi-chevron-right"></i>', '<span>Gestión Panadería</span><i class="bi bi-chevron-right"></i>')
  .replace('Explicación práctica de cada sección, botón y control de Panadería Andino.', 'Explicación práctica de cada sección, botón y control de Gestión Panadería.')
  .replace('<span>ANDINO</span></div>', '<span>LOGO</span></div>')
  .replace('<span id="footerBusinessName">Panadería Andino</span>', '<span id="footerBusinessName">Mi panadería</span>');

// Registrar el service worker para habilitar instalación PWA y actualización del shell.
const pwaRegistration = `<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .catch((error) => console.error('No se pudo registrar la aplicación offline:', error));
  });
}
</script>`;
if (!html.includes("navigator.serviceWorker.register('/sw.js'")) {
  html = html.replace('</body>', `${pwaRegistration}\n</body>`);
}

const output = path.join(root, 'app.bundle.html');
fs.writeFileSync(output, html);
console.log('Paquete actualizado y JavaScript validado: app.bundle.html');
