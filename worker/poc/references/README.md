# Referencias para medir la precisión (Fase A)

Una referencia por canción, con el mismo id que el worker da al audio de `../songs/`
(`Enter Sandman.mp3` → `Enter-Sandman`). **Nada de esta carpeta se sube al repo** (solo este README).

## Grabar con la batería (A4)

1. `npm run dev` y abrir `http://localhost:5173/dev/record-reference` en Chrome o Edge.
2. Conectar la TD-02KV por USB (sirve también cualquier teclado MIDI: usa el mapa General MIDI).
3. Cargar el MP3, dejar **Grabar** activado y tocar. Se puede grabar por tramos: regrabar un
   pasaje reemplaza solo sus golpes; "Deshacer última toma" revierte. El borrador se guarda en el
   navegador por si recargas.
4. **Descargar `<id>.json`** y guardarlo aquí: `worker/poc/references/<id>.json`.

No hace falta cuidar la latencia: el evaluador (A5) estima el desfase global antes de comparar.

## Formato

`ReferenceFile` en `src/types/reference.ts`: `hits[] = { t (s), piece, note, velocity }` y
`takes[]` (tramos grabados; A5 solo evalúa dentro de ellos).

Si consigues un archivo MIDI (`<id>.mid`) o Guitar Pro (`<id>.gp5`) de la batería, también sirve
(importación pendiente).
