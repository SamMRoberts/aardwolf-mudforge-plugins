plugin = {
  id = "aardwolf-inventory", name = "Aardwolf Inventory Management", version = "0.1.0",
  author = "Sam Roberts", description = "Dockable inventory, bag management, prepared item use and explicit sorting rules."
}

local INVENTORY_HTML = [==[<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aardwolf Inventory</title><style>
:root{color-scheme:dark;font:13px system-ui,sans-serif;background:#131b27;color:#e3eaf3;--line:#34445a;--muted:#aab9cc;--accent:#9ed0ff}*{box-sizing:border-box}body{margin:0;padding:10px;min-width:180px}button,input,select{font:inherit}button,input,select{color:inherit;background:#202e40;border:1px solid #43566f;border-radius:4px;min-height:28px}button{padding:3px 9px;cursor:pointer}button:hover:not(:disabled){background:#30465e;border-color:#8bb5df}button:disabled{opacity:.5;cursor:default}button.primary{background:#335a78;border-color:#7da8cb}input,select{padding:3px 6px;min-width:0}input[type=checkbox]{min-height:0;width:15px;height:15px;accent-color:#9ed0ff;vertical-align:middle}button:focus-visible,input:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:2px solid #bbdfff;outline-offset:2px}h1,h2,h3,p{margin:0}h1{font-size:1.12rem}h2{font-size:1rem;margin:15px 0 8px;color:#c3d4e7}h3{font-size:1rem;margin-bottom:7px}.toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.toolbar.spread{justify-content:space-between}.muted,.hint{color:var(--muted);font-size:.92rem}.status{color:#f0ce91;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.92rem}.status:empty,.feedback:empty{display:none}.status,.feedback{margin-top:8px}.feedback{white-space:pre-wrap;overflow-wrap:anywhere;color:#c5dfff}.count{display:flex;align-items:baseline;gap:8px;margin:8px 0 10px}.count strong{font-size:2.1rem;font-weight:650}.count span{color:var(--muted)}.bag-list{display:grid;gap:4px;max-height:65vh;overflow:auto}.bag{display:flex;align-items:center;justify-content:space-between;text-align:left;width:100%;gap:8px;padding:5px 7px}.bag-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bag-location{font-size:.85rem;color:var(--muted);flex-shrink:0}.empty{padding:12px 2px;color:var(--muted)}.summary-controls{display:flex;gap:5px;flex-wrap:wrap;padding-top:10px}.manager-controls{display:grid;grid-template-columns:minmax(130px,1fr) minmax(100px,1fr);gap:7px;margin-top:10px}.manager-controls label{display:flex;align-items:center;gap:6px;min-width:0}.manager-controls select,.manager-controls input{width:100%}.table-wrap{overflow:auto;max-height:52vh;margin-top:8px;border:1px solid var(--line);border-radius:4px;scroll-padding:35px}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th{text-align:left;background:#1b293a;position:sticky;top:0;z-index:1;font-weight:600}th button{display:block;width:100%;text-align:left;border:0;border-radius:0;background:none;white-space:nowrap;min-height:30px;padding:5px 7px}td{border-top:1px solid #29384b;padding:5px 7px;white-space:nowrap}td:first-child{white-space:normal;min-width:120px;max-width:400px;overflow-wrap:anywhere}tr[aria-selected=true]{background:#254766}tbody tr:hover{background:#20364d}tbody tr{cursor:default}#scope-state{margin-top:7px}.manager-footer{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}details{margin-top:12px;border-top:1px solid var(--line);padding-top:8px}summary{cursor:pointer;color:#c1d5eb}.detail-text{font-size:.92rem;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;max-height:35vh;overflow:auto;padding-top:6px}.form-grid{display:grid;grid-template-columns:minmax(180px,1fr) minmax(180px,1fr);gap:10px 18px}.form-grid label{display:flex;align-items:center;justify-content:space-between;gap:10px}.form-grid input[type=number]{width:80px}.form-grid label.check{justify-content:flex-start}.form-grid .wide{grid-column:1/-1}.box{padding:10px;border:1px solid var(--line);border-radius:5px;background:#172232}.setting-bags{display:grid;gap:6px}.setting-bag{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:5px}.setting-bag label{display:flex;gap:6px;align-items:center;overflow-wrap:anywhere}.compact{min-width:28px;padding:2px 5px}.rules{display:grid;gap:8px}.rule{display:grid;grid-template-columns:auto minmax(90px,1fr) minmax(90px,1fr) minmax(105px,1fr) auto;align-items:center;gap:6px}.rule-actions{display:flex;gap:3px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:15px 0 8px}.section-heading h2{margin:0}.setup-footer{display:flex;gap:8px;align-items:center;position:sticky;bottom:0;background:#131b27;padding-top:12px;padding-bottom:4px}.panel{margin-top:12px;border:1px solid #6b8fac;background:#1c2e40;border-radius:5px;padding:12px}.panel h2{margin-top:0;color:#e3eaf3}.panel p{margin:6px 0}.panel ol{padding-left:22px;margin:8px 0}.panel label{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}.panel input,.panel select{flex:1;min-width:130px}.panel-footer{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.preview-list{max-height:180px;overflow:auto;padding-left:22px}.pending{color:#f4d295}.section-hidden,[hidden]{display:none!important}@media(max-width:560px){.form-grid{grid-template-columns:1fr}.form-grid .wide{grid-column:auto}.rule{grid-template-columns:auto 1fr 1fr}.rule .rule-bag{grid-column:2/3}.rule-actions{grid-column:3/4}.manager-controls{grid-template-columns:1fr}body{padding:8px}.rule select,.rule input{width:100%}}@media(max-width:300px){.summary-controls button{flex:1 1 80px}.bag{flex-wrap:wrap}.bag-location{font-size:.8rem}.count strong{font-size:1.8rem}}
@media(max-width:360px){.form-grid label:not(.check){flex-direction:column;align-items:stretch;gap:4px}.form-grid input[type=number]{width:100%}.form-grid select{max-width:100%;width:100%}.rule{grid-template-columns:auto minmax(0,1fr)}.rule .rule-type{grid-column:2}.rule .rule-name,.rule .rule-bag,.rule-actions{grid-column:2}.section-heading{flex-wrap:wrap}}
</style></head><body data-role="__ROLE__">
<section id="summary-view" hidden><header class="toolbar spread"><h1>Inventory</h1><span id="summary-freshness" class="hint"></span></header><div class="count"><strong id="item-count"> - </strong><span>carried items</span></div><div id="bags" class="bag-list" aria-label="Inventory containers"></div><p id="bags-empty" class="empty" hidden>No storage bags found.</p><footer class="summary-controls"><button id="manage-button" type="button" class="primary">Manage Inventory</button><button id="setup-button" type="button">Setup</button><button id="summary-refresh" type="button">Refresh</button></footer></section>
<section id="manager-view" hidden><header class="toolbar spread"><h1>Inventory Manager</h1><div class="toolbar"><button id="manager-refresh" type="button">Refresh</button><button id="organize-button" type="button">Organize</button><button id="manager-setup" type="button">Setup</button></div></header><div class="manager-controls"><label>Location<select id="scope-select" aria-label="Inventory location"></select></label><label>Search<input id="search" type="search" placeholder="Item name" autocomplete="off"></label></div><p id="scope-state" class="muted" role="status"></p><div class="table-wrap" id="items-scroll"><table aria-label="Inventory items"><thead><tr><th><button type="button" data-sort="name">Name</button></th><th><button type="button" data-sort="level">Level</button></th><th><button type="button" data-sort="type">Type</button></th><th><button type="button" data-sort="flags">Flags</button></th><th><button type="button" data-sort="id">ID</button></th></tr></thead><tbody id="items"></tbody></table><p id="items-empty" class="empty" hidden>No items.</p></div><footer class="manager-footer"><button id="actions-button" type="button" disabled>Actions</button><button id="details-button" type="button" disabled>View details</button><button id="workflow-cancel" type="button" hidden>Cancel workflow</button></footer><details id="item-details"><summary>Item details</summary><div id="detail-text" class="detail-text">Select an item and choose View details.</div></details></section>
<section id="setup-view" hidden><h1>Inventory Setup</h1><form id="settings-form"><h2>Display and actions</h2><div class="form-grid"><label>Font size<input id="font-size" type="number" min="8" max="24" required></label><label class="check"><input id="show-worn" type="checkbox">Show worn bags in summary</label><label class="check wide"><input id="confirm-disposal" type="checkbox">Confirm Drop, Sell, and Donate</label></div><h2>Character&#39;s held slot</h2><div class="form-grid"><label>Slot number<input id="held-slot" type="number" min="0" max="255" placeholder="Unset"></label><label>Currently held item<select id="held-item"><option value="">Select to identify slot...</option></select></label></div><p class="hint" style="margin-top:6px">Select the item you are currently holding, or enter its slot number from Aardwolf&#39;s wearable command. This enables wand/staff preparation and equipment restoration.</p><h2>Summary bags</h2><p class="hint" style="margin-bottom:8px">Checked bags appear in the summary. Use arrows to change their order.</p><div id="setting-bags" class="setting-bags"></div><div class="section-heading"><h2>Organize rules</h2><button id="add-rule" type="button">Add rule</button></div><p class="hint" style="margin-bottom:8px">The first enabled rule matching type and optional name text wins. Only loose inventory is moved.</p><div id="rules" class="rules"></div><footer class="setup-footer"><button type="submit" class="primary">Save setup</button><span id="draft-state" class="hint"></span></footer></form></section>
<section id="prompt-panel" class="panel" hidden aria-labelledby="prompt-title"><h2 id="prompt-title"></h2><form id="prompt-form"><ol id="prompt-steps"></ol><label id="bag-field" hidden>Destination bag<select id="destination-bag"></select></label><label id="recipient-field" hidden>Recipient<input id="recipient" type="text" maxlength="128" autocomplete="off" placeholder="Name or 2.guard"></label><label id="target-field" hidden>Target<input id="use-target" type="text" maxlength="128" autocomplete="off" placeholder="Name or 2.guard"></label><div class="panel-footer"><button id="prompt-submit" type="submit" class="primary">Continue</button><button id="prompt-dismiss" type="button">Cancel</button></div></form></section>
<section id="preview-panel" class="panel" hidden aria-labelledby="preview-title"><h2 id="preview-title">Organize preview</h2><p class="hint">Review these moves before starting.</p><ol id="preview-list" class="preview-list"></ol><p id="preview-empty" class="muted" hidden>No matching loose items to move.</p><div class="panel-footer"><button id="start-organize" type="button" class="primary">Start moves</button><button id="preview-dismiss" type="button">Close preview</button></div></section>
<p id="status" class="status" role="status"></p><p id="feedback" class="feedback" role="status"></p>
<script>
(function(){'use strict';
const role=document.body.dataset.role;
const $=id=>document.getElementById(id), send=(event,data={})=>mudforge.send(event,data);
const TYPES={1:'Light',2:'Scroll',3:'Wand',4:'Staff',5:'Weapon',6:'Treasure',7:'Armor',8:'Potion',9:'Furniture',10:'Trash',11:'Container',12:'Drink container',13:'Key',14:'Food',15:'Boat',16:'Mob corpse',17:'Player corpse',18:'Fountain',19:'Pill',20:'Portal',21:'Beacon',22:'Gift card',23:'Unused',24:'Raw material',25:'Campfire',26:'Forge',27:'Runestone'};
let state={},localSelected=null,sortKey='name',sortDirection=1,pendingMenu=null,lastMenu=null,setupKey=null,promptKey=null,previewKey=null,itemsKey=null,bagsKey=null,scopeKey=null,equipmentKey=null,setupBagsKey=null,draft=null;
// MudForge may encode empty Lua lists as objects; normalize this boundary once.
function inventoryList(value){
  if(Array.isArray(value))return value;
  if(!value||typeof value!=='object')return [];
  return Object.keys(value).filter(key=>/^\d+$/.test(key)).sort((a,b)=>Number(a)-Number(b)).map(key=>value[key]);
}
function normalizeInventoryState(value){
  const result={...value};
  for(const key of ['bags','entries','equipment','actions'])result[key]=inventoryList(value[key]);
  result.preferences={...(value.preferences||{}),bagOrder:inventoryList((value.preferences||{}).bagOrder),hiddenBags:inventoryList((value.preferences||{}).hiddenBags)};
  result.profile={...(value.profile||{}),rules:inventoryList((value.profile||{}).rules)};
  if(value.details)result.details={...value.details,tags:inventoryList(value.details.tags)};
  if(value.prompt)result.prompt={...value.prompt,steps:inventoryList(value.prompt.steps),bags:inventoryList(value.prompt.bags)};
  if(value.preview!=null)result.preview=inventoryList(value.preview);
  return result;
}
function text(id,value){$(id).textContent=value==null?'':String(value)}
function element(tag,content,className){const node=document.createElement(tag);if(content!=null)node.textContent=String(content);if(className)node.className=className;return node}
function button(label,title,handler){const node=element('button',label,'compact');node.type='button';node.title=title;node.setAttribute('aria-label',title);node.addEventListener('click',handler);return node}
function idEqual(a,b){return a!=null&&b!=null&&String(a)===String(b)}
function locationLabel(value){if(value==='inventory')return'Carried';if(value==='equipment')return'Worn';return String(value||'').replace('container:','Bag #')}
function visibleBags(){const prefs=state.preferences||{},hidden=new Set((prefs.hiddenBags||[]).map(String));return(state.bags||[]).filter(b=>!hidden.has(String(b.id))&&(prefs.showWorn!==false||b.location!=='equipment'))}
function orderedBags(bags,order){const ranks=new Map((order||[]).map((id,i)=>[String(id),i]));return bags.slice().sort((a,b)=>(ranks.get(String(a.id))??1e9)-(ranks.get(String(b.id))??1e9)||a.name.localeCompare(b.name)||a.id-b.id)}
function renderBags(){const bags=orderedBags(visibleBags(),(state.preferences||{}).bagOrder),key=JSON.stringify(bags);if(key===bagsKey)return;bagsKey=key;const old=$('bags').scrollTop,focusedId=document.activeElement&&document.activeElement.closest('#bags .bag')&&document.activeElement.closest('#bags .bag').dataset.id;const nodes=bags.map(b=>{const row=element('button',null,'bag');row.type='button';row.dataset.id=b.id;row.append(element('span',b.name,'bag-name'),element('span',locationLabel(b.location),'bag-location'));row.title=b.name+' / #'+b.id+' / '+locationLabel(b.location);row.addEventListener('dblclick',()=>send('open',{scope:'container:'+b.id}));row.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();send('open',{scope:'container:'+b.id})}});row.addEventListener('contextmenu',e=>requestMenu(e,b.id));return row});$('bags').replaceChildren(...nodes);$('bags').scrollTop=old;$('bags-empty').hidden=bags.length>0;if(focusedId){const row=Array.from($('bags').children).find(row=>row.dataset.id===focusedId);if(row)row.focus({preventScroll:true})}}
function setOptions(select,options,value){const key=JSON.stringify(options);if(select.dataset.options!==key){select.dataset.options=key;select.replaceChildren(...options.map(o=>{const option=element('option',o.label);option.value=o.value;return option}))}select.value=value==null?'':String(value)}
function renderScopes(){const options=[{value:'inventory',label:'Inventory'},{value:'equipment',label:'Equipment'},...(state.bags||[]).map(b=>({value:'container:'+b.id,label:b.name+' (#'+b.id+')'}))];if(state.scope&&!options.some(o=>o.value===state.scope))options.push({value:state.scope,label:state.scope+' (unavailable)'});setOptions($('scope-select'),options,state.scope||'inventory')}
function selectedItem(){return(state.entries||[]).find(item=>idEqual(item.id,localSelected))}
function select(id){localSelected=id;paintSelection();send('select',{id})}
function paintSelection(){for(const row of $('items').children)row.setAttribute('aria-selected',idEqual(row.dataset.id,localSelected)?'true':'false');$('actions-button').disabled=localSelected==null;$('details-button').disabled=localSelected==null}
function requestMenu(event,id){if(id==null)return;event.preventDefault();pendingMenu={x:event.clientX||12,y:event.clientY||12};if(event.type==='keydown'||event.type==='click'){const r=event.currentTarget.getBoundingClientRect();pendingMenu={x:r.left,y:r.bottom}}localSelected=id;paintSelection();send('menu',{id})}
function renderItems(){const query=$('search').value.toLocaleLowerCase(),key=JSON.stringify([state.entries,query,sortKey,sortDirection]);if(itemsKey===key){paintSelection();return}itemsKey=key;const rows=(state.entries||[]).filter(item=>String(item.name).toLocaleLowerCase().includes(query));rows.sort((a,b)=>{let av=a[sortKey],bv=b[sortKey];if(sortKey==='type'){av=TYPES[av]||String(av);bv=TYPES[bv]||String(bv)}const result=typeof av==='number'&&typeof bv==='number'?av-bv:String(av||'').localeCompare(String(bv||''));return sortDirection*(result||a.id-b.id)});const scroll=$('items-scroll'),top=scroll.scrollTop,left=scroll.scrollLeft,focused=document.activeElement&&document.activeElement.closest('tr[data-id]'),focusId=focused&&focused.dataset.id;const nodes=rows.map(item=>{const row=element('tr');row.dataset.id=item.id;row.tabIndex=0;row.setAttribute('aria-selected',idEqual(item.id,localSelected)?'true':'false');for(const value of [item.name,item.level,TYPES[item.type]||item.type,item.flags||' - ',item.id])row.append(element('td',value));row.addEventListener('click',()=>select(item.id));row.addEventListener('contextmenu',e=>requestMenu(e,item.id));row.addEventListener('dblclick',()=>{if(item.type===11)send('open',{scope:'container:'+item.id})});row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(item.id)}else if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10'))requestMenu(e,item.id);else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const next=e.key==='ArrowDown'?row.nextElementSibling:row.previousElementSibling;if(next){next.focus();select(Number(next.dataset.id))}}});return row});$('items').replaceChildren(...nodes);$('items-empty').hidden=rows.length>0;text('items-empty',query?'No matching items.':'No items in this location.');if(focusId){const row=Array.from($('items').children).find(r=>r.dataset.id===focusId);if(row)row.focus({preventScroll:true})}scroll.scrollTop=top;scroll.scrollLeft=left;paintSelection();for(const head of document.querySelectorAll('[data-sort]')){head.parentElement.setAttribute('aria-sort',head.dataset.sort===sortKey?(sortDirection===1?'ascending':'descending'):'none')}}
function renderDetails(){const detail=state.details;if(!detail){text('detail-text','Select an item and choose View details.');return}const lines=[];for(const [key,value]of Object.entries(detail)){if(key==='tags'||value==null||typeof value==='object')continue;lines.push(key+': '+String(value))}for(const tag of detail.tags||[])lines.push(String(tag.tag)+': '+String(tag.value));text('detail-text',lines.join('\n'))}
function readDraft(){const prefs={fontSize:Number($('font-size').value),showWorn:$('show-worn').checked,confirmDisposal:$('confirm-disposal').checked,bagOrder:[],hiddenBags:[]};for(const row of $('setting-bags').querySelectorAll('[data-id]')){const id=Number(row.dataset.id);prefs.bagOrder.push(id);if(!row.querySelector('input').checked)prefs.hiddenBags.push(id)}const rules=Array.from($('rules').children).map(row=>({enabled:row.querySelector('.rule-enabled').checked,type:Number(row.querySelector('.rule-type').value),name:row.querySelector('.rule-name').value,bagId:Number(row.querySelector('.rule-bag').value)}));const slot=$('held-slot').value;return{preferences:prefs,profile:{heldSlot:slot===''?null:Number(slot),rules}}}
function markDirty(){text('draft-state','Unsaved changes')}
function renderSettingBags(){const focused=document.activeElement,focusedRow=focused&&focused.closest('.setting-bag'),focusedId=focusedRow&&focusedRow.dataset.id,focusedLabel=focused&&focused.getAttribute('aria-label');const prefs=draft.preferences,bags=orderedBags(state.bags||[],prefs.bagOrder),hidden=new Set((prefs.hiddenBags||[]).map(String));const known=new Set(bags.map(b=>String(b.id)));for(const id of prefs.bagOrder||[])if(!known.has(String(id)))bags.push({id,name:'Missing bag #'+id,location:'unavailable'});$('setting-bags').replaceChildren(...bags.map(b=>{const row=element('div',null,'setting-bag');row.dataset.id=b.id;const label=element('label'),check=element('input');check.type='checkbox';check.checked=!hidden.has(String(b.id));label.append(check,element('span',b.name+' (#'+b.id+')'));const move=delta=>{draft=readDraft();const order=Array.from($('setting-bags').querySelectorAll('[data-id]')).map(r=>Number(r.dataset.id)),index=order.indexOf(Number(b.id)),next=index+delta;if(next<0||next>=order.length)return;[order[index],order[next]]=[order[next],order[index]];draft.preferences.bagOrder=order;renderSettingBags();markDirty()};row.append(label,button('Up','Move bag up',()=>move(-1)),button('Down','Move bag down',()=>move(1)));return row}));if(!bags.length)$('setting-bags').append(element('p','Bags appear after inventory is collected.','hint'));if(focusedId){const row=Array.from($('setting-bags').children).find(row=>row.dataset.id===focusedId);if(row){const control=focused.tagName==='INPUT'?row.querySelector('input'):Array.from(row.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')===focusedLabel);if(control)control.focus({preventScroll:true})}}}
function bagOptions(selected){const opts=(state.bags||[]).map(b=>({value:b.id,label:b.name+' (#'+b.id+')'}));if(selected&&!opts.some(o=>idEqual(o.value,selected)))opts.push({value:selected,label:'Missing bag #'+selected});if(!opts.length)opts.push({value:'',label:'No bags available'});return opts}
function renderRules(){const rules=draft.profile.rules||[];$('rules').replaceChildren(...rules.map((rule,index)=>{const row=element('div',null,'rule');const enabled=element('input',null,'rule-enabled');enabled.type='checkbox';enabled.checked=rule.enabled!==false;enabled.setAttribute('aria-label','Enable rule '+(index+1));const type=element('select',null,'rule-type');type.setAttribute('aria-label','Rule '+(index+1)+' item type');setOptions(type,[{value:0,label:'Any type'},...Object.entries(TYPES).map(([value,label])=>({value,label}))],rule.type||0);const name=element('input',null,'rule-name');name.type='text';name.maxLength=128;name.placeholder='Name contains (optional)';name.value=rule.name||'';name.setAttribute('aria-label','Rule '+(index+1)+' name contains');const bag=element('select',null,'rule-bag');bag.required=true;bag.setAttribute('aria-label','Rule '+(index+1)+' destination bag');setOptions(bag,bagOptions(rule.bagId),rule.bagId||((state.bags||[])[0]||{}).id||'');const controls=element('div',null,'rule-actions');const move=delta=>{draft=readDraft();const next=index+delta;if(next<0||next>=draft.profile.rules.length)return;[draft.profile.rules[index],draft.profile.rules[next]]=[draft.profile.rules[next],draft.profile.rules[index]];renderRules();markDirty()};controls.append(button('Up','Move rule '+(index+1)+' up',()=>move(-1)),button('Down','Move rule '+(index+1)+' down',()=>move(1)),button('x','Delete rule '+(index+1),()=>{draft=readDraft();draft.profile.rules.splice(index,1);renderRules();markDirty()}));row.append(enabled,type,name,bag,controls);return row}))}
function renderSetup(){
  const key=JSON.stringify([state.identity,state.settingsRevision]),nextBags=JSON.stringify(state.bags);
  if(key!==setupKey){
    setupKey=key;setupBagsKey=nextBags;
    draft=JSON.parse(JSON.stringify({preferences:state.preferences,profile:state.profile}));
    text('draft-state','');$('font-size').value=draft.preferences.fontSize||13;
    $('show-worn').checked=draft.preferences.showWorn!==false;
    $('confirm-disposal').checked=draft.preferences.confirmDisposal!==false;
    $('held-slot').value=draft.profile.heldSlot==null?'':draft.profile.heldSlot;
    renderSettingBags();renderRules();
  }else if(setupBagsKey!==nextBags){
    // Refresh discovered destinations without replacing edited rule inputs.
    setupBagsKey=nextBags;draft=readDraft();renderSettingBags();
    for(const select of $('rules').querySelectorAll('.rule-bag')){
      const selected=select.value;setOptions(select,bagOptions(selected),selected);
    }
  }
  const nextEquipment=JSON.stringify(state.equipment);
  if(equipmentKey!==nextEquipment){
    equipmentKey=nextEquipment;
    const selected=$('held-item').value,options=[{value:'',label:'Select to identify slot...'},...state.equipment.map(item=>({value:item.id,label:item.name+' (slot '+item.wearLocation+')'}))];
    setOptions($('held-item'),options,options.some(option=>idEqual(option.value,selected))?selected:'');
  }
}
function renderPrompt(){const prompt=state.prompt||null,key=JSON.stringify(prompt);if(key===promptKey)return;promptKey=key;$('prompt-panel').hidden=!prompt;if(!prompt)return;text('prompt-title',prompt.title||'Inventory action');$('prompt-steps').replaceChildren(...(prompt.steps||[]).map(step=>element('li',step)));const isPut=prompt.kind==='put',isGive=prompt.kind==='give',hasTarget=prompt.kind==='use'&&(prompt.allowTarget||prompt.requireTarget);$('bag-field').hidden=!isPut;$('recipient-field').hidden=!isGive;$('target-field').hidden=!hasTarget;$('destination-bag').required=isPut;$('recipient').required=isGive;$('use-target').required=!!prompt.requireTarget;$('recipient').value='';$('use-target').value=prompt.defaultTarget||'';setOptions($('destination-bag'),(prompt.bags||state.bags||[]).map(b=>({value:b.id,label:b.name+' (#'+b.id+')'})),((prompt.bags||state.bags||[])[0]||{}).id);text('prompt-submit',prompt.kind==='use'?'Prepare and use':prompt.kind==='confirm'?'Confirm':'Continue');const field=isPut?$('destination-bag'):isGive?$('recipient'):hasTarget?$('use-target'):$('prompt-submit');field.focus({preventScroll:true});$('prompt-panel').scrollIntoView({block:'nearest'})}
function renderPreview(){const preview=state.preview;const key=JSON.stringify(preview);if(key===previewKey)return;previewKey=key;$('preview-panel').hidden=!Array.isArray(preview);if(!Array.isArray(preview))return;$('preview-list').replaceChildren(...preview.map(move=>element('li',move.name+'  ->  '+move.bagName+' (#'+move.bagId+')')));$('preview-empty').hidden=preview.length>0;$('start-organize').disabled=!preview.length||!!state.busy}
function render(value){if(!value||typeof value!=='object')return;const previousIdentity=state.identity,previousScope=state.scope;state=normalizeInventoryState(value);if(previousIdentity!==state.identity){localSelected=null;pendingMenu=null;lastMenu=null}if(state.selected!=null)localSelected=state.selected;else if(previousScope!==state.scope)localSelected=null;document.documentElement.style.fontSize=(Number(state.fontSize)||13)+'px';text('status',state.status);text('feedback',state.feedback);if(role==='summary'){text('item-count',state.count==null?' - ':state.count);text('summary-freshness',state.countState||'');renderBags()}if(role==='manager'){if(localSelected!=null&&!(state.entries||[]).some(item=>idEqual(item.id,localSelected)))localSelected=null;renderScopes();text('scope-state',state.scopeState||'');renderItems();renderDetails();$('workflow-cancel').hidden=!state.busy;$('organize-button').disabled=!!state.busy||!state.active;renderPrompt();renderPreview();$('prompt-submit').disabled=!!state.busy}if(role==='setup')renderSetup();for(const id of ['summary-refresh','manager-refresh'])$(id).disabled=!!state.busy||!state.active;if(pendingMenu&&state.menuSerial!=null&&state.menuSerial!==lastMenu){lastMenu=state.menuSerial;const items=(state.actions||[]).map(action=>({type:'item',id:action.id,text:action.text+(action.reason?'  -  '+action.reason:''),disabled:!!action.disabled}));if(items.length)mudforge.showMenu(items,pendingMenu.x,pendingMenu.y);pendingMenu=null}}
$('summary-view').hidden=role!=='summary';$('manager-view').hidden=role!=='manager';$('setup-view').hidden=role!=='setup';
for(const id of ['setup-button','manager-setup'])$(id).addEventListener('click',()=>send('setup'));
$('manage-button').addEventListener('click',()=>send('manage'));
for(const id of ['summary-refresh','manager-refresh'])$(id).addEventListener('click',()=>send('refresh'));
$('scope-select').addEventListener('change',()=>send('open',{scope:$('scope-select').value}));
$('search').addEventListener('input',renderItems);
for(const head of document.querySelectorAll('[data-sort]'))head.addEventListener('click',()=>{if(sortKey===head.dataset.sort)sortDirection*=-1;else{sortKey=head.dataset.sort;sortDirection=1}renderItems()});
$('actions-button').addEventListener('click',e=>requestMenu(e,localSelected));
$('actions-button').addEventListener('keydown',e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10'))requestMenu(e,localSelected)});
$('details-button').addEventListener('click',()=>{if(localSelected!=null){$('item-details').open=true;send('action',{id:localSelected,action:'details'})}});
$('organize-button').addEventListener('click',()=>send('organize'));
$('start-organize').addEventListener('click',()=>send('start-organize'));
$('workflow-cancel').addEventListener('click',()=>send('cancel'));
$('preview-dismiss').addEventListener('click',()=>send('dismiss'));
$('prompt-dismiss').addEventListener('click',()=>send('dismiss'));
$('prompt-form').addEventListener('submit',e=>{
  e.preventDefault();if(!state.prompt)return;
  const data={kind:state.prompt.kind,itemId:state.prompt.itemId,token:state.prompt.token};
  if(state.prompt.kind==='put')data.containerId=Number($('destination-bag').value);
  if(state.prompt.kind==='give')data.recipient=$('recipient').value;
  const target=$('use-target').value.trim();
  if(state.prompt.kind==='use'&&target)data.target=target;
  send('submit',data);
});
$('settings-form').addEventListener('input',markDirty);$('settings-form').addEventListener('change',markDirty);
$('held-item').addEventListener('change',()=>{const item=(state.equipment||[]).find(item=>idEqual(item.id,$('held-item').value));if(item){$('held-slot').value=item.wearLocation;markDirty()}});
$('add-rule').addEventListener('click',()=>{draft=readDraft();draft.profile.rules.push({enabled:true,type:0,name:'',bagId:((state.bags||[])[0]||{}).id||0});renderRules();markDirty()});
$('settings-form').addEventListener('submit',e=>{e.preventDefault();const value=readDraft();send('save',{...value,identity:state.identity});text('draft-state','Saving...')});
mudforge.onProperty('inventory',value=>{try{render(typeof value==='string'?JSON.parse(value):value)}catch(error){text('status','Inventory view could not display this update.')}});
send('ready',{});
})();
</script></body></html>]==]

local function inventoryMarkup(role)
  return string.gsub(INVENTORY_HTML, "__ROLE__", role)
end


local client, libraryApi, initialized = nil, nil, false
local widgets, ready, subscriptions, callbacks = {}, {}, {}, {}
local snapshot, status = { items = {}, scopes = {}, details = {} }, {}
local settings, profile, identity, characterKey = nil, nil, "", nil
local selected, scope, prompt, preview = nil, "inventory", nil, nil
local feedback, storageError, settingsRevision, menuSerial = "", nil, 0, 0
local menu, workflow, issuing, advanceTimer = nil, nil, nil, nil
local promptSerial = 0
local lifetime = 0
local publish, synchronize, advance, recover, message, createWindow
local TYPE_NAMES = { "Light", "Scroll", "Wand", "Staff", "Weapon", "Treasure", "Armor", "Potion", "Furniture",
  "Trash", "Container", "Drink container", "Key", "Food", "Boat", "Mob corpse", "Player corpse", "Fountain",
  "Pill", "Portal", "Beacon", "Gift card", "Unused", "Raw material", "Campfire", "Forge", "Runestone" }
local USE_TYPES = { [2] = "recite", [3] = "zap", [4] = "brandish", [8] = "quaff", [12] = "drink", [14] = "eat", [19] = "eat" }
local USE_LABELS = { recite = "Recite scroll", zap = "Zap wand", brandish = "Brandish staff", quaff = "Quaff potion", drink = "Drink", eat = "Eat" }
local STORAGE = "inventory:settings"

local function integer(value, minimum, maximum)
  return type(value) == "number" and value == value and value >= minimum and value <= maximum and value == math.floor(value)
end
local function objectId(value) return integer(value, 1, 9007199254740991) end
local function key(id) return string.format("%.0f", id) end
local function copy(value)
  if type(value) ~= "table" then return value end
  local result = {}
  -- Copy list entries through numeric indexing: host pairs() may stringify keys.
  for index = 1, #value do result[index] = copy(value[index]) end
  for name, child in pairs(value) do
    local index = tonumber(name)
    if child ~= nil and not (integer(index, 1, #value) and value[index] ~= nil) then result[name] = copy(child) end
  end
  return result
end
local function defaults()
  return { preferences = { fontSize = 13, showWorn = true, confirmDisposal = true, bagOrder = {}, hiddenBags = {} }, profiles = {} }
end
local function defaultProfile() return { rules = {} } end
local function validList(value, maximum, validate)
  if type(value) ~= "table" then return false end
  local count = 0
  for index, entry in pairs(value) do
    local number = tonumber(index)
    if not integer(number, 1, maximum) or not validate(entry) then return false end
    count = count + 1
  end
  return count == #value
end
local function validProfile(value)
  return type(value) == "table" and (value.heldSlot == nil or integer(value.heldSlot, 0, 255))
    and validList(value.rules, 64, function(rule)
      return type(rule) == "table" and type(rule.enabled) == "boolean" and integer(rule.type, 0, 27)
        and type(rule.name) == "string" and #rule.name <= 128 and not string.find(rule.name, "%c") and objectId(rule.bagId)
    end)
end
local function validPreferences(value)
  return type(value) == "table" and integer(value.fontSize, 8, 24) and type(value.showWorn) == "boolean"
    and type(value.confirmDisposal) == "boolean" and validList(value.bagOrder, 256, objectId) and validList(value.hiddenBags, 256, objectId)
end
local function validSettings(value)
  if type(value) ~= "table" or not validPreferences(value.preferences) or type(value.profiles) ~= "table" then return false end
  local count = 0
  for name, entry in pairs(value.profiles) do
    if type(name) ~= "string" or #name == 0 or #name > 128 or string.find(name, "%c") or not validProfile(entry) then return false end
    count = count + 1
  end
  return count <= 32
end
local function stopTimer(id) if type(id) == "string" and id ~= "" then removeTimer(id) end end
local function timer(delay, callback)
  local epoch = lifetime
  local ok, id = pcall(addTimer, delay, function() if initialized and epoch == lifetime then callback() end end)
  if ok and type(id) == "string" and id ~= "" then return id end
end
local function item(id) return objectId(id) and snapshot.items[key(id)] or nil end
local function fresh(location)
  local entry = snapshot.scopes[location]
  return entry and entry.known == true and entry.stale == false
end
local function accessibleBag(id)
  local bag = item(id)
  return bag and bag.type == 11 and (bag.location == "inventory" or bag.location == "equipment") and fresh(bag.location)
end
local function currentReason()
  if not status.available then return status.reason or "Update Aardwolf API Core to enable inventory" end
  if not status.connected then return "Disconnected" end
  if not status.active then return status.reason or "Waiting for an active character" end
  if status.collecting then return "Inventory collection is busy" end
end
local function workflowStatus()
  if not workflow then return nil end
  if workflow.kind == "organize" then return "Organizing item " .. tostring(math.min(workflow.index, #workflow.steps)) .. " of " .. tostring(#workflow.steps) end
  if workflow.phase == "restore" or workflow.phase == "recover" then return "Restoring the previous arrangement" end
  if workflow.phase == "settle" then return "Use command sent; verifying inventory" end
  return "Preparing the selected item"
end
local function inList(list, id) for _, value in ipairs(list) do if value == id then return true end end; return false end
local function bags(includeHidden)
  local result, preferences = {}, settings.preferences
  for _, bag in pairs(snapshot.items) do
    if bag.type == 11 and (includeHidden or ((preferences.showWorn or bag.location ~= "equipment") and not inList(preferences.hiddenBags, bag.id))) then
      table.insert(result, { id = bag.id, name = bag.name, location = bag.location })
    end
  end
  local ranks = {}; for index, id in ipairs(preferences.bagOrder) do ranks[key(id)] = index end
  table.sort(result, function(a, b)
    local first, second = ranks[key(a.id)] or 1000, ranks[key(b.id)] or 1000
    return first < second or (first == second and a.id < b.id)
  end)
  return result
end
local function scopeState()
  local entry = snapshot.scopes[scope]
  if not entry then return status.collecting and "loading" or "unknown" end
  if not entry.known then return "partial" end
  if entry.stale then return "stale" end
  if #entry.entries == 0 then return "empty" end
  return "fresh"
end
local function eligible(id, action)
  local entry = item(id)
  if not entry then return "Item is no longer available" end
  if workflow then return "Another inventory workflow is running" end
  if action == "open" then return entry.type ~= 11 and "This item is not a storage bag" or nil end
  local reason = currentReason()
  if reason then return reason end
  if not fresh(entry.location) then return "Refresh this item's location first" end
  if action == "details" then return nil end
  if action == "take" then
    local bagId = tonumber(string.match(entry.location, "^container:(%d+)$"))
    if not bagId or not accessibleBag(bagId) then return "Item must be in an accessible carried bag" end
  elseif action == "remove" then
    if entry.location ~= "equipment" then return "Item is not equipped" end
  elseif action == "put" or action == "wear" or action == "hold" or action == "give" or action == "drop" or action == "sell" or action == "donate" then
    if entry.location ~= "inventory" then return "Get or remove this item first" end
    if action == "hold" and not client.inventory.supports("hold") then return "Update API Core for Hold" end
    if (action == "drop" or action == "sell" or action == "give" or action == "donate") and string.find(entry.flags, "K", 1, true) then
      return "Item is kept; protection will not be removed"
    end
  elseif USE_LABELS[action] then
    if USE_TYPES[entry.type] ~= action then return "This item has a different use action" end
    if not client.inventory.supports(action) then return "Update API Core for item use" end
    local held = action == "zap" or action == "brandish"
    if held and profile.heldSlot == nil then return "Identify the held slot in Setup first" end
    if entry.location == "equipment" and (not held or entry.wearLocation ~= profile.heldSlot) then return "Remove this item from equipment first" end
    if entry.location ~= "inventory" and entry.location ~= "equipment" then
      local bagId = tonumber(string.match(entry.location, "^container:(%d+)$"))
      if not bagId or not accessibleBag(bagId) then return "Get the containing bag into inventory first" end
    end
    if held and not fresh("equipment") then return "Refresh equipment first" end
  else return "Unknown inventory action" end
end
local function actions(id)
  local entry, result = item(id), {}
  if not entry then return result end
  local function add(action, text)
    local reason = eligible(id, action)
    table.insert(result, { id = action, text = text, disabled = reason ~= nil, reason = reason })
  end
  if entry.type == 11 then add("open", "Open container") end
  add("details", "View item details")
  if string.match(entry.location, "^container:") then add("take", "Get from bag") end
  if entry.location == "equipment" then add("remove", "Remove") end
  if entry.location == "inventory" then
    add("put", "Put into bag"); add("wear", "Wear"); add("hold", "Hold")
    add("give", "Give"); add("drop", "Drop"); add("sell", "Sell"); add("donate", "Donate")
  end
  local use = USE_TYPES[entry.type]; if use then add(use, USE_LABELS[use]) end
  return result
end

publish = function()
  if not initialized then return end
  local carried = snapshot.scopes.inventory
  local equipment = {}; for _, entry in pairs(snapshot.items) do if entry.location == "equipment" then table.insert(equipment, entry) end end
  table.sort(equipment, function(a,b) return a.id < b.id end)
  local entries = snapshot.scopes[scope] and snapshot.scopes[scope].entries or {}
  local reason = currentReason()
  local state = { identity = identity, status = storageError or status.error or workflowStatus() or reason or "", feedback = feedback, busy = workflow ~= nil,
    active = status.active == true and not status.collecting, fontSize = settings.preferences.fontSize,
    count = carried and carried.known and #carried.entries or nil,
    countState = not carried and "unknown" or not carried.known and "partial" or carried.stale and "stale" or "fresh",
    scope = scope, scopeState = scopeState(), entries = entries, selected = selected, equipment = equipment,
    details = selected and snapshot.details[key(selected)] or nil, preferences = settings.preferences, profile = profile,
    settingsRevision = settingsRevision, actions = menu and menu.actions or actions(selected), menuSerial = menuSerial,
    prompt = prompt, preview = preview, types = TYPE_NAMES }
  for role, id in pairs(widgets) do
    if ready[role] then
      state.role, state.bags = role, bags(role ~= "summary")
      local ok = pcall(setWidgetProperty, id, "inventory", json.encode(state))
      if not ok then feedback = "Could not update the " .. role .. " window" end
    end
  end
end

-- Core may deliver a result synchronously during the request call. Register it
-- after the method returns, without losing or double-processing that result.
local function request(method, callback)
  local immediate, previous = {}, issuing
  issuing = immediate
  local ok, requestId, reason = pcall(method)
  issuing = previous
  if not ok or type(requestId) ~= "string" then
    callback({ outcome = "failed", reason = ok and reason or "Inventory request failed" }); return
  end
  if immediate[requestId] then callback(immediate[requestId])
  else callbacks[requestId] = callback end
end
local function readScope(target)
  request(function()
    if target == "inventory" or target == "equipment" then return client.inventory.refresh() end
    return client.inventory.lookIn(tonumber(string.match(target, "^container:(%d+)$")))
  end, function(result)
    if result.outcome == "failed" then feedback = result.reason or "Refresh failed" end
    publish()
  end)
end
local function finishWorkflow(text)
  if workflow then stopTimer(workflow.timer) end
  stopTimer(advanceTimer); advanceTimer = nil
  workflow, preview, prompt = nil, nil, nil
  feedback = text; publish()
end
local function trusted(work)
  return workflow == work and identity == work.identity and status.active and status.connected and fresh("inventory")
end
local function scheduleAdvance()
  if advanceTimer or not workflow then return end
  advanceTimer = timer(1, function() advanceTimer = nil; advance() end)
  if not advanceTimer then finishWorkflow("Workflow stopped: timer unavailable; inspect inventory before continuing") end
end
local function step(kind, id, argument) return { kind = kind, id = id, argument = argument } end
local function locationMatches(entry, location, heldSlot)
  return entry and entry.location == location and (heldSlot == nil or entry.wearLocation == heldSlot) and fresh(location)
end
local function observed(move)
  local entry = item(move.id)
  if move.kind == "take" or move.kind == "remove" then return locationMatches(entry, "inventory") end
  -- A positively observed move establishes this item's location even when the
  -- destination bag has never been completely listed. Do not invent a full scope.
  if move.kind == "put" then return entry and entry.location == "container:" .. key(move.argument) end
  if move.kind == "hold" then return locationMatches(entry, "equipment", profile.heldSlot) end
  return false
end
local function movementReason(move)
  local entry = item(move.id)
  if not entry or not fresh(entry.location) then return "Item location changed or became stale" end
  if move.kind == "take" then
    if entry.location ~= "container:" .. key(move.argument) or not accessibleBag(move.argument) then return "Source bag changed or is unavailable" end
  elseif move.kind == "put" then
    if entry.location ~= "inventory" or not accessibleBag(move.argument) or move.id == move.argument then return "Destination bag or item is unavailable" end
  elseif move.kind == "remove" then
    if entry.location ~= "equipment" then return "Equipment changed" end
  elseif move.kind == "hold" then
    if entry.location ~= "inventory" then return "Item is no longer carried" end
    for _, equipped in pairs(snapshot.items) do
      if equipped.location == "equipment" and equipped.wearLocation == profile.heldSlot then return "The held slot is occupied" end
    end
  end
end
local function restoration(work)
  local moves, entry = {}, item(work.itemId)
  if work.held and not work.originalHeld then
    if entry and entry.location == "equipment" and entry.wearLocation == work.heldSlot then table.insert(moves, step("remove", entry.id)) end
    if work.previousHeld then
      local previous = item(work.previousHeld)
      if not previous then return nil, "Previous held item is missing" end
      if previous.location == "inventory" then table.insert(moves, step("hold", previous.id))
      elseif previous.location ~= "equipment" or previous.wearLocation ~= work.heldSlot then return nil, "Previous held item moved elsewhere" end
    end
  end
  if work.originalBag and entry then
    if not accessibleBag(work.originalBag) then return nil, "Original bag is no longer available" end
    if entry.location == "inventory" or (work.held and entry.location == "equipment" and entry.wearLocation == work.heldSlot) then
      table.insert(moves, step("put", entry.id, work.originalBag))
    elseif entry.location ~= "container:" .. key(work.originalBag) then return nil, "Used item moved elsewhere" end
  end
  return moves
end
local function restore(work)
  local moves, problem = restoration(work)
  if not moves then finishWorkflow("Restoration stopped: " .. problem .. ". Inspect inventory and restore manually."); return end
  work.phase, work.steps, work.index, work.current = "restore", moves, 1, nil
  scheduleAdvance()
end
recover = function(reason)
  local work = workflow
  if not work then return end
  stopTimer(work.timer); work.timer, work.current = nil, nil
  if work.kind ~= "use" or work.phase == "restore" or work.phase == "recover" or not trusted(work) then
    finishWorkflow(reason .. "; workflow stopped. Inspect the current arrangement."); return
  end
  work.problem, work.phase = reason, "recover"
  if status.collecting then finishWorkflow(reason .. "; collection is busy. Restore the arrangement manually."); return end
  work.timer = timer(10000, function() if workflow == work then finishWorkflow(reason .. "; restoration refresh timed out") end end)
  if not work.timer then finishWorkflow(reason .. "; restoration timer unavailable"); return end
  request(function() return client.inventory.refresh() end, function(result)
    if workflow ~= work then return end
    stopTimer(work.timer); work.timer = nil
    if result.outcome == "complete" and trusted(work) and fresh("equipment") then restore(work)
    else finishWorkflow(reason .. "; could not verify state for restoration. Restore manually.") end
  end)
end

advance = function()
  local work = workflow
  if not work then return end
  if not trusted(work) then finishWorkflow("Workflow stopped: character or inventory state changed. Inspect the current arrangement."); return end
  if work.current then
    if not work.current.sent or not observed(work.current) then return end
    stopTimer(work.timer); work.timer, work.current = nil, nil
    work.index = work.index + 1
    if work.cancelRequested and work.phase ~= "restore" then recover("Cancelled"); return end
  end
  if work.phase == "settle" or work.phase == "recover" then return end
  if status.collecting then
    if not work.timer then
      work.timer = timer(10000, function() if workflow == work then recover("Inventory collector stayed busy") end end)
      if not work.timer then recover("Workflow timer unavailable") end
    end
    return
  end
  if not work.current then stopTimer(work.timer); work.timer = nil end
  local move = work.steps[work.index]
  if not move then
    if work.kind == "organize" then finishWorkflow("Organize complete: " .. tostring(#work.steps) .. " moves observed"); return end
    if work.phase == "restore" then
      finishWorkflow((work.problem or "Use command sent") .. "; original arrangement restored where items survived"); return
    end
    if work.cancelRequested then recover("Cancelled"); return end
    if status.collecting then return end
    local entry = item(work.itemId)
    if not entry or USE_TYPES[entry.type] ~= work.action then recover("Selected item changed before use"); return end
    work.phase = "settle"
    request(function() return client.inventory.use(work.itemId, work.action, { target = work.target, heldSlot = work.heldSlot }) end, function(result)
      if workflow ~= work then return end
      if result.outcome ~= "sent" then recover(result.reason or "Use command refused"); return end
      work.timer = timer(10000, function() if workflow == work then recover("Could not verify inventory after use") end end)
      if not work.timer then recover("Verification timer unavailable"); return end
      request(function() return client.inventory.refresh() end, function(refreshed)
        if workflow ~= work then return end
        stopTimer(work.timer); work.timer = nil
        if refreshed.outcome ~= "complete" or not trusted(work) then recover(refreshed.reason or "Post-use refresh failed"); return end
        if work.cancelRequested then work.problem = "Cancelled after use command was sent" end
        restore(work)
      end)
    end)
    return
  end
  if work.cancelRequested and work.phase ~= "restore" then recover("Cancelled"); return end
  if status.collecting then return end
  local reason = movementReason(move)
  if reason then recover(reason); return end
  work.current = move
  work.timer = timer(10000, function() if workflow == work then recover("Move was not observed before timeout") end end)
  if not work.timer then recover("Movement timer unavailable"); return end
  request(function() return client.inventory[move.kind](move.id, move.argument) end, function(result)
    if workflow ~= work or work.current ~= move then return end
    if result.outcome ~= "sent" then recover(result.reason or "Move refused"); return end
    move.sent = true; scheduleAdvance()
  end)
end

local function startUse(data)
  local entry, held = item(data.itemId), prompt.action == "zap" or prompt.action == "brandish"
  local action = prompt.action
  local reason = eligible(data.itemId, action)
  if reason then feedback = reason; publish(); return end
  local target = data.target
  if target == "" then target = nil end
  local command, issue = libraryApi.protocol.inventoryCommand("use", { id = entry.id, action = action, target = target, heldSlot = profile.heldSlot })
  if not command then feedback = issue or "Invalid item use options"; publish(); return end
  local work = { kind = "use", phase = "prepare", identity = identity, itemId = entry.id, action = action,
    target = target, held = held, heldSlot = profile.heldSlot, steps = {}, index = 1 }
  work.originalBag = tonumber(string.match(entry.location, "^container:(%d+)$"))
  work.originalHeld = held and entry.location == "equipment"
  if work.originalBag then table.insert(work.steps, step("take", entry.id, work.originalBag)) end
  if held and not work.originalHeld then
    for _, equipped in pairs(snapshot.items) do
      if equipped.location == "equipment" and equipped.wearLocation == profile.heldSlot then
        if work.previousHeld then feedback = "Held slot is ambiguous; refresh equipment and Setup"; publish(); return end
        work.previousHeld = equipped.id
      end
    end
    if work.previousHeld then table.insert(work.steps, step("remove", work.previousHeld)) end
    table.insert(work.steps, step("hold", entry.id))
  end
  prompt, preview, workflow, feedback = nil, nil, work, "Preparing " .. entry.name
  scheduleAdvance(); publish()
end
local function cancelWorkflow()
  prompt, preview, menu = nil, nil, nil
  if workflow then
    workflow.cancelRequested = true
    if not workflow.current and workflow.phase ~= "settle" and workflow.phase ~= "recover" and workflow.phase ~= "restore" then recover("Cancelled") end
  end
  publish()
end
local function makePreview()
  if workflow or currentReason() or not fresh("inventory") then feedback = currentReason() or "Refresh inventory first"; publish(); return end
  preview, prompt = {}, nil
  for _, entry in ipairs(snapshot.scopes.inventory.entries) do
    if entry.type ~= 11 then
      for _, rule in ipairs(profile.rules) do
        if rule.enabled and (rule.type == 0 or rule.type == entry.type) and (rule.name == "" or string.find(string.lower(entry.name), string.lower(rule.name), 1, true)) then
          local bag = item(rule.bagId)
          table.insert(preview, { id = entry.id, name = entry.name, bagId = rule.bagId,
            bagName = bag and bag.name or ("Missing bag #" .. key(rule.bagId)), unavailable = not accessibleBag(rule.bagId) })
          break
        end
      end
    end
  end
  feedback = #preview == 0 and "No loose items match enabled rules" or "Review the moves before starting Organize"
  publish()
end
local function startOrganize()
  if not preview or workflow or currentReason() or not fresh("inventory") then return end
  local moves = {}
  for _, entry in ipairs(preview) do
    local move = step("put", entry.id, entry.bagId)
    if movementReason(move) then feedback = "Preview changed or a destination is unavailable; preview Organize again"; publish(); return end
    table.insert(moves, move)
  end
  if #moves == 0 then return end
  workflow, preview = { kind = "organize", identity = identity, steps = moves, index = 1 }, nil
  scheduleAdvance(); publish()
end
local function openScope(target)
  if type(target) ~= "string" then return end
  if target ~= "inventory" and target ~= "equipment" then
    local id = tonumber(string.match(target, "^container:(%d+)$"))
    if not id or not objectId(id) or target ~= "container:" .. key(id) or not item(id) or item(id).type ~= 11 then return end
  end
  createWindow("manager", true)
  scope, selected, menu, prompt, preview = target, nil, nil, nil, nil
  local entry = snapshot.scopes[target]
  -- Explicit reads may queue behind another Core collection; opening a bag
  -- during a refresh must not leave it permanently unrequested.
  if not workflow and (not entry or not entry.known or entry.stale) and status.available and status.active and status.connected then readScope(target) end
  publish()
end
local function executeAction(id, action)
  if not objectId(id) or type(action) ~= "string" then return end
  local reason = eligible(id, action)
  if reason then feedback = reason; publish(); return end
  selected, menu, preview, prompt = id, nil, nil, nil
  local entry = item(id)
  if action == "open" then openScope("container:" .. key(id)); return end
  createWindow("manager", true)
  if action == "details" then
    request(function() return client.inventory.identify(id) end, function(result)
      feedback = result.outcome == "complete" and "Item details refreshed" or (result.reason or "Details request failed"); publish()
    end)
  elseif action == "put" or action == "give" then
    local destinations = {}; for _, bag in ipairs(bags(true)) do if bag.id ~= id and accessibleBag(bag.id) then table.insert(destinations, bag) end end
    prompt = { kind = action, title = action == "put" and "Put item into bag" or "Give item", itemId = id, bags = destinations }
  elseif (action == "drop" or action == "sell" or action == "donate") and settings.preferences.confirmDisposal then
    prompt = { kind = "confirm", title = "Confirm " .. action .. ": " .. entry.name, itemId = id, action = action }
  elseif USE_LABELS[action] then
    local steps = {}
    if string.match(entry.location, "^container:") then table.insert(steps, "Retrieve the item from its bag") end
    if action == "zap" or action == "brandish" then table.insert(steps, "Prepare the selected item in the configured held slot") end
    table.insert(steps, "Send " .. action .. (action == "zap" and " to the chosen target" or ""))
    table.insert(steps, "Restore prior held equipment and return surviving items to their original bag")
    prompt = { kind = "use", title = USE_LABELS[action] .. ": " .. entry.name, itemId = id, action = action,
      steps = steps, requireTarget = action == "zap", allowTarget = action == "zap" or action == "recite" }
  else
    local argument = action == "take" and tonumber(string.match(entry.location, "^container:(%d+)$")) or nil
    request(function() return client.inventory[action](id, argument) end, function(result)
      feedback = result.outcome == "sent" and (action .. " command sent; waiting for server updates") or (result.reason or "Action refused"); publish()
    end)
  end
  if prompt then
    promptSerial = promptSerial + 1
    prompt.identity, prompt.location, prompt.token = identity, entry.location, tostring(lifetime) .. ":" .. tostring(promptSerial)
  end
  publish()
end
local function submit(data)
  if type(data) ~= "table" or not prompt or data.kind ~= prompt.kind or data.itemId ~= prompt.itemId or data.token ~= prompt.token then return end
  local entry = item(prompt.itemId)
  if prompt.identity ~= identity or not entry or entry.location ~= prompt.location then
    prompt, feedback = nil, "Item location changed; select the action again"; publish(); return
  end
  if prompt.kind == "use" then startUse(data); return end
  local action = prompt.kind == "confirm" and prompt.action or prompt.kind
  local id, argument = prompt.itemId, nil
  local reason = eligible(id, action)
  if reason then feedback = reason; publish(); return end
  if action == "put" then
    if not objectId(data.containerId) or data.containerId == id or not accessibleBag(data.containerId) then feedback = "Choose an available destination bag"; publish(); return end
    argument = data.containerId
  elseif action == "give" then argument = data.recipient end
  prompt = nil
  request(function() return client.inventory[action](id, argument) end, function(result)
    feedback = result.outcome == "sent" and (action .. " command sent; waiting for server updates") or (result.reason or "Action refused"); publish()
  end)
end
local function saveSettings(data)
  if type(data) ~= "table" or data.identity ~= identity or workflow or not validPreferences(data.preferences) or not validProfile(data.profile) then
    feedback = "Settings are invalid, belong to another character, or a workflow is running"; publish(); return
  end
  if not characterKey then feedback = "Log in to save character settings"; publish(); return end
  local updated = copy(settings)
  -- Only persist the validated fields, rather than recursively copying arbitrary
  -- extra data supplied by a widget message.
  local preferences, savedProfile = data.preferences, { heldSlot = data.profile.heldSlot, rules = {} }
  updated.preferences = { fontSize = preferences.fontSize, showWorn = preferences.showWorn,
    confirmDisposal = preferences.confirmDisposal, bagOrder = {}, hiddenBags = {} }
  for _, id in ipairs(preferences.bagOrder) do table.insert(updated.preferences.bagOrder, id) end
  for _, id in ipairs(preferences.hiddenBags) do table.insert(updated.preferences.hiddenBags, id) end
  for _, rule in ipairs(data.profile.rules) do
    table.insert(savedProfile.rules, { enabled = rule.enabled, type = rule.type, name = rule.name, bagId = rule.bagId })
  end
  updated.profiles[characterKey] = savedProfile
  if not validSettings(updated) then feedback = "Settings exceed the supported limits"; publish(); return end
  local ok, accepted, reason = pcall(client.storage.set, STORAGE, updated)
  if not ok or accepted ~= true then storageError = "Could not save settings: " .. tostring(reason or "native storage refused the write"); publish(); return end
  local readOk, loaded, issue = pcall(client.storage.get, STORAGE)
  if not readOk or issue or not validSettings(loaded) then storageError = "Could not verify saved settings"; publish(); return end
  -- Compare using scalar/tree equality: MudForge pairs may retain nil fields.
  local function equal(a,b)
    if type(a) ~= type(b) then return false end
    if type(a) ~= "table" then return a == b end
    local function entry(value, name)
      if value[name] ~= nil then return value[name] end
      local index = tonumber(name)
      if index then return value[index] end
    end
    for name, value in pairs(a) do if value ~= nil and not equal(value,entry(b,name)) then return false end end
    for name, value in pairs(b) do if value ~= nil and entry(a,name) == nil then return false end end
    return true
  end
  if not equal(updated, loaded) then storageError = "Saved settings read-back did not match; retain your setup draft"; publish(); return end
  settings, profile, storageError = updated, copy(updated.profiles[characterKey]), nil
  settingsRevision, feedback = settingsRevision + 1, "Settings saved"
  publish()
end
message = function(role, event)
  if not initialized or type(event) ~= "table" or (event.sessionId and event.sessionId ~= getSessionId()) then return end
  local data = type(event.data) == "table" and event.data or {}
  if event.event == "ready" then ready[role] = true; publish()
  elseif event.event == "setup" then createWindow("setup", true); publish()
  elseif event.event == "manage" then openScope("inventory")
  elseif event.event == "open" then openScope(data.scope)
  elseif event.event == "refresh" then
    if not workflow then feedback = ""; readScope(role == "manager" and scope or "inventory") end
  elseif event.event == "select" and objectId(data.id) then
    local entry = item(data.id)
    if entry and (role == "summary" and entry.type == 11 or role == "manager" and entry.location == scope) then
      if selected ~= data.id then prompt = nil end
      selected, menu = data.id, nil; publish()
    end
  elseif event.event == "menu" and role == "manager" and objectId(data.id) then
    local entry = item(data.id)
    if entry and entry.location == scope then
      selected, menuSerial = data.id, menuSerial + 1
      menu = { id = data.id, identity = identity, scope = scope, actions = actions(data.id) }; publish()
    end
  elseif event.event == "action" and role == "manager" and data.id == selected and item(data.id) and item(data.id).location == scope then executeAction(data.id, data.action)
  elseif event.event == "submit" and role == "manager" then submit(data)
  elseif event.event == "save" and role == "setup" then saveSettings(data)
  elseif event.event == "organize" and role == "manager" then makePreview()
  elseif event.event == "start-organize" and role == "manager" then startOrganize()
  elseif event.event == "cancel" then cancelWorkflow()
  elseif event.event == "dismiss" then prompt, preview = nil, nil; publish() end
end
createWindow = function(role, force)
  if widgets[role] then if force then showWidget(widgets[role], true) end; return end
  local sizes = { summary = { width = 310, height = 280 }, manager = { width = 820, height = 560 }, setup = { width = 650, height = 560 } }
  local titles = { summary = "Aardwolf Inventory", manager = "Inventory Management", setup = "Inventory Setup" }
  local positions = { summary = { x = 60, y = 180 }, manager = { x = 220, y = 100 }, setup = { x = 300, y = 140 } }
  local id = createWidget({ type = "html", name = "inventory-" .. role, title = titles[role], size = sizes[role], position = positions[role] })
  if type(id) ~= "string" or id == "" then feedback = "Could not create the " .. role .. " window"; return end
  widgets[role] = id
  registerWidgetEvent(id, "luamsg", function(event) message(role, event) end)
  registerWidgetEvent(id, "menuselect", function(event)
    if role ~= "manager" or type(event) ~= "table" or (event.sessionId and event.sessionId ~= getSessionId()) then return end
    local context = menu; menu = nil
    if not context or context.identity ~= identity or context.scope ~= scope or not item(context.id) or item(context.id).location ~= context.scope then return end
    for _, action in ipairs(context.actions) do
      if action.id == event.id and not action.disabled then executeAction(context.id, action.id); return end
    end
  end)
  registerWidgetEvent(id, "menuclose", function(event)
    if type(event) == "table" and event.sessionId and event.sessionId ~= getSessionId() then return end
    menu = nil
  end)
  registerWidgetEvent(id, "close", function(event)
    if type(event) == "table" and event.sessionId and event.sessionId ~= getSessionId() then return end
    if role == "manager" then cancelWorkflow() end
  end)
  setWidgetProperty(id, "content", inventoryMarkup(role))
  if force then showWidget(id, true) end
end
synchronize = function()
  if not initialized then return end
  snapshot, status = client.inventory.get(), client.inventory.status()
  local name = status.characterName
  local nextKey = type(name) == "string" and #name > 0 and string.lower(name) or nil
  local nextIdentity = nextKey and (tostring(getSessionId()) .. "/" .. nextKey) or ""
  if identity ~= nextIdentity then
    if workflow then finishWorkflow("Character changed; workflow stopped. Inspect the previous character's arrangement.") end
    characterKey, identity = nextKey, nextIdentity
    profile = copy(characterKey and settings.profiles[characterKey] or defaultProfile())
    if not profile then profile = defaultProfile() end
    selected, scope, prompt, preview, menu = nil, "inventory", nil, nil, nil
    settingsRevision = settingsRevision + 1
  end
  if selected and not item(selected) then selected, prompt, menu = nil, nil, nil end
  if scope ~= "inventory" and scope ~= "equipment" then
    local bag = item(tonumber(string.match(scope,"^container:(%d+)$")))
    if not bag or bag.type ~= 11 then scope, selected, prompt, menu = "inventory", nil, nil, nil end
  end
  if workflow then
    if not status.active or not status.connected then finishWorkflow("Connection or active character changed; workflow stopped. Restore the arrangement manually.")
    else scheduleAdvance() end
  end
  publish()
end
function init()
  if initialized then return end
  libraryApi = require("aardwolf-api")
  client = libraryApi.new({ findPluginByName = findPluginByName, onPluginBroadcast = onPluginBroadcast,
    broadcastToPlugin = broadcastToPlugin, on = on, off = off, loadTable = loadTable, saveTable = saveTable,
    storageStatus = storageStatus, reportError = function(text) echo(text) end }, { inventory = true, packages = { "Char" } })
  if type(client.inventory.supports) ~= "function" then echo("Inventory Management requires aardwolf-api 0.7.0 or newer"); client = nil; return end
  local loaded, value, issue = pcall(client.storage.get, STORAGE)
  settings = loaded and value or nil
  storageError = (not loaded or issue) and "Saved inventory settings could not be read; defaults are in use until you save Setup" or nil
  if not validSettings(settings) then
    if settings ~= nil then storageError = "Saved inventory settings are invalid; defaults are in use until you save Setup" end
    settings = defaults()
  end
  initialized, profile, identity, characterKey = true, defaultProfile(), "", nil
  lifetime, feedback = lifetime + 1, ""
  createWindow("summary", false)
  table.insert(subscriptions, client.inventory.on(synchronize))
  table.insert(subscriptions, client.inventory.onResult(function(result)
    local callback = callbacks[result.requestId]
    if callback then callbacks[result.requestId] = nil; callback(result)
    elseif issuing then issuing[result.requestId] = result end
  end))
  registerCommand("awinventory", function(args)
    local command = type(args) == "string" and string.lower(string.match(args, "^%s*(.-)%s*$")) or ""
    if command == "show" then createWindow("summary", true)
    elseif command == "manage" then openScope("inventory")
    elseif command == "setup" then createWindow("setup", true)
    elseif command == "refresh" then if not workflow then readScope("inventory") end
    elseif command ~= "" and command ~= "status" then return "Usage: awinventory show|manage|setup|refresh|status" end
    publish()
    return "Aardwolf Inventory: " .. (status.characterName or "character unknown") .. "; " .. (storageError or status.error or workflowStatus() or currentReason() or "ready") .. "; " .. feedback
  end, "Open inventory windows, refresh inventory, or inspect status")
  client.start(); synchronize()
end
function cleanup()
  if not initialized then return end
  initialized, lifetime = false, lifetime + 1
  stopTimer(advanceTimer); advanceTimer = nil
  if workflow then stopTimer(workflow.timer) end
  workflow, callbacks, issuing = nil, {}, nil
  for _, unsubscribe in ipairs(subscriptions) do unsubscribe() end
  subscriptions = {}
  client.stop()
  for _, id in pairs(widgets) do destroyWidget(id) end
  widgets, ready, client = {}, {}, nil
  selected, scope, prompt, preview, menu = nil, "inventory", nil, nil, nil
  snapshot, status = { items = {}, scopes = {}, details = {} }, {}
end
