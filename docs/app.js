"use strict";
const $ = (s) => document.querySelector(s);
const M = Mediador;
const NOMBRES = { especificidad: "Especificidad", tono: "Tono", accionabilidad: "Accionabilidad",
                  equilibrio: "Equilibrio", alineacion: "Alineación" };

// ---------------- utilidades ----------------
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const md = (t) => (window.marked ? marked.parse(t) : `<pre style="white-space:pre-wrap">${esc(t)}</pre>`);
async function conCarga(el, fn) {
  el.classList.add("cargando");
  try { return await fn(); } finally { el.classList.remove("cargando"); }
}
function descargar(nombre, contenido, tipo) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Diff por palabras (LCS) entre dos versiones. */
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
      `Promedio ${ev.puntaje_global.toFixed(2)}${ev.listo_para_enviar ? " · ✅ listo para enviar" : ""}`;
    card.querySelector(".barras").innerHTML = M.CRITERIOS.map((k) => {
      const v = ev[k];
      return `<span>${NOMBRES[k]}</span><span class="puntos ${v < 3 ? "bajo" : ""}" title="${v}/4">` +
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
  if (b.dataset.tab === "registro") pintarRegistro();
});
document.querySelectorAll(".subtab").forEach((b) => b.onclick = () => {
  document.querySelectorAll(".subtab, .sub").forEach((x) => x.classList.remove("activo"));
  b.classList.add("activo");
  $(`#${b.dataset.sub}`).classList.add("activo");
});

// ---------------- retroalimentar ----------------
function pintarSesion() {
  const s = M.sesion();
  const hist = $("#historial");
  hist.innerHTML = "";
  $("#in-nombre").disabled = !!s;
  if (!s) {
    $("#ronda").textContent = "";
    $("#editor-titulo").textContent = "Tu comentario";
    $("#entregado").hidden = true;
    $("#editor-box").hidden = false;
    actualizarBotones();
    return;
  }
  $("#in-nombre").value = s.retroalimentador;
  s.historial.forEach((r, idx) => {
    const ultima = idx === s.historial.length - 1;
    const cont = document.createElement(ultima ? "div" : "details");
    if (!ultima) {
      cont.className = "ronda";
      cont.innerHTML = `<summary>Ronda ${r.iteracion} · ${r.evaluacion.bloqueado ? "bloqueado" : "promedio " + r.evaluacion.puntaje_global}</summary>`;
    }
    const v = document.createElement("div");
    v.className = "tarjeta";
    const previo = idx > 0 ? s.historial[idx - 1].texto : null;
    v.innerHTML = `<div class="editor-cab"><strong>Tu versión ${r.iteracion}</strong>` +
      `${previo ? '<span class="muted small">cambios respecto a la anterior</span>' : ""}</div>` +
      `<div class="version">${previo ? diffPalabras(previo, r.texto) : esc(r.texto)}</div>`;
    cont.appendChild(v);
    cont.appendChild(tarjetaEvaluacion(r.evaluacion,
      `Mediador · ronda ${r.iteracion}` + (r.iteracion <= s.max_iteraciones ? ` de ${s.max_iteraciones}` : "")));
    hist.appendChild(cont);
  });
  if (s.terminado) {
    $("#editor-box").hidden = true;
    $("#entregado").hidden = false;
    $("#entregado").textContent = `✅ Enviado a ${s.destino}.\n\n${s.mensaje_final}`;
    return;
  }
  $("#editor-box").hidden = false;
  $("#entregado").hidden = true;
  $("#editor-titulo").textContent = "Refina tu comentario";
  $("#ronda").textContent = s.iteracion >= s.max_iteraciones
    ? `ya usaste las ${s.max_iteraciones} rondas sugeridas` : `próxima: ronda ${s.iteracion + 1}`;
  actualizarBotones();
}

function mostrarAviso(t, info = false) {
  const a = $("#aviso");
  a.textContent = t; a.hidden = false; a.classList.toggle("info", info);
}

