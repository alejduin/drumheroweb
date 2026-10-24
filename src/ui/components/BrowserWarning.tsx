/**
 * BrowserWarning — muestra un banner si el navegador no soporta Web MIDI API.
 * Web MIDI API solo está disponible en Chrome y Edge.
 */
export function BrowserWarning() {
  const hasMidi = 'requestMIDIAccess' in navigator

  if (hasMidi) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 p-4 bg-yellow-900/95 border-t border-yellow-700 text-yellow-100 flex items-start gap-3">
      <span className="text-2xl shrink-0" aria-hidden="true">⚠</span>
      <div>
        <p className="font-bold">Navegador no compatible</p>
        <p className="text-sm text-yellow-300 mt-0.5">
          DrumHero requiere <strong>Chrome</strong> o <strong>Edge</strong> para acceder a la
          batería MIDI. Firefox y Safari no soportan Web MIDI API.
        </p>
      </div>
    </div>
  )
}
