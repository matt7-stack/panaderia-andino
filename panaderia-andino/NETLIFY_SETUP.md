# Publicar Panadería Andino en Netlify

## Configuración del sitio

El archivo `netlify.toml` ya define:
- Directorio base: `panaderia-andino`
- Publicación de archivos estáticos desde ese directorio
- Función serverless en `netlify/functions`
- Reescritura de las rutas `/api/*` hacia la función `api`

## Variables de entorno

En Netlify: **Site configuration → Environment variables**, agregar estas variables para el contexto **Production**:

| Variable | Cuándo se necesita | Valor |
| --- | --- | --- |
| `DATABASE_URL` | Siempre | La cadena de conexión de Neon usada por el despliegue actual |
| `SESSION_SECRET` | Siempre | El mismo secreto de sesión usado actualmente en Vercel (mínimo 32 caracteres) |
| `ADMIN_EMAIL` | Solo si todavía no se activó la cuenta administradora | El correo de la cuenta administradora |
| `ADMIN_BOOTSTRAP_TOKEN` | Solo si todavía no se activó la cuenta administradora | El token de activación existente |

No publicar estos valores en GitHub ni compartirlos en mensajes. Copiarlos directamente desde el panel seguro del proveedor anterior. Mantener el mismo `SESSION_SECRET` conserva la clave de firma; como el dominio de Netlify es distinto, los usuarios deberán iniciar sesión nuevamente en ese dominio.

## Publicación

1. Esperar a que Netlify termine de sincronizar la rama `main`.
2. Confirmar que `DATABASE_URL` y `SESSION_SECRET` estén configuradas en Production.
3. Si aún no existe una cuenta administradora, configurar también `ADMIN_EMAIL` y `ADMIN_BOOTSTRAP_TOKEN`.
4. Ejecutar **Deploys → Trigger deploy → Deploy site**.
5. Revisar el registro de compilación y probar:
   - La página principal.
   - `/api/auth/status` (debe responder JSON).
   - Inicio de sesión.
   - Lectura y guardado de datos.

La función de Netlify reutiliza el backend existente; no crea, borra ni migra tablas de Neon.
