interface HomeScreenProps {
  onPlay: () => void
  onSettings: () => void
}

export function HomeScreen({ onPlay, onSettings }: HomeScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 bg-gray-950 text-white select-none">
      <div className="text-center">
        <h1 className="text-6xl font-black tracking-tight text-purple-400 drop-shadow-lg">
          DrumHero
        </h1>
        <p className="mt-2 text-gray-400 text-lg">Conecta tu batería y toca</p>
      </div>

      <div className="flex flex-col gap-4 w-64">
        <button
          onClick={onPlay}
          className="py-4 px-8 bg-purple-600 hover:bg-purple-500 active:bg-purple-700 rounded-xl text-xl font-bold transition-colors shadow-lg shadow-purple-900"
        >
          Jugar
        </button>
        <button
          onClick={onSettings}
          className="py-3 px-8 bg-gray-800 hover:bg-gray-700 active:bg-gray-900 rounded-xl text-base font-medium transition-colors"
        >
          Ajustes
        </button>
      </div>

      <p className="text-gray-600 text-sm">Requiere Chrome o Edge con batería USB-MIDI</p>
    </div>
  )
}
