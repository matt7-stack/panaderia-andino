# Diagnóstico de bases de datos — Gestión Panadería

Fecha: 2026-11-18

## Resultado de la revisión

Se revisaron los proyectos Neon visibles y la integración Neon vinculada al proyecto Vercel `panaderia-andino`.

### Proyecto de pruebas visible

- Proyecto: `panaderia-andino-pruebas`
- ID Neon: `dawn-truth-17829414`
- Rama: `br-damp-queen-b6avpg6g`
- Base: `panaderia_pruebas`
- Se creó una rama aislada para desarrollo: `gestion-panaderia-dev-20261118` (`br-young-tree-b6zfgdex`).
- En la rama principal revisada, las tablas `app_users` y `app_state` no tenían registros; `businesses` tenía un registro.
- El esquema existente de prueba ya tiene `businesses`, `app_users.business_id NOT NULL`, `app_users.is_platform_admin` y `app_state.business_id NOT NULL`.

### Otro proyecto visible

- Proyecto: `panaderia-gestion`
- ID Neon: `raspy-heart-35340312`
- Su esquema usa tablas `usuarios`, `registros`, `auditoria`, `bloques` y `contador`; no coincide con el modelo que utiliza la API actual.

### Integración Vercel

- El proyecto Vercel `panaderia-andino` tiene una integración Neon activa.
- El recurso de la integración informa un identificador externo `dawn-hill-75587663`, que no coincide con los dos IDs de proyecto Neon visibles en esta cuenta.
- Los valores de conexión de producción están almacenados como secretos cifrados y no se pudieron verificar desde esta inspección.

## Conclusión y protección

Todavía no está demostrado cuál de los proyectos Neon visibles corresponde a la base de datos usada por la aplicación en producción. Por lo tanto:

- No ejecutar migraciones ni SQL de escritura en producción.
- No cambiar variables de entorno, credenciales, usuarios ni datos.
- No publicar la rama de desarrollo.
- No asumir que `panaderia-andino-pruebas` o `panaderia-gestion` es la base de producción.

Antes de preparar la migración definitiva, se debe confirmar el vínculo entre el recurso Neon de Vercel y el proyecto/branch real, y alinear el esquema de la API con ese esquema. La rama aislada creada en `panaderia-andino-pruebas` se reserva para pruebas, no para datos reales.
