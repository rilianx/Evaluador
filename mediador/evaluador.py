"""Modelo evaluador: puntúa el borrador en cinco criterios y genera sugerencias.

Modo "openai": gpt-5.4-mini (configurable) con salida estructurada.
Modo "simulado": heurísticas locales, sin API, solo para probar la interfaz y el flujo.
"""
import re
from typing import List

from pydantic import BaseModel, Field

from . import config, contenido

CRITERIOS = ["especificidad", "tono", "accionabilidad", "equilibrio", "alineacion"]


class Evaluacion(BaseModel):
    """Evaluación de la IA sobre el borrador de retroalimentación."""
    especificidad: int = Field(ge=1, le=4, description="1-4 según el criterio Especificidad")
    tono: int = Field(ge=1, le=4, description="1-4 según el criterio Tono")
    accionabilidad: int = Field(ge=1, le=4, description="1-4 según el criterio Accionabilidad")
    equilibrio: int = Field(ge=1, le=4, description="1-4 según el criterio Equilibrio")
    alineacion: int = Field(ge=1, le=4, description="1-4 según el criterio Alineación")
    fortalezas: str = Field(description="Qué hace bien el retroalimentador (1-2 frases)")
    sugerencias: List[str] = Field(description="Máximo 3 sugerencias o preguntas concretas", max_length=3)
    listo_para_enviar: bool = Field(description="True si el comentario ya es adecuado para enviarse")
    bloqueado: bool = Field(description="True si contiene insultos, ataques personales, contenido "
                                        "discriminatorio o no es retroalimentación. El sistema impedirá el envío.")
    motivo_bloqueo: str = Field(default="", description="Razón objetiva del bloqueo (vacío si no está bloqueado)")
    mensaje_al_retroalimentador: str = Field(description="Texto que verá el estudiante (máx ~120 palabras)")

    @property
    def puntaje_global(self) -> float:
        return round(sum(getattr(self, c) for c in CRITERIOS) / len(CRITERIOS), 2)


def construir_prompt(borrador: str, iteracion: int, max_iteraciones: int,
                     tarea: str | None = None, trabajo: str | None = None,
                     plantilla: str | None = None) -> str:
    return contenido.rellenar_prompt(
        plantilla if plantilla is not None else contenido.leer_prompt(),
        tarea=tarea if tarea is not None else contenido.leer_rubrica(),
        trabajo=trabajo if trabajo is not None else contenido.leer_trabajo(),
        borrador=borrador, iteracion=iteracion, max_iteraciones=max_iteraciones,
        supera_rondas_sugeridas="sí" if iteracion > max_iteraciones else "no",
    )


_evaluador_llm = None


def _llm():
    global _evaluador_llm
    if _evaluador_llm is None:
        from langchain_openai import ChatOpenAI
        _evaluador_llm = ChatOpenAI(model=config.MODELO).with_structured_output(Evaluacion)
    return _evaluador_llm


def evaluar_borrador(borrador: str, iteracion: int, max_iteraciones: int,
                     tarea: str | None = None, trabajo: str | None = None,
                     plantilla: str | None = None) -> Evaluacion:
    """El prompt se lee del archivo en cada llamada: los cambios hechos en la interfaz aplican de inmediato.
    `plantilla` permite probar un prompt sin guardarlo."""
    if config.MODO == "simulado":
        return evaluar_simulado(borrador, iteracion, max_iteraciones)
    return _llm().invoke(construir_prompt(borrador, iteracion, max_iteraciones, tarea, trabajo, plantilla))


# ---------------------------------------------------------------------------
# Evaluador simulado (sin API). No pretende ser bueno: solo ejercita el flujo.
# ---------------------------------------------------------------------------
_OFENSIVAS = re.compile(r"\b(idiota|est[uú]pid[oa]|tont[oa]|imb[eé]cil|in[uú]til|flojo|mediocre|"
                        r"basura|asco|pat[eé]tic[oa]|weon|hue?v[oó]n|ctm|mierda)\b", re.I)
_CONCRETO = re.compile(r"(secci[oó]n|tabla|figura|gr[aá]fico|hip[oó]tesis|procedimiento|conclusi[oó]n|"
                       r"an[aá]lisis|resultado|p[aá]rrafo|incertidumbre|\d)", re.I)
_ACCION = re.compile(r"(te sugiero|podr[ií]as|propongo|recomiendo|agrega|incluye|revisa|\?)", re.I)
_POSITIVO = re.compile(r"(bien|claro|correct|buen|logr|destac|me gust|acierto|fortaleza)", re.I)
_NEGATIVO = re.compile(r"(falta|mejorar|pero|sin embargo|no se|confus|error|deber[ií]as)", re.I)
_RUBRICA = re.compile(r"(hip[oó]tesis|procedimiento|reproduc|an[aá]lisis|evidencia|conclusi|g\b|gravedad|"
                      r"periodo|incertidumbre|r[uú]brica|criterio)", re.I)


def evaluar_simulado(borrador: str, iteracion: int, max_iteraciones: int) -> Evaluacion:
    t = borrador.strip()
    if _OFENSIVAS.search(t) or len(t) < 15:
        motivo = ("El texto contiene descalificaciones dirigidas a la persona."
                  if _OFENSIVAS.search(t) else "El texto no es una retroalimentación sobre el trabajo.")
        return Evaluacion(especificidad=1, tono=1, accionabilidad=1, equilibrio=1, alineacion=1,
                          fortalezas="", sugerencias=[], listo_para_enviar=False, bloqueado=True,
                          motivo_bloqueo=motivo,
                          mensaje_al_retroalimentador=f"{motivo} Reescríbelo centrándote en el informe: "
                                                      "qué está bien y qué cambio concreto propondrías.")
    n = lambda rx: len(rx.findall(t))
    clamp = lambda x: max(1, min(4, x))
    ev = dict(
        especificidad=clamp(1 + n(_CONCRETO) // 2),
        tono=4 if not re.search(r"(p[eé]simo|horrible|nada sirve|no sirve)", t, re.I) else 2,
        accionabilidad=clamp(1 + n(_ACCION)),
        equilibrio=clamp(1 + (2 if _POSITIVO.search(t) else 0) + (1 if _NEGATIVO.search(t) else 0)),
        alineacion=clamp(1 + n(_RUBRICA) // 2),
    )
    sugerencias = []
    if ev["especificidad"] < 3:
        sugerencias.append("¿En qué sección, tabla o figura concreta del informe notaste lo que comentas?")
    if ev["accionabilidad"] < 3:
        sugerencias.append("¿Qué cambio concreto le propondrías a tu compañero para la versión final?")
    if ev["equilibrio"] < 3:
        sugerencias.append("¿Hay algo del informe que valga la pena conservar? Díselo para que sepa qué mantener.")
    if ev["alineacion"] < 3 and len(sugerencias) < 3:
        sugerencias.append("¿Con qué criterio de la rúbrica se relaciona tu observación?")
    supera = iteracion > max_iteraciones
    listo = supera or all(v >= 3 for v in ev.values())
    if supera:
        sugerencias = []
    return Evaluacion(
        **ev, fortalezas="Tu comentario se centra en el trabajo y no en la persona.",
        sugerencias=sugerencias[:3], listo_para_enviar=listo, bloqueado=False, motivo_bloqueo="",
        mensaje_al_retroalimentador=(
            "[Modo simulado] Tu comentario está listo para enviarse. ¡Buen trabajo!" if listo else
            "[Modo simulado] Vas bien: tu comentario es respetuoso. Te dejo algunas preguntas para "
            "hacerlo más útil para tu compañero."),
    )
