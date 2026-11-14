const city=document.querySelector('#city'), panel=document.querySelector('#panel');
let sensor='VIIRS',year='2025';
const months='Oca Şub Mar Nis May Haz Tem Ağu Eyl Eki Kas Ara'.split(' ');
const provinces=atlas.paths.map(([name,d])=>({name,path:new Path2D(d)}));
for(const {name} of provinces.slice().sort((a,b)=>a.name.localeCompare(b.name,'tr')))city.add(new Option(name,name));for(const n of ['MODIS','VIIRS','Birleşmiş']){const b=document.createElement('button');b.textContent=n;b.onclick=()=>{sensor=n;render()};document.querySelector('nav').append(b)}
function render(){const n=city.value;place.textContent=n;document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.textContent===sensor));current.textContent=n;paint();
 const data=atlas.series[sensor]?.[n];if(!data){panel.textContent=sensor==='Birleşmiş'?'Birleşmiş seri henüz eklenmedi.':'Bu il için veri henüz eklenmedi.';return}
 if(!data[year])year=Object.keys(data).at(-1);const counts=data[year];panel.innerHTML='<div class="row"><b>Aylık tespitler</b><select aria-label="Yıl"></select></div><p></p><div class="months"></div>';const select=panel.querySelector('select');Object.keys(data).reverse().forEach(y=>select.add(new Option(y,y)));select.value=year;select.onchange=()=>{year=select.value;render()};panel.querySelector('p').textContent=counts.reduce((a,b)=>a+b,0).toLocaleString('tr')+' uydu tespiti';panel.querySelector('.months').innerHTML=counts.map((x,i)=>'<div style="background:rgba(203,112,48,'+(.12+.6*x/Math.max(1,...counts))+')"><small>'+months[i]+'</small><b>'+x+'</b></div>').join('');
}

const basemap=new Image(), relief=new Image();
basemap.src=assets.photo; relief.src=assets.relief;
const surface=document.createElement('canvas');surface.width=2200;surface.height=1000;
const ctx=surface.getContext('2d');
let texture;
function paint(){
 if(!basemap.naturalWidth)return;
 ctx.drawImage(basemap,0,0,2200,1000);
 for(const {name,path} of provinces){ctx.strokeStyle='rgba(255,233,183,.6)';ctx.lineWidth=1.4;ctx.stroke(path);if(name===city.value){ctx.fillStyle='rgba(244,177,73,.36)';ctx.fill(path);ctx.strokeStyle='#ffe2a0';ctx.lineWidth=3;ctx.stroke(path)}}
 if(texture)texture.needsUpdate=true;
}
function showSheet(open){sheet.inert=!open;sheet.classList.toggle('open',open);toggle.setAttribute('aria-expanded',open)}
toggle.onclick=()=>showSheet(sheet.inert);document.querySelector('#close').onclick=()=>showSheet(false);
document.onkeydown=e=>{if(e.key==='Escape')showSheet(false)};
city.onchange=()=>{render();showSheet(true)};city.value='İzmir';render();
async function start(){
 await Promise.all([basemap.decode(),relief.decode()]);paint();
 const renderer=new THREE.WebGLRenderer({antialias:true});world.append(renderer.domElement);renderer.setPixelRatio(Math.min(devicePixelRatio,2));
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x214052);
 const camera=new THREE.PerspectiveCamera(40,1,1,10000);
 const grid=new THREE.PlaneGeometry(2200,1250,440,200),positions=grid.attributes.position;
 const dem=document.createElement('canvas');dem.width=relief.width;dem.height=relief.height;const dc=dem.getContext('2d');dc.drawImage(relief,0,0);const pixels=dc.getImageData(0,0,dem.width,dem.height).data;
 for(let i=0;i<positions.count;i++){const u=grid.attributes.uv.getX(i),v=grid.attributes.uv.getY(i);positions.setZ(i,pixels[4*(Math.round((1-v)*(dem.height-1))*dem.width+Math.round(u*(dem.width-1))) ]*.32)}
 grid.computeVertexNormals();texture=new THREE.CanvasTexture(surface);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=renderer.capabilities.getMaxAnisotropy();
 const mesh=new THREE.Mesh(grid,new THREE.MeshLambertMaterial({map:texture}));scene.add(mesh,new THREE.AmbientLight(0xffffff,1.55));const sun=new THREE.DirectionalLight(0xffedd1,1.5);sun.position.set(-600,800,550);scene.add(sun);
 let x=0,y=0,z=1500,tx=0,ty=0,tz=1500,drag,frame=0,last=0;
 function draw(time){frame=0;const a=1-Math.exp(-Math.min(50,time-last)/95);last=time;x+=(tx-x)*a;y+=(ty-y)*a;z+=(tz-z)*a;camera.position.set(x,y-z*.38,z);camera.lookAt(x,y,0);renderer.render(scene,camera);if(Math.abs(tx-x)+Math.abs(ty-y)+Math.abs(tz-z)>.03)schedule()}
 function schedule(){if(!frame)frame=requestAnimationFrame(draw)}
 function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();schedule()}window.onresize=resize;resize();
 function zoom(f){tz=Math.min(2100,Math.max(190,tz*f));schedule()}
 world.onwheel=e=>{e.preventDefault();zoom(Math.exp(Math.max(-250,Math.min(250,e.deltaY))*.0016))};
 plus.onclick=()=>zoom(.74);minus.onclick=()=>zoom(1.35);home.onclick=()=>{tx=ty=0;tz=1500;schedule()};
 world.onpointerdown=e=>{world.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,tx,ty,moved:false}};
 world.onpointermove=e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.moved ||= Math.hypot(dx,dy)>4;if(drag.moved){tx=Math.max(-1050,Math.min(1050,drag.tx-dx*z*.76/innerHeight));ty=Math.max(-605,Math.min(605,drag.ty+dy*z*.8/innerHeight));schedule()}};
 world.onpointercancel=()=>drag=null;world.onpointerup=e=>{if(!drag)return;const click=!drag.moved;drag=null;if(!click)return;const ray=new THREE.Raycaster();ray.setFromCamera({x:2*e.clientX/innerWidth-1,y:1-2*e.clientY/innerHeight},camera);const hit=ray.intersectObject(mesh)[0];if(!hit)return;const found=provinces.find(p=>ctx.isPointInPath(p.path,hit.uv.x*2200,(1-hit.uv.y)*1000));if(found){city.value=found.name;render();showSheet(true);schedule()}};
 city.addEventListener('change',schedule);document.querySelector('nav').addEventListener('click',schedule);
}
start().catch(()=>{document.querySelector('footer').prepend('3B görünüm için WebGL gereklidir.　')});
