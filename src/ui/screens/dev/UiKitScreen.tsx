import { useState } from 'react'
import type { AccentName } from '@/constants/theme'
import { ACCENTS, applyAccent } from '@/constants/theme'
import {
  Button,
  Checkbox,
  Chip,
  IconButton,
  Legend,
  Panel,
  ProgressBar,
  SectionLabel,
  SegmentedControl,
  Slider,
  Stars,
  StatTile,
  StatusPill,
  StepRow,
} from '@/ui/primitives'

const DIFFICULTIES = [
  { value: 'basic', label: 'Básico' },
  { value: 'intermediate', label: 'Intermedio' },
  { value: 'full', label: 'Completo' },
] as const

const ACCENT_OPTIONS = (Object.keys(ACCENTS) as AccentName[]).map(name => ({
  value: name,
  label: name,
}))

const JUDGEMENTS = [
  { label: 'Perfecto', color: 'perfect' },
  { label: 'Cerca', color: 'close' },
  { label: 'Fallo', color: 'miss' },
  { label: 'Pad incorrecto', color: 'wrong' },
] as const

/** Catálogo de primitivas (solo en dev, /dev/ui) para revisarlas contra las maquetas. */
export function UiKitScreen() {
  const [difficulty, setDifficulty] = useState<string>('intermediate')
  const [accent, setAccent] = useState<AccentName>('violet')
  const [tempo, setTempo] = useState(100)
  const [volume, setVolume] = useState(80)
  const [metronome, setMetronome] = useState(true)
  const [paperView, setPaperView] = useState('score')

  return (
    <main className="h-screen overflow-auto bg-bg p-8 text-fg">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold">UI kit</h1>
          <SegmentedControl
            aria-label="Acento"
            options={ACCENT_OPTIONS}
            value={accent}
            onChange={name => {
              setAccent(name)
              applyAccent(name)
            }}
          />
        </header>

        <Panel title="Botones" aside="primary · secondary · light · warning">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size="lg">
              Empezar
            </Button>
            <Button variant="primary">Analizar</Button>
            <Button>Calibrar</Button>
            <Button variant="light">Reintentar</Button>
            <Button variant="warning">Revisar 12 notas</Button>
            <Button size="sm">Pequeño</Button>
            <Button disabled>Deshabilitado</Button>
            <IconButton aria-label="Pausa">❚❚</IconButton>
            <IconButton aria-label="Reproducir" variant="round">
              ▶
            </IconButton>
            <IconButton aria-label="Cerrar" variant="ghost">
              ✕
            </IconButton>
          </div>
        </Panel>

        <div className="grid grid-cols-2 gap-6">
          <Panel title="Controles">
            <SectionLabel>Dificultad</SectionLabel>
            <SegmentedControl
              aria-label="Dificultad"
              options={DIFFICULTIES}
              value={difficulty}
              onChange={setDifficulty}
              fullWidth
            />
            <SectionLabel>Tempo · {tempo} %</SectionLabel>
            <Slider
              aria-label="Tempo"
              min={50}
              max={120}
              step={5}
              value={tempo}
              valueText={`${tempo} %`}
              onChange={setTempo}
            />
            <SectionLabel>Batería · {volume}</SectionLabel>
            <Slider aria-label="Volumen batería" tone="light" value={volume} onChange={setVolume} />
            <Checkbox label="Metrónomo" checked={metronome} onChange={setMetronome} />
            <Checkbox label="Deshabilitado" checked={false} onChange={() => {}} disabled />
          </Panel>

          <Panel title="Estado">
            <div className="flex flex-wrap gap-2">
              <StatusPill tone="perfect">TD-02KV conectado</StatusPill>
              <StatusPill tone="close">Latencia sin calibrar</StatusPill>
              <StatusPill tone="miss">Sin MIDI</StatusPill>
              <StatusPill>Sin dispositivo</StatusPill>
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip tone="strong">YouTube</Chip>
              <Chip>silenciado · sincronizado +42 ms</Chip>
            </div>
            <ProgressBar aria-label="Progreso" value={0.62} />
            <Legend items={JUDGEMENTS} />
            <Stars value={4} />
          </Panel>
        </div>

        <Panel title="Análisis" aside="te avisamos al terminar">
          <StepRow index={1} label="Separar batería" state="done" />
          <StepRow index={2} label="Transcribir golpes" state="running" progress={0.42} />
          <StepRow index={3} label="Tempo y compases" state="pending" />
          <StepRow index={4} label="Generar partitura" state="failed" statusText="sin memoria" />
        </Panel>

        <div className="grid grid-cols-4 gap-3">
          <StatTile label="BPM" value="120" hint="detectado" />
          <StatTile label="Notas" value="1 295" hint="94 % en rejilla" hintTone="perfect" />
          <StatTile label="Por revisar" value="12" hint="confianza < 0.6" variant="close" />
          <StatTile
            label="Precisión"
            value="87 %"
            size="lg"
            hint="+4 % vs. anterior"
            hintTone="perfect"
          />
        </div>

        <div className="flex items-center gap-6 rounded-lg bg-paper p-5">
          <SegmentedControl
            aria-label="Vista"
            variant="paper"
            options={[
              { value: 'score', label: 'Partitura' },
              { value: 'lanes', label: 'Carriles' },
            ]}
            value={paperView}
            onChange={setPaperView}
          />
          <Legend items={JUDGEMENTS} variant="paper" />
        </div>
      </div>
    </main>
  )
}
