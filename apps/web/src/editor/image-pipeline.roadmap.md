# Pipeline de imagen — siguientes pasos

Roadmap tras completar **M1: abrir un RAW en el canvas central** (decodificado
con `libraw-wasm`, verificado end-to-end el 2026-07-02). Ordenado por dependencia
y valor. Cada bloque lista alcance, archivos, decisiones abiertas y trampas.

## Estado actual

- ✅ Store: slices `image` + `imageStatus` (`editor/image.ts`, reducer, provider, context).
- ✅ Decode: `editor/decodeRaw.ts` (libraw-wasm, `halfSize` + `useCameraWb`, `dispose()`).
- ✅ Render: `components/canvas/Canvas.tsx` (fit-to-container, devicePixelRatio, ResizeObserver).
- ✅ Apertura: `components/canvas/OpenImageButton.tsx` (input temporal M1).
- ✅ Curvas: editor completo (`compileLut` genera la LUT 256) — **pero aún no toca píxeles**.
- ✅ Ajustes: sliders escriben en el store — **tampoco tocan píxeles todavía**.

---

## M2 — Abrir desde el nav  *(en curso, lo hace el dev)*

Plegar `OpenImageButton` al icono de documento del `TopNavBar`: input oculto
(`display:none` + `ref`) disparado por el icono. Borrar el input temporal del
contenedor central en `routes/index.tsx`.

- **Archivos:** `components/navigation/elements/TopNavBar.tsx`, `routes/index.tsx`.
- **Trampa:** el input escondido necesita `ref.current.click()` desde el `onClick`
  del icono; recuerda resetear `event.target.value` para poder reabrir el mismo archivo.

---

## M3 — Metadatos al InfoPanel

Volcar `image.metadata` (tipo `Metadata` de libraw-wasm) al `InfoPanel`: cámara,
lente, ISO, apertura, velocidad, dimensiones, fecha.

- **Archivos:** `components/panels/InfoPanel.tsx` (lee `useEditor().image`).
- **Alcance bajo:** es solo presentación; los datos ya están en el store.
- **Nota:** muestra un estado vacío ("abre una imagen") cuando `image === null`.

---

## M4 — EL grande: pipeline de ajustes/curvas sobre los píxeles

Es lo que hace que TODO (curvas + sliders) se vea por fin. Hoy la cadena termina
en el store; falta el paso store → píxeles procesados → canvas.

### Contrato

Entrada: la imagen decodificada (`image`) + el estado de edición (`adjustments`,
`curves`). Salida: píxeles procesados dibujados en el canvas, **en vivo** al mover
un slider o arrastrar un punto de curva.

### Decisión de arquitectura (a cerrar antes de codificar)

- **A) Canvas 2D + LUTs en CPU:** aplicar las curvas vía la LUT de 256 (ya la
  tienes de `compileLut`) y los ajustes por-píxel sobre el `ImageData`. Simple,
  reusa `curvesMath`, pero por-píxel en JS es lento a resolución completa →
  obliga a Web Worker + trabajar sobre un buffer, y a *downscale* para el preview.
- **B) WebGL/WebGL2 (shaders):** subir la imagen como textura y aplicar
  ajustes/curvas en un fragment shader (la LUT como textura 1D). Tiempo real real,
  incluso a resolución completa. Más complejo de arrancar; es el camino de
  Lightroom/RapidRAW. **Recomendado si el objetivo es "comparable a Lightroom".**

> Sugerencia: empezar por **A** en un Worker con preview a media resolución para
> validar el orden del pipeline y el aspecto, y migrar el núcleo a **B** cuando
> el orden de operaciones esté claro. La LUT de curvas es idéntica en ambos.

### Orden de operaciones (el pipeline en sí)

Definir y fijar el orden importa (Lightroom lo tiene muy pensado). Punto de partida:

```
RAW decodificado (lineal/sRGB de libraw)
  → exposición / contraste / highlights / shadows / whites / blacks   (tone)
  → temperatura / tinte / vibrance / saturation                        (color)
  → curva RGB (LUT maestra) → curvas por canal (R/G/B)                 (curves)
  → detalle (sharpen / noise)                                          (details)
  → salida al canvas
```

### Rendimiento

- **Debounce/rAF:** no recalcular en cada `onChange`; agrupar en `requestAnimationFrame`.
- **Preview vs full:** procesar a resolución de pantalla mientras se arrastra,
  y a resolución completa al soltar.
- **Worker:** si vas por A, el bucle por-píxel bloquea el hilo → Worker + transferable
  `ArrayBuffer`.
- **Guardar el RGBA original** intacto en el store: el pipeline siempre parte del
  original, nunca de un resultado ya procesado (si no, los ajustes se acumulan).

### Archivos previstos

- `editor/pipeline.ts` (o `pipeline/`): función pura `applyPipeline(source, adjustments, curves) → ImageData`.
- Hook `useProcessedImage()` que observa el store y devuelve el bitmap procesado.
- `Canvas.tsx` pasa a dibujar el resultado del pipeline, no `image.bitmap` directo.

---

## M5 — Calidad de decode

- Quitar `halfSize` (o hacerlo condicional: media para preview, completa para export).
- Revisar settings de `libraw` (espacio de color de salida, `outputBps: 16` para
  más precisión en el pipeline, gamma).
- Gestión de memoria: RAW de resolución completa en RGBA es grande; medir.

---

## M6 — Exportar a JPG  *(objetivo del proyecto)*

Renderizar el resultado del pipeline a resolución completa y exportar:
`canvas.toBlob('image/jpeg', quality)` (o `OffscreenCanvas`). Conectar al
`ExportPanel` que ya existe (formato + calidad ya están en su UI).

- **Archivos:** `components/panels/ExportPanel.tsx` (hoy con el botón deshabilitado).
- **Decisión:** exportar el canvas de pantalla (rápido, resolución limitada) vs.
  re-procesar a resolución completa en un `OffscreenCanvas` (correcto). Para
  "exportar JPGs de verdad" hace falta lo segundo.

---

## Decisiones abiertas que conviene cerrar pronto

1. **Canvas 2D vs WebGL** para M4 (condiciona casi todo lo demás).
2. **Orden de operaciones** del pipeline (fijarlo y documentarlo).
3. **16-bit vs 8-bit** internamente (precisión vs memoria/velocidad).
4. **Undo/redo:** ¿lo quieres? El store por acciones (reducer) lo facilita, pero
   hay que diseñarlo antes de que el estado crezca.
