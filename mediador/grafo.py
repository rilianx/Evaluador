"""Grafo LangGraph: evaluar → esperar (interrupt) → decidir → evaluar | rechazar | entregar.

Un comentario bloqueado no puede enviarse aunque el estudiante escriba ENVIAR: pasa a `rechazar`
y vuelve a esperar una nueva versión. Toda versión nueva pasa por la IA antes de poder enviarse.
"""
import operator
import sqlite3
import threading
from typing import Annotated, Any, Dict, List, Literal, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from . import registro
from .config import ARCHIVO_DB, MAX_ITERACIONES
from .evaluador import evaluar_borrador


class Estado(TypedDict, total=False):
    retroalimentador: str
    destino: str
    borrador: str
    iteracion: int
    max_iteraciones: int
    evaluacion: Dict[str, Any]
    bloqueado: bool
    intentos_bloqueados: int
    evento: Literal["evaluacion", "rechazo"]
    respuesta: Literal["ENVIAR", "REESCRIBIR"]
    historial: Annotated[List[Dict[str, Any]], operator.add]
    mensaje_final: str


def _tid(config: RunnableConfig) -> str:
    return config["configurable"]["thread_id"]


def nodo_evaluar(state: Estado, config: RunnableConfig) -> Estado:
    ev = evaluar_borrador(state["borrador"], state["iteracion"], state["max_iteraciones"])
    registro.registrar_iteracion(_tid(config), state["retroalimentador"], state["destino"],
                                 state["iteracion"], state["borrador"], ev)
    evaluacion = ev.model_dump() | {"puntaje_global": ev.puntaje_global}
    return {
        "evaluacion": evaluacion,
        "bloqueado": ev.bloqueado,
        "evento": "evaluacion",
        "historial": [{"iteracion": state["iteracion"], "texto": state["borrador"], "evaluacion": evaluacion}],
    }


def nodo_esperar(state: Estado, config: RunnableConfig) -> Estado:
    respuesta = interrupt({"evento": state["evento"]})
    texto = (respuesta or "").strip()
    if texto.upper() in ("ENVIAR", "/ENVIAR"):
        return {"respuesta": "ENVIAR"}
    registro.actualizar_accion(_tid(config), state["iteracion"], "REESCRIBIR")
    return {"respuesta": "REESCRIBIR", "borrador": texto, "iteracion": state["iteracion"] + 1}


def decidir(state: Estado) -> str:
    if state["respuesta"] == "REESCRIBIR":
        return "evaluar"
    return "rechazar" if state.get("bloqueado") else "entregar"


def nodo_rechazar(state: Estado, config: RunnableConfig) -> Estado:
    registro.actualizar_accion(_tid(config), state["iteracion"], "INTENTO_ENVIO_BLOQUEADO")
    return {"evento": "rechazo", "intentos_bloqueados": state.get("intentos_bloqueados", 0) + 1}


def nodo_entregar(state: Estado, config: RunnableConfig) -> Estado:
    registro.actualizar_accion(_tid(config), state["iteracion"], "ENVIAR")
    registro.registrar_final(_tid(config), state["iteracion"])
    return {"mensaje_final": f"Retroalimentación de {state['retroalimentador']} sobre tu trabajo:\n\n"
                             f"{state['borrador']}"}


def construir_grafo(checkpointer):
    g = StateGraph(Estado)
    g.add_node("evaluar", nodo_evaluar)
    g.add_node("esperar", nodo_esperar)
    g.add_node("rechazar", nodo_rechazar)
    g.add_node("entregar", nodo_entregar)
    g.add_edge(START, "evaluar")
    g.add_edge("evaluar", "esperar")
    g.add_conditional_edges("esperar", decidir,
                            {"evaluar": "evaluar", "rechazar": "rechazar", "entregar": "entregar"})
    g.add_edge("rechazar", "esperar")
    g.add_edge("entregar", END)
    return g.compile(checkpointer=checkpointer)


_conn = sqlite3.connect(ARCHIVO_DB, check_same_thread=False)
grafo = construir_grafo(SqliteSaver(_conn))
_lock = threading.Lock()  # SQLite + un solo proceso: serializamos las ejecuciones del grafo


# ---------------------------------------------------------------------------
# API usada por la web, la consola y Telegram
# ---------------------------------------------------------------------------
def _cfg(thread_id):
    return {"configurable": {"thread_id": thread_id}}


def iniciar_sesion(thread_id: str, retroalimentador: str, destino: str, borrador: str) -> dict:
    estado = {"retroalimentador": retroalimentador, "destino": destino, "borrador": borrador,
              "iteracion": 1, "max_iteraciones": MAX_ITERACIONES,
              "intentos_bloqueados": 0, "historial": []}
    with _lock:
        grafo.invoke(estado, _cfg(thread_id))
    return estado_sesion(thread_id)


def continuar_sesion(thread_id: str, respuesta: str) -> dict:
    """`respuesta` es "ENVIAR" o el texto de una nueva versión."""
    with _lock:
        grafo.invoke(Command(resume=respuesta), _cfg(thread_id))
    return estado_sesion(thread_id)


def estado_sesion(thread_id: str) -> dict | None:
    snap = grafo.get_state(_cfg(thread_id))
    v = snap.values
    if not v:
        return None
    return {
        "thread_id": thread_id,
        "terminado": not snap.next,
        "evento": v.get("evento"),
        "bloqueado": bool(v.get("bloqueado")),
        "iteracion": v.get("iteracion"),
        "max_iteraciones": v.get("max_iteraciones"),
        "retroalimentador": v.get("retroalimentador"),
        "destino": v.get("destino"),
        "borrador": v.get("borrador"),
        "evaluacion": v.get("evaluacion"),
        "historial": v.get("historial", []),
        "mensaje_final": v.get("mensaje_final"),
    }
