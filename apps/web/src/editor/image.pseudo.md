# Abrir un RAW en el contenedor central — pseudocódigo

Guía para el milestone M1: seleccionar un archivo RAW, decodificarlo con
`libraw-wasm` y pintarlo en el `<canvas>` central (`routes/index.tsx:46`, el
`flex: 1`). Decode local en el navegador (elegido 2026-07-02).

Convenciones del repo: sin `any`, JSDoc en lo público, `camelCase`/`PascalCase`,
**toda función async envuelve el cuerpo en `try/catch` y loguea con `logger`**
(no `console.log`). Instala antes: `pnpm --filter web add libraw-wasm`.

```
Flujo completo:

  File
   → arrayBuffer → Uint8Array
   → libraw-wasm: raw.open() + raw.metadata() + raw.imageData()   [RGB, en su Worker]
   → rgbToRgba()            (añade alpha = 255)  ← EL PASO QUE TODOS OLVIDAN
   → new ImageData(rgba, w, h)
   → createImageBitmap()    (async; drawImage sí escala, putImageData no)
   → store (slice de imagen)
   → <Canvas> dibuja con drawImage, escalado "fit-to-container"
```

---

## 1. Slice de imagen (extiende el store existente)

Igual que `curves` se sumó a `EditorStoreState`, añade `image`.

```
# editor/image.ts
import LibRaw, { type Metadata } from "libraw-wasm"   # el paquete YA exporta sus tipos

interface LoadedImage:
    bitmap:   ImageBitmap      # lo que dibuja el canvas
    width:    number
    height:   number
    fileName: string
    metadata: Metadata         # tipo del propio paquete (alias LibRawMetadata); NO lo inventes

type ImageState = LoadedImage | null      # null = no hay imagen abierta

# opcional pero recomendado para UX: un estado de carga aparte
type ImageStatus = 'idle' | 'loading' | 'error'
```

```
# editor/editorReducer.ts  (sumar a lo que ya hay)
EditorStoreState = { adjustments, curves, image: ImageState, imageStatus? }

acciones nuevas:
    SET_IMAGE_STATUS  payload: ImageStatus   → state.imageStatus = payload
    SET_IMAGE         payload: LoadedImage    → state.image = payload, status = 'idle'
    CLEAR_IMAGE                               → state.image = null
```

Nota: el reducer es **puro y síncrono** — solo recibe el `LoadedImage` ya
decodificado. Toda la parte async (leer archivo, decodificar) vive en el
provider (punto 3). Mismo reparto que con las curvas.

---

## 2. Conversión RGB → RGBA  (función pura, fácil de testear al 80%)

`imageData()` de libraw devuelve **3 bytes/píxel**; `ImageData` necesita **4**.

```
# editor/image.ts
function rgbToRgba(rgb: Uint8Array, width, height): Uint8ClampedArray:
    pixels = width * height
    rgba = new Uint8ClampedArray(pixels * 4)     # ImageData exige Uint8ClampedArray
    for i in 0 .. pixels-1:
        rgba[i*4 + 0] = rgb[i*3 + 0]   # R
        rgba[i*4 + 1] = rgb[i*3 + 1]   # G
        rgba[i*4 + 2] = rgb[i*3 + 2]   # B
        rgba[i*4 + 3] = 255            # A opaco  ← si lo olvidas: imagen rayada/negra
    return rgba
```

Este es el mejor candidato a test unitario del milestone: entrada pequeña
(2×1 px), comprueba que intercala el alpha y respeta el orden RGB.

---

## 3. Decodificar + cargar  (en el provider, async, try/catch + logger)

```
# editor/decodeRaw.ts
async function decodeRaw(buffer: ArrayBuffer):
    try:
        raw = new LibRaw()
        await raw.open(new Uint8Array(buffer), { halfSize: true })   # ojo: camelCase, rápido para M1
        metadata = await raw.metadata()                # Metadata | undefined
        image    = await raw.imageData()               # { width,height,colors,bits,dataSize,data } | undefined
        if !metadata or !image: throw Error('decode returned nothing')   # los métodos devuelven | undefined
        # image = RawImageData { width, height, colors, bits, dataSize, data }
        # image.data es RawPixelData = Uint8Array | Uint16Array (según bits).
        # Con la salida por defecto (8-bit) es Uint8Array; verifica bits===8 antes
        # de pasarlo a rgbToRgba (M1). El caso 16-bit lo tratas cuando subas calidad.
        return { data: image.data, width: image.width, height: image.height, colors: image.colors, bits: image.bits, metadata }
    catch e:
        logger.error('decodeRaw failed', e)
        throw e     # deja que loadImage decida el estado de error
```

