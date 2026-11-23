'use strict';

const core = require('../[...path].js');
const { db, authenticated, send, body } = core._internal || {};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const money = value => Number(value);
const validDate = value => { if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(value||''))) return false; const date=new Date(String(value)+'T00:00:00Z'); return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0,10)===String(value); };

async function requireAddon(sql, businessId) {
  const rows = await sql`SELECT 1 FROM app_business_addons a
    JOIN app_module_catalog m ON m.module_key=a.module_key
    WHERE a.business_id=${businessId} AND a.module_key='receivables'
      AND a.contracted=TRUE AND a.enabled=TRUE AND a.status='active'
      AND m.active=TRUE AND m.implemented=TRUE AND m.commercial_mode='addon'
    LIMIT 1`;
  return rows.length > 0;
}

module.exports = async function receivablesHandler(req, res) {
  try {
    if (!db || !authenticated || !send || !body) { res.statusCode=500; return res.end(); }
    const user = await authenticated(req, res, false);
    if (!user) return;
    if (user.is_platform_admin === true || !user.business_id) {
      return send(res, 403, { error: 'Este complemento solo está disponible para cuentas vinculadas a un negocio.' });
    }

    const businessId = String(user.business_id);
    const sql = db();
    if (!(await requireAddon(sql, businessId))) {
      return send(res, 403, { code: 'ADDON_INACTIVE', error: 'Cuentas por cobrar no está contratado y activado para este negocio.' });
    }

    const permissions = user.permissions && typeof user.permissions === 'object' && !Array.isArray(user.permissions) ? user.permissions : {};
    const manager = user.role === 'admin' || user.role === 'supervisor';
    const can = key => manager || permissions[key] === true;
    const canRead = can('receivables.view') || can('receivables.manage');
    const canWrite = can('receivables.manage');

    if (req.method === 'GET') {
      if (!canRead) return send(res, 403, { error: 'No tenés permiso para consultar cuentas por cobrar.' });
      const [debts, customers, payments, settings, audit] = await Promise.all([
        sql`SELECT d.id,d.customer_id,c.name AS customer_name,c.last_name AS customer_last_name,
            c.phone AS customer_phone,d.description,d.amount,d.due_date,d.status,d.created_at,d.updated_at,
            COALESCE(SUM(p.amount) FILTER (WHERE p.status='active'),0)::numeric(14,2) AS paid_total,
            GREATEST(d.amount-COALESCE(SUM(p.amount) FILTER (WHERE p.status='active'),0),0)::numeric(14,2) AS balance
          FROM app_receivable_debts d
          JOIN app_customers c ON c.business_id=d.business_id AND c.id=d.customer_id
          LEFT JOIN app_receivable_payments p ON p.business_id=d.business_id AND p.debt_id=d.id
          WHERE d.business_id=${businessId}
          GROUP BY d.id,c.name,c.last_name,c.phone
          ORDER BY d.created_at DESC LIMIT 500`,
        sql`SELECT id,name,last_name,phone,address,notes,active
          FROM app_customers WHERE business_id=${businessId} AND active=TRUE
          ORDER BY name,last_name LIMIT 1000`,
        sql`SELECT p.id,p.debt_id,p.amount,p.paid_at,p.payment_method,p.status,p.reversal_reason,p.reversed_at,
            c.name AS customer_name,c.last_name AS customer_last_name,d.description AS debt_description
          FROM app_receivable_payments p
          JOIN app_receivable_debts d ON d.business_id=p.business_id AND d.id=p.debt_id
          JOIN app_customers c ON c.business_id=d.business_id AND c.id=d.customer_id
          WHERE p.business_id=${businessId}
          ORDER BY p.paid_at DESC LIMIT 500`,
        sql`SELECT CASE WHEN jsonb_typeof(data->'paymentMethods')='array'
          THEN data->'paymentMethods'
          ELSE '["Efectivo","Transferencia","Tarjeta","QR"]'::jsonb END AS payment_methods
          FROM app_state WHERE business_id=${businessId} LIMIT 1`,
        sql`SELECT a.id,a.debt_id,a.payment_id,a.event_type,a.details,a.created_at,u.name AS actor_name,c.name AS customer_name,c.last_name AS customer_last_name
          FROM app_receivable_audit a
          JOIN app_receivable_debts d ON d.business_id=a.business_id AND d.id=a.debt_id
          JOIN app_customers c ON c.business_id=d.business_id AND c.id=d.customer_id
          LEFT JOIN app_users u ON u.id=a.actor_user_id
          WHERE a.business_id=${businessId} ORDER BY a.created_at DESC LIMIT 500`
      ]);
      const paymentMethods = Array.isArray(settings[0]?.payment_methods) ? settings[0].payment_methods : ['Efectivo','Transferencia','Tarjeta','QR'];
      const today = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion'}).format(new Date());
      const openDebts = debts.filter(row => row.status === 'open');
      const pendingTotal = openDebts.reduce((sum,row) => sum + Math.max(0,money(row.balance)),0);
      const overdue = openDebts.filter(row => row.due_date && String(row.due_date).slice(0,10) < today);
      const customersOwing = new Set(openDebts.filter(row => money(row.balance)>0).map(row => String(row.customer_id)));
      return send(res, 200, {
        debts, customers, payments, paymentMethods, audit,
        summary: {
          pendingTotal,
          indebtedCustomers: customersOwing.size,
          overdueDebts: overdue.length,
          recentPayments: payments.slice(0,8)
        }
      });
    }

    if (req.method === 'POST') {
      if (!canWrite) return send(res, 403, { error: 'No tenés permiso para registrar deudas o pagos.' });
      const input = body(req);
      const action = clean(input.action, 32);

      if (action === 'customer') {
        const name = clean(input.name, 100);
        const lastName = clean(input.lastName, 100);
        if (!name) return send(res, 400, { error: 'Ingresá el nombre del cliente.' });
        const rows = await sql`WITH created AS (
            INSERT INTO app_customers(business_id,name,last_name,phone,address,notes)
            VALUES(${businessId},${name},${lastName},${clean(input.phone,60)||null},${clean(input.address,250)||null},${clean(input.notes,1000)||null})
            RETURNING id,name,last_name,phone,address,notes,active
          ), logged AS (
            INSERT INTO app_audit_logs(business_id,actor_user_id,action,entity_type,entity_id,details)
            SELECT ${businessId},${user.id},'receivables.customer_created','customer',id,${JSON.stringify({name,lastName})}::jsonb FROM created RETURNING id
          ) SELECT * FROM created`;
        return send(res, 201, { customer: rows[0] });
      }

      if (action === 'debt') {
        const customerId = clean(input.customerId, 64);
        const description = clean(input.description, 240);
        const amount = money(input.amount);
        const dueDate = input.dueDate ? clean(input.dueDate,10) : null;
        const idempotencyKey = clean(input.idempotencyKey,128);
        if (!UUID.test(customerId) || !description || !Number.isFinite(amount) || amount <= 0 ||
            (dueDate && (!validDate(dueDate))) ||
            idempotencyKey.length < 8) {
          return send(res, 400, { error: 'Completá cliente, concepto, importe, fecha e identificador de operación válidos.' });
        }
        const customer = await sql`SELECT id FROM app_customers WHERE id=${customerId} AND business_id=${businessId} AND active=TRUE LIMIT 1`;
        if (!customer.length) return send(res, 404, { error: 'El cliente no pertenece a este negocio o está inactivo.' });
        const inserted = await sql`WITH created AS (
            INSERT INTO app_receivable_debts(business_id,customer_id,description,amount,due_date,status,actor_user_id,idempotency_key)
            VALUES(${businessId},${customerId},${description},${amount},${dueDate},'open',${user.id},${idempotencyKey})
            ON CONFLICT (business_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
            RETURNING *
          ), logged AS (
            INSERT INTO app_receivable_audit(business_id,debt_id,actor_user_id,event_type,details)
            SELECT business_id,id,${user.id},'debt_created',jsonb_build_object('amount',amount,'customer_id',customer_id,'description',description)
            FROM created RETURNING id
          ) SELECT * FROM created`;
        if (inserted.length) return send(res, 201, { debt: inserted[0] });
        const existing = await sql`SELECT * FROM app_receivable_debts WHERE business_id=${businessId} AND idempotency_key=${idempotencyKey} LIMIT 1`;
        if (!existing.length) return send(res, 409, { error: 'No se pudo registrar la deuda. Intentá nuevamente.' });
        const same = String(existing[0].customer_id)===customerId &&
          Number(existing[0].amount)===amount && String(existing[0].description)===description;
        if (!same) return send(res, 409, { error: 'El identificador de esta operación ya fue utilizado con otros datos.' });
        return send(res, 200, { debt: existing[0], duplicate: true });
      }

      if (action === 'payment') {
        const debtId = clean(input.debtId,64);
        const amount = money(input.amount);
        const paymentMethod = clean(input.paymentMethod,40);
        const idempotencyKey = clean(input.idempotencyKey,128);
        if (!UUID.test(debtId) || !Number.isFinite(amount) || amount <= 0 || !paymentMethod || idempotencyKey.length < 8) {
          return send(res, 400, { error: 'Ingresá una deuda, un importe, un método de pago y un identificador válidos.' });
        }
        const inserted = await sql`INSERT INTO app_receivable_payments(business_id,debt_id,amount,payment_method,idempotency_key,actor_user_id)
          VALUES(${businessId},${debtId},${amount},${paymentMethod},${idempotencyKey},${user.id})
          ON CONFLICT (business_id,idempotency_key) DO NOTHING RETURNING *`;
        if (inserted.length) return send(res, 201, { payment: inserted[0] });
        const existing = await sql`SELECT * FROM app_receivable_payments WHERE business_id=${businessId} AND idempotency_key=${idempotencyKey} LIMIT 1`;
        if (!existing.length) return send(res, 409, { error: 'No se pudo registrar el pago. Intentá nuevamente.' });
        const same = String(existing[0].debt_id)===debtId && Number(existing[0].amount)===amount &&
          String(existing[0].payment_method)===paymentMethod;
        if (!same) return send(res, 409, { error: 'El identificador de esta operación ya fue utilizado con otros datos.' });
        return send(res, 200, { payment: existing[0], duplicate: true });
      }

      return send(res, 400, { error: 'Acción de cuentas por cobrar no válida.' });
    }

    if (req.method === 'PATCH') {
      if (!canWrite) return send(res, 403, { error: 'No tenés permiso para modificar deudas o anular pagos.' });
      const input = body(req);
      const action = clean(input.action,32);

      if (action === 'debt_update') {
        const id = clean(input.id,64);
        const description = clean(input.description,240);
        const amount = money(input.amount);
        const dueDate = input.dueDate ? clean(input.dueDate,10) : null;
        if (!UUID.test(id) || !description || !Number.isFinite(amount) || amount <= 0 ||
            (dueDate && !validDate(dueDate))) {
          return send(res,400,{error:'Los datos de la deuda no son válidos.'});
        }
        const rows = await sql`WITH changed AS (
            UPDATE app_receivable_debts SET description=${description},amount=${amount},due_date=${dueDate},updated_at=NOW()
            WHERE id=${id} AND business_id=${businessId} AND status='open' RETURNING *
          ), logged AS (
            INSERT INTO app_receivable_audit(business_id,debt_id,actor_user_id,event_type,details)
            SELECT business_id,id,${user.id},'debt_updated',jsonb_build_object('amount',amount,'description',description,'due_date',due_date)
            FROM changed RETURNING id
          ) SELECT * FROM changed`;
        if (!rows.length) return send(res,404,{error:'No se encontró una deuda abierta para modificar.'});
        return send(res,200,{debt:rows[0]});
      }

      if (action === 'debt_cancel') {
        const id = clean(input.id,64);
        const reason = clean(input.reason,500);
        if (!UUID.test(id) || !reason) return send(res,400,{error:'Indicá la deuda y el motivo de anulación.'});
        const rows = await sql`WITH changed AS (
            UPDATE app_receivable_debts SET status='cancelled',updated_at=NOW()
            WHERE id=${id} AND business_id=${businessId} AND status='open' RETURNING *
          ), logged AS (
            INSERT INTO app_receivable_audit(business_id,debt_id,actor_user_id,event_type,details)
            SELECT business_id,id,${user.id},'debt_cancelled',jsonb_build_object('reason',${reason})
            FROM changed RETURNING id
          ) SELECT * FROM changed`;
        if (!rows.length) return send(res,409,{error:'No se puede anular: la deuda no existe, ya fue procesada o tiene pagos activos.'});
        return send(res,200,{debt:rows[0]});
      }

      if (action === 'reverse_payment') {
        const paymentId = clean(input.paymentId,64);
        const reason = clean(input.reason,500);
        if (!UUID.test(paymentId) || !reason) return send(res,400,{error:'Indicá el pago y el motivo de anulación.'});
        const rows = await sql`UPDATE app_receivable_payments
          SET status='reversed',reversed_by=${user.id},reversed_at=NOW(),reversal_reason=${reason}
          WHERE id=${paymentId} AND business_id=${businessId} AND status='active'
          RETURNING *`;
        if (!rows.length) return send(res,409,{error:'No se encontró un pago activo para anular.'});
        return send(res,200,{payment:rows[0]});
      }

      return send(res,400,{error:'Acción de modificación no válida.'});
    }

    return send(res,405,{error:'Método no permitido.'});
  } catch (error) {
    if (error?.code === '23505') return send(res,409,{error:'El registro ya existe. Verificá si la operación ya fue procesada.'});
    if (error?.code === '42501') return send(res,403,{error:error.message || 'El complemento no está habilitado o el usuario no pertenece al negocio.'});
    if (error?.code === '23514') return send(res,409,{error:error.message || 'La operación no cumple las reglas de integridad.'});
    console.error('Receivables API error:',error);
    return send(res,500,{error:'No se pudo completar la operación de cuentas por cobrar.'});
  }
};
