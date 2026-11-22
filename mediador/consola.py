"""Prueba del bucle en la terminal:  python -m mediador.consola"""
import uuid

from . import config, contenido
from .evaluador import CRITERIOS


def formatear(s: dict) -> str:
    ev = s["evaluacion"]
    if s["evento"] == "rechazo":
        return f"🚫 No se puede enviar: {ev['motivo_bloqueo'] or ev['mensaje_al_retroalimentador']}"
    if ev["bloqueado"]:
        return f"🚫 Ronda {s['iteracion']}\n{ev['mensaje_al_retroalimentador']}\n(Reescribe el comentario.)"
    lineas = [f"🔎 Ronda {s['iteracion']} (sugeridas: {s['max_iteraciones']})"]
    lineas += [f"  {c:<15}{'●' * ev[c]}{'○' * (4 - ev[c])}" for c in CRITERIOS]
    lineas += ["", ev["mensaje_al_retroalimentador"]] + [f"  • {x}" for x in ev["sugerencias"]]
    lineas += ["", "✅ Listo: escribe ENVIAR o pega otra versión." if ev["listo_para_enviar"]
               else "✏️  Pega una nueva versión o escribe ENVIAR."]
    return "\n".join(lineas)


def main():
    from .grafo import continuar_sesion, iniciar_sesion
    print(f"Modo: {config.MODO} · modelo: {config.MODELO}\n")
    print(contenido.leer_trabajo()[:600] + "...\n")
    tid = f"consola-{uuid.uuid4().hex[:8]}"
    s = iniciar_sesion(tid, "prueba", config.AUTOR_TRABAJO, input("Pega tu retroalimentación:\n> "))
    while not s["terminado"]:
        print("\n" + formatear(s) + "\n")
        s = continuar_sesion(tid, input("> "))
    print("\n📨 Entregado:\n" + s["mensaje_final"])
    print("\nRegistro:", config.ARCHIVO_XLSX)


if __name__ == "__main__":
    main()
