PANADERÍA ANDINO — SISTEMA WEB CON ACCESO PRIVADO

ESTRUCTURA
- index.html: cargador de la aplicación web.
- app.bundle.html: interfaz completa de la panadería.
- app.bundle.part1, part2 y part3: versión comprimida utilizada por el cargador web.
- css/style.css: estilos de referencia y desarrollo.
- js/dashboard.js: navegación, cálculos, movimientos, facturas, configuración y sincronización.
- js/auth.js: inicio y cierre de sesión, activación inicial y control de interfaz por rol.
- api/[...path].js: API de autenticación, sesiones, administración de usuarios y datos compartidos.
- lib/server.js: utilidades de servidor.
- package.json: dependencias del servidor.
- vercel.json: cabeceras para los archivos estáticos comprimidos.
- .env.example: nombres de las variables requeridas (sin credenciales reales).

SECCIONES
1. Dashboard: ingresos, gastos, beneficio, facturas pendientes, gráfico y movimientos recientes.
2. Movimientos: registro, edición, eliminación, búsqueda, filtros y exportación CSV.
3. Facturas: emitidas y recibidas, estados, importes y pagos.
4. Configuración: datos del negocio, logo, categorías, métodos de pago, preferencias y administración de usuarios.

ACCESO Y PERMISOS
- No hay registro público.
- La cuenta administradora inicial usa el correo definido en ADMIN_EMAIL.
- La cuenta admin se activa una sola vez mediante la ruta /api/auth/bootstrap y el token ADMIN_BOOTSTRAP_TOKEN.
- El enlace de activación se entrega al administrador por separado después de publicar el sitio.
- La contraseña se crea desde el formulario seguro de activación; mínimo 12 caracteres. No se guarda ni se incluye una contraseña inicial en este ZIP.
- Las contraseñas se almacenan con scrypt; la sesión usa una cookie HttpOnly, Secure y SameSite=Lax.
- Solo el administrador puede crear, listar, suspender/reactivar y eliminar usuarios. Los usuarios nuevos solo pueden ser empleados o supervisores; no pueden asignarse el rol admin.
- Las rutas de administración comprueban el rol en el servidor, no solo en la interfaz.

BASE DE DATOS Y DESPLIEGUE
Este proyecto está preparado para Vercel Functions + Neon Postgres.
Variables necesarias en el entorno del despliegue:
- DATABASE_URL (provista por Neon)
- ADMIN_EMAIL
- SESSION_SECRET (secreto aleatorio de al menos 32 caracteres)
- ADMIN_BOOTSTRAP_TOKEN (token aleatorio de al menos 32 caracteres)

La conexión Neon debe estar configurada para Production, Preview y Development según los entornos que se utilicen. Después de cambiar variables de entorno, hay que crear un nuevo despliegue para que se apliquen.

PRUEBA LOCAL
La interfaz puede inspeccionarse con un servidor estático, pero el inicio de sesión, usuarios y sincronización requieren las rutas /api y variables de entorno reales. Abrir index.html directamente con file:// no es suficiente para probar autenticación.

ALCANCE
- Los movimientos y facturas son módulos de control interno; no emiten comprobantes fiscales ni se conectan con DNIT/e-Kuatia.
- No se habilita ningún usuario empleado automáticamente.
- Los datos se guardan en Neon una vez que la aplicación se despliega con DATABASE_URL configurada.
