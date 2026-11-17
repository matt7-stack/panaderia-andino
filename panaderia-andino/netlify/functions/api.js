'use strict';

// Adaptador de Netlify para reutilizar sin cambios la API existente de Vercel.
// Conserva las mismas rutas, cookies, validaciones y conexión a Neon.
const apiHandler = require('../../api/[...path].js');

exports.handler = async (event) => {
  const headers = Object.fromEntries(
    Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value])
  );
  const host = headers['x-forwarded-host'] || headers.host || 'localhost';
  const incomingPath = event.path || '';
  const functionPrefix = '/.netlify/functions/api';
  let pathname;

  if (incomingPath.startsWith(functionPrefix)) {
    pathname = '/api' + incomingPath.slice(functionPrefix.length);
  } else if (incomingPath === '/api' || incomingPath.startsWith('/api/')) {
    pathname = incomingPath;
  } else {
    pathname = '/api' + (incomingPath.startsWith('/') ? incomingPath : '/' + incomingPath);
  }

  const query = event.rawQuery ? '?' + event.rawQuery : '';
  const rawBody = event.body
    ? (event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body)
    : '';

  const req = {
    method: event.httpMethod || 'GET',
    url: pathname + query,
    headers: { ...headers, host, 'x-forwarded-host': host },
    body: rawBody
  };

  let statusCode = 200;
  const responseHeaders = {};
  let responseBody = '';

  const res = {
    set statusCode(value) { statusCode = value; },
    get statusCode() { return statusCode; },
    setHeader(name, value) { responseHeaders[name] = value; },
    end(value) { responseBody = value == null ? '' : String(value); }
  };

  try {
    await apiHandler(req, res);
    return {
      statusCode,
      headers: responseHeaders,
      body: responseBody,
      isBase64Encoded: false
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({
        error: 'No se pudo completar la solicitud. Verificá la configuración del servidor.'
      })
    };
  }
};
