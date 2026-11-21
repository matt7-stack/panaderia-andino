(function () {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = {
    products:{title:'Productos y costos',read:['products.view','products.manage'],write:'products.manage'},
    sales:{title:'Ventas',read:['sales.view'],write:'sales.create'},
    inventory:{title:'Inventario',read:['inventory.view','inventory.manage'],write:'inventory.manage'},
    customers:{title:'Clientes',read:['customers.view','customers.manage'],write:'customers.manage'},
    suppliers:{title:'Proveedores',read:['suppliers.view','suppliers.manage'],write:'suppliers.manage'},
    purchases:{title:'Compras',read:['purchases.view','purchases.create'],write:'purchases.create'},
    recipes:{title:'Recetas',read:['recipes.view','recipes.manage'],write:'recipes.manage'},
    production:{title:'Producción',read:['production.view','production.manage'],write:'production.manage'},
    cash:{title:'Caja',read:['cash.view','cash.manage','cash.open','cash.close'],write:'cash.manage'},
    reports:{title:'Informes',read:['reports.view','reports.export'],write:'reports.export'}
  };
  let currentModule = 'products';
  let cache = {};
  let loading = false;
  function user(){return window.PanaderiaAuth?.user||null;}
  function manager(){const u=user();return !!u&&(u.isPlatformAdmin===true||u.role==='admin'||u.role==='supervisor');}
  function allowed(key){const u=user();if(!u)return false;if(manager())return true;return u.permissions?.[key]===true;}
  function canModule(key){const m=labels[key];return !!m&&(manager()||m.read.some(allowed)||allowed(m.write));}
  function canRead(key){const m=labels[key];return !!m&&(manager()||m.read.some(allowed));}
  async function api(module,method,body){
    const options={method:method||'GET'};
    if(body!==undefined)options.body=JSON.stringify({...body,module});
    return window.PanaderiaAuth.api('/api/business/erp?module='+encodeURIComponent(module),options);
  }
  function ensureUi(){
    const nav=$('.nav-menu'),main=$('.main-content'),topbar=main?.querySelector('.topbar');
    if(!nav||!main||!topbar)return false;
    if(!nav.querySelector('[data-page-link="erp"]')){
      const link=document.createElement('a');
      link.href='#erp';link.className='nav-link';link.dataset.pageLink='erp';
      link.innerHTML='<i class="bi bi-grid-1x2"></i><span>Gestión operativa</span>';
      nav.appendChild(link);
    }
    if(!$('#page-erp')){
      const page=document.createElement('section');
      page.className='page-view';page.id='page-erp';page.dataset.page='erp';
      page.innerHTML='<div class="page-heading"><div><p class="eyebrow">OPERACIÓN DEL NEGOCIO</p><h1><i class="bi bi-grid-1x2 heading-page-icon"></i> Gestión operativa</h1><p class="page-subtitle">Ventas, compras, inventario, producción, caja e informes.</p></div></div><div class="erp-tabs" id="erpTabs" role="tablist"></div><div id="erpContent" class="mt-3"><p class="text-muted">Seleccioná un módulo.</p></div>';
      topbar.insertAdjacentElement('afterend',page);
    }
    return true;
  }
  function syncNavigation(){
    const link=$('[data-page-link="erp"]'),u=user();
    if(!link)return;
    const hasAny=Object.keys(labels).some(canModule);
    link.hidden=!u||!hasAny||(u.isPlatformAdmin===true&&!window.PanaderiaAuth?.selectedBusinessId);
  }
  function renderTabs(){
    const tabs=$('#erpTabs');if(!tabs)return;
    const available=Object.keys(labels).filter(canModule);
    tabs.innerHTML=available.map(key=>'<button type="button" class="btn btn-sm '+(key===currentModule?'btn-bakery':'btn-outline-bakery')+'" data-erp-tab="'+key+'">'+esc(labels[key].title)+'</button>').join('');
    if(!available.includes(currentModule))currentModule=available[0]||'products';
  }
  function productOptions(selected){
    const products=cache.products?.products||[];
    return '<option value="">Seleccionar producto</option>'+products.filter(p=>p.active!==false).map(p=>'<option value="'+esc(p.id)+'" '+(String(p.id)===String(selected||'')?'selected':'')+'>'+esc(p.name)+' · Stock '+Number(p.stock||0)+'</option>').join('');
  }
  function saleItemRow(){
    const first=cache.products?.products?.find(p=>p.active!==false);
    return '<div class="row g-2 erp-line-item erp-sale-item align-items-end mb-2"><div class="col-md-5"><label class="form-label">Producto</label><select class="form-select" name="productId" required>'+productOptions()+'</select></div><div class="col-md-3"><label class="form-label">Cantidad</label><input class="form-control" name="quantity" type="number" value="1" min="0.01" step="0.01" required></div><div class="col-md-3"><label class="form-label">Precio unitario (Gs.)</label><input class="form-control" name="unitPrice" type="number" value="'+esc(first?.sale_price||0)+'" min="0" step="1" required></div><div class="col-md-1"><button class="btn btn-outline-danger" type="button" data-erp-remove-row aria-label="Quitar artículo">×</button></div></div>';
  }
  function purchaseItemRow(){
    const first=cache.products?.products?.find(p=>p.active!==false);
    return '<div class="row g-2 erp-line-item erp-purchase-item align-items-end mb-2"><div class="col-md-5"><label class="form-label">Producto</label><select class="form-select" name="productId" required>'+productOptions()+'</select></div><div class="col-md-3"><label class="form-label">Cantidad</label><input class="form-control" name="quantity" type="number" value="1" min="0.01" step="0.01" required></div><div class="col-md-3"><label class="form-label">Costo unitario (Gs.)</label><input class="form-control" name="unitCost" type="number" value="'+esc(first?.cost_price||0)+'" min="0" step="1" required></div><div class="col-md-1"><button class="btn btn-outline-danger" type="button" data-erp-remove-row aria-label="Quitar artículo">×</button></div></div>';
  }
  function recipeIngredientRow(){
    return '<div class="row g-2 erp-line-item erp-recipe-ingredient align-items-end mb-2"><div class="col-md-6"><label class="form-label">Ingrediente</label><select class="form-select" name="ingredientId" required>'+productOptions()+'</select></div><div class="col-md-3"><label class="form-label">Cantidad</label><input class="form-control" name="ingredientQuantity" type="number" value="1" min="0.01" step="0.01" required></div><div class="col-md-2"><label class="form-label">Unidad</label><input class="form-control" name="ingredientUnit" value="kg" maxlength="24"></div><div class="col-md-1"><button class="btn btn-outline-danger" type="button" data-erp-remove-row aria-label="Quitar ingrediente">×</button></div></div>';
  }
  function customerOptions(selected){
    const rows=cache.customers?.customers||[];
    return '<option value="">Consumidor final / sin ficha</option>'+rows.filter(x=>x.active!==false).map(x=>'<option value="'+esc(x.id)+'" '+(String(x.id)===String(selected||'')?'selected':'')+'>'+esc(x.name)+'</option>').join('');
  }
  function supplierOptions(selected){
    const rows=cache.suppliers?.suppliers||[];
    return '<option value="">Sin proveedor asociado</option>'+rows.filter(x=>x.active!==false).map(x=>'<option value="'+esc(x.id)+'" '+(String(x.id)===String(selected||'')?'selected':'')+'>'+esc(x.name)+'</option>').join('');
  }
  function money(value){return 'Gs. '+Number(value||0).toLocaleString('es-PY',{maximumFractionDigits:0});}
  function table(headers,rows,empty){
    return '<div class="table-responsive"><table class="table data-table align-middle"><thead><tr>'+headers.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+ (rows||[]).join('')+'</tbody></table></div>' + ((!rows||!rows.length)?'<p class="text-muted py-2">'+(empty||'No hay registros todavía.')+'</p>':'');
  }
  function formField(label,name,type,value,extra){
    return '<div class="col-md-4"><label class="form-label" for="erp-'+name+'">'+label+'</label><input class="form-control" id="erp-'+name+'" name="'+name+'" type="'+(type||'text')+'" value="'+esc(value??'')+'" '+(extra||'')+'></div>';
  }
  function renderProducts(data){
    const rows=(data.products||[]).map(p=>'<tr><td>'+esc(p.sku||'—')+'</td><td><strong>'+esc(p.name)+'</strong><small class="d-block text-muted">'+esc(p.category||'')+'</small></td><td>'+esc(p.unit)+'</td><td>'+money(p.sale_price)+'</td><td>'+money(p.cost_price)+'</td><td>'+Number(p.stock||0)+'</td><td>'+Number(p.min_stock||0)+'</td><td><button class="btn btn-sm btn-outline-danger" data-erp-delete="products" data-id="'+esc(p.id)+'">Desactivar</button></td></tr>');
    return '<article class="panel settings-card"><h3>Nuevo producto</h3><form data-erp-form="products" class="row g-3">'+formField('Nombre *','name','text','','required maxlength="120"')+formField('Código SKU','sku','text','','maxlength="60"')+formField('Categoría','category')+formField('Unidad','unit','text','unidad')+formField('Precio de venta','salePrice','number','0','min="0" step="1"')+formField('Costo unitario','costPrice','number','0','min="0" step="1"')+formField('Stock mínimo','minStock','number','0','min="0" step="0.01"')+'<div class="col-12"><button class="btn btn-bakery" type="submit">Guardar producto</button></div></form></article><article class="panel settings-card mt-3"><h3>Catálogo e inventario de productos</h3>'+table(['SKU','PRODUCTO','UNIDAD','VENTA','COSTO','STOCK','MÍNIMO','ACCIÓN'],rows)+'</article>';
  }
  function renderSales(data){
    const rows=(data.sales||[]).map(s=>'<tr><td>'+esc(s.sale_number)+'</td><td>'+new Date(s.created_at).toLocaleString('es-PY')+'</td><td>'+esc(s.customer_name||'Consumidor final')+'</td><td>'+esc(s.payment_method||'—')+'</td><td>'+money(s.total)+'</td><td>'+esc(s.status)+'</td><td>'+(s.status==='completed'&&allowed('sales.cancel')?'<button class="btn btn-sm btn-outline-danger" data-erp-cancel-sale="'+esc(s.id)+'">Anular</button>':'—')+'</td></tr>');
    const canSell=allowed('sales.create');
    return (canSell?'<article class="panel settings-card"><h3>Registrar venta</h3><form data-erp-form="sales" class="row g-3"><div class="col-12"><div id="erpSaleItems">'+saleItemRow()+'</div><button class="btn btn-sm btn-outline-bakery" type="button" data-erp-add-row="sale"><i class="bi bi-plus-circle"></i> Agregar otro producto</button></div><div class="col-md-4"><label class="form-label">Cliente</label><select class="form-select" name="customerId">'+customerOptions()+'</select></div>'+formField('Descuento total (Gs.)','discount','number','0','min="0" step="1"')+formField('Método de pago','paymentMethod','text','Efectivo','maxlength="40"')+'<div class="col-12"><button class="btn btn-bakery" type="submit">Registrar venta</button></div></form><small class="text-muted">El costo unitario se guarda al momento de vender para calcular el margen histórico.</small></article>':'')+(canRead('sales')?'<article class="panel settings-card mt-3"><h3>Historial de ventas</h3>'+table(['NÚMERO','FECHA','CLIENTE','PAGO','TOTAL','ESTADO','ACCIÓN'],rows)+'</article>':'<p class="text-muted">Tu cuenta puede registrar ventas, pero no tiene permiso para consultar el historial.</p>');
  }
  function renderInventory(data){
    const rows=(data.movements||[]).map(m=>'<tr><td>'+new Date(m.created_at).toLocaleString('es-PY')+'</td><td>'+esc(m.product_name)+'</td><td>'+esc(m.movement_type)+'</td><td>'+Number(m.quantity)+'</td><td>'+money(m.unit_cost)+'</td><td>'+esc(m.reference||'—')+'</td></tr>');
    return '<article class="panel settings-card"><h3>Registrar movimiento de stock</h3><form data-erp-form="inventory" class="row g-3"><div class="col-md-4"><label class="form-label">Producto</label><select class="form-select" name="productId" required>'+productOptions()+'</select></div><div class="col-md-4"><label class="form-label">Tipo</label><select class="form-select" name="movementType"><option value="entry">Entrada</option><option value="exit">Salida</option><option value="waste">Merma</option><option value="adjustment">Ajuste (nuevo stock)</option></select></div>'+formField('Cantidad','quantity','number','1','min="0.01" step="0.01" required')+formField('Costo unitario','unitCost','number','0','min="0" step="1"')+formField('Referencia','reference')+'<div class="col-12"><button class="btn btn-bakery" type="submit">Guardar movimiento</button></div></form></article><article class="panel settings-card mt-3"><h3>Historial de inventario</h3>'+table(['FECHA','PRODUCTO','TIPO','CANTIDAD','COSTO','REFERENCIA'],rows)+'</article>';
  }
  function renderContacts(module,data){
    const isCustomer=module==='customers',title=isCustomer?'cliente':'proveedor',rows=(data[isCustomer?'customers':'suppliers']||[]).map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.document||x.ruc||'—')+'</td><td>'+esc(x.phone||'—')+'</td><td>'+esc(x.email||'—')+'</td><td>'+esc(x.active?'Activo':'Inactivo')+'</td><td><button class="btn btn-sm btn-outline-danger" data-erp-delete="'+module+'" data-id="'+esc(x.id)+'">Desactivar</button></td></tr>');
    return '<article class="panel settings-card"><h3>Registrar '+title+'</h3><form data-erp-form="'+module+'" class="row g-3">'+formField('Nombre *','name','text','','required maxlength="120"')+formField(isCustomer?'Documento':'RUC',isCustomer?'document':'ruc')+formField('Teléfono','phone')+formField('Correo','email','email')+formField('Dirección','address')+'<div class="col-12"><button class="btn btn-bakery" type="submit">Guardar '+title+'</button></div></form></article><article class="panel settings-card mt-3"><h3>Listado de '+(isCustomer?'clientes':'proveedores')+'</h3>'+table(['NOMBRE',isCustomer?'DOCUMENTO':'RUC','TELÉFONO','CORREO','ESTADO','ACCIÓN'],rows)+'</article>';
  }
  function renderPurchases(data){
    const rows=(data.purchases||[]).map(p=>'<tr><td>'+esc(p.document_number||p.id)+'</td><td>'+new Date(p.created_at).toLocaleDateString('es-PY')+'</td><td>'+esc(p.supplier_name||'—')+'</td><td>'+money(p.total)+'</td><td>'+esc(p.status)+'</td><td>'+(p.status==='received'?'<button class="btn btn-sm btn-outline-danger" data-erp-cancel-purchase="'+esc(p.id)+'">Anular</button>':'—')+'</td></tr>');
    return '<article class="panel settings-card"><h3>Registrar compra recibida</h3><form data-erp-form="purchases" class="row g-3"><div class="col-md-4"><label class="form-label">Proveedor</label><select class="form-select" name="supplierId">'+supplierOptions()+'</select></div><div class="col-12"><div id="erpPurchaseItems">'+purchaseItemRow()+'</div><button class="btn btn-sm btn-outline-bakery" type="button" data-erp-add-row="purchase"><i class="bi bi-plus-circle"></i> Agregar otro producto</button></div>'+formField('N.º documento','documentNumber')+'<div class="col-12"><button class="btn btn-bakery" type="submit">Registrar compra y sumar stock</button></div></form></article><article class="panel settings-card mt-3"><h3>Historial de compras</h3>'+table(['DOCUMENTO','FECHA','PROVEEDOR','TOTAL','ESTADO','ACCIÓN'],rows)+'</article>';
  }
  function renderRecipes(data){
    const rows=(data.recipes||[]).map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+esc(r.product_name||'—')+'</td><td>'+Number(r.yield_quantity)+'</td><td>'+((r.ingredients||[]).map(i=>esc(i.product_name)+' × '+Number(i.quantity)+' '+esc(i.unit)).join('<br>'))+'</td><td>'+esc(r.active?'Activa':'Inactiva')+'</td></tr>');
    return '<article class="panel settings-card"><h3>Crear receta</h3><form data-erp-form="recipes" class="row g-3">'+formField('Nombre *','name','text','','required maxlength="120"')+'<div class="col-md-4"><label class="form-label">Producto elaborado</label><select class="form-select" name="productId">'+productOptions()+'</select></div>'+formField('Rendimiento por receta','yieldQuantity','number','1','min="0.01" step="0.01" required')+'<div class="col-12"><strong>Ingredientes</strong><div id="erpRecipeIngredients">'+recipeIngredientRow()+'</div><button class="btn btn-sm btn-outline-bakery" type="button" data-erp-add-row="recipe"><i class="bi bi-plus-circle"></i> Agregar ingrediente</button></div>'+formField('Instrucciones','instructions','text','','maxlength="3000"')+'<div class="col-12"><button class="btn btn-bakery" type="submit">Guardar receta</button></div></form></article><article class="panel settings-card mt-3"><h3>Recetas registradas</h3>'+table(['RECETA','PRODUCTO','RENDIMIENTO','INGREDIENTES','ESTADO'],rows)+'</article>';
  }
  function renderProduction(data){
    const rows=(data.batches||[]).map(b=>'<tr><td>'+new Date(b.created_at).toLocaleDateString('es-PY')+'</td><td>'+esc(b.recipe_name||b.product_name||'Producción')+'</td><td>'+Number(b.planned_quantity)+'</td><td>'+esc(b.status)+'</td><td>'+(b.status==='planned'?'<button class="btn btn-sm btn-outline-primary" data-erp-production="'+esc(b.id)+'" data-status="in_progress">Iniciar</button> <button class="btn btn-sm btn-outline-danger" data-erp-production="'+esc(b.id)+'" data-status="cancelled">Cancelar</button>':(b.status==='in_progress'?'<button class="btn btn-sm btn-outline-success" data-erp-production="'+esc(b.id)+'" data-action="complete">Completar</button> <button class="btn btn-sm btn-outline-danger" data-erp-production="'+esc(b.id)+'" data-status="cancelled">Cancelar</button>':'—'))+'</td></tr>');
    return '<article class="panel settings-card"><h3>Planificar producción</h3><form data-erp-form="production" class="row g-3"><div class="col-md-4"><label class="form-label">Receta</label><select class="form-select" name="recipeId"><option value="">Sin receta</option>'+(data.recipes||[]).map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name)+'</option>').join('')+'</select></div><div class="col-md-4"><label class="form-label">Producto de salida</label><select class="form-select" name="productId">'+productOptions()+'</select></div>'+formField('Cantidad planificada','plannedQuantity','number','1','min="0.01" step="0.01" required')+formField('Observación','notes')+'<div class="col-12"><button class="btn btn-bakery" type="submit">Crear lote</button></div></form><small class="text-muted">Al completar un lote se descuentan los ingredientes, se suma el producto elaborado y se actualiza su costo promedio.</small></article><article class="panel settings-card mt-3"><h3>Lotes de producción</h3>'+table(['FECHA','RECETA / PRODUCTO','PLANIFICADO','ESTADO','ACCIÓN'],rows)+'</article>';
  }
  function renderCash(data){
    const open=(data.sessions||[]).find(s=>s.status==='open');
    const sessions=(data.sessions||[]).map(s=>'<tr><td>'+new Date(s.opened_at).toLocaleString('es-PY')+'</td><td>'+money(s.opening_amount)+'</td><td>'+esc(s.status)+'</td><td>'+money(s.expected_amount)+'</td><td>'+(s.status==='open'&&allowed('cash.close')?'<button class="btn btn-sm btn-outline-warning" data-erp-close-cash="'+esc(s.id)+'">Cerrar caja</button>':'—')+'</td></tr>');
    const movements=(data.movements||[]).map(m=>'<tr><td>'+new Date(m.created_at).toLocaleString('es-PY')+'</td><td>'+esc(m.movement_type)+'</td><td>'+esc(m.description)+'</td><td>'+esc(m.category)+'</td><td>'+money(m.amount)+'</td></tr>');
    return (!open&&allowed('cash.open')?'<article class="panel settings-card"><h3>Abrir caja</h3><form data-erp-form="cash-open" class="row g-3">'+formField('Importe inicial','openingAmount','number','0','min="0" step="1"')+'<div class="col-12"><button class="btn btn-bakery" type="submit">Abrir caja</button></div></form></article>':'')+(open&&allowed('cash.manage')?'<article class="panel settings-card"><h3>Registrar movimiento de caja</h3><p class="text-muted">Caja abierta · fondo inicial '+money(open.opening_amount)+'</p><form data-erp-form="cash" class="row g-3"><div class="col-md-4"><label class="form-label">Tipo</label><select class="form-select" name="movementType"><option value="income">Ingreso</option><option value="expense">Egreso</option></select></div>'+formField('Categoría','category','text','Varios','required')+formField('Descripción','description','text','','required')+formField('Importe','amount','number','0','min="0.01" step="1" required')+formField('Método de pago','paymentMethod','text','Efectivo')+'<div class="col-12"><button class="btn btn-bakery" type="submit">Registrar movimiento</button></div></form></article>':'')+'<article class="panel settings-card mt-3"><h3>Sesiones de caja</h3>'+table(['APERTURA','FONDO INICIAL','ESTADO','SALDO ESPERADO','ACCIÓN'],sessions)+'</article><article class="panel settings-card mt-3"><h3>Movimientos recientes</h3>'+table(['FECHA','TIPO','DESCRIPCIÓN','CATEGORÍA','IMPORTE'],movements)+'</article>';
  }
  function renderReports(data){
    const rows=(data.months||[]).map(m=>'<tr><td>'+esc(m.month)+'</td><td>'+money(m.sales)+'</td><td>'+money(m.other_income)+'</td><td>'+money(m.cost_of_goods)+'</td><td>'+money(m.expenses)+'</td><td>'+money(m.net_profit)+'</td></tr>');
    return '<article class="panel settings-card"><div class="d-flex flex-wrap justify-content-between gap-2"><div><h3>Resultado mensual</h3><p class="text-muted">Ventas + otros ingresos − costo histórico de productos vendidos − gastos registrados.</p></div><div class="d-flex gap-2"><button class="btn btn-outline-bakery btn-sm" id="erpExportCsv">Descargar CSV para Excel</button><button class="btn btn-outline-bakery btn-sm" id="erpPrintReport">Imprimir / guardar PDF</button></div></div>'+table(['MES','VENTAS','OTROS INGRESOS','COSTO DE VENTAS','GASTOS','RESULTADO NETO'],rows)+'</article>';
  }
  function renderModule(module,data){
    if(module==='products')return renderProducts(data);
    if(module==='sales')return renderSales(data);
    if(module==='inventory')return renderInventory(data);
    if(module==='customers'||module==='suppliers')return renderContacts(module,data);
    if(module==='purchases')return renderPurchases(data);
    if(module==='recipes')return renderRecipes(data);
    if(module==='production')return renderProduction(data);
    if(module==='cash')return renderCash(data);
    if(module==='reports')return renderReports(data);
    return '<p class="text-muted">Módulo no disponible.</p>';
  }
  async function loadModule(module){
    if(!canModule(module))return;
    const content=$('#erpContent');if(!content)return;
    content.innerHTML='<p class="text-muted">Cargando '+esc(labels[module].title.toLowerCase())+'…</p>';
    try{
      const jobs=[];
      if(canRead(module))jobs.push(api(module).then(result=>{cache[module]=result;}));
      if(['sales','purchases','inventory','recipes','production'].includes(module)&&canModule('products')&&!cache.products)jobs.push(api('products').then(result=>{cache.products=result;}));
      if(['sales','purchases'].includes(module)&&canModule('customers')&&!cache.customers)jobs.push(api('customers').then(result=>{cache.customers=result;}));
      if(module==='purchases'&&canModule('suppliers')&&!cache.suppliers)jobs.push(api('suppliers').then(result=>{cache.suppliers=result;}));
      await Promise.all(jobs);
      content.innerHTML=renderModule(module,cache[module]||{});
    }catch(error){content.innerHTML='<div class="alert alert-danger">'+esc(error.message||'No se pudo cargar el módulo.')+'</div>';}
  }
  function activate(user){
    if(!ensureUi())return;
    syncNavigation();renderTabs();
    if(user&&canModule(currentModule))loadModule(currentModule);
  }
  async function submitForm(event){
    const form=event.target.closest('[data-erp-form]');if(!form)return;
    event.preventDefault();
    const module=form.dataset.erpForm,fd=new FormData(form),value=name=>String(fd.get(name)||'').trim();
    const button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;
    try{
      let payload={};
      if(module==='products')payload={name:value('name'),sku:value('sku'),category:value('category'),unit:value('unit')||'unidad',salePrice:Number(value('salePrice')),costPrice:Number(value('costPrice')),minStock:Number(value('minStock'))};
      if(module==='customers')payload={name:value('name'),document:value('document'),phone:value('phone'),email:value('email'),address:value('address')};
      if(module==='suppliers')payload={name:value('name'),ruc:value('ruc'),phone:value('phone'),email:value('email'),address:value('address')};
      if(module==='inventory')payload={productId:value('productId'),movementType:value('movementType'),quantity:Number(value('quantity')),unitCost:Number(value('unitCost')),reference:value('reference')};
      if(module==='sales'){
        const product=(cache.products?.products||[]).find(p=>String(p.id)===value('productId'));
        payload={customerId:value('customerId'),discount:Number(value('discount')),paymentMethod:value('paymentMethod'),items:[...form.querySelectorAll('.erp-sale-item')].map(row=>{const product=(cache.products?.products||[]).find(p=>String(p.id)===row.querySelector('[name="productId"]')?.value);return {productId:row.querySelector('[name="productId"]')?.value,description:product?.name||'',quantity:Number(row.querySelector('[name="quantity"]')?.value),unitPrice:Number(row.querySelector('[name="unitPrice"]')?.value)};})};
      }
      if(module==='purchases'){
        const product=(cache.products?.products||[]).find(p=>String(p.id)===value('productId'));
        payload={supplierId:value('supplierId'),documentNumber:value('documentNumber'),items:[...form.querySelectorAll('.erp-purchase-item')].map(row=>{const product=(cache.products?.products||[]).find(p=>String(p.id)===row.querySelector('[name="productId"]')?.value);return {productId:row.querySelector('[name="productId"]')?.value,description:product?.name||'',quantity:Number(row.querySelector('[name="quantity"]')?.value),unitCost:Number(row.querySelector('[name="unitCost"]')?.value)};})};
      }
      if(module==='recipes')payload={name:value('name'),productId:value('productId'),yieldQuantity:Number(value('yieldQuantity')),instructions:value('instructions'),ingredients:[...form.querySelectorAll('.erp-recipe-ingredient')].map(row=>({productId:row.querySelector('[name="ingredientId"]')?.value,quantity:Number(row.querySelector('[name="ingredientQuantity"]')?.value),unit:row.querySelector('[name="ingredientUnit"]')?.value||'unidad'}))};
      if(module==='production')payload={recipeId:value('recipeId'),productId:value('productId'),plannedQuantity:Number(value('plannedQuantity')),notes:value('notes')};
      if(module==='cash-open')payload={module:'cash',action:'open',openingAmount:Number(value('openingAmount'))};
      if(module==='cash')payload={module:'cash',action:'movement',movementType:value('movementType'),category:value('category'),description:value('description'),amount:Number(value('amount')),paymentMethod:value('paymentMethod')};
      const endpoint=module==='cash-open'?'cash':module;
      await api(endpoint,'POST',payload);
      form.reset();cache={};await loadModule(currentModule);
      window.alert('Operación registrada correctamente.');
    }catch(error){window.alert(error.message||'No se pudo guardar el registro.');}
    finally{if(button)button.disabled=false;}
  }
  document.addEventListener('change',event=>{
    const select=event.target.closest('.erp-line-item select[name="productId"]');
    if(!select)return;
    const product=(cache.products?.products||[]).find(p=>String(p.id)===select.value);
    const row=select.closest('.erp-line-item');
    if(!product||!row)return;
    const price=row.querySelector('[name="unitPrice"]'),cost=row.querySelector('[name="unitCost"]');
    if(price)price.value=product.sale_price||0;
    if(cost)cost.value=product.cost_price||0;
  });
  async function clickAction(event){
    const add=event.target.closest('[data-erp-add-row]');
    if(add){const kind=add.dataset.erpAddRow,container=$(kind==='sale'?'#erpSaleItems':kind==='purchase'?'#erpPurchaseItems':'#erpRecipeIngredients');if(container)container.insertAdjacentHTML('beforeend',kind==='sale'?saleItemRow():kind==='purchase'?purchaseItemRow():recipeIngredientRow());return;}
    const removeRow=event.target.closest('[data-erp-remove-row]');
    if(removeRow){const row=removeRow.closest('.erp-line-item'),parent=row?.parentElement;if(parent?.querySelectorAll('.erp-line-item').length>1)row.remove();return;}
    const tab=event.target.closest('[data-erp-tab]');
    if(tab){currentModule=tab.dataset.erpTab;renderTabs();loadModule(currentModule);return;}
    const cancelSale=event.target.closest('[data-erp-cancel-sale]');
    const cancelPurchase=event.target.closest('[data-erp-cancel-purchase]');
    const remove=event.target.closest('[data-erp-delete]');
    const production=event.target.closest('[data-erp-production]');
    const closeCash=event.target.closest('[data-erp-close-cash]');
    try{
      if(cancelSale){if(!window.confirm('¿Anular esta venta y devolver los productos al inventario?'))return;await api('sales','PATCH',{id:cancelSale.dataset.erpCancelSale,action:'cancel'});}
      else if(cancelPurchase){if(!window.confirm('¿Anular esta compra y descontar el stock ingresado?'))return;await api('purchases','PATCH',{id:cancelPurchase.dataset.erpCancelPurchase,action:'cancel'});}
      else if(remove){if(!window.confirm('¿Desactivar este registro? Los datos históricos se conservarán.'))return;await api(remove.dataset.erpDelete,'DELETE',{id:remove.dataset.id});}
      else if(production){if(production.dataset.action==='complete'){const produced=window.prompt('Cantidad realmente producida:','1');if(produced===null)return;const waste=window.prompt('Cantidad de merma:','0');if(waste===null)return;await api('production','PATCH',{id:production.dataset.erpProduction,action:'complete',producedQuantity:Number(produced),wasteQuantity:Number(waste)});}else{await api('production','PATCH',{id:production.dataset.erpProduction,status:production.dataset.status});}}
      else if(closeCash){const amount=window.prompt('Importe contado al cerrar caja (Gs.):','0');if(amount===null)return;await api('cash','POST',{action:'close',sessionId:closeCash.dataset.erpCloseCash,closingAmount:Number(amount)});}
      else if(event.target.closest('#erpExportCsv')){exportCsv();return;}
      else if(event.target.closest('#erpPrintReport')){window.print();return;}
      else return;
      cache={};await loadModule(currentModule);
    }catch(error){window.alert(error.message||'No se pudo completar la acción.');}
  }
  function exportCsv(){
    const rows=cache.reports?.months||[];
    const csv=[['Mes','Ventas','Otros ingresos','Costo de ventas','Gastos','Resultado neto'],...rows.map(r=>[r.month,r.sales,r.other_income,r.cost_of_goods,r.expenses,r.net_profit])]
      .map(row=>row.map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='informe-mensual-gestion-negocio.csv';a.click();URL.revokeObjectURL(url);
  }
  document.addEventListener('submit',submitForm);
  document.addEventListener('click',clickAction);
  window.addEventListener('panaderia:authenticated',event=>activate(event.detail||user()));
  window.addEventListener('panaderia:pagenavigate',event=>{
    syncNavigation();
    if(event.detail?.page==='erp')loadModule(currentModule);
  });
  Promise.resolve(window.PanaderiaAuthReady).then(activate).catch(()=>{});
})();