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
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,10); };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function addRow(values = {}) {
    const body = $('#bulkExpenseRows'); if (!body) return;
    const row = document.createElement('tr'); row.className = 'bulk-expense-row';
    row.innerHTML = `<td><input class="form-control form-control-sm" type="date" data-expense-date required value="${esc(values.date || today())}"></td>
      <td><input class="form-control form-control-sm" type="text" data-expense-description maxlength="160" placeholder="Ej. Compra de harina" required value="${esc(values.description || '')}"></td>
      <td><select class="form-select form-select-sm" data-expense-category>${categories.map(x=>`<option value="${esc(x)}" ${x===(values.category||'Materia prima')?'selected':''}>${esc(x)}</option>`).join('')}</select></td>
      <td><input class="form-control form-control-sm" type="number" data-expense-amount min="1" step="1" inputmode="numeric" placeholder="0" required value="${esc(values.amount || '')}"></td>
      <td><select class="form-select form-select-sm" data-expense-payment>${payments.map(x=>`<option value="${esc(x)}" ${x===(values.payment||'Efectivo')?'selected':''}>${esc(x)}</option>`).join('')}</select></td>
      <td><button class="btn btn-outline-danger btn-sm" type="button" data-remove-expense-row aria-label="Quitar gasto"><i class="bi bi-trash"></i></button></td>`;
    body.appendChild(row); updateCount();
  }
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  function updateCount() { const count=$$('.bulk-expense-row').length; const el=$('#bulkExpenseCount'); if(el)el.textContent=`${count} ${count===1?'gasto cargado':'gastos cargados'}`; }
  function mountPanel() {
    const panel=$('#bulkExpensePanel'), page=$('#page-erp');
    if(!panel||!page)return false;
    const heading=page.querySelector('.page-heading');
    if(heading&&panel.parentElement!==page)heading.insertAdjacentElement('afterend',panel);
    return true;
  }
  function initialize() {
    mountPanel();
    const observer=new MutationObserver(()=>{if(mountPanel())observer.disconnect();});
    observer.observe(document.body,{childList:true,subtree:true});
    const form=$('#bulkExpenseForm'); if(!form||form.dataset.ready==='true')return;
    form.dataset.ready='true'; addRow();
    $('#addBulkExpenseRow')?.addEventListener('click',()=>addRow());
    $('#bulkExpenseRows')?.addEventListener('click',event=>{
      const remove=event.target.closest('[data-remove-expense-row]'); if(!remove)return;
      const rows=$$('.bulk-expense-row'); if(rows.length<=1){rows[0].querySelectorAll('input').forEach(input=>{if(input.type==='date')input.value=today();else input.value='';});return;}
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
      if(!rows.length||rows.some(x=>!x.date||!x.description||!Number.isFinite(x.amount)||x.amount<=0)){
        alert('Completá la fecha, el concepto y un importe mayor que cero en cada gasto.'); return;
      }
      const openExpense=$('[data-open-movement="expense"]'); const movementForm=$('#movementForm');
      if(!openExpense||!movementForm||!window.PanaderiaAuth?.user){alert('No se pudo abrir el registro de gastos. Recargá el sistema e intentá nuevamente.');return;}
      const button=$('#saveBulkExpenses'); button.disabled=true;
      let saved=0;
      try {
        for(const item of rows){
          openExpense.click();
          const set=(selector,value)=>{const el=$(selector);if(el)el.value=value;};
          set('#movementDescription',item.description); set('#movementAmount',String(item.amount));
          set('#movementDate',item.date); set('#movementType','expense'); set('#movementNote','');
          const category=$('#movementCategory');
          if(category&&!Array.from(category.options).some(option=>option.value===item.category))category.add(new Option(item.category,item.category));
          set('#movementCategory',item.category); set('#movementPayment',item.payment);
          movementForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
          saved++;
          await new Promise(resolve=>setTimeout(resolve,90));
        }
        await new Promise(resolve=>setTimeout(resolve,900));
        $('#bulkExpenseRows').innerHTML=''; addRow();
        const status=document.createElement('div'); status.className='alert alert-success mt-3 mb-0'; status.setAttribute('role','status'); status.textContent=`Se registraron ${saved} gastos. Ya están incluidos en Movimientos y en los totales.`;
        $('#bulkExpensePanel').querySelector('.bulk-expense-result')?.remove(); status.classList.add('bulk-expense-result'); $('#bulkExpensePanel').appendChild(status);
      } catch(error) {
        alert(error?.message||`Se procesaron ${saved} gastos antes de encontrar un problema. Revisá Movimientos antes de volver a intentarlo.`);
      } finally { button.disabled=false; }
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
  window.addEventListener('panaderia:authenticated',initialize);
})();