function actualizarBotones() {
  const s = M.sesion(), ta = $("#borrador");
  $("#contador").textContent = `${ta.value.trim().split(/\s+/).filter(Boolean).length} palabras`;
  $("#aviso").hidden = true;
  if (!s || s.terminado) {
    $("#btn-enviar").disabled = true;
    $("#btn-revisar").disabled = false;
    $("#btn-enviar").classList.add("sec"); $("#btn-revisar").classList.remove("sec");
    return;
  }
  const sinCambios = ta.value.trim() === s.borrador.trim();
  const listo = sinCambios && !s.bloqueado && s.evaluacion?.listo_para_enviar;
  $("#btn-enviar").disabled = s.bloqueado || !sinCambios;
  $("#btn-revisar").disabled = sinCambios;
  $("#btn-enviar").classList.toggle("sec", !listo);
  $("#btn-revisar").classList.toggle("sec", !!listo);
  if (s.bloqueado) {
    mostrarAviso(s.evento === "rechazo"
      ? "🚫 No se envió: el comentario fue bloqueado. Reescríbelo centrándote en el trabajo."
      : "🚫 Este comentario no puede enviarse hasta que lo reformules.");
  } else if (!sinCambios) {
    mostrarAviso("Modificaste el comentario: revísalo con la IA antes de enviarlo.", true);
  }
}

