"""Interfaz web del mediador (FastAPI).

Ejecutar:  uvicorn mediador.web:app --reload   →  http://127.0.0.1:8000
"""
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, contenido, grafo, registro
from .evaluador import evaluar_borrador

app = FastAPI(title="Mediador de retroalimentación entre pares")
STATIC = config.RAIZ / "mediador" / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")


def _llamar(fn, *args):
    """Convierte fallas del modelo (clave, red, cuota) en un error legible para la interfaz."""
    try:
        return fn(*args)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 - prototipo: mostrar el error tal cual
        raise HTTPException(502, f"Error al llamar al modelo: {type(e).__name__}: {e}")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/info")
def info():
    directorio = contenido.cargar_directorio()
    return {
        "modo": config.MODO, "modelo": config.MODELO, "max_iteraciones": config.MAX_ITERACIONES,
        "estudiantes": [{"alias": a, "nombre": r["nombre"]} for a, r in directorio.items()],
        "rubrica": contenido.leer_rubrica(), "trabajo": contenido.leer_trabajo(),
        "autor_trabajo": config.AUTOR_TRABAJO,
    }


# ---------- sesiones de retroalimentación ----------
class NuevaSesion(BaseModel):
    retroalimentador: str
    destino: str
    borrador: str


class Respuesta(BaseModel):
    texto: str  # "ENVIAR" o una nueva versión


@app.post("/api/sesiones")
def crear_sesion(d: NuevaSesion):
    if not d.borrador.strip():
        raise HTTPException(400, "El comentario está vacío.")
    if d.retroalimentador.strip().lower() == d.destino.strip().lower():
        raise HTTPException(400, "No puedes retroalimentarte a ti mismo.")
    tid = f"web-{uuid.uuid4().hex[:10]}"
    return _llamar(grafo.iniciar_sesion, tid, d.retroalimentador, d.destino, d.borrador)


@app.get("/api/sesiones/{tid}")
def ver_sesion(tid: str):
    s = grafo.estado_sesion(tid)
    if not s:
        raise HTTPException(404, "Sesión no encontrada.")
    return s


@app.post("/api/sesiones/{tid}/responder")
def responder(tid: str, r: Respuesta):
    s = grafo.estado_sesion(tid)
    if not s:
        raise HTTPException(404, "Sesión no encontrada.")
    if s["terminado"]:
        raise HTTPException(409, "Esta retroalimentación ya fue enviada.")
    if not r.texto.strip():
        raise HTTPException(400, "Escribe una nueva versión o ENVIAR.")
    return _llamar(grafo.continuar_sesion, tid, r.texto)


# ---------- prompt del mediador ----------
class Prompt(BaseModel):
    texto: str


class PruebaPrompt(BaseModel):
    texto: str
    borrador: str
    iteracion: int = 1


@app.get("/api/prompt")
def ver_prompt():
    texto = contenido.leer_prompt()
    return {"texto": texto, "marcadores": list(config.MARCADORES_PROMPT),
            "problemas": contenido.validar_prompt(texto)}


@app.put("/api/prompt")
def guardar_prompt(p: Prompt):
    problemas = contenido.validar_prompt(p.texto)
    if any(x.startswith("Falta") for x in problemas):
        raise HTTPException(400, " ".join(problemas))
    contenido.guardar_prompt(p.texto)
    return {"ok": True, "problemas": problemas}


@app.post("/api/prompt/restaurar")
def restaurar_prompt():
    return {"texto": contenido.restaurar_prompt()}


@app.post("/api/prompt/vista_previa")
def vista_previa(p: PruebaPrompt):
    from .evaluador import construir_prompt
    return {"prompt": construir_prompt(p.borrador, p.iteracion, config.MAX_ITERACIONES, plantilla=p.texto)}


@app.post("/api/prompt/probar")
def probar_prompt(p: PruebaPrompt):
    """Evalúa un borrador con el prompt del editor (sin guardarlo ni registrarlo en el Excel)."""
    ev = _llamar(lambda: evaluar_borrador(p.borrador, p.iteracion, config.MAX_ITERACIONES, plantilla=p.texto))
    return ev.model_dump() | {"puntaje_global": ev.puntaje_global, "modo": config.MODO}


# ---------- registro ----------
@app.get("/api/registro")
def ver_registro():
    return {"filas": registro.leer_filas()}


@app.get("/api/registro.xlsx")
def descargar_registro():
    if not config.ARCHIVO_XLSX.exists():
        raise HTTPException(404, "Aún no hay registros.")
    return FileResponse(config.ARCHIVO_XLSX, filename=config.ARCHIVO_XLSX.name)
