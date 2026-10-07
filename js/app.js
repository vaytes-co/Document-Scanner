/* VAYTES DOCUMENT SCANNER v3.0
   Robust browser scanner:
   - explicit OpenCV readiness with timeout
   - portrait rear-camera preview
   - live quadrilateral detection
   - conservative perspective correction
   - safe margins, illumination normalization and enhancement
   - processed preview is exactly what PDF exports
*/
const $=s=>document.querySelector(s);
const state={stream:null,loop:null,detected:null,pendingRaw:null,pendingResult:null,pages:[],engine:false};
const toast=m=>{const e=$("#toast");e.textContent=m;e.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>e.classList.remove("show"),2400)};
const modal=(id,on)=>$(id).classList.toggle("open",on);
const cvReady=()=>!!(window.cv&&cv.Mat&&cv.imread&&cv.getPerspectiveTransform);
function engineStatus(type,text){$("#engineText").textContent=text;$("#engine").className="engine "+(type||"")}
function loading(on,text){$("#loadingText").textContent=text||"Menyiapkan scanner…";$("#loadingOverlay").classList.toggle("show",on)}
function waitForCV(timeout=12000){return new Promise(resolve=>{const t=performance.now();(function check(){if(cvReady()){state.engine=true;engineStatus("ready","Scanner READY");resolve(true);return}if(performance.now()-t>timeout){state.engine=false;engineStatus("error","Basic scanner READY");resolve(false);return}setTimeout(check,100)})()})}
function d(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function sort4(p){const c=p.reduce((s,x)=>({x:s.x+x.x/4,y:s.y+x.y/4}),{x:0,y:0});return p.slice().sort((a,b)=>Math.atan2(a.y-c.y,a.x-c.x)-Math.atan2(b.y-c.y,b.x-c.x)).sort((a,b)=>(a.x+a.y)-(b.x+b.y))}
function detect(src,minArea=.10){
  if(!cvReady())return null;
  const sc=Math.min(1,1000/Math.max(src.cols,src.rows));let s=new cv.Mat();cv.resize(src,s,new cv.Size(Math.round(src.cols*sc),Math.round(src.rows*sc)),0,0,cv.INTER_AREA);
  let g=new cv.Mat(),bl=new cv.Mat(),ed=new cv.Mat();cv.cvtColor(s,g,cv.COLOR_RGBA2GRAY);cv.GaussianBlur(g,bl,new cv.Size(5,5),0);cv.Canny(bl,ed,35,125);
  let kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(7,7));cv.morphologyEx(ed,ed,cv.MORPH_CLOSE,kernel);
  let cs=new cv.MatVector(),h=new cv.Mat();cv.findContours(ed,cs,h,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
  let best=null,score=0,ia=s.cols*s.rows;
  for(let i=0;i<cs.size();i++){const c=cs.get(i),a=Math.abs(cv.contourArea(c));if(a<ia*minArea){c.delete();continue}
    const peri=cv.arcLength(c,true),q=new cv.Mat();cv.approxPolyDP(c,q,.025*peri,true);
    if(q.rows===4){let p=[];for(let j=0;j<4;j++)p.push({x:q.doubleAt(j,0)/sc,y:q.doubleAt(j,1)/sc});const ord=sort4(p),w=Math.max(d(ord[0],ord[1]),d(ord[2],ord[3])),hh=Math.max(d(ord[0],ord[3]),d(ord[1],ord[2]));const rectangular=Math.min(w/hh,hh/w);const s2=a*(.55+.45*rectangular);if(s2>score){score=s2;best=ord}}q.delete();c.delete()}
  [s,g,bl,ed,kernel,cs,h].forEach(x=>x&&x.delete&&x.delete());return best
}
function drawEdge(v,pts){
  const c=$("#edgeCanvas"),ctx=c.getContext("2d");c.width=v.videoWidth;c.height=v.videoHeight;ctx.clearRect(0,0,c.width,c.height);
  if(!pts)return;ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle="#20c77a18";ctx.fill();ctx.lineWidth=Math.max(5,c.width/190);ctx.strokeStyle="#20c77a";ctx.shadowColor="#20c77a";ctx.shadowBlur=8;ctx.stroke();ctx.shadowBlur=0;pts.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,9,0,7);ctx.fillStyle="#20c77a";ctx.fill()})
}
function warp(src,p){
  const [tl,tr,br,bl]=sort4(p);const W=Math.round(Math.max(d(tl,tr),d(bl,br))),H=Math.round(Math.max(d(tl,bl),d(tr,br)));const max=2500,scale=Math.min(1,max/W,max/H);const ow=Math.max(700,Math.round(W*scale)),oh=Math.max(900,Math.round(H*scale));
  const sp=cv.matFromArray(4,1,cv.CV_32FC2,[tl.x,tl.y,tr.x,tr.y,br.x,br.y,bl.x,bl.y]),dp=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,ow-1,0,ow-1,oh-1,0,oh-1]);const M=cv.getPerspectiveTransform(sp,dp),dst=new cv.Mat();cv.warpPerspective(src,dst,M,new cv.Size(ow,oh),cv.INTER_LANCZOS4,cv.BORDER_REPLICATE);[sp,dp,M].forEach(x=>x.delete());return dst
}
function margin(src,r=.035){const m=Math.round(Math.min(src.cols,src.rows)*r),o=new cv.Mat();cv.copyMakeBorder(src,o,m,m,m,m,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));return o}
function enhance(src,mode){
  if(mode==="photo")return src.clone();let rgb=new cv.Mat();cv.cvtColor(src,rgb,cv.COLOR_RGBA2RGB);
  if(mode==="gray"){let g=new cv.Mat();cv.cvtColor(rgb,g,cv.COLOR_RGB2GRAY);let clahe=cv.createCLAHE(2,new cv.Size(8,8)),x=new cv.Mat();clahe.apply(g,x);let o=new cv.Mat();cv.cvtColor(x,o,cv.COLOR_GRAY2RGBA);[rgb,g,x,clahe].forEach(v=>v.delete());return o}
  if(mode==="bw"){let g=new cv.Mat();cv.cvtColor(rgb,g,cv.COLOR_RGB2GRAY);cv.GaussianBlur(g,g,new cv.Size(3,3),0);let x=new cv.Mat();cv.adaptiveThreshold(g,x,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY,31,9);let k=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(2,2));cv.morphologyEx(x,x,cv.MORPH_OPEN,k);let o=new cv.Mat();cv.cvtColor(x,o,cv.COLOR_GRAY2RGBA);[rgb,g,x,k].forEach(v=>v.delete());return o}
  // Smart/Color: gentle local contrast + sharpen. No artificial zoom.
  let lab=new cv.Mat();cv.cvtColor(rgb,lab,cv.COLOR_RGB2Lab),ch=new cv.MatVector();cv.split(lab,ch);let L=ch.get(0),cl=cv.createCLAHE(1.7,new cv.Size(8,8)),L2=new cv.Mat();cl.apply(L,L2);ch.set(0,L2);cv.merge(ch,lab);let norm=new cv.Mat();cv.cvtColor(lab,norm,cv.COLOR_Lab2RGB);let blur=new cv.Mat(),sharp=new cv.Mat();cv.GaussianBlur(norm,blur,new cv.Size(0,0),1);cv.addWeighted(norm,1.22,blur,-.22,0,sharp);let o=new cv.Mat();cv.cvtColor(sharp,o,cv.COLOR_RGB2RGBA);[rgb,lab,ch,L,L2,cl,norm,blur,sharp].forEach(v=>v.delete());return o
}
function pageNormalize(src,paper){
  if(paper==="original")return src.clone();const s={a4:[210,297],a5:[148,210],letter:[216,279],legal:[216,356]}[paper],ratio=s[0]/s[1];let W=1700,H=Math.round(W/ratio);if(src.cols/src.rows>ratio*1.15){[W,H]=[H,W]}const fit=Math.min((W-90)/src.cols,(H-90)/src.rows,1),w=Math.round(src.cols*fit),h=Math.round(src.rows*fit);let r=new cv.Mat();cv.resize(src,r,new cv.Size(w,h),0,0,cv.INTER_LANCZOS4);let out=new cv.Mat(H,W,cv.CV_8UC4,new cv.Scalar(255,255,255,255));r.copyTo(out.roi(new cv.Rect(Math.round((W-w)/2),Math.round((H-h)/2),w,h)));r.delete();return out
}
function process(canvas,pts){
  const src=cv.imread(canvas);let w=pts?warp(src,pts):src.clone();let m=margin(w),e=enhance(m,$("#filter").value),p=pageNormalize(e,$("#paper").value);[src,w,m,e].forEach(x=>x.delete());return p
}
function showResult(m){state.pendingResult?.delete?.();state.pendingResult=m.clone();$("#editCanvas").width=m.cols;$("#editCanvas").height=m.rows;cv.imshow($("#editCanvas"),m);modal("#editModal",true)}
function frameCanvas(){const v=$("#video"),c=document.createElement("canvas");c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);return c}
function capture(){
  if(!state.engine){toast("Vision engine belum tersedia. Basic scanner tetap bisa dipakai dari galeri.");return}
  const c=frameCanvas();let src=cv.imread(c),pts=detect(src,.08);src.delete();try{showResult(process(c,pts))}catch(e){console.error(e);toast("Pemrosesan gagal. Coba cahaya lebih merata.")}closeCamera()
}
function startLoop(){clearTimeout(state.loop);const v=$("#video");const run=()=>{if(!$("#cameraModal").classList.contains("open"))return;if(state.engine&&v.readyState>=2){try{const c=frameCanvas(),src=cv.imread(c);state.detected=detect(src,.14);src.delete();drawEdge(v,state.detected);$("#reticle").classList.toggle("detected",!!state.detected);$("#edgeText").textContent=state.detected?"Kertas terdeteksi":"Mencari tepi kertas…";$("#edgeDot").parentElement.classList.toggle("ready",!!state.detected);$("#scanMessage").textContent=state.detected?"Kertas terdeteksi — siap dipindai":"Arahkan seluruh kertas ke dalam frame"}catch(e){}}state.loop=setTimeout(run,160)};run()}
async function openCamera(){
  loading(true,"Menyiapkan kamera…");
  const ready=await waitForCV(); // never blocks indefinitely
  try{state.stream?.getTracks().forEach(t=>t.stop());state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1080},height:{ideal:1440},aspectRatio:{ideal:.75}},audio:false});$("#video").srcObject=state.stream;modal("#cameraModal",true);await $("#video").play();loading(false);startLoop()}catch(e){loading(false);toast("Kamera tidak dapat dibuka. Izinkan kamera pada browser.");}
}
function closeCamera(){clearTimeout(state.loop);state.stream?.getTracks().forEach(t=>t.stop());state.stream=null;modal("#cameraModal",false)}
function matCanvas(m){const c=document.createElement("canvas");c.width=m.cols;c.height=m.rows;cv.imshow(c,m);return c}
function addPage(m){state.pages.push({canvas:matCanvas(m)});renderPages();$("#pdfBtn").disabled=false}
function renderPages(){const box=$("#pages");box.innerHTML="";$("#empty").style.display=state.pages.length?"none":"block";state.pages.forEach((p,i)=>{const d0=document.createElement("article");d0.className="page";const th=document.createElement("div");th.className="thumb";const c=p.canvas.cloneNode(true);c.width=p.canvas.width;c.height=p.canvas.height;th.append(c);const tag=document.createElement("span");tag.className="tag";tag.textContent=`PAGE ${String(i+1).padStart(2,"0")}`;th.append(tag);const bar=document.createElement("div");bar.className="pagebar";["↑","↓","Hapus"].forEach((x,j)=>{const b=document.createElement("button");b.textContent=x;if(j===0)b.disabled=i===0;if(j===1)b.disabled=i===state.pages.length-1;if(j===2)b.className="danger";b.onclick=()=>{if(j===0){[state.pages[i-1],state.pages[i]]=[state.pages[i],state.pages[i-1]]}else if(j===1){[state.pages[i+1],state.pages[i]]=[state.pages[i],state.pages[i+1]]}else state.pages.splice(i,1);renderPages();$("#pdfBtn").disabled=!state.pages.length};bar.append(b)});d0.append(th,bar);box.append(d0)})}
async function filePending(file){if(!cvReady()){toast("Scanner vision belum tersedia. Refresh halaman dan pastikan internet aktif.");return}const u=URL.createObjectURL(file),im=new Image();im.onload=()=>{const c=document.createElement("canvas"),max=3000,sc=Math.min(1,max/Math.max(im.naturalWidth,im.naturalHeight));c.width=Math.round(im.naturalWidth*sc);c.height=Math.round(im.naturalHeight*sc);c.getContext("2d").drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);const src=cv.imread(c),pts=detect(src,.08);src.delete();state.pendingRaw={canvas:c,pts};refreshPreview()};im.src=u}
function refreshPreview(){if(!state.pendingRaw)return;try{showResult(process(state.pendingRaw.canvas,state.pendingRaw.pts))}catch(e){console.error(e);toast("Gagal membuat preview.")}}
function exportPDF(){if(!state.pages.length)return;const {jsPDF}=window.jspdf,s=$("#paper").value,mm={a4:[210,297],a5:[148,210],letter:[216,279],legal:[216,356]};let pdf;if(s==="original"){const p=state.pages[0].canvas;pdf=new jsPDF({unit:"px",format:[p.width,p.height]})}else pdf=new jsPDF({unit:"mm",format:mm[s]});state.pages.forEach((p,i)=>{if(i)pdf.addPage(mm[s]||[p.canvas.width,p.canvas.height]);const pw=pdf.internal.pageSize.getWidth(),ph=pdf.internal.pageSize.getHeight(),r=Math.min(pw/p.canvas.width,ph/p.canvas.height),w=p.canvas.width*r,h=p.canvas.height*r;pdf.addImage(p.canvas.toDataURL("image/jpeg",.98),"JPEG",(pw-w)/2,(ph-h)/2,w,h,undefined,"FAST")});pdf.save(`VAYTES-Document-${new Date().toISOString().slice(0,10)}.pdf`);toast("PDF berhasil dibuat")}
window.addEventListener("load",()=>{
  // Do not show an endless loading state. The scanner can still be used with the gallery if OpenCV fails.
  waitForCV();
  $("#startBtn").onclick=openCamera;$("#emptyScan").onclick=openCamera;$("#addBtn").onclick=openCamera;$("#closeCam").onclick=closeCamera;$("#shutter").onclick=capture;$("#manualCapture").onclick=()=>{const c=frameCanvas();showResult(process(c,null));closeCamera()};
  $("#closeEdit").onclick=()=>{state.pendingResult?.delete?.();state.pendingResult=null;modal("#editModal",false)};
  $("#retake").onclick=()=>{state.pendingResult?.delete?.();state.pendingResult=null;modal("#editModal",false);openCamera()};
  $("#usePage").onclick=()=>{if(state.pendingResult){addPage(state.pendingResult);state.pendingResult.delete();state.pendingResult=null}modal("#editModal",false)};
  $("#pdfBtn").onclick=exportPDF;$("#fileInput").onchange=e=>[...e.target.files].forEach(filePending);$("#filter").onchange=refreshPreview;$("#paper").onchange=refreshPreview;
  $("#filterButtons").onclick=e=>{if(e.target.dataset.f){$("#filter").value=e.target.dataset.f;document.querySelectorAll("#filterButtons button").forEach(b=>b.classList.remove("active"));e.target.classList.add("active");refreshPreview()}};
  $("#reDetect").onclick=()=>{if(!state.pendingRaw)return;const src=cv.imread(state.pendingRaw.canvas);state.pendingRaw.pts=detect(src,.07);src.delete();refreshPreview()};
});
