'use strict';
(() => {
  const categories = [
    'Materia prima','Insumos y mercadería','Envases y embalajes','Servicios básicos','Agua','Electricidad',
    'Internet y telefonía','Alquiler','Salarios','Cargas sociales','Honorarios profesionales','Impuestos y tasas',
    'Contabilidad','Transporte y flete','Combustible','Mantenimiento','Reparaciones','Limpieza','Seguridad','Seguros',
    'Publicidad y marketing','Comisiones bancarias','Intereses y préstamos','Software y suscripciones',
    'Equipos y herramientas','Capacitación','Viáticos','Otros gastos'
  ];
  const payments = ['Efectivo','Transferencia','Tarjeta','QR'];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,10); };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function addRow(values = {}) {
    const body = $('#bulkExpenseRows'); if (!body) return;
    const row = document.createElement('tr'); row.className = 'bulk-expense-row';
    row.innerHTML = `<td><input class="form-control form-control-sm" type="date" data-expense-date required value="${esc(values.date || today())}"></td>
      <td><input class="form-control form-control-sm" type="text" data-expense-description maxlength="100" placeholder="Ej. Compra de harina" required value="${esc(values.description || '')}"></td>
      <td><select class="form-select form-select-sm" data-expense-category>${categories.map(x=>`<option value="${esc(x)}" ${x===(values.category||'Materia prima')?'selected':''}>${esc(x)}</option>`).join('')}</select></td>
      <td><input class="form-control form-control-sm" type="number" data-expense-amount min="1" step="1" inputmode="numeric" placeholder="0" required value="${esc(values.amount || '')}"></td>
      <td><select class="form-select form-select-sm" data-expense-payment>${payments.map(x=>`<option value="${esc(x)}" ${x===(values.payment||'Efectivo')?'selected':''}>${esc(x)}</option>`).join('')}</select></td>
      <td><button class="btn btn-outline-danger btn-sm" type="button" data-remove-expense-row aria-label="Quitar gasto"><i class="bi bi-trash"></i></button></td>`;
    body.appendChild(row); updateCount();
  }
  function updateCount() { const count=$$('.bulk-expense-row').length; const el=$('#bulkExpenseCount'); if(el)el.textContent=`${count} ${count===1?'gasto cargado':'gastos cargados'}`; }
  function mountPanel() {
    // La carga múltiple es una herramienta de Gestión operativa, no de Movimientos.
    const panel=$('#bulkExpensePanel'),page=$('#page-erp');
    if(!panel||!page)return false;
    const heading=page.querySelector('.page-heading');
    if(heading&&panel.parentElement!==page)heading.insertAdjacentElement('afterend',panel);
    return page.contains(panel);
  }
  function initialize() {
    mountPanel();
    const form=$('#bulkExpenseForm'); if(!form||form.dataset.ready==='true')return;
    form.dataset.ready='true'; addRow();
    $('#addBulkExpenseRow')?.addEventListener('click',()=>addRow());
    $('#bulkExpenseRows')?.addEventListener('click',event=>{
      const remove=event.target.closest('[data-remove-expense-row]'); if(!remove)return;
      const rows=$$('.bulk-expense-row',form);
      if(rows.length<=1){rows[0].querySelectorAll('input').forEach(input=>{input.value=input.type==='date'?today():'';});return;}
      remove.closest('tr').remove(); updateCount();
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const rows=$$('.bulk-expense-row',form).map(row=>({
        date:row.querySelector('[data-expense-date]').value,
        description:row.querySelector('[data-expense-description]').value.trim(),
        category:row.querySelector('[data-expense-category]').value,
        amount:Number(row.querySelector('[data-expense-amount]').value),
        payment:row.querySelector('[data-expense-payment]').value
      }));
      if(!rows.length||rows.some(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||!x.description||x.description.length>100||!Number.isSafeInteger(x.amount)||x.amount<=0)){
        alert('Completá la fecha, el concepto y un importe entero mayor que cero en cada gasto.'); return;
      }
      const user=window.PanaderiaAuth?.user;
      if(!user|| (user.isPlatformAdmin===true&&!window.PanaderiaAuth?.selectedBusinessId)){
        alert('Para registrar gastos, primero abrí un negocio desde Administración. La cuenta principal no tiene movimientos propios.');return;
      }
      const button=$('#saveBulkExpenses'); if(!button||button.disabled)return;
      button.disabled=true; const original=button.innerHTML; button.innerHTML='<i class="bi bi-hourglass-split"></i> Guardando…';
      try{
        const result=await new Promise((resolve,reject)=>{
          document.dispatchEvent(new CustomEvent('mattsystem:bulk-expenses',{detail:{items:rows,resolve,reject}}));
        });
        $('#bulkExpenseRows').innerHTML=''; addRow();
        const status=document.createElement('div'); status.className='alert alert-success mt-3 mb-0 bulk-expense-result'; status.setAttribute('role','status');
        status.textContent=`Se guardaron correctamente ${result.saved} gastos. El servidor confirmó la sincronización.`;
        $('#bulkExpensePanel').querySelector('.bulk-expense-result')?.remove(); $('#bulkExpensePanel').appendChild(status);
      }catch(error){
        const status=document.createElement('div');status.className='alert alert-danger mt-3 mb-0 bulk-expense-result';status.setAttribute('role','alert');status.textContent=error?.message||'No se pudieron guardar los gastos. No se informó ningún registro como exitoso.';
        $('#bulkExpensePanel').querySelector('.bulk-expense-result')?.remove();$('#bulkExpensePanel').appendChild(status);
      }finally{button.disabled=false;button.innerHTML=original;}
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
  window.addEventListener('panaderia:authenticated',initialize);
})();