(function operationsToolsModule() {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'op_'+Date.now()+'_'+Math.random().toString(36).slice(2));
  const styles = `
  #businessToolsModal{position:fixed;inset:0;z-index:12000;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(7,20,34,.62)}
  #businessToolsModal.open{display:flex}
  #businessToolsModal .bt-shell{width:min(980px,100%);max-height:min(90vh,900px);overflow:auto;border:1px solid #dce6ed;border-radius:18px;background:#f7f9fc;box-shadow:0 24px 80px #07142255}
  #businessToolsModal .bt-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 22px;background:#fff;border-bottom:1px solid #e4ebf1}
  #businessToolsModal .bt-head h2{margin:0;color:#193653;font-size:20px;font-weight:800}
  #businessToolsModal .bt-body{padding:20px}
  #businessToolsModal .bt-tabs{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:17px}
  #businessToolsModal .bt-tab{border:1px solid #d9e3eb;border-radius:9px;padding:9px 13px;background:#fff;color:#31506c;font-size:12px;font-weight:700}
  #businessToolsModal .bt-tab.active{background:#233f68;color:#fff;border-color:#233f68}
  #businessToolsModal .bt-card{padding:16px;border:1px solid #e0e8ef;border-radius:13px;background:#fff;margin-bottom:13px}
  #businessToolsModal .bt-card h3{font-size:14px;font-weight:800;color:#193653;margin:0 0 12px}
  #businessToolsModal label{display:block;margin:0 0 5px;color:#536b80;font-size:11px;font-weight:700}
  #businessToolsModal input,#businessToolsModal select,#businessToolsModal textarea{width:100%;min-height:39px;padding:8px 10px;border:1px solid #d6e1e9;border-radius:8px;background:#fff;color:#193653;font-size:12px}
  #businessToolsModal textarea{min-height:75px;resize:vertical}
  #businessToolsModal .bt-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
  #businessToolsModal .bt-btn{border:0;border-radius:8px;padding:9px 13px;background:#294d78;color:#fff;font-size:12px;font-weight:750}
  #businessToolsModal .bt-btn:disabled{opacity:.5;cursor:not-allowed}
  #businessToolsModal .bt-muted{color:#718396;font-size:11px}
  #businessToolsModal .bt-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid #edf1f4}
  #businessToolsModal .bt-row:last-child{border-bottom:0}
  #businessToolsModal .bt-status{display:inline-block;padding:4px 7px;border-radius:6px;background:#eef3f7;color:#34516b;font-size:10px;font-weight:700}
  #businessToolsModal .bt-status.pending{background:#fff4df;color:#8a6224}
  #businessToolsModal .bt-status.completed{background:#e6f5ec;color:#28734a}
  #businessToolsModal .bt-notice{padding:10px 12px;border-radius:9px;background:#edf5fb;color:#355773;font-size:11px;margin-bottom:12px}
  #businessToolsModal .bt-notice.warn{background:#fff4e4;color:#875e20}
  #businessToolsModal .bt-hidden{display:none!important}
  @media(max-width:650px){#businessToolsModal{padding:0}#businessToolsModal .bt-shell{height:100%;max-height:100%;border-radius:0}#businessToolsModal .bt-body{padding:13px}#businessToolsModal .bt-grid{grid-template-columns:1fr}}
  `;
  const addStyles = () => { if (document.getElementById('businessToolsStyles')) return; const s=document.createElement('style');s.id='businessToolsStyles';s.textContent=styles;document.head.appendChild(s); };
  const idb = {
    open() { return new Promise((resolve,reject)=>{const r=indexedDB.open('mattsystem-offline-tools',1);r.onupgradeneeded=()=>r.result.createObjectStore('queue',{keyPath:'operationId'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}); },
    async all(){const db=await this.open();return new Promise((resolve,reject)=>{const r=db.transaction('queue','readonly').objectStore('queue').getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});},
    async put(item){const db=await this.open();return new Promise((resolve,reject)=>{const r=db.transaction('queue','readwrite').objectStore('queue').put(item);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});},
    async remove(id){const db=await this.open();return new Promise((resolve,reject)=>{const r=db.transaction('queue','readwrite').objectStore('queue').delete(id);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});}
  };
  let root, currentTab='tasks', cache={tasks:[],attachments:[],team:[],movements:[],importLogs:[]}, currentUser=null, syncing=false, importRows=[];
  const api = (path,options={}) => window.PanaderiaAuth.api(path,options);
  const isManager = () => ['admin','supervisor'].includes(String(currentUser?.role||'').toLowerCase());
  const notify = message => { const toast=document.getElementById('toastMessage'); if(toast)toast.textContent=message; const el=document.getElementById('appToast'); if(el&&window.bootstrap)bootstrap.Toast.getOrCreateInstance(el,{delay:3500}).show(); else alert(message); };
  const setStatus = async () => {
    const count=(await idb.all().catch(()=>[])).length, node=document.getElementById('btOfflineStatus');
    if(node)node.innerHTML=navigator.onLine?`<span class="bt-status completed">Con conexión</span> · ${count} operación(es) pendientes`:`<span class="bt-status pending">Sin conexión</span> · ${count} operación(es) guardadas localmente`;
  };
  const queueOrSend = async payload => {
    if(!payload.operationId)payload.operationId=uid();
    try {
      if(!navigator.onLine)throw new Error('offline');
      const result=await api('/api/business/tools',{method:'POST',body:JSON.stringify(payload)});
      await refresh(); return {queued:false,result};
    } catch(error) {
      if(!navigator.onLine||/conectar|conexión|network|failed to fetch|load failed/i.test(String(error.message||''))){
        await idb.put({operationId:payload.operationId,payload,queuedAt:new Date().toISOString()});await setStatus();return {queued:true};
      }
      throw error;
    }
  };
  const syncQueue = async () => {
    if(syncing||!navigator.onLine||!window.PanaderiaAuth?.user)return;
    syncing=true;
    try{
      const items=(await idb.all()).sort((a,b)=>String(a.queuedAt).localeCompare(String(b.queuedAt)));
      for(const item of items){try{await api('/api/business/tools',{method:'POST',body:JSON.stringify(item.payload)});await idb.remove(item.operationId);}catch(error){console.warn('Sincronización pendiente:',error);break;}}
      await setStatus();await refresh().catch(()=>{});
    }finally{syncing=false;}
  };
  const close = () => {root?.classList.remove('open');root?.setAttribute('aria-hidden','true');};
  const refresh = async () => {
    if(!window.PanaderiaAuth?.user)return;
    try{cache=await api('/api/business/tools');try{localStorage.setItem('mattsystem_tools_cache_v1',JSON.stringify(cache));}catch(_){}}
    catch(error){try{const saved=localStorage.getItem('mattsystem_tools_cache_v1');if(saved)cache=JSON.parse(saved);else throw error;}catch(_){throw error;}}
    await setStatus();return cache;
  };
  const tabs = () => [['tasks','Agenda de tareas'],['attachments','Comprobantes'],...(isManager()?[['import','Importar datos']]:[]),['offline','Modo sin conexión']];
  const render = () => {
    root.querySelector('.bt-tabs').innerHTML=tabs().map(([key,label])=>`<button type="button" class="bt-tab ${currentTab===key?'active':''}" data-bt-tab="${key}">${label}</button>`).join('');
    root.querySelectorAll('[data-bt-panel]').forEach(p=>p.classList.toggle('bt-hidden',p.dataset.btPanel!==currentTab));
    root.querySelector('[data-bt-panel="tasks"]').innerHTML=`
      ${isManager()?`<div class="bt-card"><h3>Asignar nueva tarea</h3><form id="btTaskForm"><div class="bt-grid"><div><label for="btTaskTitle">Tarea</label><input id="btTaskTitle" maxlength="120" required placeholder="Ej. Revisar cierre de caja"></div><div><label for="btTaskAssignee">Responsable</label><select id="btTaskAssignee" required>${(cache.team||[]).map(u=>`<option value="${esc(u.id)}">${esc(u.name)} · ${esc(u.role)}</option>`).join('')}</select></div><div><label for="btTaskDue">Fecha límite</label><input id="btTaskDue" type="date"></div><div><label for="btTaskDescription">Detalles</label><input id="btTaskDescription" maxlength="1000" placeholder="Instrucciones (opcional)"></div></div><button class="bt-btn mt-3" type="submit">Asignar tarea</button></form></div>`:''}
      <div class="bt-card"><h3>${isManager()?'Tareas del equipo':'Mis tareas asignadas'}</h3><div id="btTaskList">${(cache.tasks||[]).length?(cache.tasks||[]).map(t=>`<div class="bt-row"><div><strong>${esc(t.title)}</strong><div class="bt-muted">${esc(t.assignedToName||'')} ${t.dueDate?'· Vence '+esc(t.dueDate):''}</div>${t.description?`<div class="bt-muted">${esc(t.description)}</div>`:''}</div><div class="text-end"><span class="bt-status ${t.status==='completed'?'completed':t.status==='pending'?'pending':''}">${t.status==='completed'?'Completada':t.status==='in_progress'?'En curso':'Pendiente'}</span><div class="mt-2"><select data-bt-task-status="${esc(t.id)}" aria-label="Estado de ${esc(t.title)}"><option value="pending" ${t.status==='pending'?'selected':''}>Pendiente</option><option value="in_progress" ${t.status==='in_progress'?'selected':''}>En curso</option><option value="completed" ${t.status==='completed'?'selected':''}>Completada</option></select></div></div></div>`).join(''):'<p class="bt-muted mb-0">Todavía no hay tareas asignadas.</p>'}</div></div>`;
    root.querySelector('[data-bt-panel="attachments"]').innerHTML=`
      <div class="bt-card"><h3>Adjuntar comprobante a un movimiento</h3><form id="btAttachmentForm"><div class="bt-grid"><div><label for="btMovement">Movimiento</label><select id="btMovement" required><option value="">Seleccionar movimiento</option>${(cache.movements||[]).slice().reverse().map(m=>`<option value="${esc(m.id)}">${esc(m.date)} · ${esc(m.description)} · Gs. ${Number(m.amount||0).toLocaleString('es-PY')}</option>`).join('')}</select></div><div><label for="btFile">Archivo (PDF, JPG, PNG o WEBP; máximo 1,1 MB)</label><input id="btFile" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required></div></div><button class="bt-btn mt-3" type="submit">Guardar comprobante</button></form></div>
      <div class="bt-card"><h3>Comprobantes guardados</h3>${(cache.attachments||[]).length?(cache.attachments||[]).map(a=>`<div class="bt-row"><div><strong>${esc(a.name)}</strong><div class="bt-muted">${esc(a.movementDescription||('Movimiento '+a.movementId))} · ${esc(a.uploadedByName||'')} · ${new Date(a.createdAt).toLocaleDateString('es-PY')}</div></div><button class="bt-btn" type="button" data-bt-download="${esc(a.id)}">Abrir</button></div>`).join(''):'<p class="bt-muted mb-0">No hay comprobantes adjuntos.</p>'}</div>`;
    const imp=root.querySelector('[data-bt-panel="import"]');
    if(imp)imp.innerHTML=`
      <div class="bt-notice">Importación disponible para el dueño y Supervisor. Se agregan registros nuevos sin borrar la información actual. Revisá el archivo antes de importar.</div>
      <div class="bt-card"><h3>Importar desde CSV o Excel</h3><form id="btImportForm"><div class="bt-grid"><div><label for="btImportTarget">Tipo de datos</label><select id="btImportTarget"><option value="movements">Ingresos y gastos</option><option value="products">Disponibilidad / productos</option><option value="invoices">Ventas y cuentas de clientes</option><option value="customers">Clientes</option><option value="suppliers">Proveedores</option></select></div><div><label for="btImportFile">Archivo CSV o Excel (.xlsx, .xls)</label><input id="btImportFile" type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" required></div></div><div id="btImportPreview" class="bt-muted mt-3">Seleccioná un archivo para ver una vista previa.</div><button class="bt-btn mt-3" type="submit" disabled id="btImportSubmit">Importar registros</button></form></div>
      <div class="bt-card"><h3>Últimas importaciones</h3>${(cache.importLogs||[]).slice().reverse().slice(0,10).map(x=>`<div class="bt-row"><div><strong>${esc(x.target)}</strong><div class="bt-muted">${Number(x.rowsAdded||0)} filas · ${esc(x.createdBy||'')} · ${new Date(x.createdAt).toLocaleString('es-PY')}</div></div></div>`).join('')||'<p class="bt-muted mb-0">No hay importaciones registradas.</p>'}</div>`;
    root.querySelector('[data-bt-panel="offline"]').innerHTML=`
      <div class="bt-card"><h3>Sincronización segura</h3><div id="btOfflineStatus" class="mb-3"></div><p class="bt-muted">Si se corta Internet, las tareas, comprobantes e importaciones realizadas desde esta sección se guardan temporalmente en este dispositivo. Al recuperar la conexión, MATTSYSTEM las envía al servidor y evita repetir operaciones ya sincronizadas.</p><p class="bt-muted">No cierres sesión ni borres los datos del navegador hasta que la cola quede vacía. La edición general de movimientos y otros módulos todavía requiere conexión.</p><button type="button" class="bt-btn" id="btSyncNow">Sincronizar ahora</button></div>
      <div class="bt-card"><h3>Alcance actual del modo sin conexión</h3><ul class="bt-muted mb-0"><li>Cola local de operaciones pendientes aislada por navegador/dispositivo.</li><li>Reintento automático al recuperar conexión.</li><li>Identificador único por operación para evitar duplicados.</li><li>La primera sincronización requiere haber iniciado sesión y tener acceso al negocio.</li></ul></div>`;
    setStatus();
  };
  const parseCSV = text => {
    const rows=[];let row=[],field='',quoted=false;
    for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'&&quoted&&text[i+1]==='"'){field+='"';i++;}else if(c==='"'){quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>String(v).trim()))rows.push(row);row=[];field='';}else field+=c;}
    row.push(field);if(row.some(v=>String(v).trim()))rows.push(row);if(rows.length<2)return [];
    const headers=rows.shift().map(h=>String(h).trim().replace(/^\uFEFF/,'').toLowerCase());
    return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,String(values[i]??'').trim()])));
  };
  const loadXLSX = () => new Promise((resolve,reject)=>{if(window.XLSX)return resolve();const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';script.onload=resolve;script.onerror=()=>reject(new Error('No se pudo cargar el lector de Excel. Conectate a Internet o guardá la hoja como CSV.'));document.head.appendChild(script);});
  const prepareImport = async file => {
    importRows=[];const preview=root.querySelector('#btImportPreview'),submit=root.querySelector('#btImportSubmit');if(submit)submit.disabled=true;if(!file){if(preview)preview.textContent='Seleccioná un archivo para ver una vista previa.';return;}
    try{let rows;if(/\.csv$/i.test(file.name)||file.type==='text/csv')rows=parseCSV(await file.text());else{await loadXLSX();const book=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false}),sheet=book.Sheets[book.SheetNames[0]];rows=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false});}
      importRows=rows.slice(0,1000);if(preview)preview.innerHTML=`<strong>${importRows.length} filas detectadas</strong><div class="bt-muted">Vista previa (primeras 5 filas):</div><pre style="white-space:pre-wrap;max-height:150px;overflow:auto;font-size:10px">${esc(JSON.stringify(importRows.slice(0,5),null,2))}</pre>`;if(submit)submit.disabled=!importRows.length;
    }catch(error){if(preview)preview.textContent=error.message||'No se pudo leer el archivo.';}
  };
  const bindEvents = () => {
    root.addEventListener('click',async e=>{
      const tab=e.target.closest('[data-bt-tab]');if(tab){currentTab=tab.dataset.btTab;render();return;}
      if(e.target.closest('[data-bt-close]')){close();return;}
      const download=e.target.closest('[data-bt-download]');if(download){try{const r=await api('/api/business/tools?attachmentId='+encodeURIComponent(download.dataset.btDownload));const blob=await(await fetch(r.dataUrl)).blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=r.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){notify(error.message||'No se pudo abrir el comprobante.');}}
      if(e.target.id==='btSyncNow')syncQueue();
    });
    root.addEventListener('change',async e=>{
      const status=e.target.closest('[data-bt-task-status]');if(status){try{const result=await queueOrSend({operationId:uid(),action:'task_status',taskId:status.dataset.btTaskStatus,status:status.value});notify(result.queued?'Cambio guardado en el dispositivo; se sincronizará al recuperar Internet.':'Estado de tarea actualizado.');}catch(error){notify(error.message||'No se pudo actualizar la tarea.');}}
      if(e.target.id==='btImportFile')await prepareImport(e.target.files?.[0]);
    });
    root.addEventListener('submit',async e=>{
      if(e.target.id==='btTaskForm'){e.preventDefault();const button=e.target.querySelector('button[type="submit"]');button.disabled=true;try{const result=await queueOrSend({operationId:uid(),action:'task_create',title:root.querySelector('#btTaskTitle').value,description:root.querySelector('#btTaskDescription').value,assignedToUserId:root.querySelector('#btTaskAssignee').value,dueDate:root.querySelector('#btTaskDue').value||null});notify(result.queued?'Tarea guardada localmente; pendiente de sincronización.':'Tarea asignada correctamente.');await refresh();render();}catch(error){notify(error.message||'No se pudo asignar la tarea.');}finally{button.disabled=false;}}
      if(e.target.id==='btAttachmentForm'){e.preventDefault();const button=e.target.querySelector('button[type="submit"]'),file=root.querySelector('#btFile').files?.[0];if(!file)return;if(file.size>1100000){notify('El archivo supera el límite de 1,1 MB.');return;}button.disabled=true;try{const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('No se pudo leer el archivo.'));reader.readAsDataURL(file);});const result=await queueOrSend({operationId:uid(),action:'attachment_add',movementId:root.querySelector('#btMovement').value,name:file.name,mime:file.type,dataUrl});notify(result.queued?'Comprobante guardado en el dispositivo; se enviará al recuperar Internet.':'Comprobante adjuntado al movimiento.');await refresh();render();}catch(error){notify(error.message||'No se pudo adjuntar el comprobante.');}finally{button.disabled=false;}}
      if(e.target.id==='btImportForm'){e.preventDefault();if(!importRows.length){notify('No hay filas válidas para importar.');return;}const button=root.querySelector('#btImportSubmit');button.disabled=true;try{const result=await queueOrSend({operationId:uid(),action:'import_rows',target:root.querySelector('#btImportTarget').value,rows:importRows});notify(result.queued?'Importación guardada localmente; se enviará al recuperar Internet.':`Importación completada: ${result.result?.rowsAdded||0} registros.`);importRows=[];await refresh();render();}catch(error){notify(error.message||'No se pudo importar el archivo.');}finally{button.disabled=false;}}
    });
  };
  const init = async () => {
    await Promise.resolve(window.PanaderiaAuthReady).catch(()=>null);currentUser=window.PanaderiaAuth?.user||null;
    const nav=document.getElementById('businessToolsNav');
    const hasBusiness=!!(currentUser?.businessId||currentUser?.business_id);
    if(nav)nav.hidden=!currentUser||currentUser.isPlatformAdmin===true||!hasBusiness;
    if(!currentUser||currentUser.isPlatformAdmin===true||!hasBusiness)return;
    if(root)return;
    addStyles();if(!nav)return;
    root=document.createElement('div');root.id='businessToolsModal';root.setAttribute('aria-hidden','true');
    root.innerHTML=`<section class="bt-shell" role="dialog" aria-modal="true" aria-labelledby="btTitle"><header class="bt-head"><div><h2 id="btTitle">Herramientas del negocio</h2><div class="bt-muted">Tareas, comprobantes, importación y continuidad operativa</div></div><button type="button" class="btn-close" aria-label="Cerrar" data-bt-close></button></header><div class="bt-body"><div class="bt-tabs"></div><section data-bt-panel="tasks"></section><section data-bt-panel="attachments" class="bt-hidden"></section><section data-bt-panel="import" class="bt-hidden"></section><section data-bt-panel="offline" class="bt-hidden"></section></div></section>`;
    document.body.appendChild(root);
    nav.addEventListener('click',e=>{e.preventDefault();root.classList.add('open');root.setAttribute('aria-hidden','false');refresh().then(render).catch(error=>{render();notify(navigator.onLine?(error.message||'No se pudieron cargar las herramientas.'):'Sin conexión: se muestran los últimos datos guardados en este dispositivo.');});});
    root.addEventListener('click',e=>{if(e.target===root)close();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&root.classList.contains('open'))close();});
    bindEvents();window.addEventListener('online',syncQueue);window.addEventListener('offline',setStatus);window.addEventListener('focus',syncQueue);loadXLSX().catch(()=>{});await syncQueue();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  window.addEventListener('panaderia:authenticated',()=>{currentUser=window.PanaderiaAuth?.user||null;init();});
})();