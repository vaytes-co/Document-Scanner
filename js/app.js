/* VAYTES DOCUMENT SCANNER v2.0
   Client-side pipeline:
   capture -> edge detection -> perspective correction -> safe margin -> illumination cleanup -> enhancement -> normalized page -> preview/PDF
*/
const $=s=>document.querySelector(s);
const state={stream:null,raf:null,edgeTimer:null,detected:null,pendingRaw:null,pendingResult:null,pages:[],rotation:0};

function toast(m){const e=$("#toast");e.textContent=m;e.classList.add("show");clearTimeout(window.__t);window.__t=setTimeout(()=>e.classList.remove("show"),2600)}
function open(id){$(id).classList.add("open")}
function close(id){$(id).classList.remove("open")}
function cvReady(){return window.cv&&cv.Mat&&typeof cv.imread==="function"}
function setEngine(ready,msg){$("#engineText").textContent=msg;$("#engineDot").parentElement.classList.toggle("ready",ready)}
function matCanvas(mat){const c=document.createElement("canvas");c.width=mat.cols;c.height=mat.rows;cv.imshow(c,mat);return c}
function loadImage(file){return new Promise((res,rej)=>{const u=URL.createObjectURL(file),im=new Image();im.onload=()=>{URL.revokeObjectURL(u);res(im)};im.onerror=rej;im.src=u})}
function canvasFromImage(im,max=2600){const scale=Math.min(1,max/Math.max(im.naturalWidth||im.width,im.naturalHeight||im.height));const c=document.createElement("canvas");c.width=Math.round((im.naturalWidth||im.width)*scale);c.height=Math.round((im.naturalHeight||im.height)*scale);c.getContext("2d",{willReadFrequently:true}).drawImage(im,0,0,c.width,c.height);return c}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function order(pts){const tl=pts.reduce((a,p)=>p.x+p.y<a.x+a.y?p:a),br=pts.reduce((a,p)=>p.x+p.y>a.x+a.y?p:a);const rest=pts.filter(p=>p!==tl&&p!==br);const tr=rest.reduce((a,p)=>p.y<p.y?a:p); // corrected below
  rest.sort((a,b)=>a.y-b.y);return [tl,rest[0],br,rest[1]]}
