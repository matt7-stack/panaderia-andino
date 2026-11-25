'use strict';

const core = require('../[...path].js');
const { db, authenticated, send, body } = core._internal || {};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

module.exports = async function businessAddonsHandler(req,res) {
  return core._internal.runWithRequestContext(async () => {
  try {
    if (!db || !authenticated || !send || !body) { res.statusCode=500; return res.end(); }
    const admin = await authenticated(req,res,true);
    if (!admin) return;
    const sql = db();

    if (req.method === 'GET') {
      const url = new URL(req.url, 'https://' + (req.headers.host || 'localhost'));
      const businessId = String(url.searchParams.get('businessId') || '');
      if (!UUID.test(businessId)) return send(res,400,{error:'Seleccioná un negocio válido.'});
      const addons = await sql`SELECT m.module_key,m.title,m.description,m.monthly_price,m.setup_price,
          COALESCE(a.contracted,FALSE) AS contracted,COALESCE(a.enabled,FALSE) AS enabled,
          COALESCE(a.status,'not_contracted') AS status,a.contracted_at,a.activated_at,a.deactivated_at,a.updated_at
        FROM app_module_catalog m
        LEFT JOIN app_business_addons a ON a.module_key=m.module_key AND a.business_id=${businessId}
        WHERE m.commercial_mode='addon' AND m.implemented=TRUE
        ORDER BY m.sort_order,m.title`;
      return send(res,200,{addons});
    }

    if (req.method === 'PUT') {
      const input = body(req);
      const businessId = String(input.businessId || '');
      const moduleKey = String(input.moduleKey || '').trim();
      const status = String(input.status || '');
      if (!UUID.test(businessId) || !moduleKey || !['active','suspended','cancelled','not_contracted'].includes(status)) {
        return send(res,400,{error:'Datos del complemento no válidos.'});
      }
      if (status === 'active' && input.contractConfirmed !== true) {
        return send(res,400,{error:'Confirmá que el negocio contrató este complemento antes de activarlo.'});
      }
      const eligible = await sql`SELECT module_key,title FROM app_module_catalog
        WHERE module_key=${moduleKey} AND commercial_mode='addon' AND implemented=TRUE AND (${status}<>'active' OR active=TRUE) LIMIT 1`;
      if (!eligible.length) return send(res,409,{error:'El complemento no está disponible para contratación.'});
      const business = await sql`SELECT id,name FROM businesses WHERE id=${businessId} LIMIT 1`;
      if (!business.length) return send(res,404,{error:'El negocio no existe o está inactivo.'});

      const contracted = status === 'active' || status === 'suspended';
      const enabled = status === 'active';
      const rows = await sql`WITH saved AS (
          INSERT INTO app_business_addons(business_id,module_key,contracted,enabled,status,contracted_at,activated_at,deactivated_at,updated_by,updated_at)
          VALUES(${businessId},${moduleKey},${contracted},${enabled},${status},
            CASE WHEN ${contracted} THEN NOW() ELSE NULL END,
            CASE WHEN ${enabled} THEN NOW() ELSE NULL END,
            CASE WHEN ${enabled} THEN NULL ELSE NOW() END,${admin.id},NOW())
          ON CONFLICT (business_id,module_key) DO UPDATE SET
            contracted=EXCLUDED.contracted,enabled=EXCLUDED.enabled,status=EXCLUDED.status,
            contracted_at=CASE WHEN EXCLUDED.contracted THEN COALESCE(app_business_addons.contracted_at,NOW()) ELSE app_business_addons.contracted_at END,
            activated_at=CASE WHEN EXCLUDED.enabled THEN NOW() ELSE app_business_addons.activated_at END,
            deactivated_at=CASE WHEN EXCLUDED.enabled THEN NULL ELSE NOW() END,
            updated_by=EXCLUDED.updated_by,updated_at=NOW()
          RETURNING *
        ), audit AS (
          INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details)
          SELECT ${businessId},${admin.id},'business.addon_status_changed','business_addon',${moduleKey},
            jsonb_build_object('moduleKey',${moduleKey},'status',${status},'contracted',${contracted},'enabled',${enabled})
          FROM saved RETURNING id
        ), notifications AS (
          INSERT INTO app_notifications(business_id,user_id,type,title,message)
          SELECT ${businessId},u.id,'license_update',
            CASE WHEN ${status}='active' THEN 'Complemento habilitado' WHEN ${status}='suspended' THEN 'Complemento suspendido' ELSE 'Estado del complemento actualizado' END,
            CASE WHEN ${status}='active' THEN ${eligible[0].title}||' ya está disponible en tu negocio.'
              WHEN ${status}='suspended' THEN ${eligible[0].title}||' fue suspendido. Los datos se conservarán.'
              WHEN ${status}='cancelled' THEN ${eligible[0].title}||' fue cancelado. Los datos se conservarán.'
              ELSE ${eligible[0].title}||' no está contratado.' END
          FROM app_users u WHERE u.business_id=${businessId} AND u.active=TRUE AND u.role IN ('admin','supervisor')
          RETURNING id
        ) SELECT * FROM saved`;
      return send(res,200,{addon:rows[0]});
    }

    return send(res,405,{error:'Método no permitido.'});
  } catch (error) {
    if (error?.code === '23514') return send(res,409,{error:'El estado solicitado no cumple las reglas del complemento.'});
    console.error('Business addons API error:',error);
    return send(res,500,{error:'No se pudo actualizar el complemento del negocio.'});
  }
  });
};
