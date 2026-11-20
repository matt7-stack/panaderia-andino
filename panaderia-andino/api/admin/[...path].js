'use strict';

// Una sola función de Vercel atiende todas las rutas administrativas.
// El handler común determina la ruta mediante req.url y aplica sus controles habituales.
const handler = require('../[...path].js');

module.exports = async function adminApiHandler(req, res) {
  return handler(req, res);
};
