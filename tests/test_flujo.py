"""Pruebas del flujo en modo simulado (sin API).  Ejecutar: pytest -q"""
import os
import tempfile

os.environ["MEDIADOR_MODO"] = "simulado"
os.environ["MEDIADOR_SALIDA"] = tempfile.mkdtemp()

from fastapi.testclient import TestClient  # noqa: E402

from mediador import contenido, registro  # noqa: E402
from mediador.web import app  # noqa: E402

cli = TestClient(app)

BUENO = ("Me gustó que tu hipótesis se apoya en la fórmula T = 2π√(L/g), está bien justificada. "
         "En el procedimiento falta indicar cuántas repeticiones hiciste por largo: ¿podrías agregarlo? "
         "En la sección 3 te sugiero graficar T² vs L para obtener una recta y calcular g con su incertidumbre. "
         "En las conclusiones revisa la frase 'para cualquier péndulo', porque solo vale para ángulos pequeños.")


def test_flujo_completo_y_registro():
    s = cli.post("/api/sesiones", json={"retroalimentador": "ana", "destino": "beto",
                                        "borrador": "Está bien pero le falta."}).json()
    assert not s["terminado"] and not s["bloqueado"] and s["iteracion"] == 1
    s = cli.post(f"/api/sesiones/{s['thread_id']}/responder", json={"texto": BUENO}).json()
    assert s["iteracion"] == 2 and s["evaluacion"]["listo_para_enviar"]
    s = cli.post(f"/api/sesiones/{s['thread_id']}/responder", json={"texto": "ENVIAR"}).json()
    assert s["terminado"] and BUENO in s["mensaje_final"]
    filas = [f for f in registro.leer_filas() if f["thread_id"] == s["thread_id"]]
    assert [f["accion_retroalimentador"] for f in filas] == ["REESCRIBIR", "ENVIAR"]
    assert filas[-1]["es_version_final"] is True


def test_bloqueado_no_se_envia():
    s = cli.post("/api/sesiones", json={"retroalimentador": "ana", "destino": "beto",
                                        "borrador": "Eres un flojo, tu informe es basura."}).json()
    assert s["bloqueado"]
    s = cli.post(f"/api/sesiones/{s['thread_id']}/responder", json={"texto": "ENVIAR"}).json()
    assert not s["terminado"] and s["evento"] == "rechazo"
    s = cli.post(f"/api/sesiones/{s['thread_id']}/responder", json={"texto": BUENO}).json()
    assert not s["bloqueado"]
    s = cli.post(f"/api/sesiones/{s['thread_id']}/responder", json={"texto": "ENVIAR"}).json()
    assert s["terminado"]


def test_prompt_validacion_y_relleno():
    assert contenido.validar_prompt("sin marcadores")[0].startswith("Falta")
    texto = "Hola {borrador} {otro} {\"json\": 1}"
    assert contenido.rellenar_prompt(texto, borrador="X") == "Hola X {otro} {\"json\": 1}"
    original = cli.get("/api/prompt").json()["texto"]
    assert cli.put("/api/prompt", json={"texto": "sin marcador"}).status_code == 400
    r = cli.post("/api/prompt/vista_previa", json={"texto": original, "borrador": "MI BORRADOR"}).json()
    assert "MI BORRADOR" in r["prompt"] and "Péndulo simple" in r["prompt"]