async function revisar() {
  const texto = $("#borrador").value.trim();
  const nombre = $("#in-nombre").value.trim();
  if (!nombre) return mostrarAviso("Escribe tu nombre primero.");
  if (!texto) return mostrarAviso("Escribe tu comentario primero.");
  M.local.set("nombre", nombre);
  await conCarga($("#editor-box"), async () => {
    try {
      const s = M.sesion();
      if (s && !s.terminado) await M.reescribir(texto);
      else await M.iniciar(nombre, M.CFG.autor_trabajo || "compañero", texto);
      pintarSesion();
      $("#historial").lastElementChild?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { mostrarAviso(e.message); }
  });
}

$("#btn-revisar").onclick = revisar;
$("#btn-enviar").onclick = () => { M.enviar(); pintarSesion(); if (M.sesion()?.bloqueado) actualizarBotones(); };
$("#btn-nueva").onclick = () => {
  const s = M.sesion();
  if (s && !s.terminado && !confirm("¿Descartar la retroalimentación en curso?")) return;
  M.descartar(); $("#borrador").value = ""; pintarSesion();
};
$("#borrador").addEventListener("input", actualizarBotones);

// ---------------- prompt ----------------
let promptGuardado = "";
function cargarPromptEditor() {
  promptGuardado = M.promptActual();
  $("#prompt-texto").value = promptGuardado;
  $("#marcadores").innerHTML = M.MARCADORES.map((m) => `<code>{${m}}</code>`).join(" ");
  estadoPrompt();
}
function estadoPrompt() {
  const txt = $("#prompt-texto").value;
  const cambiado = txt !== promptGuardado;
  const personalizado = M.local.get("prompt_personalizado", null) != null;
  $("#prompt-estado").textContent = cambiado ? "● cambios sin guardar"
    : personalizado ? "versión personalizada (este navegador)" : "versión del repositorio";
  $("#btn-prompt-guardar").disabled = !cambiado;
  $("#btn-prompt-descartar").disabled = !cambiado;
  $("#prompt-problemas").innerHTML = M.validarPrompt(txt).map((x) => `<li>${esc(x)}</li>`).join("");
}
$("#prompt-texto").addEventListener("input", estadoPrompt);
$("#btn-prompt-guardar").onclick = () => {
  const txt = $("#prompt-texto").value;
  if (M.validarPrompt(txt).some((x) => x.startsWith("Falta"))) return alert("El prompt debe incluir {borrador}.");
  M.local.set("prompt_personalizado", txt === M.textos.promptRepo ? null : txt);
  promptGuardado = txt; estadoPrompt();
};
$("#btn-prompt-descartar").onclick = () => { $("#prompt-texto").value = promptGuardado; estadoPrompt(); };
$("#btn-prompt-restaurar").onclick = () => {
  if (!confirm("¿Reemplazar el prompt del editor por el publicado en el repositorio?")) return;
  M.local.set("prompt_personalizado", null);
  cargarPromptEditor();
};
$("#btn-prompt-descargar").onclick = () =>
  descargar("prompt_mediador.md", $("#prompt-texto").value, "text/markdown;charset=utf-8");

const rondaPrueba = () => parseInt($("#prueba-ronda").value, 10) || 1;
$("#btn-probar").onclick = () => conCarga($(".col-prueba"), async () => {
  const out = $("#prueba-resultado");
  out.innerHTML = ""; $("#prueba-vista").hidden = true;
  try {
    const ev = await M.evaluar($("#prueba-borrador").value, rondaPrueba(), $("#prompt-texto").value);
    out.appendChild(tarjetaEvaluacion(ev, M.ajustes.modo() === "simulado"
      ? "Resultado (modo simulado: ignora el prompt; configura una API key)" : "Resultado"));
  } catch (e) { out.innerHTML = `<p class="aviso">${esc(e.message)}</p>`; }
});
$("#btn-vista").onclick = () => {
  const v = $("#prueba-vista");
  if (!v.hidden) { v.hidden = true; return; }
  v.textContent = M.construirPrompt($("#prueba-borrador").value, rondaPrueba(), $("#prompt-texto").value);
  v.hidden = false;
};

// ---------------- registro ----------------
const COLS_REG = ["sesion", "fecha_hora", "retroalimentador", "destino", "iteracion", "texto", "especificidad", "tono",
  "accionabilidad", "equilibrio", "alineacion", "puntaje_global", "listo_para_enviar", "bloqueado", "motivo_bloqueo",
  "fortalezas", "sugerencias_IA", "mensaje_IA", "accion_retroalimentador", "es_version_final", "modelo"];
const COLS_TABLA = COLS_REG.filter((c) => !["sesion", "fortalezas", "sugerencias_IA", "mensaje_IA", "listo_para_enviar"].includes(c));
function pintarRegistro() {
  const filas = M.registro.filas();
  $("#reg-central").textContent = M.CFG.registro_url
    ? "📤 Cada iteración también se envía al registro central (Google Sheet del profesor)."
    : "Solo se guarda en este navegador. Para reunir el registro de todos los estudiantes, configura registro_url en docs/config.js (ver README).";
  const t = $("#tabla-registro");
  if (!filas.length) { t.innerHTML = "<tr><td class='muted'>Aún no hay iteraciones registradas.</td></tr>"; return; }
  t.innerHTML = "<thead><tr>" + COLS_TABLA.map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>" +
    filas.slice().reverse().map((f) => `<tr class="${f.bloqueado ? "bloq" : f.es_version_final ? "final" : ""}">` +
      COLS_TABLA.map((c) => `<td class="${c === "texto" ? "texto" : ""}">${esc(f[c] === true ? "sí" : f[c] === false ? "" : f[c])}</td>`).join("") +
      "</tr>").join("") + "</tbody>";
}
$("#btn-reg-descargar").onclick = () => {
  const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [COLS_REG.join(";"), ...M.registro.filas().map((f) => COLS_REG.map((c) => celda(f[c])).join(";"))].join("\r\n");
  descargar("registro_retroalimentacion.csv", "﻿" + csv, "text/csv;charset=utf-8");  // BOM: Excel lee bien los acentos
};
$("#btn-reg-borrar").onclick = () => {
  if (confirm("¿Borrar el registro guardado en este navegador? (No afecta al registro central.)")) { M.registro.borrar(); pintarRegistro(); }
};

// ---------------- ejemplos de retroalimentación ----------------
let EJEMPLOS = [];
function configurarEjemplos(lista) {
  EJEMPLOS = lista || [];
  document.querySelectorAll(".sel-ejemplo").forEach((sel) => {
    sel.closest(".ejemplo-fila").hidden = !EJEMPLOS.length;
    sel.innerHTML = `<option value="">📋 Cargar un ejemplo…</option>` +
      EJEMPLOS.map((e, i) => `<option value="${i}">${esc(e.titulo)}</option>`).join("");
    sel.onchange = () => {
      const e = EJEMPLOS[sel.value];
      if (!e) return;
      const ta = $(sel.dataset.destino);
      ta.value = e.texto;
      ta.dispatchEvent(new Event("input"));
      $(sel.dataset.nota).textContent = e.esperado ? `Esperado: ${e.esperado}` : "";
      sel.value = "";
    };
  });
  const btn = $("#btn-probar-todos");
  if (btn) btn.hidden = !EJEMPLOS.length;
}

/** Evalúa todos los ejemplos (uno tras otro) y muestra una tabla comparativa con lo esperado. */
async function probarTodosLosEjemplos(evaluarFn) {
  const cont = $("#prueba-todos");
  const resultados = [];
  const corto = { especificidad: "Esp", tono: "Tono", accionabilidad: "Acc", equilibrio: "Equ", alineacion: "Ali" };
  const pintar = (enCurso) => {
    cont.innerHTML = `<table class="tabla-ejemplos"><thead><tr><th>Ejemplo</th>` +
      Object.values(corto).map((c) => `<th>${c}</th>`).join("") + `<th>Prom.</th><th>Estado</th><th>Esperado</th></tr></thead><tbody>` +
      resultados.map((r, i) => {
        if (r.error) return `<tr><td>${esc(r.ej.titulo)}</td><td colspan="8" class="aviso">${esc(r.error)}</td></tr>`;
        const ev = r.ev;
        return `<tr data-i="${i}" class="${ev.bloqueado ? "bloq" : ""}" title="Clic para ver el detalle"><td>${esc(r.ej.titulo)}</td>` +
          Object.keys(corto).map((k) => `<td class="n ${ev[k] < 3 ? "b2" : ""}">${ev[k]}</td>`).join("") +
          `<td class="n">${ev.puntaje_global.toFixed(2)}</td>` +
          `<td>${ev.bloqueado ? "🚫 bloqueado" : ev.listo_para_enviar ? "✅ listo" : "✏️ mejorar"}</td>` +
          `<td class="muted">${esc(r.ej.esperado || "")}</td></tr>`;
      }).join("") +
      (enCurso ? `<tr><td colspan="9" class="muted">Evaluando ${resultados.length + 1} de ${EJEMPLOS.length}…</td></tr>` : "") +
      "</tbody></table>";
    cont.querySelectorAll("tr[data-i]").forEach((tr) => tr.onclick = () => {
      const r = resultados[tr.dataset.i];
      $("#prueba-borrador").value = r.ej.texto;
      $("#nota-prueba").textContent = r.ej.esperado ? `Esperado: ${r.ej.esperado}` : "";
      $("#prueba-resultado").innerHTML = "";
      $("#prueba-resultado").appendChild(tarjetaEvaluacion(r.ev, `Resultado · ${r.ej.titulo}`));
    });
  };
  const btn = $("#btn-probar-todos");
  btn.disabled = true;
  try {
    for (const ej of EJEMPLOS) {
      pintar(true);
      try { resultados.push({ ej, ev: await evaluarFn(ej.texto) }); }
      catch (e) { resultados.push({ ej, error: e.message }); }
    }
    pintar(false);
  } finally { btn.disabled = false; }
}
$("#btn-probar-todos").onclick = () => {
  if (M.ajustes.modo() !== "simulado" && !confirm(`Se harán ${EJEMPLOS.length} llamadas a OpenAI con el prompt del editor. ¿Continuar?`)) return;
  probarTodosLosEjemplos((texto) => M.evaluar(texto, rondaPrueba(), $("#prompt-texto").value));
};

// ---------------- configuración (API key) ----------------
function pintarModo() {
  const chip = $("#modo"), sim = M.ajustes.modo() === "simulado";
  chip.textContent = sim ? "Modo simulado (sin API)" : `Modelo: ${M.ajustes.modelo()}`;
  chip.classList.toggle("simulado", sim);
  chip.classList.toggle("sinclave", sim);
}
$("#modo").onclick = () => {
  const k = M.ajustes.key();
  $("#cfg-key").value = "";
  $("#cfg-key").placeholder = k ? `configurada: ${k.slice(0, 3)}…${k.slice(-4)} (escribe otra para cambiarla)` : "sk-...";
  $("#cfg-modelo").value = M.ajustes.modelo();
  $("#cfg-rondas").value = M.ajustes.maxIter();
  $("#btn-cfg-quitar").hidden = $("#btn-cfg-enlace").hidden = !k;
  $("#cfg-msg").textContent = "";
  $("#dlg-config").showModal();
};
$("#btn-cfg-guardar").onclick = () => {
  const k = $("#cfg-key").value.trim();
  if (k && !k.startsWith("sk-")) { $("#cfg-msg").textContent = "La API key de OpenAI debería empezar con «sk-»."; return; }
  if (k) M.local.set("openai_key", k);
  const modelo = $("#cfg-modelo").value.trim();
  M.local.set("modelo", modelo && modelo !== M.CFG.modelo ? modelo : null);
  const r = parseInt($("#cfg-rondas").value, 10);
  M.local.set("max_iteraciones", r && r !== M.CFG.max_iteraciones ? r : null);
  pintarModo();
  $("#dlg-config").close();
};
$("#btn-cfg-quitar").onclick = () => { M.local.set("openai_key", null); pintarModo(); $("#dlg-config").close(); };
$("#btn-cfg-enlace").onclick = async () => {
  const url = `${location.origin}${location.pathname}#key=${encodeURIComponent(M.ajustes.key())}`;
  try { await navigator.clipboard.writeText(url); $("#cfg-msg").textContent = "Enlace copiado. Quien lo abra queda con la key configurada: compártelo solo por un canal privado."; }
  catch (_) { prompt("Copia este enlace:", url); }
};

/** Un enlace …/#key=sk-… configura la key en este navegador. El fragmento (#) no se envía a GitHub. */
function leerKeyDelEnlace() {
  const m = location.hash.match(/key=([^&]+)/);
  if (!m) return;
  const k = decodeURIComponent(m[1]);
  if (k.startsWith("sk-")) M.local.set("openai_key", k);
  history.replaceState(null, "", location.pathname + location.search);  // la quita de la barra de direcciones
  pintarModo();
}
window.addEventListener("hashchange", leerKeyDelEnlace);

// ---------------- inicio ----------------
(async function inicio() {
  leerKeyDelEnlace();
  pintarModo();
  $("#in-destino").value = M.CFG.autor_trabajo || "";
  $("#in-nombre").value = M.local.get("nombre", "");
  try {
    await M.cargarTextos();
  } catch (e) {
    $("#trabajo").innerHTML = `<p class="aviso">${esc(e.message)}. Si abriste el archivo directamente (file://), sírvelo con un servidor: <code>python -m http.server -d docs</code>.</p>`;
    return;
  }
  $("#trabajo").innerHTML = md(M.textos.trabajo);
  $("#rubrica").innerHTML = md(M.textos.rubrica);
  configurarEjemplos(M.textos.ejemplos);
  const s = M.sesion();
  if (s && !s.terminado) $("#borrador").value = s.borrador;
  pintarSesion();
  cargarPromptEditor();
})();
