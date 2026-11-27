(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>'Gs. '+Number(v||0).toLocaleString('es-PY',{maximumFractionDigits:0});
let busy=false,loadedFor='';
function user(){return window.PanaderiaAuth?.user||null;}
function allowed(key){const u=user();if(!u)return false;if(u.isPlatformAdmin===true||u.role==='admin')return true;if(u.role==='supervisor'&&['inventory.view','inventory.manage','cash.view','reports.view'].includes(key))return true;return u.permissions?.[key]===true;}
function modules(){return user()?.businessConfig?.modules||[];}
async function api(module,method='GET',body){const opts={method};if(body)opts.body=JSON.stringify({...body,module});return window.PanaderiaAuth.api('/api/business/erp?module='+encodeURIComponent(module),opts);}
function mount(){
 const page=$('#page-erp');if(!page||!user()||user().isPlatformAdmin===true&&!window.PanaderiaAuth?.selectedBusinessId)return false;
 if($('#businessImprovementPanel',page))return true;
 const heading=$('.page-heading',page);if(!heading)return false;
 const panel=document.createElement('section');panel.id='businessImprovementPanel';panel.className='panel settings-card mb-3';
 panel.innerHTML='<div class="d-flex justify-content-between align-items-start flex-wrap gap-2"><div><p class="eyebrow mb-1">CONTROL Y MEJORA</p><h2 class="h5 mb-1">Resumen operativo</h2><p class="text-muted small mb-0">Alertas de stock, mermas, caja y resultados. Los módulos se consultan según tu licencia y permisos.</p></div><button type="button" class="btn btn-sm btn-outline-bakery" id="refreshBusinessImprovement">Actualizar</button></div><div id="businessImprovementStatus" class="small text-muted mt-3">Preparando resumen…</div><div id="businessImprovementMetrics" class="row g-2 mt-1"></div><div id="businessImprovementDetails" class="mt-3"></div>';
 heading.insertAdjacentElement('afterend',panel);
 panel.addEventListener('click',handleClick);
 $('#refreshBusinessImprovement',panel).addEventListener('click',load);
 load();return true;
}
function metric(label,value,detail){return '<div class="col-6 col-xl-3"><div class="border rounded-3 p-3 h-100"><small class="text-muted">'+esc(label)+'</small><div class="h5 mt-1 mb-1">'+esc(value)+'</div><small class="text-muted">'+esc(detail||'')+'</small></div></div>';}
async function load(){
 if(busy||!$('#businessImprovementPanel'))return;busy=true;
 const status=$('#businessImprovementStatus'),metrics=$('#businessImprovementMetrics'),details=$('#businessImprovementDetails');
 if(status)status.textContent='Actualizando información…';
 try{
  const configured=modules(),jobs=[];
  if(configured.includes('inventory')&&allowed('inventory.view'))jobs.push(api('inventory').then(x=>['inventory',x]));
  if(configured.includes('cash')&&allowed('cash.view'))jobs.push(api('cash').then(x=>['cash',x]));
  if(configured.includes('reports')&&allowed('reports.view'))jobs.push(api('reports').then(x=>['reports',x]));
  const results=await Promise.allSettled(jobs),data={};
  results.forEach(r=>{if(r.status==='fulfilled')data[r.value[0]]=r.value[1];});
  const inventory=data.inventory||{},products=inventory.products||[],movements=inventory.movements||[];
  const low=products.filter(p=>Number(p.min_stock)>0&&Number(p.stock)<=Number(p.min_stock));
  const wastes=movements.filter(m=>m.movement_type==='waste');
  const wasteQty=wastes.reduce((a,m)=>a+Number(m.quantity||0),0);
  const sessions=(data.cash?.sessions||[]),open=sessions.find(s=>s.status==='open');
  const months=data.reports?.months||[],month=months[months.length-1]||{};
  const cards=[];
  if(configured.includes('inventory')&&allowed('inventory.view'))cards.push(metric('Productos bajo mínimo',String(low.length),low.length?'Requieren reposición':'Sin alertas de stock'));
  if(configured.includes('inventory')&&allowed('inventory.view'))cards.push(metric('Mermas registradas',String(wastes.length),wasteQty.toLocaleString('es-PY')+' unidades en el historial'));
  if(configured.includes('cash')&&allowed('cash.view'))cards.push(metric('Estado de caja',open?'Abierta':'Cerrada',open?'Apertura '+money(open.opening_amount):'No hay sesión abierta'));
  if(configured.includes('reports')&&allowed('reports.view'))cards.push(metric('Resultado del mes',money(month.net_profit),'Estimación según ventas, costos y gastos registrados'));
  if(metrics)metrics.innerHTML=cards.join('')||'<div class="col-12"><p class="text-muted small">No hay módulos operativos disponibles para este usuario o licencia.</p></div>';
  let html='';
  if(configured.includes('inventory')&&allowed('inventory.view'))html+='<div class="border rounded-3 p-3 mb-2"><strong>Alertas de reposición</strong>'+(low.length?'<div class="table-responsive mt-2"><table class="table table-sm mb-0"><thead><tr><th>Producto</th><th>Existencia</th><th>Mínimo</th></tr></thead><tbody>'+low.slice(0,12).map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+esc(p.stock)+' '+esc(p.unit||'')+'</td><td>'+esc(p.min_stock)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="small text-muted mb-0 mt-2">No hay productos por debajo del mínimo configurado.</p>')+'</div>';
  if(configured.includes('cash')&&allowed('cash.view'))html+='<div class="border rounded-3 p-3 mb-2"><strong>Cierre y arqueo de caja</strong>'+(open?'<p class="small text-muted mt-1 mb-2">Apertura: '+money(open.opening_amount)+' · Iniciada: '+esc(open.opened_at?new Date(open.opened_at).toLocaleString('es-PY'):'')+'</p>'+(allowed('cash.close')?'<form id="businessImprovementCloseCash" class="row g-2 align-items-end"><input type="hidden" name="sessionId" value="'+esc(open.id)+'"><div class="col-sm-6"><label class="form-label small" for="businessImprovementClosingAmount">Efectivo contado al cierre</label><input class="form-control" id="businessImprovementClosingAmount" name="closingAmount" type="number" min="0" step="1" required></div><div class="col-sm-6"><button class="btn btn-outline-danger" type="submit">Cerrar caja y calcular diferencia</button></div></form>':'<p class="small text-muted mb-0">Tu rol puede consultar caja, pero no tiene permiso para cerrarla.</p>'):'<p class="small text-muted mb-0 mt-2">No hay una caja abierta. Abrila desde el módulo Caja.</p>')+'</div>';
  if(configured.includes('inventory')&&allowed('inventory.view'))html+='<div class="border rounded-3 p-3 mb-2"><strong>Control de mermas</strong><p class="small text-muted mb-0 mt-1">Se registraron '+wastes.length+' movimientos de merma, con un total de '+wasteQty.toLocaleString('es-PY')+' unidades. El detalle y la carga se realizan desde Inventario.</p></div>';
  if(details)details.innerHTML=html||'<p class="small text-muted">No hay información operativa disponible.</p>';
  if(status)status.textContent='Resumen actualizado · '+new Date().toLocaleString('es-PY')+(results.some(r=>r.status==='rejected')?' · Algunas consultas no estuvieron disponibles.':'');
 }catch(e){if(status)status.textContent=e.message||'No se pudo actualizar el resumen.';}
 finally{busy=false;}
}
async function handleClick(e){
 const form=e.target.closest('#businessImprovementCloseCash');if(!form)return;
}
document.addEventListener('submit',async e=>{
 const form=e.target.closest('#businessImprovementCloseCash');if(!form)return;e.preventDefault();
 const button=form.querySelector('button[type="submit"]');button.disabled=true;
 try{
  const closingAmount=Number(form.elements.closingAmount.value),sessionId=form.elements.sessionId.value;
  if(!Number.isFinite(closingAmount)||closingAmount<0)throw new Error('Ingresá un importe contado válido.');
  const result=await api('cash','POST',{action:'close',sessionId,closingAmount});
  const expected=Number(result.session?.expected_amount||0),difference=Number(result.session?.difference||0);
  window.alert('Caja cerrada. Esperado: '+money(expected)+'. Diferencia: '+money(difference)+'.');
  await load();
 }catch(err){window.alert(err.message||'No se pudo cerrar la caja.');}
 finally{button.disabled=false;}
});
function init(){if(mount())return;const observer=new MutationObserver(()=>{if(mount())observer.disconnect();});observer.observe(document.body,{childList:true,subtree:true});}
document.addEventListener('DOMContentLoaded',init);
window.addEventListener('panaderia:authenticated',()=>{loadedFor='';init();});
window.addEventListener('hashchange',()=>{if(location.hash==='#erp')load();});
})();