```
# editor/EditorProvider.tsx  (nuevo método expuesto, como setCurve)
async function loadImage(file: File):
    try:
        dispatch(SET_IMAGE_STATUS, 'loading')
        buffer = await file.arrayBuffer()
        { data, width, height, metadata } = await decodeRaw(buffer)
        rgba = rgbToRgba(data, width, height)
        imageData = new ImageData(rgba, width, height)
        bitmap = await createImageBitmap(imageData)
        dispatch(SET_IMAGE, { bitmap, width, height, fileName: file.name, metadata })
    catch e:
        logger.error('loadImage failed', e)
        dispatch(SET_IMAGE_STATUS, 'error')
```

Expón en `editorContext.ts` (interface `EditorState`): `image`, `imageStatus`,
`loadImage(file)`. Igual que hiciste con `curves`/`setCurve`.

---

## 4. Componente Canvas  (el contenedor central)

```
# components/canvas/Canvas.tsx
component Canvas():
    { image } = useEditor()
    canvasRef = useRef<HTMLCanvasElement>

    draw():
        canvas = canvasRef.current; if !canvas: return
        ctx = canvas.getContext('2d'); if !ctx: return

        # tamaño físico = tamaño CSS * devicePixelRatio (nitidez en pantallas HiDPI)
        rect = canvas.getBoundingClientRect()
        dpr = window.devicePixelRatio || 1
        canvas.width  = rect.width  * dpr
        canvas.height = rect.height * dpr

        ctx.clearRect(0, 0, canvas.width, canvas.height)
        if !image: return

        # "fit": escala para caber conservando aspecto, y centra
        scale = min(canvas.width / image.width, canvas.height / image.height)
        drawW = image.width  * scale
        drawH = image.height * scale
        offX  = (canvas.width  - drawW) / 2
        offY  = (canvas.height - drawH) / 2
        ctx.drawImage(image.bitmap, offX, offY, drawW, drawH)

    useEffect(draw, [image])                 # redibuja cuando cambia la imagen
    useEffect(() => observe resize → draw)   # ResizeObserver para que el fit siga al contenedor

    return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
```

Montaje: en `routes/index.tsx:46`, sustituye
`<div style={{ flex: 1 }}>{/* editor canvas */}</div>` por
`<div style={{ flex: 1, minWidth: 0 }}><Canvas /></div>`.

---

## 5. Selector de archivo

```
# components/canvas/OpenImageButton.tsx  (o cablearlo al icono "documento" del nav)
RAW_ACCEPT = ".arw,.cr2,.cr3,.nef,.dng,.raf,.orf,.rw2"

component OpenImageButton():
    { loadImage } = useEditor()
    onChange(event):
        file = event.target.files?.[0]
        if file: loadImage(file)
    return <input type="file" accept={RAW_ACCEPT} onChange={onChange} />
```

Para M1 vale un `<input>` pelado. En M2 lo escondes (`display:none` + `ref`) y lo
disparas desde el icono de documento del `TopNavBar`.

---

## Avisos que te ahorrarán horas

- **Alpha (punto 2):** el fallo nº1. RGB→RGBA sin el `255` = imagen corrupta.
- **`Uint8ClampedArray`:** `new ImageData(...)` lo exige; un `Uint8Array` normal lanza.
- **`createImageBitmap` es async:** no olvides el `await`.
- **Vite + WASM/Worker:** si al arrancar ves un 404 del `.wasm` o del worker del
  paquete, es config de assets de Vite (no un bug tuyo). Avísame y lo resolvemos.
- **`halfSize: true`** (camelCase) en M1: decodifica a mitad de resolución → mucho
  más rápido para iterar. Lo quitas cuando el flujo funcione.
- **`data` es `Uint8Array | Uint16Array`:** `rgbToRgba` de M1 asume 8-bit (Uint8Array);
  verifica `bits === 8` en `decodeRaw`. El 16-bit (valores 0–65535) requiere escalar,
  déjalo para cuando subas calidad.
- **Memoria:** un RAW de 24MP en RGBA ≈ 96MB. Cierra/reemplaza bitmaps al abrir otro
  (`image.bitmap.close()` antes de sustituir) para no acumular.
- **devicePixelRatio:** sin él la imagen se ve borrosa en pantallas HiDPI.

## Orden de tests sugerido

Decode WASM y canvas no se testean bien en jsdom. Cubre lo puro:
1. `rgbToRgba` — 2×1 px, verifica intercalado + alpha 255 (test unitario limpio).
2. reducer `SET_IMAGE`/`CLEAR_IMAGE`/`SET_IMAGE_STATUS` — transiciones de estado.
3. `loadImage` (opcional) — mockeando `decodeRaw` y `createImageBitmap`, comprueba
   que despacha `loading → SET_IMAGE` en éxito y `error` en fallo.
```
