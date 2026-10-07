/* VAYTES DOCUMENT SCANNER v1.2
   Client-side document scanning: live edge detection, perspective correction,
   consistent paper framing, real enhancement, multi-page PDF export.
*/
const $ = (s) => document.querySelector(s);
const state = { pages: [], stream: null, pending: null, liveTimer: null, busy: false };

const toast = (msg) => {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(window.__toast); window.__toast = setTimeout(() => t.classList.remove("show"), 2600);
};
const openModal = (el) => { el.classList.add("open"); el.setAttribute("aria-hidden", "false"); };
const closeModal = (el) => { el.classList.remove("open"); el.setAttribute("aria-hidden", "true"); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function cvReady() { return window.cv && typeof cv.Mat === "function" && typeof cv.imread === "function"; }
function setEngineStatus(text, ok = false) {
  const el = $("#engineStatus"), dot = document.querySelector(".status-dot");
  el.textContent = text;
  dot.style.background = ok ? "#12b76a" : "#f79009";
  dot.style.boxShadow = ok ? "0 0 0 4px #12b76a15" : "0 0 0 4px #f7900915";
}
async function waitForOpenCV() {
  for (let i = 0; i < 80; i++) {
    if (cvReady()) { setEngineStatus("Scanner siap", true); return true; }
    await sleep(250);
  }
  setEngineStatus("Mesin scanner gagal dimuat");
  toast("Mesin pemrosesan belum tersedia. Periksa koneksi internet lalu muat ulang halaman.");
  return false;
}

function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function orderPoints(points){
  const p=[...points];
  const sum=p.map(v=>v.x+v.y), diff=p.map(v=>v.x-v.y);
  return [p[sum.indexOf(Math.min(...sum))], p[diff.indexOf(Math.max(...diff))], p[sum.indexOf(Math.max(...sum))], p[diff.indexOf(Math.min(...diff))]];
}

// Finds the OUTER page contour. RETR_EXTERNAL prevents text boxes/inner rectangles
// from being mistaken for the document itself.
function detectDocument(src, opts={}) {
  const maxDim = opts.maxDim || 1000;
  const scale = Math.min(1, maxDim / Math.max(src.cols, src.rows));
  let small=new cv.Mat(), gray=new cv.Mat(), blur=new cv.Mat(), edges=new cv.Mat();
  let contours=new cv.MatVector(), hierarchy=new cv.Mat();
  cv.resize(src, small, new cv.Size(Math.max(1,Math.round(src.cols*scale)),Math.max(1,Math.round(src.rows*scale))),0,0,cv.INTER_AREA);
  cv.cvtColor(small,gray,cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);
  cv.Canny(blur,edges,45,150);
  // Close small gaps around the paper edge.
  const kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(5,5));
  cv.morphologyEx(edges,edges,cv.MORPH_CLOSE,kernel);
  cv.findContours(edges,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);

  const imageArea=small.cols*small.rows;
  let best=null,bestScore=0;
  for(let i=0;i<contours.size();i++){
    const cnt=contours.get(i), area=cv.contourArea(cnt);
    if(area < imageArea*0.20){ cnt.delete(); continue; }
    const peri=cv.arcLength(cnt,true), approx=new cv.Mat();
    cv.approxPolyDP(cnt,approx,0.025*peri,true);
    if(approx.rows===4){
      const a=[]; for(let j=0;j<4;j++) a.push({x:approx.intAt(j,0)/scale,y:approx.intAt(j,1)/scale});
      const ordered=orderPoints(a);
      const w=Math.max(dist(ordered[0],ordered[1]),dist(ordered[3],ordered[2]));
      const h=Math.max(dist(ordered[0],ordered[3]),dist(ordered[1],ordered[2]));
      const rectangular=Math.min(w,h)/Math.max(w,h);
      const score=(area/imageArea)*0.82 + rectangular*0.18;
      if(score>bestScore){ bestScore=score; best=ordered; }
    }
    approx.delete();cnt.delete();
  }
  [small,gray,blur,edges,contours,hierarchy,kernel].forEach(x=>x&&x.delete&&x.delete());
  return best;
}

function warpDocument(src, pts) {
  const [tl,tr,br,bl]=pts;
  const w=Math.max(dist(tl,tr),dist(bl,br));
  const h=Math.max(dist(tl,bl),dist(tr,br));
  const maxW=2400, scale=Math.min(1,maxW/w);
  const outW=Math.max(700,Math.round(w*scale)), outH=Math.max(700,Math.round(h*scale));
  const sp=cv.matFromArray(4,1,cv.CV_32FC2,[tl.x,tl.y,tr.x,tr.y,br.x,br.y,bl.x,bl.y]);
  const dp=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,outW-1,0,outW-1,outH-1,0,outH-1]);
  const M=cv.getPerspectiveTransform(sp,dp), dst=new cv.Mat();
  cv.warpPerspective(src,dst,M,new cv.Size(outW,outH),cv.INTER_LANCZOS4,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));
  M.delete();sp.delete();dp.delete();
  return dst;
}

