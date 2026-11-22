/* Motor del mediador en el navegador (equivalente al grafo LangGraph de la versión Python).
 *
 *   evaluar → esperar → { REESCRIBIR → evaluar | ENVIAR + bloqueado → rechazar → esperar | ENVIAR → entregar }
 *
 * - Toda versión nueva pasa por la IA antes de poder enviarse.
 * - Un comentario bloqueado no puede enviarse.
 */
"use strict";

const Mediador = (() => {
  const CFG = window.MEDIADOR_CONFIG || {};
  const CRITERIOS = ["especificidad", "tono", "accionabilidad", "equilibrio", "alineacion"];
  const MARCADORES = ["tarea", "trabajo", "borrador", "iteracion", "max_iteraciones", "supera_rondas_sugeridas"];

  // ---------- almacenamiento local (todo protegido: puede fallar en modo privado) ----------
  const local = {
    get(k, def = null) { try { const v = localStorage.getItem("mediador_" + k); return v == null ? def : JSON.parse(v); } catch (_) { return def; } },
    set(k, v) { try { v == null ? localStorage.removeItem("mediador_" + k) : localStorage.setItem("mediador_" + k, JSON.stringify(v)); } catch (_) {} },
  };

  const ajustes = {
    key: () => local.get("openai_key", ""),
    modelo: () => local.get("modelo", "") || CFG.modelo || "gpt-5.4-mini",
    maxIter: () => Number(local.get("max_iteraciones", 0)) || CFG.max_iteraciones || 3,
    modo: () => (local.get("openai_key", "") ? "openai" : "simulado"),
  };

  // ---------- textos (se cargan del sitio) ----------
  const textos = { trabajo: "", rubrica: "", promptRepo: "", ejemplos: [] };
  async function cargarTextos() {
    const leer = async (ruta) => {
      const r = await fetch(ruta + "?v=" + Date.now());
      if (!r.ok) throw new Error(`No se pudo cargar ${ruta} (${r.status})`);
      return r.text();
    };
    [textos.trabajo, textos.rubrica, textos.promptRepo] = await Promise.all([
      leer(CFG.archivo_trabajo || "datos/trabajo_ejemplo.md"),
      leer(CFG.archivo_rubrica || "datos/rubrica.md"),
      leer(CFG.archivo_prompt || "prompts/prompt_mediador.md"),
    ]);
    // Ejemplos de retroalimentación para probar (opcional: si falta el archivo, no hay selector).
    try { textos.ejemplos = JSON.parse(await leer(CFG.archivo_ejemplos || "datos/ejemplos_retroalimentacion.json")); }
    catch (_) { textos.ejemplos = []; }
  }
  const promptActual = () => local.get("prompt_personalizado", null) ?? textos.promptRepo;

  function validarPrompt(texto) {
    const usados = new Set([...texto.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
    const p = [];
    if (!usados.has("borrador")) p.push("Falta el marcador obligatorio {borrador}.");
    const desc = [...usados].filter((u) => !MARCADORES.includes(u));
    if (desc.length) p.push("Marcadores desconocidos (se dejarán tal cual): " + desc.map((d) => `{${d}}`).join(", "));
    return p;
  }

  function construirPrompt(borrador, iteracion, plantilla = null) {
    const max = ajustes.maxIter();
    const valores = { tarea: textos.rubrica, trabajo: textos.trabajo, borrador, iteracion, max_iteraciones: max,
                      supera_rondas_sugeridas: iteracion > max ? "sí" : "no" };
    return (plantilla ?? promptActual()).replace(/\{(\w+)\}/g, (m, k) => (k in valores ? String(valores[k]) : m));
  }

  // ---------- evaluador: OpenAI (salida estructurada) ----------
  const puntaje = { type: "integer", enum: [1, 2, 3, 4] };
  const ESQUEMA = {
    type: "object", additionalProperties: false,
    properties: {
      especificidad: { ...puntaje, description: "1-4 según el criterio Especificidad" },
      tono: { ...puntaje, description: "1-4 según el criterio Tono" },
      accionabilidad: { ...puntaje, description: "1-4 según el criterio Accionabilidad" },
      equilibrio: { ...puntaje, description: "1-4 según el criterio Equilibrio" },
      alineacion: { ...puntaje, description: "1-4 según el criterio Alineación" },
      fortalezas: { type: "string", description: "Qué hace bien el retroalimentador (1-2 frases)" },
      sugerencias: { type: "array", items: { type: "string" }, description: "Máximo 3 sugerencias o preguntas concretas" },
      listo_para_enviar: { type: "boolean", description: "True si el comentario ya es adecuado para enviarse" },
      bloqueado: { type: "boolean", description: "True si contiene insultos, ataques personales, contenido discriminatorio o no es retroalimentación. El sistema impedirá el envío." },
      motivo_bloqueo: { type: "string", description: "Razón objetiva del bloqueo (vacío si no está bloqueado)" },
      mensaje_al_retroalimentador: { type: "string", description: "Texto que verá el estudiante (máx ~120 palabras)" },
    },
  };
  ESQUEMA.required = Object.keys(ESQUEMA.properties);

  async function evaluarOpenAI(prompt) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ajustes.key()}` },
      body: JSON.stringify({
        model: ajustes.modelo(),
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_schema", json_schema: { name: "evaluacion", strict: true, schema: ESQUEMA } },
      }),
    }).catch((e) => { throw new Error("No se pudo conectar con OpenAI: " + e.message); });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data.error?.message || `HTTP ${r.status}`;
      throw new Error(r.status === 401 ? "La API key no es válida (401). Revísala en ⚙️ Opciones generales." : "OpenAI: " + msg);
    }
    const m = data.choices?.[0]?.message;
    if (m?.refusal) throw new Error("El modelo se negó a evaluar: " + m.refusal);
    const ev = JSON.parse(m.content);
    ev.sugerencias = (ev.sugerencias || []).slice(0, 3);
    return ev;
  }

  // ---------- evaluador simulado (sin API): solo ejercita el flujo ----------
  function evaluarSimulado(borrador, iteracion) {
    const t = borrador.trim();
    const ofensivo = /\b(idiota|est[uú]pid[oa]|tont[oa]|imb[eé]cil|in[uú]til|flojo|mediocre|basura|asco|pat[eé]tic[oa]|weon|hue?v[oó]n|ctm|mierda)\b/i.test(t);
    if (ofensivo || t.length < 15) {
      const motivo = ofensivo ? "El texto contiene descalificaciones dirigidas a la persona."
                              : "El texto no es una retroalimentación sobre el trabajo.";
      return { especificidad: 1, tono: 1, accionabilidad: 1, equilibrio: 1, alineacion: 1, fortalezas: "",
               sugerencias: [], listo_para_enviar: false, bloqueado: true, motivo_bloqueo: motivo,
               mensaje_al_retroalimentador: `${motivo} Reescríbelo centrándote en el informe: qué está bien y qué cambio concreto propondrías.` };
    }
    const n = (rx) => (t.match(rx) || []).length;
    const c = (x) => Math.max(1, Math.min(4, x));
    const ev = {
      especificidad: c(1 + Math.floor(n(/(secci[oó]n|tabla|figura|gr[aá]fico|hip[oó]tesis|procedimiento|conclusi[oó]n|an[aá]lisis|resultado|p[aá]rrafo|incertidumbre|\d)/gi) / 2)),
      tono: /(p[eé]simo|horrible|nada sirve|no sirve)/i.test(t) ? 2 : 4,
      accionabilidad: c(1 + n(/(te sugiero|podr[ií]as|propongo|recomiendo|agrega|incluye|revisa|\?)/gi)),
      equilibrio: c(1 + (/(bien|claro|correct|buen|logr|destac|me gust|acierto|fortaleza)/i.test(t) ? 2 : 0) + (/(falta|mejorar|pero|sin embargo|no se|confus|error|deber[ií]as)/i.test(t) ? 1 : 0)),
      alineacion: c(1 + Math.floor(n(/(hip[oó]tesis|procedimiento|reproduc|an[aá]lisis|evidencia|conclusi|gravedad|periodo|incertidumbre|r[uú]brica|criterio)/gi) / 2)),
    };
    const sug = [];
    if (ev.especificidad < 3) sug.push("¿En qué sección, tabla o figura concreta del informe notaste lo que comentas?");
    if (ev.accionabilidad < 3) sug.push("¿Qué cambio concreto le propondrías a tu compañero para la versión final?");
    if (ev.equilibrio < 3) sug.push("¿Hay algo del informe que valga la pena conservar? Díselo para que sepa qué mantener.");
    if (ev.alineacion < 3) sug.push("¿Con qué criterio de la rúbrica se relaciona tu observación?");
    const supera = iteracion > ajustes.maxIter();
    const listo = supera || CRITERIOS.every((k) => ev[k] >= 3);
    return { ...ev, fortalezas: "Tu comentario se centra en el trabajo y no en la persona.",
             sugerencias: supera ? [] : sug.slice(0, 3), listo_para_enviar: listo, bloqueado: false, motivo_bloqueo: "",
             mensaje_al_retroalimentador: listo ? "[Modo simulado] Tu comentario está listo para enviarse. ¡Buen trabajo!"
               : "[Modo simulado] Vas bien: tu comentario es respetuoso. Te dejo algunas preguntas para hacerlo más útil para tu compañero." };
  }

  async function evaluar(borrador, iteracion, plantilla = null) {
    const ev = ajustes.modo() === "simulado" ? evaluarSimulado(borrador, iteracion)
                                             : await evaluarOpenAI(construirPrompt(borrador, iteracion, plantilla));
    ev.puntaje_global = Math.round((CRITERIOS.reduce((s, k) => s + ev[k], 0) / CRITERIOS.length) * 100) / 100;
    return ev;
  }

  // ---------- registro (local + Google Sheets opcional) ----------
  const registro = {
    filas: () => local.get("registro", []),
    agregar(fila) {
      const filas = registro.filas(); filas.push(fila); local.set("registro", filas);
      enviarCentral({ tipo: "iteracion", fila });
    },
    accion(sesion, iteracion, accion) {
      const filas = registro.filas();
      const f = [...filas].reverse().find((x) => x.sesion === sesion && x.iteracion === iteracion);
      if (f) {
        f.accion_retroalimentador = f.accion_retroalimentador ? `${f.accion_retroalimentador} → ${accion}` : accion;
        if (accion === "ENVIAR") f.es_version_final = true;
        local.set("registro", filas);
      }
      enviarCentral({ tipo: "accion", sesion, iteracion, accion });
    },
    borrar: () => local.set("registro", null),
  };
  function enviarCentral(datos) {
    if (!CFG.registro_url) return;
    // text/plain + no-cors: Apps Script no responde a preflight CORS. No hay confirmación de vuelta.
    fetch(CFG.registro_url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" },
                              body: JSON.stringify(datos) }).catch(() => {});
  }

  // ---------- sesión (máquina de estados) ----------
  const ahora = () => new Date().toLocaleString("sv-SE").slice(0, 19);
  let sesion = local.get("sesion", null);
  const guardar = () => local.set("sesion", sesion);

  async function nodoEvaluar() {
    const ev = await evaluar(sesion.borrador, sesion.iteracion);
    sesion.evaluacion = ev;
    sesion.bloqueado = ev.bloqueado;
    sesion.evento = "evaluacion";
    sesion.historial.push({ iteracion: sesion.iteracion, texto: sesion.borrador, evaluacion: ev });
    registro.agregar({
      sesion: sesion.id, fecha_hora: ahora(), retroalimentador: sesion.retroalimentador, destino: sesion.destino,
      iteracion: sesion.iteracion, texto: sesion.borrador, ...Object.fromEntries(CRITERIOS.map((k) => [k, ev[k]])),
      puntaje_global: ev.puntaje_global, listo_para_enviar: ev.listo_para_enviar, bloqueado: ev.bloqueado,
      motivo_bloqueo: ev.motivo_bloqueo, fortalezas: ev.fortalezas,
      sugerencias_IA: ev.sugerencias.map((s) => "- " + s).join("\n"), mensaje_IA: ev.mensaje_al_retroalimentador,
      accion_retroalimentador: "", es_version_final: false, modelo: ajustes.modo() === "simulado" ? "simulado" : ajustes.modelo(),
    });
  }

  async function iniciar(retroalimentador, destino, borrador) {
    const nueva = { id: "web-" + Math.random().toString(36).slice(2, 12), retroalimentador, destino, borrador,
                    iteracion: 1, max_iteraciones: ajustes.maxIter(), historial: [], intentos_bloqueados: 0,
                    terminado: false, evento: null, bloqueado: false, evaluacion: null, mensaje_final: null };
    const previa = sesion;
    sesion = nueva;
    try { await nodoEvaluar(); } catch (e) { sesion = previa; throw e; }
    guardar();
    return sesion;
  }

  async function reescribir(texto) {
    const respaldo = JSON.stringify(sesion);
    registro.accion(sesion.id, sesion.iteracion, "REESCRIBIR");
    sesion.borrador = texto;
    sesion.iteracion += 1;
    try { await nodoEvaluar(); }
    catch (e) { sesion = JSON.parse(respaldo); throw e; }  // si falla la IA, se puede reintentar la misma versión
    guardar();
    return sesion;
  }

  function enviar() {
    if (sesion.bloqueado) {                       // nodo rechazar
      registro.accion(sesion.id, sesion.iteracion, "INTENTO_ENVIO_BLOQUEADO");
      sesion.evento = "rechazo";
      sesion.intentos_bloqueados += 1;
    } else {                                      // nodo entregar
      registro.accion(sesion.id, sesion.iteracion, "ENVIAR");
      sesion.terminado = true;
      sesion.mensaje_final = `Retroalimentación de ${sesion.retroalimentador} sobre tu trabajo:\n\n${sesion.borrador}`;
    }
    guardar();
    return sesion;
  }

  function descartar() { sesion = null; guardar(); }

  return { CFG, CRITERIOS, MARCADORES, local, ajustes, textos, cargarTextos, promptActual, validarPrompt,
           construirPrompt, evaluar, registro, iniciar, reescribir, enviar, descartar, sesion: () => sesion };
})();
