/* TridaPro JMC Studio front-end. Chapter content is rendered into
   window.CHAPTERS by Flask (templates/studio.html) from SQLite. */
const AB=["A","B","C","D","E"];
const CHAPTERS=window.CHAPTERS||[];
const IS_ADMIN=!!window.IS_ADMIN;

const $=id=>document.getElementById(id);
const S={chap:CHAPTERS[0],mode:"learn",slide:0,dSub:"quiz",
 dN:10,dPool:[],dQs:[],di:0,dAns:{},dElim:{},dElimOn:false,dT:0,dTick:null,
 tQs:[],ti:0,tAns:{},tFlag:{},tElim:{},tElimOn:false,tSubmitted:false,tReview:false,
 tSecs:3600,tTick:null,tPaused:false};

/* ================= CHAPTER PICKER ================= */
$("selChap").innerHTML=CHAPTERS.map(c=>`<option value="${c.id}">${c.name}</option>`).join("");
$("selChap").onchange=e=>{S.chap=CHAPTERS.find(c=>c.id===e.target.value);S.slide=0;renderDeck();resetDrillsUI();resetTestUI();syncTitles();buildStepper();};

function syncTitles(){
 const nm=S.chap.name;
 $("dChap").textContent=nm+" — how many questions?";
 $("tChap").textContent=nm+" — full paper, exam conditions";
}

/* ================= MODE SWITCH ================= */
function setMode(m){
 S.mode=m;
 $("mLearn").classList.toggle("active",m==="learn");
 $("mDrills").classList.toggle("active",m==="drills");
 $("mTest").classList.toggle("active",m==="test");
 $("learnView").style.display=m==="learn"?"flex":"none";
 $("drillsView").style.display=m==="drills"?"flex":"none";
 $("testView").style.display=m==="test"?"flex":"none";
 if(m==="learn")setTimeout(()=>{fitBoard();fitSlidePen();},30);
 if(m!=="drills")stopDrillTimer();
 if(m!=="test")stopTestTimer();
}
$("mLearn").onclick=()=>setMode("learn");
$("mDrills").onclick=()=>setMode("drills");
$("mTest").onclick=()=>setMode("test");

