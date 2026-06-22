/* ============================================================
   Relatórios · Universidade da Criança
   App offline para professoras lançarem relatórios de
   desenvolvimento dos alunos, com banco de dados local
   (IndexedDB) e exportação em PDF com o timbre oficial.
   ============================================================ */

(function(){
"use strict";

/* ---------------- dados fixos do timbre oficial ---------------- */
const SCHOOL_NAME = "UNIVERSIDADE DA CRIANÇA";
const SCHOOL_LINES = [
  "Fundada em 02 de dezembro de 2002 - Escola Comunitária",
  "Registrada Sob Nº 22.008 - CNPJ: 05.752.926/0001-57- INEP 21019002",
  "Autorizada pelo Conselho Municipal de Educação - Resolução n° 26/2023",
  "Autorizada pelo Conselho Estadual de Educação - Resolução n° 115/2015"
];

const SECTIONS = [
  { key:"introducao",     label:"Introdução:",
    hint:"Apresente brevemente a criança, o período observado e o contexto da turma." },
  { key:"regras",          label:"Regras e comportamentos:",
    hint:"Descreva como a criança lida com regras, rotinas, limites e o convívio em grupo." },
  { key:"desenvolvimento", label:"Desenvolvimento cognitivo:",
    hint:"Descreva avanços em linguagem, raciocínio, coordenação motora, autonomia e aprendizagem." },
  { key:"familia",         label:"Participação da família:",
    hint:"Descreva o envolvimento e o acompanhamento da família na vida escolar da criança." },
  { key:"conclusao",       label:"Conclusão:",
    hint:"Resuma o desenvolvimento geral observado e oriente os próximos passos." }
];

const AVATAR_COLORS = ["#1B6FA8","#D6432E","#6C56A0","#E8862E","#3F9142","#C2940E"];

/* ---------------- IndexedDB ---------------- */
const DB_NAME = "unicaRelatoriosDB";
const DB_VERSION = 1;
let dbPromise = null;

function openDB(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject)=>{
    if(!window.indexedDB){ reject(new Error("IndexedDB indisponível neste navegador.")); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains("alunos")){
        const s = db.createObjectStore("alunos", { keyPath:"id", autoIncrement:true });
        s.createIndex("nome", "nome", { unique:false });
      }
      if(!db.objectStoreNames.contains("relatorios")){
        const r = db.createObjectStore("relatorios", { keyPath:"id", autoIncrement:true });
        r.createIndex("alunoId", "alunoId", { unique:false });
      }
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode){
  return openDB().then(db=> db.transaction(storeName, mode).objectStore(storeName));
}
function dbAll(storeName){
  return tx(storeName, "readonly").then(store=> new Promise((resolve,reject)=>{
    const out = []; const req = store.openCursor();
    req.onsuccess = (e)=>{ const c = e.target.result; if(c){ out.push(c.value); c.continue(); } else resolve(out); };
    req.onerror = ()=> reject(req.error);
  }));
}
function dbGet(storeName, id){
  return tx(storeName, "readonly").then(store=> new Promise((resolve,reject)=>{
    const req = store.get(id);
    req.onsuccess = ()=> resolve(req.result || null);
    req.onerror = ()=> reject(req.error);
  }));
}
function dbAdd(storeName, obj){
  return tx(storeName, "readwrite").then(store=> new Promise((resolve,reject)=>{
    const req = store.add(obj);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  }));
}
function dbPut(storeName, obj){
  return tx(storeName, "readwrite").then(store=> new Promise((resolve,reject)=>{
    const req = store.put(obj);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  }));
}
function dbDelete(storeName, id){
  return tx(storeName, "readwrite").then(store=> new Promise((resolve,reject)=>{
    const req = store.delete(id);
    req.onsuccess = ()=> resolve();
    req.onerror = ()=> reject(req.error);
  }));
}
function dbAllByIndex(storeName, indexName, value){
  return tx(storeName, "readonly").then(store=> new Promise((resolve,reject)=>{
    const out = [];
    const req = store.index(indexName).openCursor(IDBKeyRange.only(value));
    req.onsuccess = (e)=>{ const c = e.target.result; if(c){ out.push(c.value); c.continue(); } else resolve(out); };
    req.onerror = ()=> reject(req.error);
  }));
}

/* ---------------- utilidades ---------------- */
function escapeHtml(s){
  return String(s==null?"":s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function initials(nome){
  const parts = String(nome||"").trim().split(/\s+/).filter(Boolean);
  if(parts.length===0) return "?";
  if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0]+parts[1][0]).toUpperCase();
}
function colorFor(id){ return AVATAR_COLORS[(id||0) % AVATAR_COLORS.length]; }
function formatDate(ts){
  if(!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric" });
}
function slug(s){
  return String(s||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-zA-Z0-9]+/g,"_").replace(/^_+|_+$/g,"") || "relatorio";
}
function debounce(fn, ms){
  let t; return function(...args){ clearTimeout(t); t = setTimeout(()=>fn.apply(this,args), ms); };
}
function currentYear(){ return new Date().getFullYear(); }

/* ---------------- toast ---------------- */
function toast(msg, type){
  const root = document.getElementById("toast-root");
  root.innerHTML = "";
  const el = document.createElement("div");
  el.className = "toast" + (type ? " "+type : "");
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(()=>{ if(el.parentNode) el.parentNode.removeChild(el); }, 2400);
}

/* ---------------- modal ---------------- */
function closeModal(){ document.getElementById("modal-root").innerHTML = ""; }
function showModal(html){
  const root = document.getElementById("modal-root");
  root.innerHTML = '<div class="modal-backdrop" id="modal-backdrop"><div class="modal-sheet">'+html+'</div></div>';
  document.getElementById("modal-backdrop").addEventListener("click", (e)=>{
    if(e.target.id === "modal-backdrop") closeModal();
  });
}
function confirmModal({ title, desc, confirmLabel, danger, onConfirm }){
  showModal(
    '<h3>'+escapeHtml(title)+'</h3>' +
    (desc ? '<p class="desc">'+escapeHtml(desc)+'</p>' : '') +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost" id="m-cancel">Cancelar</button>' +
      '<button class="btn '+(danger?'btn-danger':'btn-primary')+'" id="m-ok">'+escapeHtml(confirmLabel||"Confirmar")+'</button>' +
    '</div>'
  );
  document.getElementById("m-cancel").onclick = closeModal;
  document.getElementById("m-ok").onclick = ()=>{ closeModal(); onConfirm(); };
}

function openAlunoModal(existing){
  const isEdit = !!existing;
  showModal(
    '<h3>'+(isEdit ? "Editar aluno" : "Novo aluno")+'</h3>' +
    '<div class="field"><label>Nome do aluno</label>' +
      '<input type="text" id="m-nome" placeholder="Nome completo" value="'+escapeHtml(existing?existing.nome:"")+'"></div>' +
    '<div class="field"><label>Turma</label>' +
      '<input type="text" id="m-turma" placeholder="Ex.: Jardim II" value="'+escapeHtml(existing?existing.turma:"")+'"></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost" id="m-cancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="m-ok">Salvar</button>' +
    '</div>'
  );
  document.getElementById("m-cancel").onclick = closeModal;
  document.getElementById("m-nome").focus();
  document.getElementById("m-ok").onclick = async ()=>{
    const nome = document.getElementById("m-nome").value.trim();
    const turma = document.getElementById("m-turma").value.trim();
    if(!nome){ toast("Digite o nome do aluno.", "error"); return; }
    try{
      if(isEdit){
        existing.nome = nome; existing.turma = turma;
        await dbPut("alunos", existing);
        toast("Aluno atualizado.", "success");
      } else {
        const id = await dbAdd("alunos", { nome, turma, criadoEm: Date.now() });
        toast("Aluno cadastrado.", "success");
      }
      closeModal();
      render();
    }catch(err){
      console.error(err);
      toast("Não foi possível salvar o aluno.", "error");
    }
  };
}

/* ---------------- topbar ---------------- */
function setTopbar({ title, subtitle, showBack, backHref, actionLabel, actionFn }){
  const el = document.getElementById("topbar");
  el.innerHTML =
    '<div class="topbar-inner">' +
      (showBack
        ? '<button class="topbar-back" id="tb-back" aria-label="Voltar">&#8592;</button>'
        : '<img class="topbar-logo" src="'+ (window.APP_ASSETS?APP_ASSETS.icon192:"") +'" alt="">') +
      '<div class="topbar-titles">' +
        '<div class="t1">'+escapeHtml(title||"")+'</div>' +
        (subtitle ? '<div class="t2">'+escapeHtml(subtitle)+'</div>' : '') +
      '</div>' +
      (actionLabel ? '<button class="topbar-action" id="tb-action">'+escapeHtml(actionLabel)+'</button>' : '') +
    '</div>';
  if(showBack){
    document.getElementById("tb-back").onclick = ()=>{ location.hash = backHref || "#/"; };
  }
  if(actionLabel){
    document.getElementById("tb-action").onclick = actionFn;
  }
}

/* ---------------- timbre (cabeçalho oficial) ---------------- */
function timbreHTML(){
  return (
    '<div class="timbre">' +
      '<img src="'+APP_ASSETS.timbre+'" alt="Logo Universidade da Criança">' +
      '<div class="timbre-text">' +
        '<h2>'+SCHOOL_NAME+'</h2>' +
        SCHOOL_LINES.map(l=>'<p>'+escapeHtml(l)+'</p>').join("") +
      '</div>' +
    '</div>'
  );
}

/* ============================================================
   VIEW: Lista de alunos
   ============================================================ */
async function viewAlunos(){
  setTopbar({
    title: "Relatórios",
    subtitle: "Universidade da Criança",
    showBack: false,
    actionLabel: "+ Aluno",
    actionFn: ()=> openAlunoModal(null)
  });

  const app = document.getElementById("app");
  app.innerHTML =
    '<div class="searchbar">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
      '<input type="text" id="search-input" placeholder="Buscar aluno...">' +
    '</div>' +
    '<div class="section-title">Alunos</div>' +
    '<div id="alunos-list"></div>' +
    '<div class="app-footer">Universidade da Criança — relatórios salvos neste aparelho</div>';

  let alunos = await dbAll("alunos");
  alunos.sort((a,b)=> a.nome.localeCompare(b.nome, "pt-BR"));

  // contagem de relatórios por aluno
  const counts = {};
  for(const a of alunos){
    const rs = await dbAllByIndex("relatorios", "alunoId", a.id);
    counts[a.id] = rs;
  }

  function paint(filter){
    const f = (filter||"").trim().toLowerCase();
    const filtered = !f ? alunos : alunos.filter(a=>
      (a.nome||"").toLowerCase().includes(f) || (a.turma||"").toLowerCase().includes(f)
    );
    const list = document.getElementById("alunos-list");
    if(filtered.length === 0){
      list.innerHTML =
        '<div class="empty">' +
          '<span class="emoji">🧒</span>' +
          '<h3>'+(alunos.length===0 ? "Nenhum aluno cadastrado" : "Nenhum aluno encontrado")+'</h3>' +
          '<p>'+(alunos.length===0 ? "Toque em “+ Aluno” para cadastrar o primeiro aluno da turma." : "Tente buscar por outro nome ou turma.")+'</p>' +
        '</div>';
      return;
    }
    list.innerHTML = filtered.map(a=>{
      const rs = counts[a.id] || [];
      const ultimo = rs.length ? rs.reduce((m,r)=> Math.max(m, r.criadoEm||0), 0) : 0;
      return (
        '<div class="aluno-card" data-id="'+a.id+'">' +
          '<div class="aluno-avatar" style="background:'+colorFor(a.id)+'">'+initials(a.nome)+'</div>' +
          '<div class="aluno-info">' +
            '<div class="aluno-nome">'+escapeHtml(a.nome)+'</div>' +
            '<div class="aluno-turma">'+(a.turma?escapeHtml(a.turma):"Sem turma definida")+'</div>' +
          '</div>' +
          '<div class="aluno-meta"><b>'+rs.length+'</b>relatório'+(rs.length===1?"":"s")+'</div>' +
          '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</div>'
      );
    }).join("");
    list.querySelectorAll(".aluno-card").forEach(card=>{
      card.addEventListener("click", ()=>{ location.hash = "#/aluno/"+card.dataset.id; });
    });
  }

  paint("");
  document.getElementById("search-input").addEventListener("input", (e)=> paint(e.target.value));
}

/* ============================================================
   VIEW: Detalhe do aluno
   ============================================================ */
async function viewAlunoDetail(id){
  const aluno = await dbGet("alunos", id);
  if(!aluno){ toast("Aluno não encontrado.", "error"); location.hash = "#/"; return; }

  setTopbar({
    title: aluno.nome,
    subtitle: aluno.turma ? "Turma "+aluno.turma : "",
    showBack: true, backHref: "#/",
    actionLabel: "Editar",
    actionFn: ()=> openAlunoModal(aluno)
  });

  let relatorios = await dbAllByIndex("relatorios", "alunoId", id);
  relatorios.sort((a,b)=> (b.criadoEm||0) - (a.criadoEm||0));

  const app = document.getElementById("app");
  app.innerHTML =
    '<div class="aluno-hero">' +
      '<h1>'+escapeHtml(aluno.nome)+'</h1>' +
      (aluno.turma ? '<span class="turma-tag">Turma '+escapeHtml(aluno.turma)+'</span>' : '') +
      '<div class="aluno-hero-actions">' +
        '<button class="btn btn-sm" id="btn-excluir-aluno">Excluir aluno</button>' +
      '</div>' +
    '</div>' +
    '<div class="fab-row">' +
      '<button class="btn btn-primary btn-block btn-lg" id="btn-novo-relatorio">+ Novo relatório</button>' +
    '</div>' +
    '<div class="section-title">Relatórios salvos</div>' +
    '<div id="relatorios-list"></div>';

  document.getElementById("btn-novo-relatorio").onclick = ()=>{ location.hash = "#/relatorio/novo/"+aluno.id; };
  document.getElementById("btn-excluir-aluno").onclick = ()=>{
    confirmModal({
      title: "Excluir aluno?",
      desc: "Isso também apagará todos os relatórios salvos de "+aluno.nome+". Essa ação não pode ser desfeita.",
      confirmLabel: "Excluir tudo",
      danger: true,
      onConfirm: async ()=>{
        for(const r of relatorios) await dbDelete("relatorios", r.id);
        await dbDelete("alunos", aluno.id);
        toast("Aluno excluído.", "success");
        location.hash = "#/";
      }
    });
  };

  const list = document.getElementById("relatorios-list");
  if(relatorios.length === 0){
    list.innerHTML =
      '<div class="empty">' +
        '<span class="emoji">📝</span>' +
        '<h3>Nenhum relatório ainda</h3>' +
        '<p>Toque em “+ Novo relatório” para começar o relatório descritivo deste aluno.</p>' +
      '</div>';
    return;
  }
  list.innerHTML = relatorios.map(r=>{
    const preview = [r.introducao, r.desenvolvimento].filter(Boolean).join(" ").slice(0,160);
    return (
      '<div class="relatorio-card" data-id="'+r.id+'">' +
        '<div class="relatorio-card-top">' +
          '<div class="relatorio-ano">Relatório '+escapeHtml(String(r.ano||""))+'</div>' +
          '<div class="relatorio-data">'+formatDate(r.criadoEm)+'</div>' +
        '</div>' +
        (preview ? '<div class="relatorio-preview">'+escapeHtml(preview)+(preview.length>=160?"…":"")+'</div>' : '') +
        '<div class="relatorio-actions">' +
          '<button class="btn btn-outline btn-sm" data-act="abrir">Abrir / Editar</button>' +
          '<button class="btn btn-accent btn-sm" data-act="pdf">Exportar PDF</button>' +
          '<button class="btn btn-danger btn-sm" data-act="excluir">Excluir</button>' +
        '</div>' +
      '</div>'
    );
  }).join("");

  list.querySelectorAll(".relatorio-card").forEach(card=>{
    const rid = Number(card.dataset.id);
    card.querySelector('[data-act="abrir"]').onclick = ()=>{ location.hash = "#/relatorio/"+rid; };
    card.querySelector('[data-act="pdf"]').onclick = async ()=>{
      const r = await dbGet("relatorios", rid);
      gerarPDF(r);
    };
    card.querySelector('[data-act="excluir"]').onclick = ()=>{
      confirmModal({
        title: "Excluir relatório?",
        desc: "O relatório de "+(aluno.nome)+" ("+card.querySelector(".relatorio-ano").textContent+") será apagado permanentemente.",
        confirmLabel: "Excluir",
        danger: true,
        onConfirm: async ()=>{
          await dbDelete("relatorios", rid);
          toast("Relatório excluído.", "success");
          viewAlunoDetail(id);
        }
      });
    };
  });
}

/* ============================================================
   VIEW: Formulário de relatório (novo ou edição)
   ============================================================ */
async function viewRelatorioForm({ alunoId, relatorioId }){
  let relatorio, aluno;

  if(relatorioId){
    relatorio = await dbGet("relatorios", relatorioId);
    if(!relatorio){ toast("Relatório não encontrado.", "error"); location.hash = "#/"; return; }
    aluno = await dbGet("alunos", relatorio.alunoId);
  } else {
    aluno = await dbGet("alunos", alunoId);
    if(!aluno){ toast("Aluno não encontrado.", "error"); location.hash = "#/"; return; }
    relatorio = {
      alunoId: aluno.id,
      alunoNome: aluno.nome,
      turma: aluno.turma || "",
      professoras: localStorage.getItem("unica_last_professoras") || "",
      ano: currentYear(),
      introducao:"", regras:"", desenvolvimento:"", familia:"", conclusao:"",
      criadoEm: Date.now()
    };
  }

  setTopbar({
    title: relatorioId ? "Editar relatório" : "Novo relatório",
    subtitle: aluno.nome,
    showBack: true,
    backHref: "#/aluno/"+aluno.id
  });

  const app = document.getElementById("app");
  app.innerHTML =
    timbreHTML() +
    '<div class="report-title">RELATÓRIO INDIVIDUAL DESCRITIVO<br>DO DESENVOLVIMENTO</div>' +
    '<div style="text-align:center">' +
      '<span class="tag-pill"><span class="tag-dot"></span>Ano letivo&nbsp;' +
        '<input type="number" id="f-ano" value="'+escapeHtml(String(relatorio.ano))+'" style="width:64px;border:none;background:transparent;font-weight:800;font-size:13px;color:var(--text);outline:none;text-align:center">' +
      '</span>' +
    '</div>' +

    '<div class="form-card">' +
      '<div class="field"><label>Nome do aluno</label>' +
        '<input type="text" id="f-nome" value="'+escapeHtml(relatorio.alunoNome)+'"></div>' +
      '<div class="row-2">' +
        '<div class="field"><label>Turma</label>' +
          '<input type="text" id="f-turma" value="'+escapeHtml(relatorio.turma)+'"></div>' +
      '</div>' +
      '<div class="field"><label>Professor (a)</label>' +
        '<input type="text" id="f-professoras" placeholder="Nome do(a) professor(a)" value="'+escapeHtml(relatorio.professoras)+'"></div>' +
    '</div>' +

    '<div class="form-card">' +
      SECTIONS.map(sec=>
        '<div class="field">' +
          '<label>'+escapeHtml(sec.label)+'</label>' +
          '<div class="hint">'+escapeHtml(sec.hint)+'</div>' +
          '<textarea id="f-'+sec.key+'" placeholder="Escreva aqui...">'+escapeHtml(relatorio[sec.key]||"")+'</textarea>' +
        '</div>'
      ).join("") +
    '</div>' +

    '<div class="form-actions">' +
      (relatorioId ? '<button class="btn btn-danger" id="btn-excluir">Excluir</button>' : '') +
      '<button class="btn btn-ghost" id="btn-salvar">Salvar</button>' +
      '<button class="btn btn-primary" id="btn-pdf">Exportar PDF</button>' +
    '</div>';

  function collect(){
    const data = {
      alunoId: aluno.id,
      alunoNome: document.getElementById("f-nome").value.trim() || aluno.nome,
      turma: document.getElementById("f-turma").value.trim(),
      professoras: document.getElementById("f-professoras").value.trim(),
      ano: parseInt(document.getElementById("f-ano").value,10) || currentYear(),
      criadoEm: relatorio.criadoEm || Date.now(),
      atualizadoEm: Date.now()
    };
    SECTIONS.forEach(sec=>{ data[sec.key] = document.getElementById("f-"+sec.key).value; });
    if(relatorioId) data.id = relatorioId;
    return data;
  }

  async function save(){
    const data = collect();
    try{
      let id;
      if(relatorioId){ await dbPut("relatorios", data); id = relatorioId; }
      else { id = await dbAdd("relatorios", data); relatorioId = id; }
      if(data.professoras) localStorage.setItem("unica_last_professoras", data.professoras);
      return { ...data, id };
    }catch(err){
      console.error(err);
      toast("Não foi possível salvar o relatório.", "error");
      return null;
    }
  }

  document.getElementById("btn-salvar").onclick = async ()=>{
    const saved = await save();
    if(saved){ toast("Relatório salvo.", "success"); location.hash = "#/aluno/"+aluno.id; }
  };

  document.getElementById("btn-pdf").onclick = async ()=>{
    const saved = await save();
    if(saved){ toast("Relatório salvo. Gerando PDF...", "success"); gerarPDF(saved); }
  };

  if(relatorioId){
    document.getElementById("btn-excluir").onclick = ()=>{
      confirmModal({
        title: "Excluir relatório?",
        desc: "Essa ação não pode ser desfeita.",
        confirmLabel: "Excluir",
        danger: true,
        onConfirm: async ()=>{
          await dbDelete("relatorios", relatorioId);
          toast("Relatório excluído.", "success");
          location.hash = "#/aluno/"+aluno.id;
        }
      });
    };
  }
}

/* ============================================================
   Exportar PDF (replica o timbre oficial da escola)
   ============================================================ */
function gerarPDF(relatorio){
  try{
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:"mm", format:"a4" });
    const pageW = 210, pageH = 297, marginX = 18;
    let y = 16;

    // logo (proporção original ~640x631)
    const logoW = 24, logoH = logoW * (631/640);
    doc.addImage(APP_ASSETS.timbre, "PNG", marginX, y, logoW, logoH);

    const textX = marginX + logoW + 6;
    doc.setFont("helvetica","bold"); doc.setFontSize(13.5);
    doc.setTextColor(0,0,0);
    doc.text(SCHOOL_NAME, textX, y+6);
    const tw = doc.getTextWidth(SCHOOL_NAME);
    doc.setLineWidth(0.4);
    doc.line(textX, y+7.3, textX+tw, y+7.3);

    doc.setFont("helvetica","normal"); doc.setFontSize(8.2);
    let ly = y + 11.5;
    SCHOOL_LINES.forEach(line=>{
      const wrapped = doc.splitTextToSize(line, pageW - textX - marginX);
      wrapped.forEach(w=>{ doc.text(w, textX, ly); ly += 3.9; });
    });

    y = Math.max(y + logoH, ly) + 4;
    doc.setDrawColor(190); doc.setLineWidth(0.3);
    doc.line(marginX, y, pageW - marginX, y);
    y += 9;

    // título
    doc.setFont("helvetica","bold"); doc.setFontSize(12.5);
    doc.setTextColor(15,15,15);
    const title = "RELATÓRIO INDIVIDUAL DESCRITIVO DO DESENVOLVIMENTO - " + (relatorio.ano || currentYear());
    const titleLines = doc.splitTextToSize(title, pageW - 2*marginX);
    titleLines.forEach(l=>{ doc.text(l, pageW/2, y, { align:"center" }); y += 6; });
    y += 2;

    // dados do aluno
    doc.setFontSize(10.6);
    function infoLine(label, value){
      doc.setFont("helvetica","bold");
      doc.text(label, marginX, y);
      const lw = doc.getTextWidth(label + " ");
      doc.setFont("helvetica","normal");
      const wrapped = doc.splitTextToSize(value || "-", pageW - marginX - lw - marginX);
      doc.text(wrapped[0] || "-", marginX + lw, y);
      y += 6.3;
      for(let i=1;i<wrapped.length;i++){ doc.text(wrapped[i], marginX, y); y += 6.3; }
    }
    infoLine("NOME DO ALUNO:", relatorio.alunoNome);
    infoLine("TURMA:", relatorio.turma);
    infoLine("PROFESSOR (A):", relatorio.professoras);

    y += 2.5;
    doc.setDrawColor(225); doc.setLineWidth(0.25);
    doc.line(marginX, y, pageW - marginX, y);
    y += 8;

    function footers(){
      const total = doc.internal.getNumberOfPages();
      const today = new Date().toLocaleDateString("pt-BR");
      for(let i=1;i<=total;i++){
        doc.setPage(i);
        doc.setFont("helvetica","normal"); doc.setFontSize(8);
        doc.setTextColor(150,150,150);
        doc.text("Universidade da Criança - relatório gerado em " + today, marginX, pageH - 10);
        doc.text("Página " + i + "/" + total, pageW - marginX, pageH - 10, { align:"right" });
      }
    }

    function ensureSpace(needed){
      if(y + needed > pageH - 18){
        doc.addPage();
        y = 20;
      }
    }

    SECTIONS.forEach(sec=>{
      const value = (relatorio[sec.key] || "").trim() || "(não preenchido)";
      ensureSpace(14);
      doc.setFont("helvetica","bold"); doc.setFontSize(11.5);
      doc.setTextColor(27,111,168);
      doc.text(sec.label, marginX, y);
      y += 6.2;
      doc.setFont("helvetica","normal"); doc.setFontSize(10.4);
      doc.setTextColor(25,25,25);
      const textWidth = pageW - 2*marginX;
      const indent = 12.5; // 1,25cm ABNT

      function renderJustLine(line, x, w, isLast){
        const words = line.trim().split(/\s+/);
        const totalWordW = words.reduce((s,ww)=>s+doc.getTextWidth(ww), 0);
        const gap = words.length > 1 ? (w - totalWordW) / (words.length - 1) : 0;
        if(isLast || words.length <= 2 || gap > 3.5){
          doc.text(line, x, y);
        } else {
          let cx = x;
          words.forEach(ww=>{ doc.text(ww, cx, y); cx += doc.getTextWidth(ww) + gap; });
        }
      }

      const paras = value.split(/\n+/).filter(p=>p.trim());
      paras.forEach(para=>{
        if(para.trim() === "(não preenchido)"){ ensureSpace(6); doc.text(para, marginX, y); y += 5.5; return; }
        const firstFit = doc.splitTextToSize(para.trim(), textWidth - indent);
        const firstLine = firstFit[0];
        const wordsFirst = firstLine.trim().split(/\s+/);
        const remaining = para.trim().split(/\s+/).slice(wordsFirst.length).join(" ");
        ensureSpace(6);
        doc.text(firstLine, marginX + indent, y);
        y += 5.5;
        if(remaining.trim()){
          const restLines = doc.splitTextToSize(remaining, textWidth);
          restLines.forEach((line, i)=>{
            ensureSpace(6);
            renderJustLine(line, marginX, textWidth, i === restLines.length - 1);
            y += 5.5;
          });
        }
      });
      y += 5.5;
    });

    // Bloco de assinaturas — sempre na última página
    const assinH = 38;
    if(y + assinH > pageH - 18){ doc.addPage(); y = 20; }
    y += 10;

    const midX = pageW / 2;
    const lineY = y + 22;
    const labelY = lineY + 5;
    const nameY  = labelY + 5;
    const cargoY = nameY + 4.5;

    // Lado esquerdo — professora
    doc.setDrawColor(0); doc.setLineWidth(0.4);
    doc.line(marginX, lineY, midX - 10, lineY);
    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    doc.setTextColor(30,30,30);
    doc.text("Professora", (marginX + midX - 10) / 2, labelY, { align:"center" });

    // Lado direito — coordenadora (imagem da assinatura + nome fixo)
    const sigX = midX + 2;
    const sigW = 38;
    const sigH = 18;
    const sigCenterX = (sigX + pageW - marginX) / 2;
    doc.addImage(APP_ASSETS.assinaturaCoordenadora, "PNG", sigCenterX - sigW/2, lineY - sigH, sigW, sigH);
    doc.line(sigX, lineY, pageW - marginX, lineY);
    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    doc.text("Thayrys Chrystal Lima Machado", (sigX + pageW - marginX) / 2, nameY, { align:"center" });
    doc.setFontSize(9.5);
    doc.text("Coord. Pedagógica", (sigX + pageW - marginX) / 2, cargoY, { align:"center" });

    footers();

    const filename = "Relatorio_" + slug(relatorio.alunoNome) + "_" + (relatorio.ano||currentYear()) + ".pdf";

    // Dentro do app Android (wrapper nativo), salva via ponte Java no
    // armazenamento do aparelho. No navegador/PWA, usa o download padrão.
    if(window.AndroidBridge && typeof window.AndroidBridge.savePdf === "function"){
      const base64 = doc.output("datauristring").split(",")[1];
      window.AndroidBridge.savePdf(base64, filename);
      toast("PDF exportado: " + filename, "success");
    } else {
      doc.save(filename);
      toast("PDF exportado: " + filename, "success");
    }
  }catch(err){
    console.error(err);
    toast("Não foi possível gerar o PDF.", "error");
  }
}

