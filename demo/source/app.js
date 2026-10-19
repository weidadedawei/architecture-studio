(() => {
  'use strict';
  const $ = id => document.getElementById(id), NS = 'http://www.w3.org/2000/svg';
  const DATA = JSON.parse($('editorData').textContent), ICONS = DATA.icons, UI = DATA.ui;
  const DEFAULTS = structuredClone(DATA.book.diagrams), clone = value => structuredClone(value);
  const textFields = {node:['name','sub','detail','modules'],group:['title','sub','code','footer'],edge:['label'],annotation:['text']};
  const palette = {request:'#3b71b1',notify:'#0d9488',governance:'#94a3b8',dependency:'#7593aa',delivery:'#94a3b8'};
  let book, storageOK = true, selected = null, editing = false, gesture = null, toastTimer;
  const histories = {system:{undo:[],redo:[]},network:{undo:[],redo:[]}}, views = {}, drafts = new Map();
  const svg = $('diagram'), workspace = $('workspace');
  const ctx = document.createElement('canvas').getContext('2d');
  const safeId = id => typeof id === 'string' && /^[a-zA-Z][\w-]{0,79}$/.test(id);
  function fail(key='invalid') { throw Error(ui(key)); }
  function ui(key, vars={}) { let value = UI[book?.locale || 'zh-CN'][key] ?? UI['zh-CN'][key] ?? key; return String(value).replace(/\{(\w+)\}/g,(m,k)=>vars[k]??m); }
  function model() { return book.diagrams[book.active]; }
  function lang() { return book.locale; }
  function dict(m=model()) { return m.translations[lang()]; }
  function tr(key, fallback='', m=model()) { return m.translations?.[lang()]?.[key] ?? m.translations?.['zh-CN']?.[key] ?? fallback; }
  function local(kind,item,m=model()) { const o={...item}; for(const field of textFields[kind] || []) o[field]=tr(`${kind}.${item.id}.${field}`,item[field]??(field==='modules'?[]:''),m); return o; }
  function setText(kind,item,field,value) { model().translations[lang()][`${kind}.${item.id}.${field}`]=clone(value); if(lang()==='zh-CN')item[field]=clone(value); }
  function finite(v,min=-5000,max=6000) { return Number.isFinite(v)&&v>=min&&v<=max; }
  function checkModel(m,type) {
    if(!m||m.schema!==1||m.diagramType!==type||!finite(m.width,500,4000)||!finite(m.height,400,3000)) fail();
    for(const [key,max] of [['nodes',200],['groups',40],['edges',400],['annotations',200]])if(!Array.isArray(m[key])||m[key].length>max)fail();
    const ids=new Set(),endpointIds=new Set();
    for(const [kind,list] of [['node',m.nodes],['group',m.groups],['annotation',m.annotations]])for(const item of list){
      if(!item||!safeId(item.id)||ids.has(item.id)||!finite(item.x,0,m.width)||!finite(item.y,0,m.height))fail();
      ids.add(item.id);
      if(kind!=='annotation'){
        if(!finite(item.w,40,m.width)||!finite(item.h,28,m.height)||item.x+item.w>m.width+1||item.y+item.h>m.height+1)fail();
        endpointIds.add(item.id);
      }
      if(item.icon&&!Object.hasOwn(ICONS,item.icon))fail();
      if(item.altIcon&&!Object.hasOwn(ICONS,item.altIcon))fail();
      if(item.layout&&!['stacked','horizontal','hero','network','network-note','frame','network-zone'].includes(item.layout))fail();
      for(const name of ['fill','stroke','color','titleColor','subColor'])if(item[name]!==undefined&&!/^#[\da-f]{6}$/i.test(item[name]))fail();
      for(const field of textFields[kind])if(item[field]!==undefined){
        if(field==='modules'){if(!Array.isArray(item[field])||item[field].length>8||item[field].some(s=>typeof s!=='string'||s.length>80))fail();}
        else if(typeof item[field]!=='string'||item[field].length>2000)fail();
      }
      for(const name of ['titleSize','titleSizeEn','subSize','subSizeEn','subLineHeight','iconSize','size','enSize','lineHeight'])if(item[name]!==undefined&&!finite(item[name],8,100))fail();
      if(item.owner&&!safeId(item.owner))fail();
      if(item.box&&(!finite(item.box.x,0,m.width)||!finite(item.box.y,0,m.height)||!finite(item.box.w,1,m.width)||!finite(item.box.h,1,m.height)))fail();
      if(item.box)for(const key of ['fill','stroke'])if(item.box[key]!==undefined&&!/^#[\da-f]{6}$/i.test(item.box[key]))fail();
      for(const key of ['titleOffset','subOffset','textOffset','iconOffset'])if(item[key]!==undefined&&(!Array.isArray(item[key])||item[key].length!==2||!item[key].every(v=>finite(v))))fail();
      for(const key of ['subLineSizes','subLineSizesEn'])if(item[key]!==undefined&&(!Array.isArray(item[key])||item[key].length>30||!item[key].every(v=>finite(v,8,100))))fail();
      for(const key of ['enY','hEn','rx'])if(item[key]!==undefined&&!finite(item[key],0,4000))fail();
      if(item.legendLine){if(!['x1','x2','y'].every(k=>finite(item.legendLine[k]))||!/^#[\da-f]{6}$/i.test(item.legendLine.color))fail();}
      if(item.anchor&&!['start','middle','end'].includes(item.anchor))fail();
    }
    for(const edge of m.edges){
      if(!safeId(edge.id)||ids.has(edge.id)||!endpointIds.has(edge.from)||!endpointIds.has(edge.to)||!Object.hasOwn(palette,edge.type))fail();
      ids.add(edge.id);
      if(edge.route&&!['auto','hv','vh','around','poly'].includes(edge.route))fail();
      for(const key of ['fromPort','toPort'])if(edge[key]&&!['top','bottom','left','right'].includes(edge[key]))fail();
      for(const key of ['fromFraction','toFraction'])if(edge[key]!==undefined&&!finite(edge[key],0,1))fail();
      for(const key of ['via','viaY'])if(edge[key]!==undefined&&!finite(edge[key],0,Math.max(m.width,m.height)))fail();
      for(const key of ['labelPosition','labelOffset'])if(edge[key]&&(!Array.isArray(edge[key])||edge[key].length!==2||!edge[key].every(v=>finite(v))))fail();
      if(edge.waypoints&&(!Array.isArray(edge.waypoints)||edge.waypoints.length>24||edge.waypoints.some(p=>!Array.isArray(p)||p.length!==2||!finite(p[0],0,m.width)||!finite(p[1],0,m.height))))fail();
      if(edge.label!==undefined&&(typeof edge.label!=='string'||edge.label.length>500))fail();
    }
    if(!m.translations||Object.keys(m.translations).some(l=>!['zh-CN','en'].includes(l)))fail();
    for(const l of ['zh-CN','en']){
      const d=m.translations[l];if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).length>4000)fail();
      for(const[k,v]of Object.entries(d)){
        if(k.length>180||!/^(?:diagram\.[\w.]+|(?:node|group|edge|annotation)\.[\w-]+\.[\w]+)$/.test(k))fail();
        if(k.endsWith('.modules')){if(!Array.isArray(v)||v.length>8||v.some(s=>typeof s!=='string'||s.length>80))fail();}
        else if(typeof v!=='string'||v.length>3000)fail();
      }
    }
    return m;
  }
  function normalizeModel(m,type){
    const o=clone(m);o.diagramType=type;o.annotations??=[];o.translations??={};
    for(const l of ['zh-CN','en'])o.translations[l]??={};
    for(const[kind,list]of [['node',o.nodes],['group',o.groups],['edge',o.edges],['annotation',o.annotations]])for(const item of list||[])for(const field of textFields[kind]){
      const key=`${kind}.${item.id}.${field}`;
      if(item[field]!==undefined&&o.translations['zh-CN'][key]===undefined)o.translations['zh-CN'][key]=clone(item[field]);
    }
    for(const l of ['zh-CN','en'])for(const key of Object.keys(o.translations[l]))if(key.startsWith('ui.'))delete o.translations[l][key];
    return checkModel(o,type);
  }
  function validateBook(data){
    if(!data||data.schema!==2||!data.diagrams||typeof data.storageId!=='string'||data.storageId.length>120||!['system','network'].includes(data.active)||!['zh-CN','en'].includes(data.locale))fail();
    const o=clone(data);for(const type of ['system','network'])o.diagrams[type]=normalizeModel(o.diagrams[type],type);
    if(o.drafts){if(typeof o.drafts!=='object'||Array.isArray(o.drafts)||Object.keys(o.drafts).length>800)fail();for(const[k,v]of Object.entries(o.drafts)){if(k.length>200||!v||typeof v!=='object'||Array.isArray(v)||Object.values(v).some(x=>typeof x!=='boolean'&&(typeof x!=='string'||x.length>4000)))fail();}}
    return o;
  }
  book=validateBook(DATA.book);
  const storageKey=()=>`demo-diagram-workbench:${book.storageId}`;
  try { const raw=localStorage.getItem(storageKey());if(raw){try{book=validateBook(JSON.parse(raw));}catch(_){/* Keep the bundled diagram if stored data is invalid. */}} } catch(_){storageOK=false;}
  for(const[k,v]of Object.entries(book.drafts||{}))drafts.set(k,v);
  const params=new URLSearchParams(location.search);if(['system','network'].includes(params.get('diagram')))book.active=params.get('diagram');if(['zh-CN','en'].includes(params.get('lang')))book.locale=params.get('lang');
  function persist(){book.drafts=Object.fromEntries(drafts);try{localStorage.setItem(storageKey(),JSON.stringify(book));storageOK=true;}catch(_){storageOK=false;}status();}
  function status(){ $('status').textContent=ui(storageOK?'savedLocal':'storageUnavailable'); }
  function toast(key,vars){$('toast').textContent=Object.hasOwn(UI[lang()],key)?ui(key,vars):key;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3200);}
  function history(){return histories[book.active];}
  function record(){history().undo.push(clone(model()));if(history().undo.length>50)history().undo.shift();history().redo=[];}
  function applyHistory(direction){rememberDraft();const h=history(),from=h[direction],other=h[direction==='undo'?'redo':'undo'];if(!from.length)return;other.push(clone(model()));book.diagrams[book.active]=from.pop();for(const k of drafts.keys())if(k.startsWith(book.active+':'))drafts.delete(k);selected=null;$('inspector').hidden=true;persist();refresh();render();}
  function itemFor(sel=selected){if(!sel)return null;return sel.kind==='meta'?{id:sel.id}:model()[sel.kind==='node'?'nodes':sel.kind==='group'?'groups':sel.kind==='edge'?'edges':'annotations'].find(x=>x.id===sel.id);}
  function currentView(){return views[book.active]??=( {scale:1,x:0,y:0,auto:true} );}
  function fit(){const v=currentView(),w=workspace.clientWidth,h=workspace.clientHeight;v.scale=Math.max(.08,Math.min((w-30)/model().width,(h-30)/model().height));v.x=(w-model().width*v.scale)/2;v.y=(h-model().height*v.scale)/2;v.auto=true;view();}
  function view(){const v=currentView();svg.setAttribute('viewBox',`0 0 ${workspace.clientWidth} ${workspace.clientHeight}`);svg.querySelector('#scene')?.setAttribute('transform',`translate(${v.x},${v.y}) scale(${v.scale})`);$('zoomValue').textContent=Math.round(v.scale*100)+'%';}
  function zoom(factor,x=workspace.clientWidth/2,y=workspace.clientHeight/2){const v=currentView(),old=v.scale,next=Math.max(.08,Math.min(3,old*factor));v.x=x-(x-v.x)*next/old;v.y=y-(y-v.y)*next/old;v.scale=next;v.auto=false;view();}
  function measure(s,size=13,weight=400){ctx.font=`${weight} ${size}px Arial,"PingFang SC","Microsoft YaHei",sans-serif`;return ctx.measureText(s).width;}
  const iconCache=new Map();
  function iconSource(key,color){const icon=ICONS[key]||ICONS.server;if(!color||icon.kind==='brand')return icon.src;const cacheKey=key+':'+color;if(!iconCache.has(cacheKey)){const source=atob(icon.src.split(',')[1]).replace(/currentColor/g,color).replace(/stroke="#[\da-f]{6}"/gi,'stroke="'+color+'"');iconCache.set(cacheKey,'data:image/svg+xml;base64,'+btoa(source));}return iconCache.get(cacheKey);}
  function wrap(value,width,size=13,weight=400){const result=[];for(const row of String(value||'').split('\n')){let line='';for(const token of row.match(/[A-Za-z0-9_.+\/-]+|[^\x00-\xff]|\s+|./g)||['']){if(line&&measure(line+token,size,weight)>width){result.push(line.trimEnd());line='';}if(measure(token,size,weight)>width){for(const ch of token){if(line&&measure(line+ch,size,weight)>width){result.push(line);line='';}line+=ch;}}else line+=line?token:token.trimStart();}result.push(line.trimEnd());}return result;}
  function endpoint(id){return model().nodes.find(n=>n.id===id)||model().groups.find(n=>n.id===id);}
  function port(n,side='right',fraction=.5){return side==='top'?[n.x+n.w*fraction,n.y]:side==='bottom'?[n.x+n.w*fraction,n.y+n.h]:side==='left'?[n.x,n.y+n.h*fraction]:[n.x+n.w,n.y+n.h*fraction];}
  function geometry(e){
    const p=port(endpoint(e.from),e.fromPort,e.fromFraction),q=port(endpoint(e.to),e.toPort||'left',e.toFraction),route=e.route||'auto';let raw=[p];
    if(route==='hv'){const x=e.via??(p[0]+q[0])/2;raw.push([x,p[1]],[x,q[1]]);}
    else if(route==='vh'){const y=e.via??(p[1]+q[1])/2;raw.push([p[0],y],[q[0],y]);}
    else if(route==='around')raw.push([p[0],e.viaY??p[1]+40],[e.via??(p[0]+q[0])/2,e.viaY??p[1]+40],[e.via??(p[0]+q[0])/2,q[1]]);
    else if(route==='poly')raw.push(...(e.waypoints||[]));
    else if(p[0]!==q[0]&&p[1]!==q[1]){
      if(['top','bottom'].includes(e.fromPort))raw.push([p[0],(p[1]+q[1])/2],[q[0],(p[1]+q[1])/2]);
      else raw.push([(p[0]+q[0])/2,p[1]],[(p[0]+q[0])/2,q[1]]);
    }
    raw.push(q);const points=[];
    for(let i=0;i<raw.length;i++){const next=raw[i],prev=points.at(-1);if(prev&&Math.abs(prev[0]-next[0])>.001&&Math.abs(prev[1]-next[1])>.001){const first=i===1,vertical=first?['top','bottom'].includes(e.fromPort):i===raw.length-1?!['top','bottom'].includes(e.toPort||'left'):false;points.push(vertical?[prev[0],next[1]]:[next[0],prev[1]]);}if(!points.length||Math.abs(points.at(-1)[0]-next[0])>.001||Math.abs(points.at(-1)[1]-next[1])>.001)points.push(next);}
    const segments=points.slice(1).map((b,i)=>({a:points[i],b,len:Math.hypot(b[0]-points[i][0],b[1]-points[i][1])})).filter(s=>s.len>.001).sort((a,b)=>b.len-a.len),s=segments.find(s=>s.a[1]===s.b[1]&&s.len>80)||segments[0],offset=e.labelOffset||[0,0];
    return {points,label:e.labelPosition|| (s?[(s.a[0]+s.b[0])/2+offset[0],(s.a[1]+s.b[1])/2-10+offset[1]]:[p[0]+offset[0],p[1]-10+offset[1]])};
  }
  function annotationBounds(a){if(a.box)return{x:a.box.x,y:a.box.y,w:a.box.w,h:a.box.h};const text=local('annotation',a).text,size=lang()==='en'?(a.enSize||a.size||15):a.size||15,lines=String(text).split('\n'),w=Math.max(15,...lines.map(s=>measure(s,size,a.weight||400))),x=a.anchor==='middle'?a.x-w/2:a.anchor==='end'?a.x-w:a.x,y=(lang()==='en'?a.enY??a.y:a.y)-size;return{x,y,w,h:lines.length*(a.lineHeight||size*1.4)+4};}
  function sceneCommands(){
    const commands=[],m=model();let items=commands;
    const R=(x,y,w,h,fill='#fff',stroke='#d9e3ef',rx=14,extra={})=>items.push({type:'rect',x,y,w,h,fill,stroke,rx,...extra});
    const T=(x,y,value,size=13,color='#7d90a8',weight=400,anchor='start',extra={})=>items.push({type:'text',x,y,value:String(value??''),size,color,weight,anchor,...extra});
    const I=(key,x,y,size,color)=>items.push({type:'image',key,x,y,size,color});
    const L=(x1,y1,x2,y2,color='#d9e4f2',dash=false)=>items.push({type:'line',x1,y1,x2,y2,color,dash});
    const entity=(kind,item,draw,bounds=item)=>{const prev=items,command={type:'entity',kind,id:item.id,bounds:{x:bounds.x,y:bounds.y,w:bounds.w,h:bounds.h},items:[]};commands.push(command);items=command.items;draw();items=prev;};
    const tile=(key,x,y,box=44,size=30,color)=>{R(x,y,box,box,'#f2f5fa','#e6ebf2',12);I(key,x+(box-size)/2,y+(box-size)/2,size,color);};
    R(0,0,m.width,m.height,'#fff','#e3ebf5',22);
    entity('meta',{id:'canvas'},()=>{
      R(30,24,5,38,'#496d9d','none',2.5);T(51,48,tr('diagram.title'),32,'#203b5a',600);T(51,70,tr('diagram.kicker'),m.diagramType==='network'?17:12,'#8092aa');
      const width=lang()==='en'?340:252,x=m.width-width-30;R(x,24,width,31,'#ecf2fa','#dde7f3',15);T(x+width/2,45,tr('diagram.mode'),13,'#596987',500,'middle');T(m.width-30,73,tr('diagram.referenceNote'),13,'#7d90a8',400,'end');
    },{x:25,y:17,w:m.width-50,h:65});
    if(m.diagramType==='system')entity('meta',{id:'overview'},()=>{
      R(30,90,575,150,'#f5f8fc','#e1e9f3',18);T(52,126,tr('diagram.overviewTitle'),19,'#304b62',600);wrap(tr('diagram.overviewSub'),530,13).forEach((line,i)=>T(52,155+i*18,line));
      for(const item of [{x:52,key:'request',color:palette.request},{x:222,key:'notify',color:palette.notify},{x:391,key:'governance',color:palette.governance}]){L(item.x,204,item.x+27,204,item.color,item.key==='governance');T(item.x+36,209,tr('diagram.legend.'+item.key));}
    },{x:30,y:90,w:575,h:150});
    for(const source of m.groups){const g=local('group',source);entity('group',source,()=>{
      R(g.x,g.y,g.w,lang()==='en'?(g.hEn??g.h):g.h,g.fill||'#f5f8fc',g.stroke||(g.id==='application'?'#d9d7ee':'#e4eaf0'),g.rx||18,{dash:!!g.optional});
      if(g.layout==='frame'||g.layout==='network-zone'){
        if(g.icon)I(g.icon,g.x+(g.iconOffset?.[0]||24),g.y+(g.iconOffset?.[1]||16),g.iconSize||26);
        T(g.x+(g.titleOffset?.[0]||24),g.y+(g.titleOffset?.[1]||36),g.title,g.titleSize||20,g.color||'#3d5f81',600);
        if(g.sub)T(g.x+(g.subOffset?.[0]??g.w-25),g.y+(g.subOffset?.[1]??36),g.sub,g.subSize||15,'#8296ad',400,g.subAnchor||'end');
      }else{
        R(g.x+18,g.y+17,32,26,g.color||'#64748b','none',8);T(g.x+34,g.y+35,g.code||'',12,'#fff',600,'middle');T(g.x+61,g.y+36,g.title,19,'#304b62',600);if(g.sub)T(g.x+61,g.y+57,g.sub);
        if(g.optional)T(g.x+g.w-20,g.y+34,tr('diagram.referenceShort'),12,'#7d90a8',400,'end');
        if(g.footer){L(g.x+30,g.y+g.h-53,g.x+g.w-30,g.y+g.h-53);T(g.x+g.w/2,g.y+g.h-25,g.footer,13,'#7d90a8',400,'middle');}
      }
    });}
    for(const edge of m.edges)commands.push({type:'edge',edge:local('edge',edge),geometry:geometry(edge)});
    for(const source of m.nodes){const n=local('node',source),x=n.x,y=n.y;entity('node',source,()=>{
      R(x,y,n.w,n.h,n.fill||'#fff',n.stroke||(n.layout==='hero'?'#c5cfee':n.optional?'#c4d1e1':'#d9e3ef'),n.layout?.startsWith('network')?17:14,{dash:!!n.optional,shadow:n.layout!=='network-note',main:true});
      if(n.layout==='hero'){
        R(x+1,y+1,n.w-2,83,'#f4f5ff','none',13);tile(n.icon,x+16,y+15);T(x+72,y+43,n.name,21,'#233d63',600);const sub=n.sub.split('\n');T(x+18,y+71,sub[0]||'',13,'#71829c');const modules=n.modules||[],expanded=n.h>220;
        modules.forEach((name,i)=>{const last=expanded&&i===modules.length-1&&modules.length%2,w=expanded?(last?n.w-32:(n.w-44)/2):78,bx=last?16:expanded?16+(i%2)*(w+12):16+(i%3)*86,by=(expanded?100:90)+Math.floor(i/(expanded?2:3))*(expanded?39:34);R(x+bx,y+by,w,28,'#f1f4fb','#e8ecf6',7);T(x+bx+w/2,y+by+19,name,13,'#596987',500,'middle');});T(x+18,y+n.h-38,sub[1]||'',13,'#71829c');T(x+18,y+n.h-19,sub[2]||'',13,'#71829c');
      }else if(n.layout==='stacked'){
        if(n.altIcon){const bx=x+(n.w-84)/2;R(bx,y+11,84,44,'#f2f5fa','#e6ebf2',12);I(n.icon,bx+10,y+19,28);I(n.altIcon,bx+52,y+22,23);}else tile(n.icon,x+(n.w-44)/2,y+11);
        const names=wrap(n.name,n.w-16,18,600);names.forEach((line,i)=>T(x+n.w/2,y+75+i*21,line,18,'#304b62',600,'middle'));wrap(n.sub,n.w-16,13).forEach((line,i)=>T(x+n.w/2,y+94+(names.length-1)*21+i*17,line,13,'#71859a',400,'middle'));
      }else if(n.layout==='network-note'){
        I(n.icon,x+(n.iconOffset?.[0]||22),y+(n.iconOffset?.[1]||25),n.iconSize||31,n.color);T(x+(n.textOffset?.[0]||70),y+(n.textOffset?.[1]||36),n.name,n.titleSize||19,n.titleColor||'#4a7768',600);
        n.sub.split('\n').forEach((line,i)=>T(x+(n.subOffset?.[0]||70),y+(n.subOffset?.[1]||67)+i*(n.subLineHeight||25),line,(lang()==='en'?n.subLineSizesEn:n.subLineSizes)?.[i]||n.subSize||16,n.subColor||'#739486'));
      }else if(n.layout==='network'){
        tile(n.icon,x+18,y+19,48,28,n.color);const titleSize=lang()==='en'?(n.titleSizeEn||n.titleSize||22):n.titleSize||22,subSize=lang()==='en'?(n.subSizeEn||n.subSize||16):n.subSize||16;
        const names=wrap(n.name,n.w-95,titleSize,600);names.forEach((line,i)=>T(x+81,y+43+i*(titleSize+3),line,titleSize,'#345371',600));wrap(n.sub,n.w-95,subSize).forEach((line,i)=>T(x+81,y+72+(names.length-1)*(titleSize+3)+i*24,line,subSize,'#6c85a1'));
      }else{
        const compact=n.kind==='delivery',box=compact?40:44,tx=compact?64:76,font=compact?16:18;tile(n.icon,x+(compact?12:15),y+(n.h-box)/2,box,compact?28:30);const names=wrap(n.name,n.w-tx-12,font,600),subs=n.sub?wrap(n.sub,n.w-tx-12,13):[],total=names.length*22+(subs.length?6+subs.length*18:0),start=y+(n.h-total)/2+17;names.forEach((line,i)=>T(x+tx,start+i*22,line,font,'#304b62',600));subs.forEach((line,i)=>T(x+tx,start+names.length*22+4+i*18,line,13,'#71859a'));
      }
    });}
    for(const source of m.annotations){const a=local('annotation',source),bounds=annotationBounds(source);entity('annotation',source,()=>{
      if(a.box)R(a.box.x,a.box.y,a.box.w,a.box.h,a.box.fill,a.box.stroke,a.box.rx||14);
      const size=lang()==='en'?(a.enSize||a.size||15):a.size||15,y=lang()==='en'?(a.enY??a.y):a.y;
      String(a.text).split('\n').forEach((line,i)=>T(a.x,y+i*(a.lineHeight||size*1.4),line,size,a.color||'#7d90a8',a.weight||400,a.anchor||'start'));
      if(a.legendLine){const l=a.legendLine;L(l.x1,l.y,l.x2,l.y,l.color,l.dash);}
    },bounds);}
    return commands;
  }
  function el(tag,attrs={},text){const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;}
  function render(){
    const commands=sceneCommands();svg.replaceChildren();const defs=el('defs');
    for(const[key,color]of Object.entries(palette))for(const start of [false,true]){const marker=el('marker',{id:`arrow-${key}${start?'-start':''}`,viewBox:'0 0 10 10',refX:start?1:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto'});marker.append(el('path',{d:start?'M10,0 L0,5 L10,10Z':'M0,0 L10,5 L0,10Z',fill:color}));defs.append(marker);}
    const shadow=el('filter',{id:'card-shadow',x:'-15%',y:'-20%',width:'135%',height:'150%'});shadow.append(el('feDropShadow',{dx:0,dy:3,stdDeviation:4,'flood-color':'#25446a','flood-opacity':.055}));defs.append(shadow);svg.append(defs);
    svg.append(el('style',{},'text{font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif}.edge-label{paint-order:stroke;stroke:#fff;stroke-width:4;stroke-linejoin:round}.edit-hit{fill:none;stroke:#4979b4;stroke-width:2;stroke-dasharray:5 4;pointer-events:none}'));
    svg.append(el('title',{},tr('diagram.title')));const scene=el('g',{id:'scene'});svg.append(scene);
    const primitive=(p,parent)=>{
      if(p.type==='rect')parent.append(el('rect',{x:p.x,y:p.y,width:p.w,height:p.h,rx:p.rx,fill:p.fill,stroke:p.stroke,'stroke-width':1.1,...(p.dash?{'stroke-dasharray':'5 5'}:{}),...(p.shadow?{filter:'url(#card-shadow)'}:{})}));
      else if(p.type==='text')parent.append(el('text',{x:p.x,y:p.y,fill:p.color,'font-size':p.size,'font-weight':p.weight,'text-anchor':p.anchor},p.value));
      else if(p.type==='line')parent.append(el('line',{x1:p.x1,y1:p.y1,x2:p.x2,y2:p.y2,stroke:p.color,'stroke-width':1.5,...(p.dash?{'stroke-dasharray':'5 5'}:{})}));
      else if(p.type==='image')parent.append(el('image',{href:iconSource(p.key,p.color),x:p.x,y:p.y,width:p.size,height:p.size,'data-icon':p.key}));
    };
    for(const command of commands){
      if(command.type==='entity'){
        const g=el('g',{'data-entity':command.id,'data-kind':command.kind});if(command.kind==='node'){const n=local('node',model().nodes.find(n=>n.id===command.id));if(n.detail)g.append(el('title',{},n.name+' — '+n.detail));}command.items.forEach(p=>primitive(p,g));if(selected?.kind===command.kind&&selected.id===command.id){const b=command.bounds;g.append(el('rect',{x:b.x-4,y:b.y-4,width:b.w+8,height:b.h+8,rx:10,class:'edit-hit'}));}scene.append(g);
      }else if(command.type==='edge'){
        const e=command.edge,{points,label}=command.geometry,g=el('g',{'data-entity':e.id,'data-kind':'edge'}),d=points.map((p,i)=>(i?'L':'M')+p.join(',')).join(' '),color=palette[e.type]||palette.request;
        g.append(el('path',{d,fill:'none',stroke:color,'stroke-width':selected?.id===e.id?2.8:1.6,'stroke-linejoin':'round','marker-end':`url(#arrow-${e.type})`,...(e.bidirectional?{'marker-start':`url(#arrow-${e.type}-start)`}:{}),...(e.type==='governance'?{'stroke-dasharray':'5 5'}:{})}));
        if(e.label)g.append(el('text',{x:label[0],y:label[1],fill:e.labelColor||'#7188a3','font-size':lang()==='en'?(e.labelSizeEn||e.labelSize||12):e.labelSize||12,'text-anchor':e.labelAnchor||'middle',class:'edge-label'},e.label));
        if(editing)g.append(el('path',{d,fill:'none',stroke:'transparent','stroke-width':18,'data-hit':'edge'}));scene.append(g);
      }else primitive(command,scene);
    }
    svg.classList.toggle('is-editing',editing);view();
  }
  function refresh(){
    document.documentElement.lang=lang();document.title=ui('pageTitle');for(const e of document.querySelectorAll('[data-i18n]'))e.textContent=ui(e.dataset.i18n);
    $('systemTab').setAttribute('aria-selected',book.active==='system');$('networkTab').setAttribute('aria-selected',book.active==='network');$('langZh').setAttribute('aria-pressed',lang()==='zh-CN');$('langEn').setAttribute('aria-pressed',lang()==='en');$('edit').setAttribute('aria-pressed',editing);
    $('undo').disabled=!history().undo.length;$('redo').disabled=!history().redo.length;$('addNode').disabled=!editing;$('addEdge').disabled=!editing;
    $('hint').textContent=ui(editing?'editHint':'viewHint');status();
    for(const id of ['edgeFromPort','edgeToPort']){$(id).replaceChildren();for(const value of ['right','left','top','bottom'])$(id).append(new Option(ui(value),value));}
    $('edgeRoute').replaceChildren();for(const route of ['auto','hv','vh','around','poly'])$('edgeRoute').append(new Option(ui('route_'+route),route));
    $('edgeType').replaceChildren();for(const type of Object.keys(palette))$('edgeType').append(new Option(ui('type_'+type),type));
    $('itemAnchor').replaceChildren();for(const anchor of ['start','middle','end'])$('itemAnchor').append(new Option(ui('anchor_'+anchor),anchor));
    if(selected)fillInspector();
  }
  const draftKey=()=>selected?`${book.active}:${lang()}:${selected.kind}:${selected.id}`:'';
  const sharedDraftKey=()=>selected?`${book.active}:shared:${selected.kind}:${selected.id}`:'';
  const languageFormIds=new Set(['itemName','itemSubtitle','itemDetail','itemModules']);
  const formIds=['itemName','itemSubtitle','itemDetail','itemModules','itemX','itemY','itemW','itemH','itemFill','itemStroke','itemIcon','itemOptional','itemSize','itemAnchor','edgeFrom','edgeTo','edgeFromPort','edgeToPort','edgeType','edgeRoute','edgeVia','edgeViaY','edgeWaypoints','edgeLabelX','edgeLabelY','edgeBoth','edgeFromFraction','edgeToFraction'];
  function rememberDraft(){if(!selected||$('inspector').hidden)return;const text={},shared={};for(const id of formIds)(languageFormIds.has(id)?text:shared)[id]=$(id).type==='checkbox'?$(id).checked:$(id).value;drafts.set(draftKey(),text);drafts.set(sharedDraftKey(),shared);persist();}
  function setValue(id,value){if($(id).type==='checkbox')$(id).checked=!!value;else $(id).value=value??'';}
  function showLabel(id,show){const label=$(id).closest('label');if(label)label.hidden=!show;}
  function fillInspector(){
    const source=itemFor();if(!source){selected=null;$('inspector').hidden=true;return;}
    const kind=selected.kind,item=kind==='meta'?source:local(kind,source),isEdge=kind==='edge',isAnnotation=kind==='annotation',isMeta=kind==='meta';
    $('inspectorTitle').textContent=ui('edit_'+kind);$('nodeFields').hidden=kind!=='node';$('edgeFields').hidden=!isEdge;$('boxFields').hidden=isEdge||isMeta;$('annotationFields').hidden=!isAnnotation;$('moduleFields').hidden=!(kind==='node'&&item.layout==='hero')&&!isMeta;$('deleteItem').hidden=isMeta;
    showLabel('itemSubtitle',!isEdge&&!isAnnotation);showLabel('itemDetail',!isEdge&&!isAnnotation);showLabel('itemW',!isAnnotation);showLabel('itemH',!isAnnotation);
    $('inspectorHelp').textContent=ui('inspectorHelp');
    const values={itemName:item.name??item.title??item.text??item.label??'',itemSubtitle:item.sub||'',itemDetail:kind==='group'?item.footer||'':item.detail||'',itemModules:(item.modules||[]).join('\n'),itemX:item.x,itemY:item.y,itemW:item.w,itemH:item.h,itemFill:item.fill||'#ffffff',itemStroke:item.stroke||item.color||'#d9e3ef',itemIcon:item.icon||'server',itemOptional:item.optional,itemSize:item.size||15,itemAnchor:item.anchor||'start'};
    if(isMeta){const overview=item.id==='overview';values.itemName=tr(overview?'diagram.overviewTitle':'diagram.title');values.itemSubtitle=tr(overview?'diagram.overviewSub':'diagram.kicker');values.itemDetail=overview?'':tr('diagram.mode');values.itemModules=overview?'':tr('diagram.referenceNote');}
    if(isEdge){for(const id of ['edgeFrom','edgeTo']){$(id).replaceChildren();for(const[kind,list]of [['node',model().nodes],['group',model().groups]])for(const source of list){const i=local(kind,source);$(id).append(new Option(i.name||i.title||i.id,i.id));}}
      Object.assign(values,{edgeFrom:item.from,edgeTo:item.to,edgeFromPort:item.fromPort||'right',edgeToPort:item.toPort||'left',edgeType:item.type,edgeRoute:item.route||'auto',edgeVia:item.via,edgeViaY:item.viaY,edgeWaypoints:(item.waypoints||[]).map(p=>p.join(', ')).join('\n'),edgeLabelX:item.labelPosition?.[0],edgeLabelY:item.labelPosition?.[1],edgeBoth:item.bidirectional,edgeFromFraction:item.fromFraction??.5,edgeToFraction:item.toFraction??.5});
    }
    Object.assign(values,drafts.get(sharedDraftKey())||{},drafts.get(draftKey())||{});for(const id of formIds)setValue(id,values[id]);
  }
  function select(kind,id){rememberDraft();selected={kind,id};$('inspector').hidden=false;fillInspector();render();}
  function commitForm(event){
    event?.preventDefault();const source=itemFor();if(!source)return;const before=clone(model());
    try{
      const kind=selected.kind,name=$('itemName').value.trim(),number=id=>{const value=Number($(id).value);if(!Number.isFinite(value))fail('invalidNumber');return value;},optionalNumber=id=>$(id).value.trim()===''?undefined:number(id);
      if(kind!=='edge'&&!name)fail('nameRequired');
      if(kind==='meta'){
        const overview=source.id==='overview';dict()[overview?'diagram.overviewTitle':'diagram.title']=name;dict()[overview?'diagram.overviewSub':'diagram.kicker']=$('itemSubtitle').value.trim();if(!overview){dict()['diagram.mode']=$('itemDetail').value.trim();dict()['diagram.referenceNote']=$('itemModules').value.trim();}
      }else if(kind==='edge'){
        setText('edge',source,'label',name);Object.assign(source,{from:$('edgeFrom').value,to:$('edgeTo').value,fromPort:$('edgeFromPort').value,toPort:$('edgeToPort').value,fromFraction:number('edgeFromFraction'),toFraction:number('edgeToFraction'),type:$('edgeType').value,route:$('edgeRoute').value,bidirectional:$('edgeBoth').checked});
        for(const[field,id]of [['via','edgeVia'],['viaY','edgeViaY']]){const value=optionalNumber(id);if(value===undefined)delete source[field];else source[field]=value;}
        source.waypoints=$('edgeWaypoints').value.trim()?$('edgeWaypoints').value.trim().split(/\n/).map(line=>line.trim().split(/[,，\s]+/).map(Number)):[];
        const lx=optionalNumber('edgeLabelX'),ly=optionalNumber('edgeLabelY');if((lx===undefined)!==(ly===undefined))fail('labelPair');if(lx===undefined)delete source.labelPosition;else source.labelPosition=[lx,ly];
      }else{
        const oldX=source.x,oldY=source.y,newX=number('itemX'),newY=number('itemY');moveEntity(kind,source,newX-oldX,newY-oldY,false);
        if(kind==='annotation'){setText(kind,source,'text',name);source.size=number('itemSize');delete source.enSize;source.anchor=$('itemAnchor').value;source.color=$('itemStroke').value;}
        else{
          Object.assign(source,{w:number('itemW'),h:number('itemH'),fill:$('itemFill').value,stroke:$('itemStroke').value,optional:$('itemOptional').checked});delete source.hEn;setText(kind,source,kind==='node'?'name':'title',name);setText(kind,source,'sub',$('itemSubtitle').value.trim());setText(kind,source,kind==='node'?'detail':'footer',$('itemDetail').value.trim());
          if(kind==='node'){source.icon=$('itemIcon').value;if(source.layout==='hero')setText(kind,source,'modules',$('itemModules').value.split('\n').map(s=>s.trim()).filter(Boolean));}
        }
      }
      checkModel(model(),book.active);history().undo.push(before);if(history().undo.length>50)history().undo.shift();history().redo=[];drafts.delete(draftKey());drafts.delete(sharedDraftKey());selected=null;$('inspector').hidden=true;persist();refresh();render();toast('applied');
    }catch(e){book.diagrams[book.active]=before;toast(e.message);}
  }
  function moveAnnotation(a,dx,dy){a.x+=dx;a.y+=dy;if(a.enY!==undefined)a.enY+=dy;if(a.box){a.box.x+=dx;a.box.y+=dy;}if(a.legendLine){a.legendLine.x1+=dx;a.legendLine.x2+=dx;a.legendLine.y+=dy;}}
  function moveEntity(kind,item,dx,dy,contents=true){
    if(kind==='annotation'){moveAnnotation(item,dx,dy);return;}
    const moved=new Set([item.id]),inside=n=>n.x>=item.x-.1&&n.y>=item.y-.1&&n.x+n.w<=item.x+item.w+.1&&n.y+n.h<=item.y+item.h+.1;
    if(kind==='group'&&contents){for(const n of [...model().nodes,...model().groups])if(n.id!==item.id&&inside(n)){n.x+=dx;n.y+=dy;moved.add(n.id);}for(const a of model().annotations)if(a.x>=item.x&&a.x<=item.x+item.w&&a.y>=item.y&&a.y<=item.y+item.h)moveAnnotation(a,dx,dy);}
    else for(const a of model().annotations)if(a.owner===item.id)moveAnnotation(a,dx,dy);
    item.x+=dx;item.y+=dy;
    for(const e of model().edges)if(moved.has(e.from)&&moved.has(e.to)){if(e.waypoints)e.waypoints=e.waypoints.map(p=>[p[0]+dx,p[1]+dy]);if(e.via!==undefined)e.via+=e.route==='vh'?dy:dx;if(e.viaY!==undefined)e.viaY+=dy;if(e.labelPosition)e.labelPosition=[e.labelPosition[0]+dx,e.labelPosition[1]+dy];}
  }
  let nextId=0;
  const uniqueId=prefix=>prefix+'-'+(crypto.randomUUID?.()||Date.now().toString(36)+'-'+(++nextId));
  function addNode(){if(model().nodes.length>=200){toast('limitReached');return;}record();const m=model(),id=uniqueId('component'),item={id,x:Math.min(750,m.width-240),y:Math.min(350,m.height-160),w:220,h:125,name:'新组件',sub:'组件说明',detail:'',icon:'server',kind:'app',layout:m.diagramType==='network'?'network':'horizontal'};m.nodes.push(item);for(const[l,name,sub]of [['zh-CN','新组件','组件说明'],['en','New Component','Component description']]){m.translations[l][`node.${id}.name`]=name;m.translations[l][`node.${id}.sub`]=sub;m.translations[l][`node.${id}.detail`]='';}persist();refresh();select('node',id);}
  function addEdge(){if(model().edges.length>=400){toast('limitReached');return;}if(model().nodes.length<2){toast('needNodes');return;}record();const id=uniqueId('connection'),edge={id,from:model().nodes[0].id,to:model().nodes[1].id,type:'request',route:'auto',label:''};model().edges.push(edge);for(const l of ['zh-CN','en'])model().translations[l][`edge.${id}.label`]='';persist();refresh();select('edge',id);}
  function deleteItem(){if(!selected||selected.kind==='meta')return;record();const{kind,id}=selected,key=kind==='node'?'nodes':kind==='group'?'groups':kind==='edge'?'edges':'annotations',removed=new Set([id]);model()[key]=model()[key].filter(i=>i.id!==id);if(kind==='node'||kind==='group'){for(const e of model().edges)if(e.from===id||e.to===id)removed.add(e.id);model().edges=model().edges.filter(e=>e.from!==id&&e.to!==id);model().annotations=model().annotations.filter(a=>{if(a.owner===id){removed.add(a.id);return false;}return true;});}for(const l of ['zh-CN','en'])for(const k of Object.keys(model().translations[l]))if([...removed].some(id=>k.split('.')[1]===id))delete model().translations[l][k];for(const k of drafts.keys())if(k.startsWith(book.active+':')&&[...removed].some(id=>k.endsWith(':'+id)))drafts.delete(k);selected=null;$('inspector').hidden=true;persist();refresh();render();toast('deleted');}
  function switchDiagram(type){rememberDraft();book.active=type;selected=null;$('inspector').hidden=true;persist();refresh();render();if(currentView().auto)fit();}
  function switchLanguage(locale){rememberDraft();book.locale=locale;persist();refresh();render();}
  function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
  function exportSvg(){const copy=svg.cloneNode(true),m=model();copy.setAttribute('xmlns',NS);copy.setAttribute('width',m.width);copy.setAttribute('height',m.height);copy.setAttribute('viewBox',`0 0 ${m.width} ${m.height}`);copy.setAttribute('lang',lang());copy.querySelector('#scene').removeAttribute('transform');copy.querySelectorAll('.edit-hit,[data-hit]').forEach(e=>e.remove());copy.classList.remove('is-editing');return new XMLSerializer().serializeToString(copy);}
  const stem=()=>`demo-${book.active==='system'?'architecture':'network-topology'}-${lang()==='en'?'en':'zh'}`;
  function exportDrawio(){
    const doc=document.implementation.createDocument('','mxfile'),file=doc.documentElement;let serial=0;file.setAttribute('host','app.diagrams.net');
    const make=(tag,attrs={},parent)=>{const e=doc.createElement(tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));parent?.append(e);return e;};
    const diagram=make('diagram',{id:book.active,name:tr('diagram.title')},file),graph=make('mxGraphModel',{grid:1,gridSize:10,guides:1,connect:1,page:1,pageScale:1,pageWidth:model().width,pageHeight:model().height},diagram),root=make('root',{},graph);make('mxCell',{id:0},root);make('mxCell',{id:1,parent:0},root);
    const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    const cell=(id,value,style,x,y,w,h,parent=1)=>{const c=make('mxCell',{id,value,style,vertex:1,parent},root);make('mxGeometry',{x,y,width:w,height:h,as:'geometry'},c);return c;};
    const primitive=(p,parent=1,origin={x:0,y:0})=>{
      const id='part-'+(++serial),x=p.x-origin.x,y=p.y-origin.y;
      if(p.type==='rect')cell(id,'',`rounded=1;arcSize=14;fillColor=${p.fill};strokeColor=${p.stroke};${p.dash?'dashed=1;':''}`,x,y,p.w,p.h,parent);
      else if(p.type==='text'){
        const width=measure(p.value,p.size,p.weight)+4,tx=p.anchor==='middle'?x-width/2:p.anchor==='end'?x-width:x;
        cell(id,esc(p.value),`text;html=1;strokeColor=none;fillColor=none;whiteSpace=nowrap;overflow=visible;align=left;verticalAlign=top;spacing=0;fontFamily=Arial;fontSize=${p.size};fontColor=${p.color};${p.weight>=500?'fontStyle=1;':''}`,tx,y-p.size*.85,width,p.size*1.3,parent);
      }else if(p.type==='image'){
        const src='data:image/svg+xml,'+encodeURIComponent(atob(iconSource(p.key,p.color).split(',')[1]));cell(id,'',`shape=image;image=${src};aspect=fixed;imageAspect=0;`,x,y,p.size,p.size,parent);
      }else if(p.type==='line'){
        const c=make('mxCell',{id,edge:1,parent,style:`endArrow=none;strokeColor=${p.color};${p.dash?'dashed=1;':''}`},root),g=make('mxGeometry',{relative:1,as:'geometry'},c);make('mxPoint',{x:p.x1-origin.x,y:p.y1-origin.y,as:'sourcePoint'},g);make('mxPoint',{x:p.x2-origin.x,y:p.y2-origin.y,as:'targetPoint'},g);
      }
    };
    for(const c of sceneCommands()){
      if(c.type==='entity'){const id=`${c.kind}-${c.id}`,b=c.bounds;cell(id,'','group;html=1;',b.x,b.y,b.w,b.h);c.items.forEach(p=>primitive(p,id,b));}
      else if(c.type==='edge'){
        const e=c.edge,from=endpoint(e.from),to=endpoint(e.to),p=c.geometry.points[0],q=c.geometry.points.at(-1),source=(model().nodes.includes(from)?'node-':'group-')+e.from,target=(model().nodes.includes(to)?'node-':'group-')+e.to;
        const style=`edgeStyle=none;html=1;endArrow=block;endFill=1;${e.bidirectional?'startArrow=block;startFill=1;':''}strokeColor=${palette[e.type]};strokeWidth=1.5;fontFamily=Arial;fontSize=${lang()==='en'?(e.labelSizeEn||e.labelSize||12):e.labelSize||12};fontColor=${e.labelColor||'#7188a3'};labelBackgroundColor=#ffffff;exitX=${(p[0]-from.x)/from.w};exitY=${(p[1]-from.y)/from.h};entryX=${(q[0]-to.x)/to.w};entryY=${(q[1]-to.y)/to.h};exitPerimeter=0;entryPerimeter=0;${e.type==='governance'?'dashed=1;':''}`;
        const edge=make('mxCell',{id:'edge-'+e.id,value:'',edge:1,parent:1,source,target,style},root),g=make('mxGeometry',{relative:1,as:'geometry'},edge),points=make('Array',{as:'points'},g);c.geometry.points.slice(1,-1).forEach(p=>make('mxPoint',{x:p[0],y:p[1]},points));
        if(e.label)primitive({type:'text',x:c.geometry.label[0],y:c.geometry.label[1],value:e.label,size:lang()==='en'?(e.labelSizeEn||e.labelSize||12):e.labelSize||12,color:e.labelColor||'#7188a3',weight:400,anchor:e.labelAnchor||'middle'});
      }else primitive(c);
    }
    return new XMLSerializer().serializeToString(doc);
  }
  async function exportPng(){const button=$('pngExport');button.disabled=true;try{const url=URL.createObjectURL(new Blob([exportSvg()],{type:'image/svg+xml'}));try{const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error(ui('exportFailed')));image.src=url;});const canvas=document.createElement('canvas'),scale=2;canvas.width=model().width*scale;canvas.height=model().height*scale;const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(image,0,0,canvas.width,canvas.height);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!blob)throw Error(ui('exportFailed'));download(blob,stem()+'.png');toast('exported');}finally{URL.revokeObjectURL(url);}}catch(e){toast(e.message);}finally{button.disabled=false;}}
  function serializeJson(value){return JSON.stringify(value).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');}
  function saveHtml(){rememberDraft();const copy=document.documentElement.cloneNode(true),snapshot=clone(book);snapshot.storageId='snapshot-'+(crypto.randomUUID?.()||Date.now().toString(36));copy.querySelector('#editorData').textContent=serializeJson({...DATA,book:snapshot});copy.querySelector('#diagram').replaceChildren();copy.querySelector('#inspector').hidden=true;copy.querySelector('#toast').hidden=true;copy.querySelector('#fileInput').value='';download(new Blob(['<!doctype html>\n'+copy.outerHTML],{type:'text/html;charset=utf-8'}),'demo-bilingual-diagrams-edited.html');toast('savedHtml');}
  async function importJson(file){
    if(!file)return;rememberDraft();const previous=book,oldDrafts=new Map(drafts),oldSelected=selected,oldHistories=clone(histories),oldViews=clone(views),oldInspectorHidden=$('inspector').hidden;try{if(file.size>2500000)fail('fileTooLarge');const incoming=JSON.parse(await file.text());let candidate;
      if(incoming.schema===2)candidate=validateBook(incoming);
      else if(incoming.schema===1){candidate=clone(book);const type=incoming.diagramType==='network'?'network':'system';candidate.diagrams[type]=normalizeModel(incoming,type);candidate.active=type;candidate.locale=incoming.locale==='en'?'en':book.locale;candidate=validateBook(candidate);}
      else fail();
      const currentStorageId=book.storageId;book=candidate;book.storageId=currentStorageId;sceneCommands();drafts.clear();for(const[k,v]of Object.entries(book.drafts||{}))drafts.set(k,v);for(const type of ['system','network']){histories[type]={undo:[],redo:[]};delete views[type];}selected=null;$('inspector').hidden=true;refresh();render();fit();persist();toast('imported');
    }catch(e){book=previous;drafts.clear();for(const[k,v]of oldDrafts)drafts.set(k,v);selected=oldSelected;for(const type of ['system','network']){histories[type]=oldHistories[type];delete views[type];if(oldViews[type])views[type]=oldViews[type];}$('inspector').hidden=oldInspectorHidden;persist();refresh();render();toast(ui('importFailed')+': '+e.message);}finally{$('fileInput').value='';}
  }
  $('systemTab').onclick=()=>switchDiagram('system');$('networkTab').onclick=()=>switchDiagram('network');$('langZh').onclick=()=>switchLanguage('zh-CN');$('langEn').onclick=()=>switchLanguage('en');
  $('fit').onclick=fit;$('plus').onclick=()=>zoom(1.2);$('minus').onclick=()=>zoom(1/1.2);$('undo').onclick=()=>applyHistory('undo');$('redo').onclick=()=>applyHistory('redo');
  $('edit').onclick=()=>{rememberDraft();editing=!editing;if(!editing){selected=null;$('inspector').hidden=true;}refresh();render();};
  $('addNode').onclick=addNode;$('addEdge').onclick=addEdge;$('deleteItem').onclick=deleteItem;$('editForm').onsubmit=commitForm;$('closeInspector').onclick=()=>{rememberDraft();selected=null;$('inspector').hidden=true;render();};
  $('save').onclick=()=>{rememberDraft();download(new Blob([JSON.stringify(book,null,2)],{type:'application/json'}),'demo-bilingual-diagrams.json');toast('savedJson');};$('load').onclick=()=>$('fileInput').click();$('fileInput').onchange=e=>importJson(e.target.files[0]);$('saveHtml').onclick=saveHtml;
  $('svgExport').onclick=()=>{download(new Blob([exportSvg()],{type:'image/svg+xml'}),stem()+'.svg');toast('exported');};$('drawioExport').onclick=()=>{download(new Blob([exportDrawio()],{type:'application/xml'}),stem()+'.drawio');toast('exported');};$('pngExport').onclick=exportPng;
  $('reset').onclick=()=>{record();book.diagrams[book.active]=normalizeModel(DEFAULTS[book.active],book.active);for(const k of drafts.keys())if(k.startsWith(book.active+':'))drafts.delete(k);selected=null;$('inspector').hidden=true;persist();refresh();render();fit();toast('resetDone');};
  for(const id of Object.keys(ICONS))$('itemIcon').append(new Option(id,id));
  for(const id of ['edgeFromFraction','edgeToFraction'])$(id).step='any';
  svg.addEventListener('wheel',e=>{e.preventDefault();const r=svg.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top);},{passive:false});
  svg.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;const target=e.target.closest('[data-entity]'),kind=target?.dataset.kind,id=target?.dataset.entity,v=currentView();
    if(editing&&kind==='edge'){select(kind,id);return;}
    if(editing&&target){rememberDraft();if(kind==='meta'){select(kind,id);return;}gesture={kind,id,sx:e.clientX,sy:e.clientY,base:clone(model()),moved:false};}
    else{v.auto=false;gesture={kind:'pan',sx:e.clientX,sy:e.clientY,x:v.x,y:v.y,moved:false};}
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove',e=>{
    if(!gesture)return;const dx=e.clientX-gesture.sx,dy=e.clientY-gesture.sy;if(Math.hypot(dx,dy)>3)gesture.moved=true;
    if(gesture.kind==='pan'){const v=currentView();v.x=gesture.x+dx;v.y=gesture.y+dy;view();}
    else if(gesture.moved){book.diagrams[book.active]=clone(gesture.base);const item=itemFor({kind:gesture.kind,id:gesture.id});const mx=Math.round(dx/currentView().scale),my=Math.round(dy/currentView().scale),bounds=gesture.kind==='annotation'?annotationBounds(item):item,minX=-bounds.x,maxX=model().width-bounds.x-bounds.w,minY=-bounds.y,maxY=model().height-bounds.y-bounds.h;moveEntity(gesture.kind,item,Math.max(minX,Math.min(maxX,mx)),Math.max(minY,Math.min(maxY,my)));render();}
  });
  function endGesture(){if(!gesture)return;const g=gesture;gesture=null;if(g.kind==='pan')return;if(g.moved){try{checkModel(model(),book.active);}catch(_){book.diagrams[book.active]=g.base;refresh();render();toast('dragOutside');return;}history().undo.push(g.base);if(history().undo.length>50)history().undo.shift();history().redo=[];drafts.delete(`${book.active}:shared:${g.kind}:${g.id}`);persist();refresh();if(selected)fillInspector();render();}else select(g.kind,g.id);}
  svg.addEventListener('pointerup',endGesture);svg.addEventListener('pointercancel',endGesture);
  svg.addEventListener('dblclick',e=>{const t=e.target.closest('[data-entity]');if(!t)return;editing=true;refresh();select(t.dataset.kind,t.dataset.entity);});
  document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();applyHistory(e.shiftKey?'redo':'undo');}if(e.key==='Escape')$('closeInspector').click();});
  let lastSize={w:workspace.clientWidth,h:workspace.clientHeight};new ResizeObserver(()=>{const v=currentView(),w=workspace.clientWidth,h=workspace.clientHeight;if(v.auto)fit();else{v.x+=(w-lastSize.w)/2;v.y+=(h-lastSize.h)/2;view();}lastSize={w,h};}).observe(workspace);
  refresh();render();fit();
})();