function addWhiteBorder(src, ratio=0.035){
  const padX=Math.max(8,Math.round(src.cols*ratio)), padY=Math.max(8,Math.round(src.rows*ratio));
  const dst=new cv.Mat();
  cv.copyMakeBorder(src,dst,padY,padY,padX,padX,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));
  return dst;
}

function enhance(src, mode){
  if(mode==='original') return src.clone();
  if(mode==='bw'){
    let gray=new cv.Mat(), clean=new cv.Mat(), bw=new cv.Mat(), rgba=new cv.Mat();
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,clean,new cv.Size(3,3),0);
    cv.adaptiveThreshold(clean,bw,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY,31,9);
    cv.cvtColor(bw,rgba,cv.COLOR_GRAY2RGBA);
    [gray,clean,bw].forEach(x=>x.delete()); return rgba;
  }
  let blur=new cv.Mat(), sharp=new cv.Mat();
  cv.GaussianBlur(src,blur,new cv.Size(0,0),1.05);
  // Unsharp mask: visible effect without destroying fine text.
  cv.addWeighted(src,1.45,blur,-0.45,0,sharp);
  blur.delete();
  if(mode==='clean'){
    const out=new cv.Mat(); cv.convertScaleAbs(sharp,out,1.05,4); sharp.delete(); return out;
  }
  const out=new cv.Mat(); cv.convertScaleAbs(sharp,out,1.10,1); sharp.delete(); return out;
}

function matToCanvas(mat){ const c=document.createElement('canvas'); c.width=mat.cols; c.height=mat.rows; cv.imshow(c,mat); return c; }
function canvasToMat(canvas){ return cv.imread(canvas); }

function paperConfig(){
  const key=$("#paperSize").value;
  return ({a4:[210,297],a5:[148,210],letter:[216,279],legal:[216,356],original:null})[key];
}

// Normalizes every page to the same physical paper and the same visual margins.
function normalizePage(mat){
  const cfg=paperConfig();
  if(!cfg) return mat.clone();
  const isLandscape=mat.cols/mat.rows>1.12;
  const [pw,ph]=isLandscape?[cfg[1],cfg[0]]:cfg;
  const W=isLandscape?1800:1600;
  const H=Math.round(W*(ph/pw));
  const canvas=new cv.Mat(H,W,cv.CV_8UC4,new cv.Scalar(255,255,255,255));
  const margin=Math.round(W*0.055), maxW=W-margin*2, maxH=H-margin*2;
  const scale=Math.min(maxW/mat.cols,maxH/mat.rows);
  const w=Math.max(1,Math.round(mat.cols*scale)),h=Math.max(1,Math.round(mat.rows*scale));
  const resized=new cv.Mat(); cv.resize(mat,resized,new cv.Size(w,h),0,0,cv.INTER_AREA);
  const x=Math.round((W-w)/2),y=Math.round((H-h)/2);
  resized.copyTo(canvas.roi(new cv.Rect(x,y,w,h))); resized.delete();
  return canvas;
}

function prepareImageCanvas(canvas, forcedPts=null){
  if(!cvReady()) throw new Error('OpenCV not ready');
  let src=canvasToMat(canvas), warped=null, padded=null, enhanced=null, normalized=null;
  try{
    const mode=$("#detectMode").value;
    const pts=forcedPts || (mode==='auto' ? detectDocument(src) : null);
    // If detection fails, keep the ENTIRE photo. Never invent a crop.
    warped=pts ? warpDocument(src,pts) : src.clone();
    padded=addWhiteBorder(warped,0.035);
    enhanced=enhance(padded,$("#enhanceMode").value);
    normalized=normalizePage(enhanced);
    return {canvas:matToCanvas(normalized),points:pts};
  } finally {
    [src,warped,padded,enhanced,normalized].forEach(x=>x&&x.delete&&x.delete());
  }
}

function processImageElement(img){
  return new Promise((resolve,reject)=>{
    const c=document.createElement('canvas'); c.width=img.naturalWidth||img.width; c.height=img.naturalHeight||img.height;
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    try{ resolve(prepareImageCanvas(c)); }catch(e){ console.error(e); reject(e); }
  });
}

