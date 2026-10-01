"""Genera páginas de prueba aisladas (.qa/) a partir del index construido.
Usa claves siguiente.qa.*; nunca escribe sobre los datos reales de Siguiente.
"""
from pathlib import Path
root=Path(__file__).resolve().parent.parent
out=root/'.qa';out.mkdir(exist_ok=True)
base=(root/'public'/'index.html').read_text(encoding='utf-8').replace('siguiente.frontend.v2','siguiente.qa.v2').replace('siguiente.theme','siguiente.qa.theme')
app=(root/'src/app.js').read_text(encoding='utf-8').replace('siguiente.frontend.v2','siguiente.qa.v2').replace('siguiente.theme','siguiente.qa.theme')
marker='<script>\n'+app
common="""
try { localStorage.removeItem('siguiente.qa.v2'); localStorage.setItem('siguiente.qa.theme','light'); } catch(e) {}
globalThis.SiguienteConfig={sync:false};
var qd=new Date(),qp=n=>String(n).padStart(2,'0');
globalThis.QA_TODAY=qd.getFullYear()+'-'+qp(qd.getMonth()+1)+'-'+qp(qd.getDate());
qd.setDate(qd.getDate()+1);globalThis.QA_TOMORROW=qd.getFullYear()+'-'+qp(qd.getMonth()+1)+'-'+qp(qd.getDate());
"""
helper="""
var sleep=ms=>new Promise(r=>setTimeout(r,ms));
var q=s=>document.querySelector(s);
var vis=s=>[...document.querySelectorAll(s)].find(e=>e.getClientRects().length&&e.offsetWidth&&getComputedStyle(e).display!=='none');
var click=s=>{var e=vis(s);if(!e)throw new Error('Missing '+s);e.scrollIntoView({block:'nearest',behavior:'instant'});e.click();};
var type=(s,v)=>{q(s).value=v;q(s).dispatchEvent(new Event('input',{bubbles:true}));};
var go=v=>click('[data-action="go"][data-view="'+v+'"]');
for(var n=0;n<100&&!q('#capture');n++)await sleep(10);
if(!q('#capture'))throw new Error('Initial render missing');
"""
# Evita cerrar un script desde datos literales de los propios fixtures.
def script(code): return '<script>\n'+code.replace('</script','<\\/script')+'\n</script>\n'
def save(name, setup='', body=''):
 text=base.replace(marker,script(common+setup)+marker,1)
 if body:text=text.replace('</body>',script(body)+'</body>')
 (out/(name+'.html')).write_text(text, encoding='utf-8')

ui=(root/'tests/ui.test.js').read_text(encoding='utf-8')
for kind in ['workflow','recovery','quota','tabs','reload','pagination','print']:
 setup="globalThis.QA_KIND='"+kind+"';"
 if kind=='recovery':setup+="localStorage.setItem('siguiente.qa.v2',JSON.stringify({schemaVersion:99,tasks:[],sessions:[],plans:[],savedAt:null}));"
 if kind=='quota':setup+="Storage.prototype.setItem=function(){throw new DOMException('Quota de prueba','QuotaExceededError');};"
 if kind=='pagination':setup+="var ss=SiguienteCore.emptyState();for(var i=0;i<40;i++)ss=SiguienteCore.captureTask(ss,{title:'Tarea '+i},new Date(Date.now()-100000+i*1000).toISOString()).state;localStorage.setItem('siguiente.qa.v2',JSON.stringify(ss));"
 if kind=='print':setup+="var ss=SiguienteCore.emptyState();var stamp=n=>new Date(Date.now()-240000+n*1000).toISOString();ss=SiguienteCore.captureTask(ss,{title:'Tarea de prueba de impresión'},stamp(0)).state;var id=ss.tasks[0].id;ss=SiguienteCore.defineTask(ss,{taskId:id,nextAction:'Un paso de prueba'},stamp(1)).state;for(var i=0;i<60;i++){ss=SiguienteCore.startSession(ss,{taskId:id},stamp(2+i*3)).state;ss=SiguienteCore.closeSession(ss,{progress:'yes',finished:false,nextStep:'Un paso de prueba'},stamp(3+i*3)).state;}localStorage.setItem('siguiente.qa.v2',JSON.stringify(ss));"
 if kind=='reload':
  setup="globalThis.QA_KIND='reload';if(sessionStorage.getItem('siguiente.qa.reload')==='done') {var ss=SiguienteCore.captureTask(SiguienteCore.emptyState(),{title:'Persistencia al recargar'},new Date(Date.now()-10000).toISOString()).state;localStorage.setItem('siguiente.qa.v2',JSON.stringify(ss));}"
  # En la segunda carga conserva exactamente el estado, no lo reconstruye.
  text=base.replace(marker,script(common.replace("localStorage.removeItem('siguiente.qa.v2');", "if(sessionStorage.getItem('siguiente.qa.reload')!=='done')localStorage.removeItem('siguiente.qa.v2');")+"globalThis.QA_KIND='reload';")+marker,1).replace('</body>',script(ui)+'</body>')
  (out/('ui-'+kind+'.html')).write_text(text, encoding='utf-8')
 else:save('ui-'+kind,setup,ui)

