/* VAYTES DOCUMENT SCANNER - client-side document scanner */
const $ = (s)=>document.querySelector(s);
const state={pages:[],stream:null,pending:null};

const toast=(msg)=>{const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove("show"),2400)};
const openModal=(el)=>{el.classList.add("open");el.setAttribute("aria-hidden","false")};
const closeModal=(el)=>{el.classList.remove("open");el.setAttribute("aria-hidden","true")};

function matToCanvas(mat){
  const c=document.createElement("canvas"); c.width=mat.cols;c.height=mat.rows;
  cv.imshow(c,mat); return c;
}
function orderPoints(pts){
  pts=pts.map(p=>({x:p.x,y:p.y}));
  pts.sort((a,b)=>(a.x+a.y)-(b.x+b.y));
  const tl=pts[0], br=pts[3];
  const rest=[pts[1],pts[2]].sort((a,b)=>a.y-b.y);
  return [tl,rest[0],br,rest[1]];
}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function detectDocument(src){
  const maxDim=1500, scale=Math.min(1,maxDim/Math.max(src.cols,src.rows));
  let small=new cv.Mat(); cv.resize(src,small,new cv.Size(Math.round(src.cols*scale),Math.round(src.rows*scale)),0,0,cv.INTER_AREA);
  let gray=new cv.Mat(), blur=new cv.Mat(), edges=new cv.Mat();
  cv.cvtColor(small,gray,cv.COLOR_RGBA2GRAY); cv.GaussianBlur(gray,blur,new cv.Size(5,5),0); cv.Canny(blur,edges,55,170);
  let contours=new cv.MatVector(), hierarchy=new cv.Mat(); cv.findContours(edges,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
  let best=null,bestArea=0, imageArea=small.cols*small.rows;
  for(let i=0;i<contours.size();i++){
    const cnt=contours.get(i), area=cv.contourArea(cnt); if(area<imageArea*.12) {cnt.delete();continue}
    const peri=cv.arcLength(cnt,true), approx=new cv.Mat(); cv.approxPolyDP(cnt,approx,.025*peri,true);
    if(approx.rows===4 && area>bestArea){bestArea=area;best=approx.clone()}
    approx.delete();cnt.delete();
  }
  let result=null;
  if(best){
    const pts=[]; for(let i=0;i<4;i++) pts.push({x:best.intAt(i,0)/scale,y:best.intAt(i,1)/scale});
    result=orderPoints(pts);
  }
  [small,gray,blur,edges,contours,hierarchy,best].forEach(x=>{if(x&&x.delete)x.delete()});
  return result;
}
function warp(src,pts){
  const [tl,tr,br,bl]=pts;
  const w=Math.max(distance(tl,tr),distance(bl,br));
  const h=Math.max(distance(tl,bl),distance(tr,br));
  const ratio=w/h;
  const maxW=2200;
  const outW=Math.min(Math.round(w),maxW);
  const outH=Math.min(Math.round(h),Math.round(maxW/Math.max(.2,ratio)));
  const dstPts=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,outW-1,0,outW-1,outH-1,0,outH-1]);
  const srcPts=cv.matFromArray(4,1,cv.CV_32FC2,[tl.x,tl.y,tr.x,tr.y,br.x,br.y,bl.x,bl.y]);
  const M=cv.getPerspectiveTransform(srcPts,dstPts), dst=new cv.Mat();
  cv.warpPerspective(src,dst,M,new cv.Size(outW,outH),cv.INTER_LANCZOS4,cv.BORDER_REPLICATE);
  M.delete();srcPts.delete();dstPts.delete(); return dst;
}
function enhance(mat,mode){
  if(mode==="original") return mat.clone();
  let gray=new cv.Mat(), out=new cv.Mat();
  cv.cvtColor(mat,gray,cv.COLOR_RGBA2GRAY);
  if(mode==="bw"){
    cv.adaptiveThreshold(gray,out,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY,31,11);
    let rgba=new cv.Mat();cv.cvtColor(out,rgba,cv.COLOR_GRAY2RGBA);gray.delete();out.delete();return rgba;
  }
  const alpha=mode==="clean"?1.06:1.13, beta=mode==="clean"?4:0;
  cv.convertScaleAbs(mat,out,alpha,beta);
  let sharp=new cv.Mat();
  const kernel=cv.matFromArray(3,3,cv.CV_32F,[0,-1,0,-1,5,-1,0,-1,0]);
  cv.filter2D(out,sharp,cv.CV_8U,kernel); kernel.delete();out.delete();gray.delete();return sharp;
}
function processImage(img,cb){
  if(typeof cv==="undefined" || !cv.Mat){toast("Scanner sedang menyiapkan mesin pemrosesan. Tunggu sebentar lalu coba lagi.");return}
  if(!cv.Mat){toast("Mesin pemrosesan gambar belum siap.");return}
  const c=document.createElement("canvas");c.width=img.naturalWidth||img.width;c.height=img.naturalHeight||img.height;
  c.getContext("2d").drawImage(img,0,0,c.width,c.height);
  let src=cv.imread(c), pts=null;
  try{
    const mode=$("#detectMode").value;
    if(mode==="auto") pts=detectDocument(src);
    let warped=pts?warp(src,pts):src.clone();
    let enhanced=enhance(warped,$("#enhanceMode").value);
    cb(enhanced);
    src.delete();warped.delete();enhanced.delete();
  }catch(e){console.error(e);src.delete();toast("Gagal memproses foto. Coba foto dengan cahaya lebih baik.");}
}
function canvasFromMat(mat){return matToCanvas(mat)}
function addPageFromMat(mat){
  const c=canvasFromMat(mat); state.pages.push({canvas:c}); renderPages(); updatePdfState(); toast(`Halaman ${state.pages.length} ditambahkan`);
}
function renderPages(){
  const grid=$("#pagesGrid"), empty=$("#emptyState"); grid.innerHTML="";
  empty.style.display=state.pages.length?"none":"block";
  state.pages.forEach((p,i)=>{
    const card=document.createElement("article");card.className="page-card";
    const thumb=document.createElement("div");thumb.className="thumb";const cn=p.canvas.cloneNode(true);cn.width=p.canvas.width;cn.height=p.canvas.height;thumb.appendChild(cn);
    const no=document.createElement("span");no.className="page-no";no.textContent=`PAGE ${String(i+1).padStart(2,"0")}`;thumb.appendChild(no);
    const actions=document.createElement("div");actions.className="page-actions";
    const up=document.createElement("button");up.textContent="↑";up.disabled=i===0;up.onclick=()=>{[state.pages[i-1],state.pages[i]]=[state.pages[i],state.pages[i-1]];renderPages()};
    const down=document.createElement("button");down.textContent="↓";down.disabled=i===state.pages.length-1;down.onclick=()=>{[state.pages[i+1],state.pages[i]]=[state.pages[i],state.pages[i+1]];renderPages()};
    const del=document.createElement("button");del.className="remove";del.textContent="Hapus";del.onclick=()=>{state.pages.splice(i,1);renderPages();updatePdfState()};
    actions.append(up,down,del);card.append(thumb,actions);grid.appendChild(card);
  });
}
function updatePdfState(){$("#pdfBtn").disabled=!state.pages.length}
async function startCamera(){
  try{
    if(state.stream) state.stream.getTracks().forEach(t=>t.stop());
    state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:4032},height:{ideal:3024}},audio:false});
    $("#camera").srcObject=state.stream;openModal($("#cameraModal"));
  }catch(e){toast("Kamera tidak bisa dibuka. Pastikan izin kamera aktif dan gunakan HTTPS/GitHub Pages.");}
}
function stopCamera(){if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null}}
function handleBlob(blob){
  const url=URL.createObjectURL(blob),img=new Image();
  img.onload=()=>processImage(img,(mat)=>{state.pending=mat.clone();$("#previewCanvas").width=mat.cols;$("#previewCanvas").height=mat.rows;cv.imshow($("#previewCanvas"),mat);openModal($("#previewModal"));URL.revokeObjectURL(url);mat.delete()});
  img.src=url;
}
async function capture(){
  const video=$("#camera"),c=document.createElement("canvas");c.width=video.videoWidth;c.height=video.videoHeight;c.getContext("2d").drawImage(video,0,0,c.width,c.height);
  c.toBlob(handleBlob,"image/jpeg",.97);
}
function handleFiles(files){[...files].forEach(file=>{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{processImage(img,mat=>addPageFromMat(mat));URL.revokeObjectURL(url)};img.src=url})}
function exportPDF(){
  if(!state.pages.length)return;
  const {jsPDF}=window.jspdf; const size=$("#paperSize").value;
  const dims={a4:[210,297],a5:[148,210],letter:[216,279],legal:[216,356]};
  let pdf;
  if(size==="original"){
    const p=state.pages[0].canvas; const px=2.83465; pdf=new jsPDF({orientation:p.width>p.height?"landscape":"portrait",unit:"pt",format:[p.width/px,p.height/px]});
  }else pdf=new jsPDF({orientation:"portrait",unit:"mm",format:dims[size]});
  state.pages.forEach((p,i)=>{
    if(i) pdf.addPage(size==="original"?undefined:dims[size],"portrait");
    const pw=pdf.internal.pageSize.getWidth(),ph=pdf.internal.pageSize.getHeight();
    const margin=size==="original"?0:7, iw=pw-margin*2, ih=ph-margin*2;
    const ratio=Math.min(iw/p.canvas.width,ih/p.canvas.height),w=p.canvas.width*ratio,h=p.canvas.height*ratio;
    const x=(pw-w)/2,y=(ph-h)/2;
    pdf.addImage(p.canvas.toDataURL("image/jpeg",.95),"JPEG",x,y,w,h,undefined,"FAST");
  });
  const stamp=new Date().toISOString().slice(0,10);pdf.save(`VAYTES-Document-Scanner-${stamp}.pdf`);toast("PDF berhasil dibuat.");
}
window.addEventListener("DOMContentLoaded",()=>{
  $("#startBtn").onclick=startCamera;$("#emptyStartBtn").onclick=startCamera;$("#addBtn").onclick=startCamera;
  $("#captureBtn").onclick=()=>{capture();stopCamera();closeModal($("#cameraModal"))};
  $("#closeCamera").onclick=()=>{stopCamera();closeModal($("#cameraModal"))};
  $("#closePreview").onclick=()=>{if(state.pending){state.pending.delete();state.pending=null}closeModal($("#previewModal"))};
  $("#retakeBtn").onclick=()=>{if(state.pending){state.pending.delete();state.pending=null}closeModal($("#previewModal"));startCamera()};
  $("#acceptBtn").onclick=()=>{if(state.pending){addPageFromMat(state.pending);state.pending.delete();state.pending=null}closeModal($("#previewModal"))};
  $("#fileInput").onchange=e=>handleFiles(e.target.files);
  $("#pdfBtn").onclick=exportPDF;
  $("#workspace").addEventListener("click",e=>{});
  const setStatus=(text,ok=false)=>{
    $("#engineStatus").textContent=text;
    const dot=document.querySelector(".status-dot");
    dot.style.background=ok?"#12b76a":"#f79009";
    dot.style.boxShadow=ok?"0 0 0 4px #12b76a15":"0 0 0 4px #f7900915";
  };
  const waitForOpenCV=()=>{
    if(window.cv && cv.Mat){
      setStatus("Scanner siap",true);
      return;
    }
    if(window.__opencvFailed){
      setStatus("Mesin scanner gagal dimuat",false);
      toast("Gagal memuat mesin scanner. Pastikan perangkat terhubung ke internet.");
      return;
    }
    setStatus("Menyiapkan scanner…",false);
    setTimeout(waitForOpenCV,250);
  };
  waitForOpenCV();
});
