# Publicar Panadería Andino en Netlify

## Configuración del sitio

El archivo `netlify.toml` ya define:
- Directorio base: `panaderia-andino`
- Publicación de archivos estáticos desde ese directorio
- Función serverless en `netlify/functions`
- Reescritura de las rutas `/api/*` hacia la función `api`

## Variables de entorno obligatorias

En Netlify: **Site configuration → Environment variables**, agregar las siguientes variables para el contexto **Production**:

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | La misma cadena de conexión de Neon usada por el despliegue actual |
| `SESSION_SECRET` | El mismo secreto de sesión usado actualmente en Vercel (mínimo 32 caracteres) |
| `ADMIN_EMAIL` | El correo de la cuenta administradora |
| `ADMIN_BOOTSTRAP_TOKEN` | El token de activación existente, si todavía se necesita para activar el primer administrador |

No publicar estos valores en GitHub ni compartirlos en mensajes. Copiarlos directamente desde el panel seguro de variables del proveedor anterior. Mantener el mismo `SESSION_SECRET` conserva la misma clave de firma; como el dominio de Netlify es distinto, los usuarios deberán iniciar sesión nuevamente en ese dominio.

## Publicación

1. Esperar a que Netlify termine de sincronizar la rama `main`.
2. Confirmar que las cuatro variables estén configuradas en Production.
3. Ejecutar **Deploys → Trigger deploy → Deploy site**.
4. Revisar el registro de compilación y probar:
   - La página principal.
   - `/api/auth/status` (debe responder JSON).
   - Inicio de sesión.
   - Lectura y guardado de datos.

La función de Netlify reutiliza el backend existente; no crea, borra ni migra tablas de Neon.