function detect(src,minimum=.16){
  let scale=Math.min(1,1100/Math.max(src.cols,src.rows)),s=new cv.Mat();
  cv.resize(src,s,new cv.Size(Math.round(src.cols*scale),Math.round(src.rows*scale)),0,0,cv.INTER_AREA);
  let g=new cv.Mat(),b=new cv.Mat(),e=new cv.Mat();cv.cvtColor(s,g,cv.COLOR_RGBA2GRAY);cv.GaussianBlur(g,b,new cv.Size(5,5),0);cv.Canny(b,e,45,150);
  let k=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(5,5));cv.morphologyEx(e,e,cv.MORPH_CLOSE,k);
  let cs=new cv.MatVector(),h=new cv.Mat();cv.findContours(e,cs,h,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
  let best=null,bestScore=0,areaImg=s.cols*s.rows;
  for(let i=0;i<cs.size();i++){let c=cs.get(i),a=Math.abs(cv.contourArea(c));if(a<areaImg*minimum){c.delete();continue}let p=cv.arcLength(c,true),q=new cv.Mat();cv.approxPolyDP(c,q,.018*p,true);
    if(q.rows===4){let ps=[];for(let j=0;j<4;j++)ps.push({x:q.doubleAt(j,0)/scale,y:q.doubleAt(j,1)/scale});let w=Math.max(dist(ps[0],ps[1]),dist(ps[2],ps[3])),hh=Math.max(dist(ps[0],ps[3]),dist(ps[1],ps[2]));let ratio=w/hh,rect=Math.min(ratio,1/ratio),score=a*(.65+.35*rect);if(score>bestScore){bestScore=score;best=ps} }q.delete();c.delete()}
  [s,g,b,e,k,cs,h].forEach(x=>x&&x.delete&&x.delete());return best?order(best):null
}
function drawDetection(pts,video,canvas){
  const ctx=canvas.getContext("2d");canvas.width=video.videoWidth;canvas.height=video.videoHeight;ctx.clearRect(0,0,canvas.width,canvas.height);
  if(!pts)return;
  ctx.lineWidth=Math.max(5,canvas.width/180);ctx.strokeStyle="#20c77a";ctx.fillStyle="#20c77a33";ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();ctx.stroke();
  pts.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);ctx.fillStyle="#20c77a";ctx.fill()})
}
function warp(src,pts){
  let [tl,tr,br,bl]=pts;let W=Math.max(dist(tl,tr),dist(bl,br)),H=Math.max(dist(tl,bl),dist(tr,br));
  // Never enlarge the source beyond what was captured. This prevents "zoomed" results.
  const outW=Math.max(700,Math.min(2600,Math.round(W))),outH=Math.max(900,Math.min(3600,Math.round(H)));
  const sp=cv.matFromArray(4,1,cv.CV_32FC2,[tl.x,tl.y,tr.x,tr.y,br.x,br.y,bl.x,bl.y]);
  const dp=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,outW-1,0,outW-1,outH-1,0,outH-1]);
  const M=cv.getPerspectiveTransform(sp,dp),dst=new cv.Mat();cv.warpPerspective(src,dst,M,new cv.Size(outW,outH),cv.INTER_LANCZOS4,cv.BORDER_REPLICATE);
  [sp,dp,M].forEach(x=>x.delete());return dst;
}
function rotateMat(src,deg){if(!deg)return src.clone();let dst=new cv.Mat();if(deg===90)cv.rotate(src,dst,cv.ROTATE_90_CLOCKWISE);else if(deg===180)cv.rotate(src,dst,cv.ROTATE_180);else cv.rotate(src,dst,cv.ROTATE_90_COUNTERCLOCKWISE);return dst}
function addSafeMargin(src,ratio=.045){
  const m=Math.round(Math.min(src.cols,src.rows)*ratio),dst=new cv.Mat();
  cv.copyMakeBorder(src,dst,m,m,m,m,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));return dst
}
function enhance(src,mode){
  if(mode==="photo")return src.clone();
  let bgr=new cv.Mat();cv.cvtColor(src,bgr,cv.COLOR_RGBA2RGB);
  // Illumination normalization: flatten uneven paper lighting without destroying text.
  let lab=new cv.Mat();cv.cvtColor(bgr,lab,cv.COLOR_RGB2Lab);let ch=new cv.MatVector();cv.split(lab,ch);
  let clahe=cv.createCLAHE(2.0,new cv.Size(8,8));let L=ch.get(0),L2=new cv.Mat();clahe.apply(L,L2);ch.set(0,L2);
  let norm=new cv.Mat();cv.merge(ch,lab);cv.cvtColor(lab,norm,cv.COLOR_Lab2RGB);
  let out=new cv.Mat();
  if(mode==="gray"){cv.cvtColor(norm,out,cv.COLOR_RGB2GRAY);let rgba=new cv.Mat();cv.cvtColor(out,rgba,cv.COLOR_GRAY2RGBA);[bgr,lab,ch,clahe,L,L2,norm,out].forEach(x=>x&&x.delete&&x.delete());return rgba}
  if(mode==="bw"){
    let gr=new cv.Mat();cv.cvtColor(norm,gr,cv.COLOR_RGB2GRAY);cv.GaussianBlur(gr,gr,new cv.Size(3,3),0);cv.adaptiveThreshold(gr,out,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY,31,9);
    // Small morphological opening removes isolated camera noise.
    let kk=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(2,2));cv.morphologyEx(out,out,cv.MORPH_OPEN,kk);kk.delete();
    let rgba=new cv.Mat();cv.cvtColor(out,rgba,cv.COLOR_GRAY2RGBA);[bgr,lab,ch,clahe,L,L2,norm,out,gr].forEach(x=>x&&x.delete&&x.delete());return rgba
  }
  // Smart/Color: local contrast + conservative unsharp mask.
  let blur=new cv.Mat();cv.GaussianBlur(norm,blur,new cv.Size(0,0),1.2);cv.addWeighted(norm,1.32,blur,-.32,0,out);
  let rgba=new cv.Mat();cv.cvtColor(out,rgba,cv.COLOR_RGB2RGBA);[bgr,lab,ch,clahe,L,L2,norm,out,blur].forEach(x=>x&&x.delete&&x.delete());return rgba
}
function normalizePage(src,paper){
  if(paper==="original")return src.clone();
  const sizes={a4:[210,297],a5:[148,210],letter:[216,279],legal:[216,356]}, [mmW,mmH]=sizes[paper];
  const ratio=mmW/mmH,srcRatio=src.cols/src.rows;
  let W=1600,H=Math.round(W/ratio);
  if((srcRatio>1&&ratio<1)||(srcRatio<1&&ratio>1)){W=1600;H=Math.round(W/ratio)}
  // Fit source inside target with white canvas, never crop.
  const scale=Math.min((W-80)/src.cols,(H-80)/src.rows,1.0);
  const w=Math.max(1,Math.round(src.cols*scale)),h=Math.max(1,Math.round(src.rows*scale));
  let resized=new cv.Mat();cv.resize(src,resized,new cv.Size(w,h),0,0,cv.INTER_LANCZOS4);
  let page=new cv.Mat(H,W,cv.CV_8UC4,new cv.Scalar(255,255,255,255));let x=Math.round((W-w)/2),y=Math.round((H-h)/2);resized.copyTo(page.roi(new cv.Rect(x,y,w,h)));resized.delete();return page
}
function processCanvas(c,forcePts=null){
  let src=cv.imread(c), pts=forcePts||detect(src,.12), warped;
  if(pts){warped=warp(src,pts)}else{warped=src.clone();toast("Tepi kertas belum yakin terdeteksi — seluruh foto dipertahankan.")}
  let safe=addSafeMargin(warped,.035), enhanced=enhance(safe,$("#filter").value), normalized=normalizePage(enhanced,$("#paper").value);
  [src,warped,safe,enhanced].forEach(x=>x.delete());return normalized
}
function matToData(mat){const c=matCanvas(mat);return c}
function showResult(mat){state.pendingResult=mat.clone();$("#editCanvas").width=mat.cols;$("#editCanvas").height=mat.rows;cv.imshow($("#editCanvas"),mat);open("#editModal")}
function captureFrame(){
  const v=$("#video"),c=document.createElement("canvas");c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);
  if(!cvReady()){toast("Scanner masih memuat. Tunggu sampai status READY.");return}
  try{const src=cv.imread(c),pts=detect(src,.10);src.delete();const result=processCanvas(c,pts);showResult(result);result.delete()}catch(e){console.error(e);toast("Gagal memproses halaman. Coba cahaya lebih merata.");}
}
function startEdgeLoop(){
  clearTimeout(state.raf);cancelAnimationFrame(state.raf);const v=$("#video"),ec=$("#edgeCanvas");
  const loop=()=>{if(!$("#cameraModal").classList.contains("open"))return;if(cvReady()&&v.readyState>=2){try{const c=document.createElement("canvas");c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);const small=c.width>1200?(()=>{const q=document.createElement("canvas");const sc=1200/c.width;q.width=1200;q.height=Math.round(c.height*sc);q.getContext("2d").drawImage(c,0,0,q.width,q.height);return q})():c;const src=cv.imread(small);let pts=detect(src,.18);if(pts&&small!==c){const sx=c.width/small.width,sy=c.height/small.height;pts=pts.map(p=>({x:p.x*sx,y:p.y*sy}))}src.delete();state.detected=pts;drawDetection(pts,v,ec);$("#reticle").classList.toggle("detected",!!pts);$("#edgeText").textContent=pts?"Dokumen terdeteksi":"Mencari dokumen…";$("#edgeDot").parentElement.classList.toggle("ready",!!pts);$("#scanMessage").textContent=pts?"Tahan sebentar…":"Arahkan kamera ke seluruh halaman"}catch(e){}}state.raf=setTimeout(()=>requestAnimationFrame(loop),120)};loop()
}
async function openCamera(){
  if(!navigator.mediaDevices?.getUserMedia){toast("Kamera membutuhkan browser yang mendukung camera API dan HTTPS.");return}
  try{state.stream?.getTracks().forEach(t=>t.stop());state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}},audio:false});$("#video").srcObject=state.stream;open("#cameraModal");await $("#video").play();startEdgeLoop()}catch(e){console.error(e);toast("Kamera tidak dapat dibuka. Periksa izin kamera.");}
}
function closeCamera(){clearTimeout(state.raf);cancelAnimationFrame(state.raf);state.stream?.getTracks().forEach(t=>t.stop());state.stream=null;close("#cameraModal")}
function addPage(mat){const c=matCanvas(mat);state.pages.push({canvas:c});renderPages();$("#pdfBtn").disabled=false}
function renderPages(){const box=$("#pages");box.innerHTML="";$("#empty").style.display=state.pages.length?"none":"block";state.pages.forEach((p,i)=>{const d=document.createElement("article");d.className="page";const th=document.createElement("div");th.className="thumb";const c=p.canvas.cloneNode(true);c.width=p.canvas.width;c.height=p.canvas.height;th.append(c);const t=document.createElement("span");t.className="tag";t.textContent=`PAGE ${String(i+1).padStart(2,"0")}`;th.append(t);const bar=document.createElement("div");bar.className="pagebar";const up=document.createElement("button");up.textContent="↑";up.disabled=i===0;up.onclick=()=>{[state.pages[i-1],state.pages[i]]=[state.pages[i],state.pages[i-1]];renderPages()};const down=document.createElement("button");down.textContent="↓";down.disabled=i===state.pages.length-1;down.onclick=()=>{[state.pages[i+1],state.pages[i]]=[state.pages[i],state.pages[i+1]];renderPages()};const del=document.createElement("button");del.textContent="Hapus";del.className="danger";del.onclick=()=>{state.pages.splice(i,1);renderPages();$("#pdfBtn").disabled=!state.pages.length};bar.append(up,down,del);d.append(th,bar);box.append(d)})}
function applyFilter(){if(!state.pendingRaw||!cvReady())return;try{let m=processCanvas(state.pendingRaw.canvas,state.pendingRaw.pts);state.pendingResult?.delete?.();state.pendingResult=m;$("#editCanvas").width=m.cols;$("#editCanvas").height=m.rows;cv.imshow($("#editCanvas"),m)}catch(e){console.error(e);toast("Filter gagal diproses.")}}
async function fileToPending(file){const im=await loadImage(file),c=canvasFromImage(im,3000);let src=cv.imread(c),pts=detect(src,.10);src.delete();state.pendingRaw={canvas:c,pts};applyFilter();open("#editModal")}
function exportPDF(){
  if(!state.pages.length)return;const {jsPDF}=window.jspdf,size=$("#paper").value;const mm={a4:[210,297],a5:[148,210],letter:[216,279],legal:[216,356]};
  let pdf;if(size==="original"){const p=state.pages[0].canvas;pdf=new jsPDF({unit:"px",format:[p.width,p.height],orientation:p.width>p.height?"landscape":"portrait"});}else pdf=new jsPDF({unit:"mm",format:mm[size],orientation:"portrait",compress:true});
  state.pages.forEach((p,i)=>{if(i)pdf.addPage(size==="original"?[p.canvas.width,p.canvas.height]:mm[size],"portrait");const pw=pdf.internal.pageSize.getWidth(),ph=pdf.internal.pageSize.getHeight();let x=0,y=0,w=pw,h=ph;if(size==="original"){w=p.canvas.width;h=p.canvas.height}else{const r=Math.min(pw/p.canvas.width,ph/p.canvas.height);w=p.canvas.width*r;h=p.canvas.height*r;x=(pw-w)/2;y=(ph-h)/2}pdf.addImage(p.canvas.toDataURL("image/jpeg",.97),"JPEG",x,y,w,h,undefined,"FAST")});
  pdf.save(`VAYTES-Document-${new Date().toISOString().slice(0,10)}.pdf`);toast("PDF berhasil dibuat.");
}
window.addEventListener("load",()=>{
  const wait=()=>{if(cvReady()){setEngine(true,"Scanner READY")}else setTimeout(wait,300)};wait();
  $("#startBtn").onclick=openCamera;$("#emptyScan").onclick=openCamera;$("#addBtn").onclick=openCamera;
  $("#closeCam").onclick=closeCamera;$("#shutter").onclick=()=>{captureFrame();closeCamera()};
  $("#closeEdit").onclick=()=>{state.pendingResult?.delete?.();state.pendingResult=null;close("#editModal")};
  $("#retake").onclick=()=>{state.pendingResult?.delete?.();state.pendingResult=null;close("#editModal");openCamera()};
  $("#usePage").onclick=()=>{if(state.pendingResult){addPage(state.pendingResult);state.pendingResult.delete();state.pendingResult=null}close("#editModal")};
  $("#pdfBtn").onclick=exportPDF;
  $("#fileInput").onchange=e=>[...e.target.files].forEach(file=>fileToPending(file));
  $("#filterButtons").onclick=e=>{if(e.target.dataset.f){document.querySelectorAll("#filterButtons button").forEach(b=>b.classList.remove("active"));e.target.classList.add("active");$("#filter").value=e.target.dataset.f;applyFilter()}};
  $("#filter").onchange=applyFilter;
  $("#rotateLeft").onclick=()=>rotatePending(-90);$("#rotateRight").onclick=()=>rotatePending(90);
  $("#reDetect").onclick=()=>{if(state.pendingRaw){const src=cv.imread(state.pendingRaw.canvas);state.pendingRaw.pts=detect(src,.08);src.delete();applyFilter()}};
});
function rotatePending(deg){if(!state.pendingRaw)return;const src=cv.imread(state.pendingRaw.canvas),r=rotateMat(src,deg);src.delete();state.pendingRaw.canvas=matCanvas(r);r.delete();applyFilter()}