scenarios={
 'sample-today':"click('[data-action=\"sample\"]');",
 'sample-dark':"click('[data-action=\"sample\"]');click('[data-action=\"theme-toggle\"]');",
 'inbox':"click('[data-action=\"sample\"]');go('bandeja');",
 'inbox-edit':"click('[data-action=\"sample\"]');go('bandeja');var last=[...document.querySelectorAll('[data-action=\"edit-inline-action\"]')].at(-1);last.click();type('#inline-action','Escribir tres ideas y elegir una');",
 'inbox-error':"type('#capture','Preparar mi primer borrador');click('.capture-add');click('[data-action=\"save-inline-action\"]');",
 'session':"click('[data-action=\"sample\"]');click('[data-action=\"start\"]');",
 'session-paused':"click('[data-action=\"sample\"]');click('[data-action=\"start\"]');click('[data-action=\"session-pause-toggle\"]');",
 'close':"click('[data-action=\"sample\"]');click('[data-action=\"start\"]');click('[data-action=\"finish\"]');",
 'close-error':"click('[data-action=\"sample\"]');click('[data-action=\"start\"]');click('[data-action=\"finish\"]');type('#cl-next','');q('#close-form').requestSubmit();",
 'week':"click('[data-action=\"sample\"]');go('semana');",
 'progress':"click('[data-action=\"sample\"]');go('progreso');",
 'progress-empty':"click('[data-action=\"sample\"]');go('progreso');type('#log-search','No coincide');q('.log-empty').scrollIntoView({block:'center',behavior:'instant'});",
 'adjust':"click('[data-action=\"sample\"]');click('[data-action=\"adjust\"]');",
 'define':"click('[data-action=\"sample\"]');click('[data-action=\"adjust\"]');click('[data-action=\"adjust-edit\"]');",
 'reschedule':"click('[data-action=\"sample\"]');click('[data-action=\"adjust\"]');click('[data-action=\"adjust-reschedule\"]');",
 'menu':"click('[data-action=\"open-settings\"]');",
 'menu-empty':"click('[data-action=\"toggle-menu\"]');",
 'import-confirm':"click('[data-action=\"toggle-menu\"]');var ss=SiguienteCore.captureTask(SiguienteCore.emptyState(),{title:'Ejemplo de copia importada'},new Date().toISOString()).state;var dt=new DataTransfer();dt.items.add(new File([JSON.stringify(ss)],'ejemplo.json',{type:'application/json'}));q('#importfile').files=dt.files;q('#importfile').dispatchEvent(new Event('change',{bubbles:true}));await sleep(40);q('#import-confirm').scrollIntoView({block:'center',behavior:'instant'});",
 'long-content':"type('#capture','Una tarea con una descripción más larga de lo habitual para comprobar que cada palabra y cada control tienen el espacio que necesitan, sin salir de su contenedor');click('.capture-add');type('#inline-action','Empezar por una acción concreta aunque su descripción ocupe varias líneas: revisar las notas del documento, elegir una idea y escribir el primer párrafo sin preocuparme todavía por la versión final');click('[data-action=\"save-inline-action\"]');click('[data-action=\"choose\"]');",
}
for name,code in scenarios.items():
 if name=='menu':continue
 body='(async function(){'+helper+code+"\nawait sleep(30);q('#announcement').textContent='';document.activeElement?.blur();document.title='QA PASS · "+name+"';})().catch(function(e){document.title='QA FAIL · '+e.message;setTimeout(function(){throw e},0);});"
 save(name,body=body)
# Estado de error de recuperación, sin recorrer nada más, para inspección visual.
save('recovery',"localStorage.setItem('siguiente.qa.v2','{datos rotos');")
print('Generated',len(list(out.glob('*.html'))),'isolated QA pages in .qa/')
