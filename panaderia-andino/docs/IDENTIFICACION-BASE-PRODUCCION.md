# Identificación de la base de datos de producción

## Hallazgo de auditoría (2026-11-19)

El proyecto Vercel `panaderia-andino` tiene una variable `DATABASE_URL` con destino `production` y `preview`, administrada por el almacén de secretos de la integración de Neon. El valor es de tipo `sensitive` / `integration-store-secret`; la API de gestión no permite leerlo ni obtener su host o nombre de base de datos. La configuración de integración expone `projects: []`, por lo que no aporta un identificador verificable de proyecto Neon.

Se revisaron los proyectos Neon visibles en la cuenta:

| Proyecto | ID | Esquema encontrado | Conclusión |
|---|---|---|---|
| panaderia-andino-pruebas | `dawn-truth-17829414` | `app_users`, `businesses`, `app_state`, etc. | Entorno de pruebas |
| gestion-panaderia-nueva | `quiet-grass-59745537` | `app_users`, `businesses`, `app_state`, etc. | Entorno aislado de desarrollo |
| panaderia-gestion | `raspy-heart-35340312` | `usuarios`, `registros`, `auditoria`, etc. | Esquema legado, no coincide con la API SaaS actual |

No hay evidencia suficiente para asociar ninguno de esos proyectos con el secreto de producción de Vercel. No se debe inferir que el proyecto de pruebas o el esquema legado sean producción, ni cambiar la variable `DATABASE_URL` basándose únicamente en el nombre.

## Diagnóstico seguro agregado

La API incorpora `GET /api/admin/database-info`, protegido por sesión y rol de administrador global. Devuelve únicamente:

- Proveedor PostgreSQL/Neon detectado.
- Host y nombre de base de datos.
- Rol de conexión y versión del servidor.
- Entorno, proyecto y deployment de Vercel.

No devuelve contraseñas, URI de conexión, tokens ni hashes. Al ejecutarse dentro del deployment, lee las variables inyectadas por Vercel y consulta la identidad real del servidor conectado.

## Cómo cerrar la identificación

Después de desplegar esta versión en producción, el administrador global puede consultar el endpoint desde una sesión autenticada:

`/api/admin/database-info`

El `host` y el `database` devueltos deben cotejarse con la consola de Neon para obtener el ID exacto del proyecto y la rama. Si el host aparece vacío, se debe abrir el recurso Neon vinculado a la variable sensible desde Vercel Marketplace / Neon y confirmar su proyecto de origen. No se ejecutan migraciones en este diagnóstico.

## Protección

Hasta que el resultado se coteje con la consola de Neon, queda prohibido aplicar migraciones, resetear datos o sustituir credenciales de producción. El endpoint es de solo lectura y está limitado al administrador global.
