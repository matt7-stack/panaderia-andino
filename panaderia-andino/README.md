# Panadería Andino

Sistema web administrativo para Panadería Andino. Esta es la versión base recuperada del ZIP del proyecto y preparada para incorporarse al repositorio GitHub.

## Estado técnico actual

- Interfaz: HTML, CSS y JavaScript.
- Backend: Vercel Functions (`api/[...path].js`).
- Base de datos: Neon PostgreSQL mediante `@neondatabase/serverless`.
- Despliegue previsto: Vercel.
- No es todavía una aplicación Next.js/React ni utiliza Prisma. Se conserva la arquitectura existente para evitar una migración innecesaria antes de auditarla.

## Módulos existentes

- Dashboard financiero con gráficos.
- Movimientos manuales de ingresos y gastos.
- Facturas emitidas y recibidas para control interno.
- Configuración del negocio y preferencias.
- Inicio de sesión y activación inicial del administrador.
- Persistencia compartida en Neon mediante una fila JSONB (`app_state`).

## Módulos pendientes según la especificación del proyecto

- Ventas por productos y métodos de pago.
- Catálogo de productos y materias primas.
- Inventario y movimientos de stock.
- Recetas y producción.
- Compras y proveedores.
- Empleados y pagos.
- Beneficio mensual basado en costo de ventas.
- Informes PDF y Excel.

## Variables de entorno

Configurar en Vercel (Development, Preview y Production según corresponda):

- `DATABASE_URL`: cadena de conexión de Neon.
- `ADMIN_EMAIL`: correo del administrador.
- `SESSION_SECRET`: secreto aleatorio de al menos 32 caracteres.
- `ADMIN_BOOTSTRAP_TOKEN`: token aleatorio de al menos 32 caracteres.

Copiar `.env.example` como referencia para el entorno local. **Nunca subir `.env` ni credenciales reales a GitHub.**

## Estructura relevante

- `index.html`: cargador de la interfaz comprimida.
- `app.bundle.html`: interfaz ensamblada.
- `app.bundle.part1`, `part2`, `part3`: fragmentos gzip requeridos por el cargador.
- `api/[...path].js`: API de autenticación, sesiones y sincronización de datos.
- `lib/server.js`: utilidades de servidor.
- `js/` y `css/`: archivos de desarrollo/referencia incluidos en el ZIP.

## Seguridad y datos

- El repositorio no debe contener secretos reales.
- La cuenta administradora se activa una sola vez mediante el flujo de bootstrap.
- El proyecto contiene datos de demostración en el estado inicial; deben identificarse y retirarse antes de usar datos reales.
- Las facturas actuales son registros de control interno; no son comprobantes fiscales ni están integradas con DNIT/e-Kuatia.
- Antes de cambiar el esquema de Neon, realizar una copia de seguridad y validar el entorno de destino.

## Próximo trabajo

1. Importar esta base al repositorio `matt7-stack/panaderia-andino`.
2. Verificar variables y conexión Neon en Vercel sin exponer credenciales.
3. Corregir la carga inicial para que no convierta datos de demostración en datos reales.
4. Implementar los módulos pendientes gradualmente, con pruebas y migraciones controladas.
