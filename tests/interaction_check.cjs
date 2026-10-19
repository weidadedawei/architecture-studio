const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const {createCanvas,loadImage,GlobalFonts}=require('@napi-rs/canvas');
const here=path.resolve(__dirname,'..'),out=path.join(here,'demo'),previews=path.join(here,'images'),results=[];
for(const font of ['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Supplemental/Arial Bold.ttf','/System/Library/Fonts/Supplemental/Arial Unicode.ttf']){try{GlobalFonts.registerFromPath(font);}catch(_){}}
const expose=`window.__test={getBook:()=>clone(book),getModel:()=>clone(model()),select,geometry,sceneCommands,validateBook,checkModel,moveEntity,record,persist,exportSvg,exportDrawio,saveHtml,importJson,switchLanguage,switchDiagram,render,fit,currentView};`;
function mount(html,{seed={},opaque=false}={}){
  const errors=[],downloads=[],blobs=new Map(),virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(html,{url:opaque?'file:///offline/index.html':'https://offline.invalid/editor/',runScripts:'outside-only',virtualConsole});
  const w=dom.window,d=w.document;w.structuredClone=structuredClone;w.Blob=Blob;w.ResizeObserver=class{observe(){}};
  Object.defineProperties(d.getElementById('workspace'),{clientWidth:{value:1440},clientHeight:{value:850}});
  d.getElementById('diagram').setPointerCapture=()=>{};
  const canvases=new WeakMap();
  w.HTMLCanvasElement.prototype.getContext=function(){let c=canvases.get(this);if(!c){c=createCanvas(this.width||300,this.height||150);canvases.set(this,c);}const context=c.getContext('2d'),original=context.drawImage.bind(context);context.drawImage=(image,...args)=>original(image._image||image,...args);return context;};
  w.HTMLCanvasElement.prototype.toBlob=function(callback){const c=canvases.get(this);callback(new Blob([c.toBuffer('image/png')],{type:'image/png'}));};
  w.Image=class{set src(url){const source=blobs.get(url);source.arrayBuffer().then(buf=>loadImage(Buffer.from(buf))).then(image=>{this._image=image;this.onload?.();}).catch(e=>this.onerror?.(e));}};
  w.URL.createObjectURL=blob=>{const id='blob:offline-'+blobs.size;blobs.set(id,blob);return id;};w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,blob:blobs.get(this.href)});};
  if(!opaque)for(const[k,v]of Object.entries(seed))w.localStorage.setItem(k,v);
  const script=[...d.querySelectorAll('script')].find(s=>s.type!=='application/json').textContent;
  w.eval(script.replace(/\}\)\(\);\s*$/,expose+'})();'));
  return {w,d,t:w.__test,errors,downloads,dom,click:id=>d.getElementById(id).click(),value:(id,value)=>{d.getElementById(id).value=value;},submit:()=>d.getElementById('editForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}))};
}
function saveResult(name){results.push(name);console.log('PASS',name);}
function pointer(app,target,type,x,y){target.dispatchEvent(new app.w.MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y}));}
function moveWithPointer(app,kind,id,dx,dy){const target=app.d.querySelector(`[data-kind="${kind}"][data-entity="${id}"] rect`),v=app.t.currentView();assert(target);pointer(app,target,'pointerdown',100,100);pointer(app,app.d.getElementById('diagram'),'pointermove',100+dx*v.scale,100+dy*v.scale);pointer(app,app.d.getElementById('diagram'),'pointerup',100+dx*v.scale,100+dy*v.scale);}
async function fakeImport(app,value){const text=typeof value==='string'?value:JSON.stringify(value);await app.t.importJson({size:Buffer.byteLength(text),text:async()=>text});}
async function main(){
  const html=await fs.readFile(path.join(out,'index.html'),'utf8'),a=mount(html);assert(a.t);assert.deepEqual(a.errors,[]);
  assert.equal(a.t.getModel().nodes.length,28);a.click('networkTab');assert.equal(a.t.getModel().nodes.length,13);a.click('systemTab');saveResult('both diagrams initialize without runtime errors');
  await fs.mkdir(previews,{recursive:true});await fs.mkdir(path.join(here,'reports'),{recursive:true});
  for(const type of ['system','network'])for(const language of ['zh-CN','en']){
    a.t.switchDiagram(type);a.t.switchLanguage(language);
    const commands=a.t.sceneCommands(),svg=a.t.exportSvg();assert(!svg.includes('NaN'));if(language==='en')assert(!/[\u3400-\u9fff]/u.test(a.d.getElementById('diagram').textContent));
    for(const c of commands)if(c.type==='edge')for(let i=1;i<c.geometry.points.length;i++){const p=c.geometry.points[i-1],q=c.geometry.points[i];assert(p[0]===q[0]||p[1]===q[1]);}
    const cardOverflow=[];
    for(const c of commands.filter(c=>c.type==='entity'&&c.kind==='node'))for(const p of c.items.filter(p=>p.type==='text')){
      const context=createCanvas(1,1).getContext('2d');context.font=`${p.weight} ${p.size}px Arial`;const width=context.measureText(p.value).width,left=p.anchor==='middle'?p.x-width/2:p.anchor==='end'?p.x-width:p.x;
      if(left<c.bounds.x-2||left+width>c.bounds.x+c.bounds.w+2||p.y>c.bounds.y+c.bounds.h+2)cardOverflow.push({id:c.id,text:p.value});
    }
    assert.deepEqual(cardOverflow,[],type+' '+language+' card overflow');
    await fs.writeFile(path.join(previews,`${type}-${language}.svg`),svg);
    const raster=await loadImage(Buffer.from(svg)),canvas=createCanvas(a.t.getModel().width*2,a.t.getModel().height*2),c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(raster,0,0,canvas.width,canvas.height);await fs.writeFile(path.join(previews,`${type}-${language}.png`),canvas.toBuffer('image/png'));
    const drawio=a.t.exportDrawio(),xml=new a.w.DOMParser().parseFromString(drawio,'application/xml');assert.equal(xml.querySelectorAll('parsererror').length,0);const cells=[...xml.querySelectorAll('mxCell')],ids=new Set(cells.map(c=>c.id));assert.equal(ids.size,cells.length);for(const c of cells)for(const k of ['source','target'])if(c.hasAttribute(k))assert(ids.has(c.getAttribute(k)));assert(cells.filter(c=>c.getAttribute('edge')==='1').length>=a.t.getModel().edges.length);await fs.writeFile(path.join(previews,`${type}-${language}.drawio`),drawio);
  }
  saveResult('four bilingual renderings: no Chinese in English, no card overflow, orthogonal edges, SVG/PNG and editable Draw.io valid');
  a.t.switchDiagram('system');a.t.switchLanguage('zh-CN');a.click('edit');a.t.select('node','manager');a.value('itemName','中文草稿');a.click('langEn');a.value('itemX','75');a.value('itemName','Management UI');a.submit();assert.equal(a.t.getModel().nodes.find(n=>n.id==='manager').x,75);a.click('langZh');a.t.select('node','manager');assert.equal(a.d.getElementById('itemName').value,'中文草稿');assert.equal(a.d.getElementById('itemX').value,'75');a.submit();let m=a.t.getModel();assert.equal(m.nodes.find(n=>n.id==='manager').x,75);assert.equal(m.translations.en['node.manager.name'],'Management UI');assert.equal(m.translations['zh-CN']['node.manager.name'],'中文草稿');saveResult('language drafts never overwrite shared geometry or the other translation');
  a.t.select('node','manager');a.value('itemSubtitle','中文待应用');a.click('networkTab');a.t.select('node','https-entry');a.value('itemName','ALB Test');a.submit();a.click('systemTab');a.t.select('node','manager');assert.equal(a.d.getElementById('itemSubtitle').value,'中文待应用');a.submit();assert.equal(a.t.getBook().diagrams.network.translations['zh-CN']['node.https-entry.name'],'ALB Test');saveResult('switching diagrams retains independent models and unapplied text drafts');
  a.t.select('edge','device-https');a.value('itemName','设备请求');a.value('edgeRoute','hv');a.value('edgeVia','245');a.submit();assert.equal(a.t.getModel().edges.find(e=>e.id==='device-https').via,245);a.click('langEn');a.t.select('edge','device-https');a.value('itemName','Device Requests');a.submit();assert.equal(a.t.getModel().translations['zh-CN']['edge.device-https.label'],'设备请求');saveResult('connection labels, endpoint fractions, and routing edit correctly in both languages');
  a.click('networkTab');a.t.select('annotation','public-clients');a.value('itemName','External Clients');a.submit();a.t.select('group','private-data');a.value('itemName','Private Data');a.submit();assert.equal(a.t.getModel().translations.en['annotation.public-clients.text'],'External Clients');assert.equal(a.t.getModel().translations.en['group.private-data.title'],'Private Data');saveResult('network zone and annotation text are editable');
  a.click('addNode');const newNode=a.t.getModel().nodes.at(-1).id;a.value('itemName','Extra Component');a.value('itemX','1000');a.value('itemY','780');a.submit();a.click('addEdge');const edge=a.t.getModel().edges.at(-1).id;a.value('edgeFrom','app');a.value('edgeTo',newNode);a.value('itemName','New Link');a.submit();const counts=[a.t.getModel().nodes.length,a.t.getModel().edges.length];a.t.select('node',newNode);a.click('deleteItem');assert(!a.t.getModel().edges.some(e=>e.id===edge));a.click('undo');assert.deepEqual([a.t.getModel().nodes.length,a.t.getModel().edges.length],counts);a.click('redo');assert(!a.t.getModel().nodes.some(n=>n.id===newNode));a.click('undo');saveResult('add/delete cascades and undo/redo restore components and their connections');
  a.t.select('node','app');a.click('closeInspector');const appBefore=a.t.getModel().nodes.find(n=>n.id==='app'),badgeBefore=a.t.getModel().annotations.find(n=>n.id==='single-instance');moveWithPointer(a,'node','app',12,0);m=a.t.getModel();assert.equal(m.nodes.find(n=>n.id==='app').x,appBefore.x+12);assert.equal(m.annotations.find(n=>n.id==='single-instance').x,badgeBefore.x+12);a.click('undo');saveResult('dragging a node moves its owned annotations; undo restores positions');
  a.click('systemTab');const opsBefore=JSON.stringify(a.t.getModel());moveWithPointer(a,'group','ops',30,0);assert.equal(JSON.stringify(a.t.getModel()),opsBefore);a.t.validateBook(a.t.getBook());saveResult('a group move that would push waypoints outside the canvas is rejected without saving invalid data');
  a.t.select('node','manager');a.value('itemName','Unapplied Draft');const beforeInvalid=JSON.stringify(a.t.getBook().diagrams),badCases=[];
  let bad=a.t.getBook();bad.diagrams.system.translations.en['node.business.modules']='bad';badCases.push(bad);
  bad=a.t.getBook();bad.diagrams.network.edges[0].to='missing-node';badCases.push(bad);
  bad=a.t.getBook();bad.diagrams.network.nodes[0].id=bad.diagrams.network.groups[0].id;badCases.push(bad);
  bad=a.t.getBook();bad.diagrams.system.nodes[0].w=-20;badCases.push(bad);
  bad=a.t.getBook();bad.diagrams.system.nodes[0].icon='https://invalid.example/icon.svg';badCases.push(bad);
  bad=a.t.getBook();bad.diagrams.network.annotations.find(a=>a.box).box.fill='url(https://invalid.example/pixel)';badCases.push(bad);
  for(const candidate of badCases){await fakeImport(a,candidate);assert.equal(JSON.stringify(a.t.getBook().diagrams),beforeInvalid);assert.equal(a.d.getElementById('itemName').value,'Unapplied Draft');}
  await fakeImport(a,'{broken JSON');assert.equal(a.d.getElementById('itemName').value,'Unapplied Draft');saveResult('seven malformed imports fail atomically and preserve the current inspector draft');
  a.click('save');const project=JSON.parse(await a.downloads.at(-1).blob.text());a.t.select('node','manager');a.value('itemName','Temporary');a.submit();await fakeImport(a,project);assert.deepEqual(a.t.getBook().diagrams,project.diagrams);for(const filename of ['01-bilingual-edit.json','02-customized-project.json']){const example=JSON.parse(await fs.readFile(path.join(here,'examples',filename),'utf8'));await fakeImport(a,example);assert.deepEqual(a.t.getBook().diagrams,example.diagrams);}await fakeImport(a,project);saveResult('JSON export/import round trip and both runnable examples preserve both diagrams and languages');
  a.click('saveHtml');const saved=await a.downloads.at(-1).blob.text();assert(saved.startsWith('<!doctype html>'));const snapshotData=JSON.parse(new JSDOM(saved).window.document.getElementById('editorData').textContent),oldStorage=Object.fromEntries(Array.from({length:a.w.localStorage.length},(_,i)=>{const k=a.w.localStorage.key(i);return[k,a.w.localStorage.getItem(k)];})),b=mount(saved,{seed:oldStorage});assert.notEqual(snapshotData.book.storageId,a.t.getBook().storageId);assert.deepEqual(b.t.getBook().diagrams,a.t.getBook().diagrams);saveResult('saved HTML embeds both edited diagrams and uses an independent storage namespace');
  const reloaded=mount(html,{seed:oldStorage});assert.deepEqual(reloaded.t.getBook().diagrams,a.t.getBook().diagrams);saveResult('browser storage reload retains bilingual edits');
  const opaque=mount(html,{opaque:true});assert(opaque.d.getElementById('status').textContent.includes('不可用'));opaque.click('langEn');opaque.click('networkTab');opaque.click('save');assert.equal(JSON.parse(await opaque.downloads.at(-1).blob.text()).active,'network');opaque.click('saveHtml');assert((await opaque.downloads.at(-1).blob.text()).includes('network-topology')||opaque.downloads.at(-1).name.endsWith('.html'));saveResult('opaque/file-origin storage failure still permits editing and JSON/HTML backup');
  a.click('networkTab');a.click('pngExport');for(let i=0;i<100&&a.d.getElementById('pngExport').disabled;i++)await new Promise(r=>setTimeout(r,20));assert(!a.d.getElementById('pngExport').disabled);const png=a.downloads.at(-1);assert(png.name.endsWith('.png'));const pngBytes=Buffer.from(await png.blob.arrayBuffer());assert.equal(pngBytes.subarray(1,4).toString(),'PNG');saveResult('PNG export produces a real high-resolution PNG through offline native rasterization');
  for(const x of [a,b,reloaded,opaque]){assert.deepEqual(x.errors,[]);x.dom.window.close();}
  await fs.writeFile(path.join(here,'reports','interaction-results.json'),JSON.stringify({checks:results,passed:results.length,verification:'Offline DOM and native SVG rasterization; no browser UI automation or network requests.'},null,2));
  console.log('\nALL',results.length,'CHECKS PASSED');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