function addPage(rawCanvas){
  try{
    const result=prepareImageCanvas(rawCanvas);
    state.pages.push({raw:rawCanvas,processed:result.canvas,points:result.points});
    renderPages(); updatePdfState(); toast(`Halaman ${state.pages.length} siap`);
  }catch(e){console.error(e);toast('Gagal memproses dokumen. Coba foto dengan cahaya lebih rata.');}
}

function renderPages(){
  const grid=$("#pagesGrid"),empty=$("#emptyState"); grid.innerHTML=''; empty.style.display=state.pages.length?'none':'block';
  state.pages.forEach((p,i)=>{
    const card=document.createElement('article');card.className='page-card';
    const thumb=document.createElement('div');thumb.className='thumb';
    const cn=p.processed.cloneNode(true);cn.width=p.processed.width;cn.height=p.processed.height;thumb.appendChild(cn);
    const no=document.createElement('span');no.className='page-no';no.textContent=`PAGE ${String(i+1).padStart(2,'0')}`;thumb.appendChild(no);
    const actions=document.createElement('div');actions.className='page-actions';
    const up=document.createElement('button');up.textContent='↑';up.disabled=i===0;up.onclick=()=>{[state.pages[i-1],state.pages[i]]=[state.pages[i],state.pages[i-1]];renderPages()};
    const down=document.createElement('button');down.textContent='↓';down.disabled=i===state.pages.length-1;down.onclick=()=>{[state.pages[i+1],state.pages[i]]=[state.pages[i],state.pages[i+1]];renderPages()};
    const del=document.createElement('button');del.className='remove';del.textContent='Hapus';del.onclick=()=>{state.pages.splice(i,1);renderPages();updatePdfState()};
    actions.append(up,down,del);card.append(thumb,actions);grid.appendChild(card);
  });
}
function updatePdfState(){ $("#pdfBtn").disabled=!state.pages.length; }

async function reprocessAll(){
  if(!state.pages.length||state.busy)return;
  state.busy=true; setEngineStatus('Memproses halaman…');
  try{
    for(const p of state.pages){ const keepPoints = $("#detectMode").value === 'auto' ? p.points : null; const result=prepareImageCanvas(p.raw,keepPoints); p.processed=result.canvas; if($("#detectMode").value==='auto') p.points=result.points; }
    renderPages();
  }catch(e){console.error(e);toast('Sebagian halaman gagal diproses.');}
  state.busy=false; setEngineStatus('Scanner siap',true);
}

function rawCanvasFromVideo(){
  const video=$("#camera"),c=document.createElement('canvas'); c.width=video.videoWidth;c.height=video.videoHeight;c.getContext('2d').drawImage(video,0,0,c.width,c.height);return c;
}

function drawLiveOverlay(){
  if(!state.stream || !cvReady() || !$("#cameraModal").classList.contains('open')) return;
  const video=$("#camera"), overlay=$("#edgeOverlay"), ctx=overlay.getContext('2d');
  const w=video.videoWidth,h=video.videoHeight;if(!w||!h)return;
  const scale=Math.min(1,900/Math.max(w,h));
  const c=document.createElement('canvas');c.width=Math.round(w*scale);c.height=Math.round(h*scale);c.getContext('2d').drawImage(video,0,0,c.width,c.height);
  try{
    const src=cv.imread(c),pts=detectDocument(src,{maxDim:900});src.delete();
    overlay.width=overlay.clientWidth*devicePixelRatio;overlay.height=overlay.clientHeight*devicePixelRatio;ctx.clearRect(0,0,overlay.width,overlay.height);ctx.save();ctx.scale(overlay.width/c.clientWidth,overlay.height/c.clientHeight);
    if(pts){ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x*scale,p.y*scale):ctx.moveTo(p.x*scale,p.y*scale));ctx.closePath();ctx.strokeStyle='#53e5a4';ctx.lineWidth=4/Math.max(1,scale);ctx.shadowBlur=10;ctx.shadowColor='#53e5a4';ctx.stroke();}
    ctx.restore();
  }catch(e){ /* camera preview must remain usable */ }
}
function startLiveDetection(){ clearInterval(state.liveTimer); state.liveTimer=setInterval(drawLiveOverlay,260); }
function stopLiveDetection(){clearInterval(state.liveTimer);state.liveTimer=null;const c=$("#edgeOverlay");if(c)c.getContext('2d').clearRect(0,0,c.width,c.height);}

