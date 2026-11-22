"""Registro en Excel para el profesor: una fila por cada borrador evaluado."""
import datetime as dt
import threading

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from . import config

COLUMNAS = [
    "thread_id", "fecha_hora", "retroalimentador", "destino", "iteracion",
    "texto", "especificidad", "tono", "accionabilidad", "equilibrio", "alineacion",
    "puntaje_global", "listo_para_enviar", "bloqueado", "motivo_bloqueo",
    "fortalezas", "sugerencias_IA", "mensaje_IA", "accion_retroalimentador", "es_version_final",
]
ANCHOS = {"texto": 60, "motivo_bloqueo": 35, "fortalezas": 40, "sugerencias_IA": 50,
          "mensaje_IA": 50, "fecha_hora": 19}
_lock = threading.Lock()


def _abrir():
    if config.ARCHIVO_XLSX.exists():
        wb = load_workbook(config.ARCHIVO_XLSX)
        return wb, wb["iteraciones"]
    wb = Workbook()
    ws = wb.active
    ws.title = "iteraciones"
    ws.append(COLUMNAS)
    for i, col in enumerate(COLUMNAS, start=1):
        c = ws.cell(row=1, column=i)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="2F5496")
        ws.column_dimensions[get_column_letter(i)].width = ANCHOS.get(col, 16)
    ws.freeze_panes = "A2"
    return wb, ws


def registrar_iteracion(thread_id, retroalimentador, destino, iteracion, texto, ev):
    with _lock:
        wb, ws = _abrir()
        ws.append([
            thread_id, dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            retroalimentador, destino, iteracion, texto,
            ev.especificidad, ev.tono, ev.accionabilidad, ev.equilibrio, ev.alineacion,
            ev.puntaje_global, ev.listo_para_enviar, ev.bloqueado, ev.motivo_bloqueo,
            ev.fortalezas, "\n".join(f"- {s}" for s in ev.sugerencias), ev.mensaje_al_retroalimentador,
            "", False,
        ])
        for c in ws[ws.max_row]:
            c.alignment = Alignment(wrap_text=True, vertical="top")
        wb.save(config.ARCHIVO_XLSX)


def _fila(ws, thread_id, iteracion):
    ci, cj = COLUMNAS.index("thread_id") + 1, COLUMNAS.index("iteracion") + 1
    for r in range(ws.max_row, 1, -1):
        if ws.cell(r, ci).value == thread_id and ws.cell(r, cj).value == iteracion:
            return r
    return None


def actualizar_accion(thread_id, iteracion, accion):
    """Qué hizo el retroalimentador tras ver la evaluación: ENVIAR, REESCRIBIR o INTENTO_ENVIO_BLOQUEADO."""
    with _lock:
        wb, ws = _abrir()
        r = _fila(ws, thread_id, iteracion)
        if r:
            c = ws.cell(r, COLUMNAS.index("accion_retroalimentador") + 1)
            c.value = f"{c.value} → {accion}" if c.value else accion
            wb.save(config.ARCHIVO_XLSX)


def registrar_final(thread_id, iteracion):
    with _lock:
        wb, ws = _abrir()
        r = _fila(ws, thread_id, iteracion)
        if r:
            ws.cell(r, COLUMNAS.index("es_version_final") + 1).value = True
            wb.save(config.ARCHIVO_XLSX)


def leer_filas() -> list[dict]:
    if not config.ARCHIVO_XLSX.exists():
        return []
    with _lock:
        wb = load_workbook(config.ARCHIVO_XLSX, read_only=True)
        filas = list(wb["iteraciones"].iter_rows(values_only=True))
        wb.close()
    cab = filas[0]
    return [dict(zip(cab, f)) for f in filas[1:]]