/* ================= LEARN · DECK ================= */
function renderDeck(){
 $("deckName").textContent=S.chap.name+" — Presentation";
 const useEmbed=!!S.chap.deck;
 $("slideFrame").style.display=useEmbed?"block":"none";
 $("demoSlide").style.display=useEmbed?"none":"flex";
 $("noEmbed").style.display="none";
 /* Google's player has its own prev/next and full-screen controls */
 document.querySelector(".snav").style.display=useEmbed?"none":"flex";
 if(useEmbed){$("slideFrame").src=S.chap.deck;$("sCount").textContent="Google Slides";$("sPrev").disabled=true;$("sNext").disabled=true;}
 else{drawSlide();$("sPrev").disabled=false;$("sNext").disabled=false;}
 clearSlidePen();
}
function drawSlide(){
 const sl=S.chap.slides,d=sl[S.slide];
 if(!d){$("demoSlide").innerHTML=`<div class="kicker">${S.chap.name}</div><h2>No slides <em>yet</em></h2><div class="sub">Add slides or link a Google Slides deck in the admin panel.</div>`;$("sCount").textContent="—";$("sPrev").disabled=true;$("sNext").disabled=true;return;}
 $("demoSlide").innerHTML=`<div class="kicker">${d.k}</div><h2>${d.h}</h2><div class="sub">${d.s}</div><ul>${d.b.map((x,i)=>`<li><span class="b">${i+1}</span><span>${x}</span></li>`).join("")}</ul><div class="note">${d.n}</div>`;
 $("sCount").textContent=`Slide ${S.slide+1} of ${sl.length}`;
 $("sPrev").disabled=S.slide===0;$("sNext").disabled=S.slide===sl.length-1;
}
$("sPrev").onclick=()=>{if(S.slide>0){S.slide--;drawSlide();clearSlidePen();}};
$("sNext").onclick=()=>{if(S.slide<S.chap.slides.length-1){S.slide++;drawSlide();clearSlidePen();}};
$("sFull").onclick=()=>{const el=$("slideBox");(el.requestFullscreen||el.webkitRequestFullscreen).call(el);};
$("sLink").onclick=()=>{$("noEmbed").style.display="flex";};
$("urlCancel").onclick=()=>{$("noEmbed").style.display="none";};
$("urlGo").onclick=()=>{let u=$("urlIn").value.trim();if(!u)return;u=u.replace(/\/(edit|pub|view)(\?[^#]*)?(#.*)?$/,"/embed");S.chap.deck=u;renderDeck();
 if(!IS_ADMIN){toast("Deck loaded for this session — sign in as a teacher to save it","🖥️");return;}
 api(`/api/chapters/${S.chap.id}/deck`,{deck_url:u}).then(()=>toast("Deck saved to this chapter","🖥️")).catch(()=>toast("Deck loaded, but saving failed","⚠️"));
};

const sp=$("slidePen"),spx=sp.getContext("2d");
let spDraw=false,spOn=false,spColor="#C7302A",spLast=null,spUndo=[];
["#C7302A","#F5C62A","#12182A","#12996B"].forEach((c,i)=>{const b=document.createElement("button");b.className="sw"+(i===0?" on":"");b.style.background=c;b.setAttribute("aria-label","Pen colour");b.onclick=()=>{spColor=c;spOn=true;$("sPen").classList.add("active");sp.classList.add("armed");sp.style.pointerEvents="auto";document.querySelectorAll("#sSwatches .sw").forEach(s=>s.classList.remove("on"));b.classList.add("on");};$("sSwatches").appendChild(b);});
function fitSlidePen(){const r=$("slideBox").getBoundingClientRect();const snap=sp.width?spx.getImageData(0,0,sp.width,sp.height):null;sp.width=r.width;sp.height=r.height;spx.lineCap="round";spx.lineJoin="round";if(snap)try{spx.putImageData(snap,0,0);}catch(e){}}
new ResizeObserver(fitSlidePen).observe($("slideBox"));
$("sPen").onclick=()=>{spOn=!spOn;$("sPen").classList.toggle("active",spOn);sp.classList.toggle("armed",spOn);sp.style.pointerEvents=spOn?"auto":"none";};
sp.style.pointerEvents="none";
const spPos=e=>{const r=sp.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
sp.addEventListener("pointerdown",e=>{if(!spOn)return;spDraw=true;spUndo.push(spx.getImageData(0,0,sp.width,sp.height));if(spUndo.length>24)spUndo.shift();spLast=spPos(e);sp.setPointerCapture(e.pointerId);});
sp.addEventListener("pointermove",e=>{if(!spDraw)return;const p=spPos(e);spx.strokeStyle=spColor;spx.lineWidth=3.5;spx.beginPath();spx.moveTo(spLast.x,spLast.y);spx.lineTo(p.x,p.y);spx.stroke();spLast=p;});
["pointerup","pointerleave","pointercancel"].forEach(ev=>sp.addEventListener(ev,()=>spDraw=false));
$("sUndo").onclick=()=>{if(spUndo.length)spx.putImageData(spUndo.pop(),0,0);};
$("sClear").onclick=()=>clearSlidePen();
function clearSlidePen(){spx.clearRect(0,0,sp.width,sp.height);spUndo=[];}

/* ================= LEARN · WHITEBOARD ================= */
const bc=$("board"),bx=bc.getContext("2d"),bw=$("boardWrap");
let bDraw=false,bTool="pen",bColor="#12182A",bSize=3,bLast=null,bUndo=[];
["#12182A","#F5C62A","#C7302A","#12996B","#2A3A9C","#7A5BD8"].forEach((c,i)=>{const b=document.createElement("button");b.className="sw"+(i===0?" on":"");b.style.background=c;b.setAttribute("aria-label","Pen colour");b.onclick=()=>{bColor=c;bTool="pen";setBTool();document.querySelectorAll("#wSwatches .sw").forEach(s=>s.classList.remove("on"));b.classList.add("on");};$("wSwatches").appendChild(b);});
function fitBoard(){const snap=bc.width?bx.getImageData(0,0,bc.width,bc.height):null;const r=bw.getBoundingClientRect();bc.width=r.width;bc.height=r.height;bx.lineCap="round";bx.lineJoin="round";if(snap)try{bx.putImageData(snap,0,0);}catch(e){}}
new ResizeObserver(fitBoard).observe(bw);fitBoard();
const bPos=e=>{const r=bc.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
bc.addEventListener("pointerdown",e=>{bDraw=true;bUndo.push(bx.getImageData(0,0,bc.width,bc.height));if(bUndo.length>30)bUndo.shift();bLast=bPos(e);bc.setPointerCapture(e.pointerId);$("wHint").style.opacity="0";});
bc.addEventListener("pointermove",e=>{if(!bDraw)return;const p=bPos(e);bx.globalCompositeOperation=bTool==="eraser"?"destination-out":"source-over";bx.strokeStyle=bColor;bx.lineWidth=bTool==="eraser"?bSize*3:bSize;bx.beginPath();bx.moveTo(bLast.x,bLast.y);bx.lineTo(p.x,p.y);bx.stroke();bLast=p;});
["pointerup","pointerleave","pointercancel"].forEach(ev=>bc.addEventListener(ev,()=>bDraw=false));
function setBTool(){$("wPen").classList.toggle("active",bTool==="pen");$("wErase").classList.toggle("active",bTool==="eraser");}
$("wPen").onclick=()=>{bTool="pen";setBTool();};
$("wErase").onclick=()=>{bTool="eraser";setBTool();};
$("wGrid").onclick=()=>{bw.classList.toggle("grid");$("wGrid").textContent=bw.classList.contains("grid")?"Squared":"Plain";};
$("wUndo").onclick=()=>{if(bUndo.length)bx.putImageData(bUndo.pop(),0,0);};
$("wClear").onclick=()=>{bUndo.push(bx.getImageData(0,0,bc.width,bc.height));bx.clearRect(0,0,bc.width,bc.height);};
$("wSize").oninput=e=>bSize=+e.target.value;
$("wSave").onclick=()=>{const o=document.createElement("canvas");o.width=bc.width;o.height=bc.height;const c=o.getContext("2d");c.fillStyle="#fff";c.fillRect(0,0,o.width,o.height);if(bw.classList.contains("grid")){c.strokeStyle="#E7E4D8";c.lineWidth=1;for(let x=0;x<o.width;x+=26){c.beginPath();c.moveTo(x,0);c.lineTo(x,o.height);c.stroke();}for(let y=0;y<o.height;y+=26){c.beginPath();c.moveTo(0,y);c.lineTo(o.width,y);c.stroke();}}c.drawImage(bc,0,0);const a=document.createElement("a");a.download="tridapro-whiteboard.png";a.href=o.toDataURL();a.click();};

/* ================= SHARED INK FACTORY (pen + highlighter) ================= */
function makeInk(canvas,wrap,swWrapEl,undoBtn,clearBtn,penBtn,highBtn,barEl){
 const ctx=canvas.getContext("2d");
 const CFG={pen:{colors:["#C7302A","#12182A","#2A3A9C","#12996B"],w:3.2,alpha:1,cap:"round",comp:"source-over"},
            high:{colors:["#FFE45E","#9BEFC8","#FFC2D6","#B9D4FF"],w:20,alpha:.42,cap:"butt",comp:"multiply"}};
 let tool=null,drawing=false,last=null,stack=[],color={pen:CFG.pen.colors[0],high:CFG.high.colors[0]};
 function fit(){const r=wrap.getBoundingClientRect();const snap=canvas.width?ctx.getImageData(0,0,canvas.width,canvas.height):null;canvas.width=r.width;canvas.height=r.height;if(snap)try{ctx.putImageData(snap,0,0);}catch(e){}}
 new ResizeObserver(fit).observe(wrap);
 function clear(){ctx.clearRect(0,0,canvas.width,canvas.height);stack=[];}
 function buildSw(){const cfg=CFG[tool];if(!cfg)return;swWrapEl.innerHTML="";cfg.colors.forEach(c=>{const b=document.createElement("button");b.className="sw"+(color[tool]===c?" on":"");b.style.background=c;b.setAttribute("aria-label","Ink colour");b.onclick=()=>{color[tool]=c;buildSw();};swWrapEl.appendChild(b);});}
 function setTool(t){
  tool=(tool===t)?null:t;
  penBtn.classList.toggle("on",tool==="pen");
  highBtn.classList.toggle("on",tool==="high");
  canvas.classList.toggle("armed",!!tool);
  barEl.style.display=tool?"flex":"none";
  if(tool){fit();buildSw();}
 }
 penBtn.onclick=()=>setTool("pen");
 highBtn.onclick=()=>setTool("high");
 const pos=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
 canvas.addEventListener("pointerdown",e=>{if(!tool)return;drawing=true;stack.push(ctx.getImageData(0,0,canvas.width,canvas.height));if(stack.length>28)stack.shift();last=pos(e);canvas.setPointerCapture(e.pointerId);});
 canvas.addEventListener("pointermove",e=>{if(!drawing||!tool)return;const cfg=CFG[tool],p=pos(e);ctx.save();ctx.globalAlpha=cfg.alpha;ctx.globalCompositeOperation=cfg.comp;ctx.strokeStyle=color[tool];ctx.lineWidth=cfg.w;ctx.lineCap=cfg.cap;ctx.lineJoin="round";ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();ctx.restore();last=p;});
 ["pointerup","pointerleave","pointercancel"].forEach(ev=>canvas.addEventListener(ev,()=>drawing=false));
 undoBtn.onclick=()=>{if(stack.length)ctx.putImageData(stack.pop(),0,0);};
 clearBtn.onclick=()=>clear();
 return{fit,clear,disarm:()=>setTool(tool)};
}
const dInk=makeInk($("qInkD"),$("dWrap"),$("dInkSw"),$("dInkUndo"),$("dInkClear"),$("dPen"),$("dHigh"),$("dInkBar"));
const tInk=makeInk($("qInkT"),$("tWrap"),$("tInkSw"),$("tInkUndo"),$("tInkClear"),$("tPen"),$("tHigh"),$("tInkBar"));

/* ================= CLASSWORK DRILLS · QUIZ / WORKSHEET SUB-TABS ================= */
function setDrillsSubMode(m){
 S.dSub=m;
 $("dSubQuiz").classList.toggle("active",m==="quiz");
 $("dSubPdf").classList.toggle("active",m==="pdf");
 $("dQuizPane").style.display=m==="quiz"?"flex":"none";
 $("dPdfPane").style.display=m==="pdf"?"flex":"none";
 if(m==="pdf")renderCwPane();
}
$("dSubQuiz").onclick=()=>setDrillsSubMode("quiz");
$("dSubPdf").onclick=()=>setDrillsSubMode("pdf");

/* ================= CLASSWORK WORKSHEET (PDF + Scribble) =================
   The PDF is uploaded in the admin panel and served by Flask at ch.cwUrl. */
function renderCwPane(){
 const ch=S.chap;
 exitCwScribble();CwInk.clear();
 if(ch.cwUrl){
  $("cwToolbar").style.display="flex";
  $("cwEmpty").style.display="none";
  $("cwTitle").textContent=ch.name+" — Classwork worksheet";
  $("cwPages").textContent=(ch.cwPages?ch.cwPages+" pages · ":"")+"PDF";
  $("cwIframeSlot").innerHTML=`<iframe src="${ch.cwUrl}#toolbar=1&navpanes=0" title="${ch.name} classwork worksheet"></iframe>`;
  requestAnimationFrame(()=>CwInk.resize());
 }else{
  $("cwToolbar").style.display="none";
  $("cwIframeSlot").innerHTML="";
  $("cwEmpty").style.display="flex";
  $("cwEmptyBody").textContent=`A teacher or admin uploads ${ch.name}'s classwork PDF once in the admin panel, and it appears here automatically.`;
 }
}
$("cwDownload").onclick=()=>{
 const ch=S.chap;
 if(!ch.cwUrl){toast("This worksheet hasn't been uploaded yet","📄");return;}
 const a=document.createElement("a");
 a.href=ch.cwUrl+"?download=1";
 a.download=`TridaPro_${ch.id.toUpperCase()}_Classwork_Worksheet.pdf`;
 document.body.appendChild(a);a.click();document.body.removeChild(a);
 toast("Download started","⬇️");
};

/* ---- scribble ink engine: normalized point coordinates so strokes
   stay correctly placed through resize and window-size changes ---- */
const CW_INK_COLORS=["#12182A","#C7302A","#2A3A9C","#12996B"];
const CwInk=(function(){
 const wrap=$("cwFrameWrap"),canvas=$("cwInk"),ctx=canvas.getContext("2d");
 let strokes=[],current=null,tool="pen",color=CW_INK_COLORS[0],cw=0,ch=0;
 function styleFor(t){
  if(t==="highlighter")return{op:"multiply",alpha:.42,width:15};
  if(t==="eraser")return{op:"destination-out",alpha:1,width:24};
  return{op:"source-over",alpha:1,width:2.6};
 }
 function resize(){
  const r=wrap.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
  cw=r.width;ch=r.height;
  canvas.width=Math.max(1,Math.round(cw*dpr));canvas.height=Math.max(1,Math.round(ch*dpr));
  canvas.style.width=cw+"px";canvas.style.height=ch+"px";
  ctx.setTransform(dpr,0,0,dpr,0,0);
  redrawAll();
 }
 function drawStroke(s){
  if(s.pts.length<1)return;
  const st=styleFor(s.tool);
  ctx.save();
  ctx.globalCompositeOperation=st.op;ctx.globalAlpha=st.alpha;
  ctx.strokeStyle=s.color;ctx.lineWidth=st.width;ctx.lineCap="round";ctx.lineJoin="round";
  ctx.beginPath();
  s.pts.forEach((p,i)=>{const x=p.x*cw,y=p.y*ch;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
  if(s.pts.length===1){const p=s.pts[0];ctx.lineTo(p.x*cw+0.1,p.y*ch+0.1);}
  ctx.stroke();
  ctx.restore();
 }
 function redrawAll(){ctx.clearRect(0,0,cw,ch);strokes.forEach(drawStroke);}
 function pt(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};}
 function down(e){if(!wrap.classList.contains("scribbling"))return;canvas.setPointerCapture(e.pointerId);current={tool,color,pts:[pt(e)]};drawStroke(current);e.preventDefault();}
 function move(e){if(!current)return;current.pts.push(pt(e));drawStroke({tool:current.tool,color:current.color,pts:current.pts.slice(-2)});e.preventDefault();}
 function up(){if(!current)return;strokes.push(current);current=null;}
 canvas.addEventListener("pointerdown",down);
 canvas.addEventListener("pointermove",move);
 canvas.addEventListener("pointerup",up);
 canvas.addEventListener("pointercancel",up);
 window.addEventListener("resize",()=>{if(S.mode==="drills"&&S.dSub==="pdf")resize();});
 return{
  resize,
  clear(){strokes=[];current=null;ctx.clearRect(0,0,cw,ch);},
  undo(){strokes.pop();redrawAll();},
  setTool(t){tool=t;},
  setColor(c){color=c;}
 };
})();
function buildCwSwatches(){
 const w=$("cwSwatches");
 w.innerHTML=CW_INK_COLORS.map((c,i)=>`<div class="cw-ann-swatch${i===0?' on':''}" data-c="${c}" style="background:${c}"></div>`).join("");
 w.querySelectorAll(".cw-ann-swatch").forEach(sw=>sw.onclick=()=>{
  w.querySelectorAll(".cw-ann-swatch").forEach(s=>s.classList.remove("on"));
  sw.classList.add("on");CwInk.setColor(sw.dataset.c);
 });
}
buildCwSwatches();
function setCwTool(t){
 CwInk.setTool(t);
 ["cwToolPen","cwToolHi","cwToolEr"].forEach(id=>$(id).classList.remove("on"));
 const map={pen:"cwToolPen",highlighter:"cwToolHi",eraser:"cwToolEr"};
 $(map[t]).classList.add("on");
}
$("cwToolPen").onclick=()=>setCwTool("pen");
$("cwToolHi").onclick=()=>setCwTool("highlighter");
$("cwToolEr").onclick=()=>setCwTool("eraser");
$("cwToolUndo").onclick=()=>CwInk.undo();
$("cwToolClear").onclick=()=>CwInk.clear();
$("cwToolDone").onclick=()=>exitCwScribble();
function enterCwScribble(){$("cwFrameWrap").classList.add("scribbling");$("cwScribbleToggle").classList.add("active");CwInk.resize();}
function exitCwScribble(){$("cwFrameWrap").classList.remove("scribbling");$("cwScribbleToggle").classList.remove("active");}
$("cwScribbleToggle").onclick=()=>{$("cwFrameWrap").classList.contains("scribbling")?exitCwScribble():enterCwScribble();};

/* ================= CLASSWORK DRILLS · QUIZ ================= */
function resetDrillsUI(){$("dSetup").style.display="grid";$("dRun").style.display="none";$("dRes").style.display="none";stopDrillTimer();setDrillsSubMode("quiz");}
const dStepVals=[5,10,15];
function buildStepper(){
 const max=S.chap.drills.length;
 $("dStepper").innerHTML=dStepVals.filter(v=>v<max).map(v=>`<button class="step${v===S.dN?" on":""}" data-v="${v}">${v}</button>`).join("")+`<button class="step${S.dN===max?" on":""}" data-v="${max}">All (${max})</button>`;
 $("dStepper").querySelectorAll(".step").forEach(b=>b.onclick=()=>{S.dN=+b.dataset.v;buildStepper();$("dStartLbl").textContent=S.dN+" questions";});
}
buildStepper();
$("startDrills").onclick=()=>{
 if(!S.chap.drills.length){toast("No drill questions in this chapter yet","📝");return;}
 const pool=[...S.chap.drills].map((q,i)=>({...q,_i:i}));
 for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
 S.dQs=pool.slice(0,S.dN);S.dAns={};S.dElim={};S.di=0;S.dT=0;
 $("dSetup").style.display="none";$("dRun").style.display="flex";$("dRes").style.display="none";
 $("dCountChip").textContent=S.dQs.length+" questions";
 $("dNavTitle").textContent=S.chap.name+" · Drills";
 dInk.clear();startDrillTimer();renderDrillQ();
};
$("dBack").onclick=()=>resetDrillsUI();
$("dBack2").onclick=()=>resetDrillsUI();
$("dRetry").onclick=()=>$("startDrills").click();
$("dElimBtn").onclick=()=>{S.dElimOn=!S.dElimOn;$("dElimBtn").classList.toggle("on",S.dElimOn);renderDrillQ();};

function renderDrillQ(){
 const q=S.dQs[S.di],a=S.dAns[S.di],show=a!==undefined,el=S.dElim[S.di]||{};
 const opts=q.o.map((o,j)=>{
  let cls="opt";let mk="";
  if(show){cls+=" lock";if(j===q.c){cls+=" right";mk="✓";}else if(j===a){cls+=" wrong";mk="✕";}}
  if(el[j]&&!show)cls+=" dead";
  return `<div class="orow"><button class="${cls}" data-j="${j}"><span class="k">${AB[j]}</span><span class="txt">${o}</span><span class="mk">${mk}</span></button><button class="abc elim${S.dElimOn?" show":""}${el[j]?" on":""}" data-e="${j}" aria-label="Eliminate ${AB[j]}">${AB[j]}</button></div>`;
 }).join("");
 let expl=show?`<div class="expl"><h4>Explanation</h4><p>${q.e}</p><div class="ansline">Correct answer: ${AB[q.c]}</div></div>`:"";
 $("dCard").innerHTML=`<div class="qhead"><div class="qnum">${S.di+1}</div><div class="qband">Classwork</div></div><div class="stem">${q.s}</div><div class="opts">${opts}</div>${expl}`;
 $("dCard").querySelectorAll(".opt").forEach(b=>b.onclick=()=>{if(show)return;S.dAns[S.di]=+b.dataset.j;renderDrillQ();buildDrillNav();});
 $("dCard").querySelectorAll(".abc.elim").forEach(b=>b.onclick=()=>{const j=+b.dataset.e;S.dElim[S.di]=S.dElim[S.di]||{};S.dElim[S.di][j]=!S.dElim[S.di][j];renderDrillQ();});
 $("dPick").innerHTML=`Question ${S.di+1} of ${S.dQs.length} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M6 15l6-6 6 6"/></svg>`;
 $("dPrev").disabled=S.di===0;
 $("dNext").textContent=(S.di===S.dQs.length-1)?"Finish":"Next";
 buildDrillNav();
}
function buildDrillNav(){
 $("dNavGrid").innerHTML=S.dQs.map((_,j)=>{let c="ng";if(S.dAns[j]!==undefined)c+=(S.dAns[j]===S.dQs[j].c)?" ok":" bad";if(j===S.di)c+=" cur";return `<button class="${c}" data-j="${j}">${j+1}</button>`;}).join("");
 $("dNavGrid").querySelectorAll(".ng").forEach(b=>b.onclick=()=>{S.di=+b.dataset.j;$("dNavPop").classList.remove("show");dInk.clear();renderDrillQ();});
}
$("dPick").onclick=()=>$("dNavPop").classList.toggle("show");
$("dPrev").onclick=()=>{if(S.di>0){S.di--;dInk.clear();renderDrillQ();}};
$("dNext").onclick=()=>{if(S.di<S.dQs.length-1){S.di++;dInk.clear();renderDrillQ();$("dNavPop").classList.remove("show");}else finishDrills();};
function startDrillTimer(){stopDrillTimer();S.dTick=setInterval(()=>{S.dT++;$("dTimer").textContent=fmt(S.dT);},1000);$("dTimer").textContent="00:00";}
function stopDrillTimer(){if(S.dTick)clearInterval(S.dTick);S.dTick=null;}
function finishDrills(){
 stopDrillTimer();
 const n=S.dQs.filter((q,j)=>S.dAns[j]===q.c).length;
 $("dRun").style.display="none";$("dRes").style.display="grid";
 $("dResKick").textContent=S.chap.name+" · Classwork Drills";
 $("dScoreN").textContent=n;$("dRes").querySelector(".of").textContent="/"+S.dQs.length;
 const pct=n/S.dQs.length;
 $("dResMsg").textContent=(pct===1?"Perfect set — every question landed.":pct>=.8?"Strong set — just a couple to revisit.":pct>=.6?"Solid. Go over the misses as a class.":"Good starting point — walk through the explanations together.")+`  ·  ${fmt(S.dT)}`;
 $("dResBars").innerHTML=S.dQs.map((q,j)=>`<i class="${S.dAns[j]===q.c?"ok":"bad"}"></i>`).join("");
 saveAttempt("drill",S.dQs,S.dAns,S.dT);
}
function fmt(s){const m=Math.floor(s/60),x=s%60;return String(m).padStart(2,"0")+":"+String(x).padStart(2,"0");}

/* ================= TEST (UKMT JMC MOCK) ================= */
/* JMC has a single national paper — no year-group split in the
   marking scheme or the follow-on rounds, unlike IMC's Y9/Y10/Y11
   bands — so the Test setup goes straight to Start. */
function resetTestUI(){$("tSetup").style.display="grid";$("tRun").style.display="none";$("tReport").style.display="none";stopTestTimer();}
$("startTest").onclick=()=>{
 if(!S.chap.test.length){toast("No mock questions in this chapter yet","📝");return;}
 S.tQs=S.chap.test;S.tAns={};S.tFlag={};S.tElim={};S.ti=0;S.tSubmitted=false;S.tReview=false;S.tSecs=3600;S.tPaused=false;
 $("tSetup").style.display="none";$("tRun").style.display="flex";$("tReport").style.display="none";
 $("tNavTitle").textContent=S.chap.name+" · JMC Mock";
 $("tToolsLive").style.display="flex";$("tToolsReview").style.display="none";
 tInk.clear();startTestTimer();renderTestQ();
};
$("tBack").onclick=()=>{if(confirm("Leave the mock? Your progress on this attempt will be lost."))resetTestUI();};
$("tElimBtn").onclick=()=>{S.tElimOn=!S.tElimOn;$("tElimBtn").classList.toggle("on",S.tElimOn);renderTestQ();};

function bandOf(idx){return idx<15?1:2;}
function bandMarks(idx){return idx<15?{c:5,w:0}:{c:6,w:0};}
function renderTestQ(){
 const q=S.tQs[S.ti],a=S.tAns[S.ti],show=S.tReview,el=S.tElim[S.ti]||{},band=bandOf(S.ti),bm=bandMarks(S.ti);
 const opts=q.o.map((o,j)=>{
  let cls="opt";let mk="";
  if(show){cls+=" lock";if(j===q.c){cls+=" right";mk="✓";}else if(j===a){cls+=" wrong";mk="✕";}}
  else if(j===a)cls+=" sel";
  if(el[j]&&!show)cls+=" dead";
  return `<div class="orow"><button class="${cls}" data-j="${j}"><span class="k">${AB[j]}</span><span class="txt">${o}</span><span class="mk">${mk}</span></button><button class="abc elim${(S.tElimOn&&!show)?" show":""}${el[j]?" on":""}" data-e="${j}" aria-label="Eliminate ${AB[j]}">${AB[j]}</button></div>`;
 }).join("");
 let expl="";
 if(show){
  const correct=a===q.c,delta=a===undefined?0:(correct?bm.c:bm.w);
  expl=`<div class="expl"><h4>Explanation</h4><p>${q.e}</p><div class="ansline ${delta<0?"neg":""}">Correct answer: ${AB[q.c]} &nbsp;·&nbsp; You scored ${delta>0?"+":""}${delta} on this question</div></div>`;
 }
 $("tCard").innerHTML=`<div class="qhead"><div class="qnum">${S.ti+1}</div><div class="qband">Band ${band} · ${bm.c===5?"+5 / 0 / 0":"+"+bm.c+" / "+bm.w+" / 0"}</div>${!show?`<button class="mark${S.tFlag[S.ti]?" on":""}" id="tMk"><svg width="14" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg> Mark for Review</button>`:""}</div><div class="stem">${q.s}</div><div class="opts">${opts}</div>${expl}`;
 if(!show){const mk=$("tMk");if(mk)mk.onclick=()=>{S.tFlag[S.ti]=!S.tFlag[S.ti];renderTestQ();buildTestNav();};}
 $("tCard").querySelectorAll(".opt").forEach(b=>b.onclick=()=>{if(show)return;S.tAns[S.ti]=+b.dataset.j;renderTestQ();buildTestNav();});
 $("tCard").querySelectorAll(".abc.elim").forEach(b=>b.onclick=()=>{if(show)return;const j=+b.dataset.e;S.tElim[S.ti]=S.tElim[S.ti]||{};S.tElim[S.ti][j]=!S.tElim[S.ti][j];renderTestQ();});
 $("tPick").innerHTML=`Question ${S.ti+1} of 25 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M6 15l6-6 6 6"/></svg>`;
 $("tPrev").disabled=S.ti===0;
 $("tNext").textContent=(S.ti===24)?(show?"Finish review":"Submit paper"):"Next";
 buildTestNav();
}
function buildTestNav(){
 $("tNavGrid").innerHTML=S.tQs.map((_,j)=>{let c="ng";if(S.tReview||S.tSubmitted){c+=(S.tAns[j]===undefined)?"":(S.tAns[j]===S.tQs[j].c)?" ok":" bad";}else if(S.tAns[j]!==undefined)c+=" ans";if(j===S.ti)c+=" cur";if(S.tFlag[j])c+=" flag";return `<button class="${c}" data-j="${j}">${j+1}</button>`;}).join("");
 $("tNavGrid").querySelectorAll(".ng").forEach(b=>b.onclick=()=>{S.ti=+b.dataset.j;$("tNavPop").classList.remove("show");tInk.clear();renderTestQ();});
}
$("tPick").onclick=()=>$("tNavPop").classList.toggle("show");
$("tPrev").onclick=()=>{if(S.ti>0){S.ti--;tInk.clear();renderTestQ();}};
$("tNext").onclick=()=>{
 if(S.ti<24){S.ti++;tInk.clear();renderTestQ();$("tNavPop").classList.remove("show");}
 else if(S.tReview){$("tReport").style.display="flex";$("tRun").style.display="none";}
 else openSubmit();
};

function openSubmit(){
 const blanks=S.tQs.filter((_,j)=>S.tAns[j]===undefined).length;
 $("submitBody").textContent=blanks>0?`You have ${blanks} question${blanks===1?"":"s"} left unanswered. Once submitted, the paper is marked using the official UKMT scheme and cannot be changed.`:"Every question has an answer. Once submitted, the paper is marked using the official UKMT scheme and cannot be changed.";
 $("submitModal").classList.add("show");
}
$("submitCancel").onclick=()=>$("submitModal").classList.remove("show");
$("submitGo").onclick=()=>{$("submitModal").classList.remove("show");finishTest();};

function startTestTimer(){
 stopTestTimer();
 $("tTimer").textContent=fmtCountdown(S.tSecs);
 S.tTick=setInterval(()=>{
  if(S.tPaused)return;
  S.tSecs--;
  $("tTimer").textContent=fmtCountdown(S.tSecs);
  $("tTimer").classList.toggle("low",S.tSecs<=300);
  if(S.tSecs<=0){stopTestTimer();toast("Time's up — submitting your paper","⏱️");finishTest();}
 },1000);
}
function stopTestTimer(){if(S.tTick)clearInterval(S.tTick);S.tTick=null;}
function fmtCountdown(s){s=Math.max(0,s);const m=Math.floor(s/60),x=s%60;return String(m).padStart(2,"0")+":"+String(x).padStart(2,"0");}
$("tPause").onclick=()=>{S.tPaused=!S.tPaused;$("tPause").textContent=S.tPaused?"▶":"❚❚";};
$("tHide").onclick=()=>{const t=$("tTimer");t.classList.toggle("hidden");$("tHide").textContent=t.classList.contains("hidden")?"Show":"Hide";};

function scoreTest(){
 let raw=0;const bands={1:{c:0,i:0,bl:0,m:0},2:{c:0,i:0,bl:0,m:0}};
 S.tQs.forEach((q,idx)=>{
  const a=S.tAns[idx],band=bandOf(idx),bm=bandMarks(idx);let contrib=0;
  if(a===undefined)bands[band].bl++;
  else if(a===q.c){contrib=bm.c;bands[band].c++;}
  else{contrib=bm.w;bands[band].i++;}
  bands[band].m+=contrib;raw+=contrib;
 });
 return{raw:Math.max(0,raw),bands};
}
/* Official current JMC thresholds (ukmt.org.uk/junior-challenges/junior-maths-challenge-awards):
   Gold 75+, Silver 59+, Bronze 47+; Junior Kangaroo 80+, Junior
   Mathematical Olympiad 112+. JMC publishes one national set of
   bands — no year-group split, unlike IMC's Y9/Y10/Y11 bands. */
function certBand(score){if(score>=75)return"Gold";if(score>=59)return"Silver";if(score>=47)return"Bronze";return"Participation";}
const JUNIOR_QUALS=[{n:"Junior Kangaroo",th:80},{n:"Junior Mathematical Olympiad",th:112}];
function qualBadges(score){
 return JUNIOR_QUALS.map(x=>({...x,hit:score>=x.th}));
}

function finishTest(){
 stopTestTimer();S.tSubmitted=true;S.tReview=false;
 const{raw,bands}=scoreTest();
 saveAttempt("test",S.tQs,S.tAns,3600-Math.max(0,S.tSecs));
 $("tRun").style.display="none";$("tReport").style.display="flex";
 $("repScore").textContent=raw;
 $("repChap").textContent=S.chap.name+" · JMC Mock";
 $("repYr").textContent=`Completed in ${fmtCountdown(3600-Math.max(0,S.tSecs))}`;
 const band=certBand(raw);
 $("repBadge").textContent=band==="Participation"?"Certificate of Participation":band+" Certificate";
 $("repBadge").className="badge "+band;

 /* gauge */
 const pct=v=>Math.min(100,(v/135)*100);
 let g=`<div class="zone" style="left:0;width:${pct(47)}%;background:${'var(--silver-soft)'};border-right:1px solid #DCD8C8"></div>`;
 g+=`<div class="zone" style="left:${pct(47)}%;width:${pct(59)-pct(47)}%;background:var(--bronze-soft)"></div>`;
 g+=`<div class="zone" style="left:${pct(59)}%;width:${pct(75)-pct(59)}%;background:#E9E4D2"></div>`;
 g+=`<div class="zone" style="left:${pct(75)}%;width:${100-pct(75)}%;background:var(--gold-soft)"></div>`;
 const quals=qualBadges(raw);
 quals.forEach(q=>{if(q.th<=135)g+=`<div class="tick" style="left:${pct(q.th)}%"><span class="tl">${q.n.split(" ")[0]} ${q.th}</span></div>`;});
 g+=`<div class="pin" style="left:${pct(raw)}%"><div class="cap"></div><div class="lbl">You: ${raw}</div></div>`;
 $("gauge").innerHTML=g;

 /* qualification cards */
 $("qualGrid").innerHTML=quals.map(q=>`<div class="qualc ${q.hit?"hit":""}"><div class="nm">${q.hit?"✓ ":""}${q.n}</div><div class="st">${q.hit?`Qualifies — needs ${q.th}+, scored ${raw}`:`Needs ${q.th}+ &nbsp;·&nbsp; ${q.th-raw} mark${q.th-raw===1?"":"s"} short`}</div></div>`).join("")+
  `<div class="qualc ${raw>=47?"hit":""}"><div class="nm">${raw>=47?"✓ ":""}Certificate</div><div class="st">${certBand(raw)==="Participation"?"Certificate of Participation":certBand(raw)+" — "+(raw>=75?"top band, 75+":raw>=59?"59+":"47+")}</div></div>`+
  `<div class="qualc"><div class="nm">Maximum possible</div><div class="st">135 marks across 25 questions</div></div>`;

 /* band breakdown */
 const labels={1:"Q1–15 · +5 / 0",2:"Q16–25 · +6 / 0"};
 $("bandGrid").innerHTML=[1,2].map(b=>{const d=bands[b];const n=b===1?15:10;return `<div class="bandc"><div class="t">${labels[b]}</div><div class="m">${d.m} pts</div><div class="row"><span>Correct</span><b>${d.c}</b></div><div class="row"><span>Incorrect</span><b>${d.i}</b></div><div class="row"><span>Blank</span><b>${d.bl}</b></div><div class="mini">${Array.from({length:n}).map((_,i)=>`<i class="${i<d.c?"ok":i<d.c+d.i?"bad":"bl"}"></i>`).join("")}</div></div>`;}).join("");

 /* review table */
 $("revTable").innerHTML="<tr><th>Q</th><th>Your answer</th><th>Correct</th><th>Result</th><th>Marks</th></tr>"+
  S.tQs.map((q,idx)=>{
   const a=S.tAns[idx],bm=bandMarks(idx);
   const state=a===undefined?"bl":(a===q.c?"ok":"bad");
   const delta=a===undefined?0:(a===q.c?bm.c:bm.w);
   const deltaCls=delta>0?"pos":delta<0?"neg":"zero";
   return `<tr><td>${idx+1}</td><td>${a===undefined?"—":AB[a]}</td><td>${AB[q.c]}</td><td><span class="dot ${state}"></span></td><td class="delta ${deltaCls}">${delta>0?"+":""}${delta}</td></tr>`;
  }).join("");

 if(raw>=75)toast("Gold-band score — brilliant paper!","🏅");
 else if(raw>=59)toast("Silver-band score — great work!","🥈");
 else if(raw>=47)toast("Bronze-band score — solid paper!","🥉");
}
$("repReview").onclick=()=>{S.tReview=true;S.ti=0;$("tReport").style.display="none";$("tRun").style.display="flex";$("tToolsLive").style.display="none";$("tToolsReview").style.display="flex";tInk.clear();renderTestQ();};
$("repRetry").onclick=()=>$("startTest").click();
$("repBack").onclick=()=>resetTestUI();

/* ================= BACKEND ================= */
function api(url,body){
 return fetch(url,{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":window.CSRF_TOKEN},body:JSON.stringify(body)})
  .then(r=>{if(!r.ok)throw new Error(r.status);return r.json();});
}
/* answers are keyed by question id; the server re-marks them itself */
function saveAttempt(kind,qs,ans,secs){
 const answers={};qs.forEach((q,j)=>{answers[q.id]=ans[j]===undefined?null:ans[j];});
 api("/api/attempts",{chapter:S.chap.id,kind,answers,duration_secs:secs})
  .catch(()=>toast("Couldn't save this result to the server","⚠️"));
}

/* ================= TOAST ================= */
function toast(m,e){const w=$("toasts"),d=document.createElement("div");d.className="toast";d.innerHTML=`<span>${e||"✦"}</span> ${m}`;w.appendChild(d);setTimeout(()=>{d.classList.add("out");setTimeout(()=>d.remove(),320);},2400);}

/* keyboard */
document.addEventListener("keydown",e=>{
 if(["INPUT","SELECT","TEXTAREA"].includes(document.activeElement.tagName))return;
 if(S.mode==="learn"){if(e.key==="ArrowRight")$("sNext").click();if(e.key==="ArrowLeft")$("sPrev").click();}
 else if(S.mode==="drills"&&$("dRun").style.display!=="none"){if(e.key==="ArrowRight")$("dNext").click();if(e.key==="ArrowLeft")$("dPrev").click();}
 else if(S.mode==="test"&&$("tRun").style.display!=="none"){if(e.key==="ArrowRight")$("tNext").click();if(e.key==="ArrowLeft")$("tPrev").click();}
});

/* boot */
syncTitles();renderDeck();