async function startCamera(){
  if(!await waitForOpenCV()) return;
  try{
    if(state.stream)stopCamera();
    state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
    const video=$("#camera"); video.srcObject=state.stream; await video.play(); openModal($("#cameraModal")); startLiveDetection();
  }catch(e){console.error(e);toast('Kamera tidak bisa dibuka. Pastikan izin kamera aktif dan gunakan HTTPS.');}
}
function stopCamera(){stopLiveDetection();if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null;}}

function capture(){
  if(!state.stream)return;
  const raw=rawCanvasFromVideo();
  try{
    const result=prepareImageCanvas(raw);
    state.pending={raw,processed:result.canvas,points:result.points};
    stopCamera();
    closeModal($("#cameraModal"));
    showPreview(state.pending.processed);
  }catch(e){console.error(e);toast('Foto gagal diproses. Coba pastikan seluruh kertas terlihat.');}
}
function showPreview(canvas){
  const p=$("#previewCanvas");p.width=canvas.width;p.height=canvas.height;p.getContext('2d').drawImage(canvas,0,0);openModal($("#previewModal"));}

function handleFiles(files){
  if(!files.length)return;
  waitForOpenCV().then(async ok=>{
    if(!ok)return;
    for(const file of [...files]){
      if(!file.type.startsWith('image/'))continue;
      const url=URL.createObjectURL(file),img=new Image();
      await new Promise((resolve)=>{img.onload=async()=>{try{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);addPage(c);}catch(e){toast('Foto tidak dapat diproses.')}URL.revokeObjectURL(url);resolve();};img.onerror=resolve;img.src=url;});
    }
  });
}

function acceptPending(){
  if(!state.pending)return;
  state.pages.push(state.pending);state.pending=null;renderPages();updatePdfState();closeModal($("#previewModal"));toast(`Halaman ${state.pages.length} ditambahkan`);
}
function clearPending(){state.pending=null;}

function exportPDF(){
  if(!state.pages.length)return;
  if(!window.jspdf){toast('PDF engine belum siap. Coba lagi sebentar.');return;}
  const {jsPDF}=window.jspdf; const size=$("#paperSize").value; const dims={a4:[210,297],a5:[148,210],letter:[216,279],legal:[216,356]};
  let pdf;
  const first=state.pages[0].processed;
  if(size==='original'){
    const pt=0.75; pdf=new jsPDF({orientation:first.width>first.height?'landscape':'portrait',unit:'pt',format:[first.width*pt,first.height*pt]});
  }else{
    const cfg=dims[size],land=first.width>first.height; pdf=new jsPDF({orientation:land?'landscape':'portrait',unit:'mm',format:land?[cfg[1],cfg[0]]:cfg});
  }
  state.pages.forEach((p,i)=>{
    if(i){
      if(size==='original'){
        const pt=.75; pdf.addPage([p.processed.width*pt,p.processed.height*pt],p.processed.width>p.processed.height?'landscape':'portrait');
      }else{
        const cfg=dims[size],land=p.processed.width>p.processed.height;pdf.addPage(land?[cfg[1],cfg[0]]:cfg,land?'landscape':'portrait');
      }
    }
    const pw=pdf.internal.pageSize.getWidth(),ph=pdf.internal.pageSize.getHeight();
    const margin=size==='original'?0:5,iw=pw-margin*2,ih=ph-margin*2,ratio=Math.min(iw/p.processed.width,ih/p.processed.height),w=p.processed.width*ratio,h=p.processed.height*ratio;
    pdf.addImage(p.processed.toDataURL('image/jpeg',.94),'JPEG',(pw-w)/2,(ph-h)/2,w,h,undefined,'FAST');
  });
  pdf.save(`VAYTES-Document-Scanner-${new Date().toISOString().slice(0,10)}.pdf`);toast('PDF berhasil dibuat.');
}

window.addEventListener('DOMContentLoaded',async()=>{
  await waitForOpenCV();
  $("#startBtn").onclick=startCamera; $("#emptyStartBtn").onclick=startCamera; $("#addBtn").onclick=startCamera;
  $("#captureBtn").onclick=()=>{capture();};
  $("#closeCamera").onclick=()=>{stopCamera();closeModal($("#cameraModal"));};
  $("#closePreview").onclick=()=>{clearPending();closeModal($("#previewModal"));};
  $("#retakeBtn").onclick=()=>{clearPending();closeModal($("#previewModal"));startCamera();};
  $("#acceptBtn").onclick=acceptPending;
  $("#fileInput").onchange=e=>handleFiles(e.target.files);
  $("#pdfBtn").onclick=exportPDF;
  $("#enhanceMode").onchange=reprocessAll;
  $("#paperSize").onchange=reprocessAll;
  $("#detectMode").onchange=reprocessAll;
  window.addEventListener('beforeunload',stopCamera);
});
