const svg=document.querySelector('svg'), city=document.querySelector('#city'), panel=document.querySelector('#panel');
let sensor='VIIRS', year='2025', view=[0,0,2200,1000], drag=null, moved=false;
const months='Oca Şub Mar Nis May Haz Tem Ağu Eyl Eki Kas Ara'.split(' ');
for(const [n,d] of atlas.paths.sort((a,b)=>a[0].localeCompare(b[0],'tr'))){
 city.add(new Option(n,n));const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',d);p.dataset.name=n;const t=document.createElementNS(svg.namespaceURI,'title');t.textContent=n;p.append(t);p.onclick=()=>{if(!moved){city.value=n;render()}};land.append(p);
}
for(const n of ['MODIS','VIIRS','Birleşmiş']){const b=document.createElement('button');b.textContent=n;b.onclick=()=>{sensor=n;render()};document.querySelector('nav').append(b)}
function render(){const n=city.value;place.textContent=n;document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.textContent===sensor));land.querySelectorAll('path').forEach(p=>p.classList.toggle('selected',p.dataset.name===n));
 const data=atlas.series[sensor]?.[n];if(!data){panel.textContent=sensor==='Birleşmiş'?'Birleşmiş seri henüz eklenmedi.':'Bu il için veri henüz eklenmedi.';return}
 if(!data[year])year=Object.keys(data).at(-1);const counts=data[year];panel.innerHTML='<div class="row"><b>Aylık tespitler</b><select aria-label="Yıl"></select></div><p></p><div class="months"></div>';const select=panel.querySelector('select');Object.keys(data).reverse().forEach(y=>select.add(new Option(y,y)));select.value=year;select.onchange=()=>{year=select.value;render()};panel.querySelector('p').textContent=counts.reduce((a,b)=>a+b,0).toLocaleString('tr')+' uydu tespiti';panel.querySelector('.months').innerHTML=counts.map((x,i)=>'<div style="background:rgba(203,112,48,'+(.12+.6*x/Math.max(1,...counts))+')"><small>'+months[i]+'</small><b>'+x+'</b></div>').join('');
}
function apply(){view[0]=Math.max(0,Math.min(2200-view[2],view[0]));view[1]=Math.max(0,Math.min(1000-view[3],view[1]));svg.setAttribute('viewBox',view.join(' '))}
function zoom(f,x=.5,y=.5){const w=Math.min(2200,Math.max(240,view[2]*f)),h=w/2.2;view=[view[0]+(view[2]-w)*x,view[1]+(view[3]-h)*y,w,h];apply()}
svg.onwheel=e=>{e.preventDefault();const r=svg.getBoundingClientRect();zoom(e.deltaY<0?.8:1.25,(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height)};
svg.onpointerdown=e=>{drag=[e.clientX,e.clientY,...view];moved=false};
window.onpointermove=e=>{if(!drag)return;const dx=e.clientX-drag[0],dy=e.clientY-drag[1];if(Math.abs(dx)+Math.abs(dy)>3)moved=true;if(moved){view[0]=drag[2]-dx*view[2]/svg.clientWidth;view[1]=drag[3]-dy*view[3]/svg.clientHeight;apply()}};
window.onpointerup=()=>drag=null;plus.onclick=()=>zoom(.75);minus.onclick=()=>zoom(1.333);home.onclick=()=>{view=[0,0,2200,1000];apply()};city.onchange=render;city.value='İzmir';render();
