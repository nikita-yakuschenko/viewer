import * as WEBIFC from "web-ifc";

/**
 * Workaround-окружение для web-ifc в Next.js / Vite-бандлах.
 *
 * Проблема: многопоточный wasm пытается резолвить worker URL относительно бандла;
 * в dev/preview пути часто ломаются → Init падает или зависает.
 *
 * Решение: принудительно single-thread Init (все тяжёлые операции остаются на main thread,
 * но зато стабильный запуск). Это осознанный trade-off для browser-first viewer без
 * отдельной worker-обвязки под web-ifc.
 *
 * Границы: патчим один раз на прототипе IfcAPI; повторный вызов безопасен (флаг на прототипе).
 * Не смешивать с бизнес-логикой IFC — только bootstrap.
 */
let webIfcSingleThreadPatchApplied = false;

export function applyWebIfcSingleThreadPatch(): void {
  if (webIfcSingleThreadPatchApplied) return;
  const proto = WEBIFC.IfcAPI.prototype as {
    Init: WEBIFC.IfcAPI["Init"];
    __bimViewerSingleThreadPatched?: boolean;
  };
  if (proto.__bimViewerSingleThreadPatched) {
    webIfcSingleThreadPatchApplied = true;
    return;
  }
  const originalInit = proto.Init;
  proto.Init = function patchedInit(
    this: WEBIFC.IfcAPI,
    customLocateFileHandler?: WEBIFC.LocateFileHandlerFn,
    _forceSingleThread?: boolean
  ) {
    return originalInit.call(this, customLocateFileHandler, true);
  };
  proto.__bimViewerSingleThreadPatched = true;
  webIfcSingleThreadPatchApplied = true;
}

/**
 * Emscripten / pthread: mainScriptUrlOrBlob помогает резолвить worker относительно CDN
 * для web-ifc-api.js (особенно в Next dev).
 * Не перезаписываем весь global Module — только дополняем.
 */
export function applyWebIfcModuleScriptHint(mainScriptUrl: string): void {
  const g = globalThis as { Module?: Record<string, unknown> };
  g.Module = {
    ...g.Module,
    mainScriptUrlOrBlob: mainScriptUrl,
  };
}
