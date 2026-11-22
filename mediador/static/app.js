"use strict";
const $ = (s) => document.querySelector(s);
const CRITERIOS = [["especificidad", "Especificidad"], ["tono", "Tono"], ["accionabilidad", "Accionabilidad"],
                   ["equilibrio", "Equilibrio"], ["alineacion", "Alineación"]];
let INFO = null;
let sesion = null;           // estado devuelto por el servidor
let promptGuardado = "";

// ---------------- utilidades ----------------
async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts,
                               body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `Error ${r.status}`);
  return data;
}
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const md = (t) => (window.marked ? marked.parse(t) : `<pre style="white-space:pre-wrap">${esc(t)}</pre>`);
const guardarLocal = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} };
const leerLocal = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };

async function conCarga(el, fn) {
  el.classList.add("cargando");
  try { return await fn(); } finally { el.classList.remove("cargando"); }
}

/** Diff por palabras (LCS) entre dos versiones, para ver qué cambió en cada ronda. */
function diffPalabras(a, b) {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
  if (A.length * B.length > 400000) return esc(b);
  const m = A.length, n = B.length, L = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
    L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0, out = "";
  while (i < m && j < n) {
    if (A[i] === B[j]) { out += esc(A[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { out += A[i].trim() ? `<del>${esc(A[i])}</del>` : esc(A[i]); i++; }
    else { out += B[j].trim() ? `<ins>${esc(B[j])}</ins>` : esc(B[j]); j++; }
  }
  while (i < m) { out += A[i].trim() ? `<del>${esc(A[i])}</del>` : ""; i++; }
  while (j < n) { out += B[j].trim() ? `<ins>${esc(B[j])}</ins>` : esc(B[j]); j++; }
  return out;
}

function tarjetaEvaluacion(ev, titulo) {
  const n = $("#tpl-eval").content.cloneNode(true);
  const card = n.querySelector(".eval");
  card.querySelector(".eval-titulo").textContent = titulo;
  if (ev.bloqueado) {
    card.classList.add("bloq");
    card.querySelector(".barras").remove();
    card.querySelector(".eval-global").textContent = "🚫 No se puede enviar";
  } else {
    if (ev.listo_para_enviar) card.classList.add("listo");
    card.querySelector(".eval-global").textContent =
      `Promedio ${ev.puntaje_global?.toFixed?.(2) ?? ""}${ev.listo_para_enviar ? " · ✅ listo para enviar" : ""}`;
    card.querySelector(".barras").innerHTML = CRITERIOS.map(([k, nombre]) => {
      const v = ev[k];
      return `<span>${nombre}</span><span class="puntos ${v < 3 ? "bajo" : ""}" title="${v}/4">` +
        [1, 2, 3, 4].map((x) => `<i class="${x <= v ? "on" : ""}"></i>`).join("") + "</span>";
    }).join("");
  }
  card.querySelector(".eval-msg").textContent = ev.mensaje_al_retroalimentador || "";
  card.querySelector(".eval-sug").innerHTML = (ev.sugerencias || []).map((s) => `<li>${esc(s)}</li>`).join("");
  card.querySelector(".eval-fort").textContent = ev.fortalezas && !ev.bloqueado ? `Fortalezas: ${ev.fortalezas}` : "";
  return n;
}

// ---------------- pestañas ----------------
document.querySelectorAll(".tab").forEach((b) => b.onclick = () => {
  document.querySelectorAll(".tab, .panel").forEach((x) => x.classList.remove("activo"));
  b.classList.add("activo");
  $(`#tab-${b.dataset.tab}`).classList.add("activo");
  if (b.dataset.tab === "registro") cargarRegistro();
});
document.querySelectorAll(".subtab").forEach((b) => b.onclick = () => {
  document.querySelectorAll(".subtab, .sub").forEach((x) => x.classList.remove("activo"));
  b.classList.add("activo");
  $(`#${b.dataset.sub}`).classList.add("activo");
});

// ---------------- retroalimentar ----------------
function pintarSesion() {
  const hist = $("#historial");
  hist.innerHTML = "";
  const btnEnviar = $("#btn-enviar"), ta = $("#borrador");
  if (!sesion) {
    $("#ronda").textContent = "";
    $("#editor-titulo").textContent = "Tu comentario";
    btnEnviar.disabled = true;
    $("#entregado").hidden = true;
    $("#editor-box").hidden = false;
    $("#sel-retro").disabled = $("#sel-destino").disabled = false;
    return;
  }
  $("#sel-retro").value = sesion.retroalimentador;
  $("#sel-destino").value = sesion.destino;
  $("#sel-retro").disabled = $("#sel-destino").disabled = true;

  const rondas = sesion.historial || [];
  rondas.forEach((r, idx) => {
    const ultima = idx === rondas.length - 1;
    const cont = document.createElement(ultima ? "div" : "details");
    if (!ultima) {
      cont.className = "ronda";
      cont.innerHTML = `<summary>Ronda ${r.iteracion} · ${r.evaluacion.bloqueado ? "bloqueado" : "promedio " + r.evaluacion.puntaje_global}</summary>`;
    }
    const v = document.createElement("div");
    v.className = "tarjeta";
    const previo = idx > 0 ? rondas[idx - 1].texto : null;
    v.innerHTML = `<div class="editor-cab"><strong>Tu versión ${r.iteracion}</strong>` +
      `${previo ? '<span class="muted small">cambios respecto a la anterior</span>' : ""}</div>` +
      `<div class="version">${previo ? diffPalabras(previo, r.texto) : esc(r.texto)}</div>`;
    cont.appendChild(v);
    const titulo = `Mediador · ronda ${r.iteracion}` + (r.iteracion <= sesion.max_iteraciones ? ` de ${sesion.max_iteraciones}` : "");
    cont.appendChild(tarjetaEvaluacion(r.evaluacion, titulo));
    hist.appendChild(cont);
  });

  if (sesion.terminado) {
    $("#editor-box").hidden = true;
    const e = $("#entregado");
    e.hidden = false;
    const nombre = INFO.estudiantes.find((x) => x.alias === sesion.destino)?.nombre || sesion.destino;
    e.textContent = `✅ Enviado a ${nombre}.\n\n${sesion.mensaje_final}`;
    return;
  }
  $("#editor-box").hidden = false;
  $("#entregado").hidden = true;
  $("#editor-titulo").textContent = "Refina tu comentario";
  const sig = sesion.iteracion + 1;
  $("#ronda").textContent = sesion.iteracion >= sesion.max_iteraciones
    ? `ya usaste las ${sesion.max_iteraciones} rondas sugeridas` : `próxima: ronda ${sig}`;
  actualizarBotones();
}

function actualizarBotones() {
  const ta = $("#borrador"), aviso = $("#aviso");
  $("#contador").textContent = `${ta.value.trim().split(/\s+/).filter(Boolean).length} palabras`;
  if (!sesion || sesion.terminado) { $("#btn-enviar").disabled = true; return; }
  const sinCambios = ta.value.trim() === (sesion.borrador || "").trim();
  $("#btn-enviar").disabled = sesion.bloqueado || !sinCambios;
  $("#btn-revisar").disabled = sinCambios;
  // Si la IA lo da por listo, el botón principal pasa a ser "Enviar".
  const listo = sinCambios && !sesion.bloqueado && sesion.evaluacion?.listo_para_enviar;
  $("#btn-enviar").classList.toggle("sec", !listo);
  $("#btn-revisar").classList.toggle("sec", !!listo);
  aviso.hidden = true;
  if (sesion.bloqueado) {
    mostrarAviso(sesion.evento === "rechazo"
      ? "🚫 No se envió: el comentario fue bloqueado. Reescríbelo centrándote en el trabajo."
      : "🚫 Este comentario no puede enviarse hasta que lo reformules.");
  } else if (!sinCambios) {
    mostrarAviso("Modificaste el comentario: revísalo con la IA antes de enviarlo.", true);
  }
}

function mostrarAviso(t, info = false) {
  const a = $("#aviso");
  a.textContent = t; a.hidden = false; a.classList.toggle("info", info);
}

async function revisar() {
  const texto = $("#borrador").value.trim();
  if (!texto) return mostrarAviso("Escribe tu comentario primero.");
  if (texto.toUpperCase() === "ENVIAR") return mostrarAviso("Usa el botón «Enviar al compañero».", true);
  await conCarga($("#editor-box"), async () => {
    try {
      sesion = sesion
        ? await api(`/api/sesiones/${sesion.thread_id}/responder`, { method: "POST", body: { texto } })
        : await api("/api/sesiones", { method: "POST", body: {
            retroalimentador: $("#sel-retro").value, destino: $("#sel-destino").value, borrador: texto } });
      guardarLocal("mediador_tid", sesion.thread_id);
      pintarSesion();
      $("#historial").lastElementChild?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { mostrarAviso(e.message); }
  });
}

async function enviar() {
  if (!sesion) return;
  await conCarga($("#editor-box"), async () => {
    try {
      sesion = await api(`/api/sesiones/${sesion.thread_id}/responder`, { method: "POST", body: { texto: "ENVIAR" } });
      pintarSesion();
    } catch (e) { mostrarAviso(e.message); }
  });
}

function nueva() {
  sesion = null;
  guardarLocal("mediador_tid", null);
  $("#borrador").value = "";
  pintarSesion();
  actualizarBotones();
  $("#btn-revisar").disabled = false;
}

$("#btn-revisar").onclick = revisar;
$("#btn-enviar").onclick = enviar;
$("#btn-nueva").onclick = nueva;
$("#borrador").addEventListener("input", () => { actualizarBotones(); if (!sesion) $("#btn-revisar").disabled = false; });

// ---------------- prompt ----------------
async function cargarPrompt() {
  const p = await api("/api/prompt");
  promptGuardado = p.texto;
  $("#prompt-texto").value = p.texto;
  $("#marcadores").innerHTML = p.marcadores.map((m) => `<code>{${m}}</code>`).join(" ");
  pintarProblemas(p.problemas);
  estadoPrompt();
}
function pintarProblemas(lista) {
  $("#prompt-problemas").innerHTML = (lista || []).map((x) => `<li>${esc(x)}</li>`).join("");
}
function estadoPrompt() {
  const cambiado = $("#prompt-texto").value !== promptGuardado;
  $("#prompt-estado").textContent = cambiado ? "● cambios sin guardar" : "guardado";
  $("#btn-prompt-guardar").disabled = !cambiado;
  $("#btn-prompt-descartar").disabled = !cambiado;
}
$("#prompt-texto").addEventListener("input", estadoPrompt);
$("#btn-prompt-guardar").onclick = async () => {
  try {
    const r = await api("/api/prompt", { method: "PUT", body: { texto: $("#prompt-texto").value } });
    promptGuardado = $("#prompt-texto").value;
    pintarProblemas(r.problemas);
    estadoPrompt();
  } catch (e) { pintarProblemas([e.message]); }
};
$("#btn-prompt-descartar").onclick = () => { $("#prompt-texto").value = promptGuardado; estadoPrompt(); };
$("#btn-prompt-restaurar").onclick = async () => {
  if (!confirm("¿Reemplazar el prompt actual por la versión original del repositorio?")) return;
  const r = await api("/api/prompt/restaurar", { method: "POST" });
  promptGuardado = r.texto; $("#prompt-texto").value = r.texto; estadoPrompt(); pintarProblemas([]);
};
function cuerpoPrueba() {
  return { texto: $("#prompt-texto").value, borrador: $("#prueba-borrador").value,
           iteracion: parseInt($("#prueba-ronda").value, 10) || 1 };
}
$("#btn-probar").onclick = () => conCarga($(".col-prueba"), async () => {
  const out = $("#prueba-resultado");
  out.innerHTML = "";
  $("#prueba-vista").hidden = true;
  try {
    const ev = await api("/api/prompt/probar", { method: "POST", body: cuerpoPrueba() });
    out.appendChild(tarjetaEvaluacion(ev, ev.modo === "simulado" ? "Resultado (modo simulado: ignora el prompt)" : "Resultado"));
  } catch (e) { out.innerHTML = `<p class="aviso">${esc(e.message)}</p>`; }
});
$("#btn-vista").onclick = async () => {
  const v = $("#prueba-vista");
  if (!v.hidden) { v.hidden = true; return; }
  const r = await api("/api/prompt/vista_previa", { method: "POST", body: cuerpoPrueba() });
  v.textContent = r.prompt; v.hidden = false;
};

// ---------------- registro ----------------
const COLS_REG = ["fecha_hora", "retroalimentador", "destino", "iteracion", "texto", "especificidad", "tono",
                  "accionabilidad", "equilibrio", "alineacion", "puntaje_global", "bloqueado", "motivo_bloqueo",
                  "accion_retroalimentador", "es_version_final"];
async function cargarRegistro() {
  const { filas } = await api("/api/registro");
  const t = $("#tabla-registro");
  if (!filas.length) { t.innerHTML = "<tr><td class='muted'>Aún no hay iteraciones registradas.</td></tr>"; return; }
  t.innerHTML = "<thead><tr>" + COLS_REG.map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>" +
    filas.slice().reverse().map((f) => `<tr class="${f.bloqueado ? "bloq" : f.es_version_final ? "final" : ""}">` +
      COLS_REG.map((c) => `<td class="${c === "texto" ? "texto" : ""}">${esc(f[c] === true ? "sí" : f[c] === false ? "" : f[c])}</td>`).join("") +
      "</tr>").join("") + "</tbody>";
}
$("#btn-reg-actualizar").onclick = cargarRegistro;

// ---------------- inicio ----------------
(async function inicio() {
  INFO = await api("/api/info");
  const chip = $("#modo");
  chip.textContent = INFO.modo === "simulado" ? "Modo simulado (sin API)" : `Modelo: ${INFO.modelo}`;
  chip.classList.toggle("simulado", INFO.modo === "simulado");
  $("#trabajo").innerHTML = md(INFO.trabajo);
  $("#rubrica").innerHTML = md(INFO.rubrica);
  const opts = INFO.estudiantes.map((e) => `<option value="${esc(e.alias)}">${esc(e.nombre)}</option>`).join("");
  $("#sel-retro").innerHTML = opts;
  $("#sel-destino").innerHTML = opts;
  $("#sel-destino").value = INFO.autor_trabajo;
  $("#sel-retro").value = INFO.estudiantes.find((e) => e.alias !== INFO.autor_trabajo)?.alias;

  const tid = leerLocal("mediador_tid");
  if (tid) {
    try {
      sesion = await api(`/api/sesiones/${tid}`);
      if (!sesion.terminado) $("#borrador").value = sesion.borrador || "";
    } catch (_) { sesion = null; guardarLocal("mediador_tid", null); }
  }
  pintarSesion();
  actualizarBotones();
  if (!sesion) $("#btn-revisar").disabled = false;
  cargarPrompt();
})();