/* ---------------- roteador ---------------- */
function parseHash(){
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  if(parts.length === 0) return { view:"alunos" };
  if(parts[0] === "aluno" && parts[1]) return { view:"alunoDetail", id:Number(parts[1]) };
  if(parts[0] === "relatorio" && parts[1] === "novo" && parts[2]) return { view:"relatorioForm", alunoId:Number(parts[2]) };
  if(parts[0] === "relatorio" && parts[1]) return { view:"relatorioForm", relatorioId:Number(parts[1]) };
  return { view:"alunos" };
}

async function render(){
  const route = parseHash();
  closeModal();
  window.scrollTo(0,0);
  try{
    if(route.view === "alunos") await viewAlunos();
    else if(route.view === "alunoDetail") await viewAlunoDetail(route.id);
    else if(route.view === "relatorioForm") await viewRelatorioForm(route);
  }catch(err){
    console.error(err);
    document.getElementById("app").innerHTML =
      '<div class="empty"><span class="emoji">⚠️</span><h3>Ocorreu um erro</h3><p>'+escapeHtml(err.message||"")+'</p></div>';
  }
}

/* ---------------- inicialização ---------------- */
window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", async ()=>{
  if("serviceWorker" in navigator && location.protocol.indexOf("http") === 0){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }
  try{
    await openDB();
    render();
  }catch(err){
    document.getElementById("app").innerHTML =
      '<div class="empty"><span class="emoji">⚠️</span><h3>Não foi possível abrir o banco de dados local</h3><p>'+escapeHtml(err.message||"")+'</p></div>';
  }
});

})();
