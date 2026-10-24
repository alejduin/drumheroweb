# Prompt Optimizado para Claude Code — Onboarding Profesional

> **Cómo usar este archivo:** Ejecuta cada fase como un prompt independiente en Claude Code.
> No copies todo de golpe — Claude Code trabaja mejor con instrucciones enfocadas.

---

## FASE 0 — Configuración del Entorno (ejecutar primero)

```
Soy desarrollador de software con experiencia en JavaScript/TypeScript. Voy a configurar Claude Code desde cero para uso profesional. Necesito que me guíes paso a paso en:

1. **Configuración inicial de Claude Code:**
   - Verificar instalación correcta (`claude --version`) y autenticación
   - Configurar el archivo `~/.claude/settings.json` con las mejores prácticas
   - Explicarme los modos de uso disponibles (plan, code, architect) y cuándo usar cada uno
   - Configurar el modelo preferido y parámetros de contexto

2. **Configuración del proyecto base:**
   - Crear y configurar `CLAUDE.md` en la raíz del proyecto con convenciones, stack, y reglas del proyecto
   - Configurar `.claude/` con settings locales del proyecto
   - Explicar cómo estructurar instrucciones en CLAUDE.md para que persistan entre sesiones

3. **MCP Servers:**
   - Listar los MCP servers más útiles para desarrollo web fullstack
   - Instalar y configurar: filesystem, GitHub, y cualquier otro que consideres esencial
   - Mostrarme cómo verificar que están funcionando

4. **Optimización de tokens:**
   - Enseñarme las técnicas para usar menos tokens sin perder calidad (compact, context management)
   - Configurar auto-compact si está disponible
   - Mejores prácticas para mantener el contexto limpio en sesiones largas

Antes de ejecutar cualquier cosa, muéstrame el plan completo y pídeme confirmación.
```

---

## FASE 1 — Flujo de Trabajo Profesional (ejecutar después de Fase 0)

```
Ahora enséñame el flujo de trabajo profesional con Claude Code aplicándolo a un proyecto real. Vamos a crear un proyecto llamado "DrumHero" (los requerimientos están en REQUIREMENTS.md en este directorio).

Antes de escribir código, quiero que me enseñes:

1. **Modo Architect (planificación):**
   - Usa el modo architect/plan para analizar REQUIREMENTS.md
   - Genera un plan técnico: arquitectura, dependencias, estructura de carpetas, y orden de implementación
   - Guárdalo como PLAN.md para referencia

2. **CLAUDE.md del proyecto:**
   - Crea el CLAUDE.md óptimo para este proyecto incluyendo: stack (React + TS + Vite + Tailwind), convenciones de código, estructura de carpetas, y las reglas que Claude Code debe seguir al generar código

3. **Scaffolding con Claude Code:**
   - Inicializa el proyecto siguiendo el plan
   - Muéstrame cómo usar Claude Code para generar la estructura base sin escribir cada archivo manualmente
   - Configura linting, formatting, y git hooks

Solo planifica y haz el scaffolding. NO implementes features todavía.
```

---

## FASE 2 — Desarrollo Guiado Feature por Feature

```
Vamos a implementar la Fase 1 (MVP) del proyecto DrumHero siguiendo el PLAN.md.

Para cada feature, quiero que sigas este flujo y me expliques qué estás haciendo:

1. Describe qué vas a implementar y por qué en ese orden
2. Escribe el código
3. Escribe tests básicos
4. Haz commit con mensaje convencional (conventional commits)

Empieza con la primera feature del MVP: conexión Web MIDI API.

Después de cada feature completada, espera mi confirmación antes de continuar con la siguiente.
```

---

## FASE 3 — Técnicas Avanzadas (ejecutar cuando ya tengas el MVP)

```
Ya tengo el MVP funcionando. Ahora enséñame las técnicas avanzadas de Claude Code aplicadas a este proyecto:

1. **Sub-agentes y orquestación:**
   - Muéstrame cómo usar `claude --print` o el modo headless para crear scripts que orquesten múltiples tareas
   - Ejemplo práctico: un script que ejecute Claude Code para revisar código, correr tests, y generar changelog automáticamente

2. **Custom slash commands:**
   - Crear comandos personalizados en `.claude/commands/` para tareas repetitivas de este proyecto
   - Ejemplo: `/review` para code review, `/test-feature` para generar tests de una feature

3. **Hooks y automatización:**
   - Configurar hooks pre/post para validación automática
   - Integrar con CI/CD si aplica

4. **Multi-archivo y refactoring:**
   - Muéstrame cómo pedirle a Claude Code que haga refactors que toquen múltiples archivos de forma segura
   - Ejemplo práctico con algún módulo del proyecto

Explícame cada concepto antes de aplicarlo.
```

---

## Notas sobre por qué este prompt es mejor que el original

### Problemas del prompt original:
- **Demasiado amplio:** pedía "todo" en un solo prompt (configuración + MCP + agentes + proyecto + guía completa)
- **Sin proyecto definido:** pedía "un proyecto de ejemplo no muy complejo" dejando a Claude Code elegir, lo que gasta tokens en decisiones innecesarias
- **Mezclaba stacks:** mencionaba Angular, Node, Supabase, MongoDB, PostgreSQL, Docker sin decidir — Claude Code no sabe cuál elegir
- **Sin fases:** al pedir todo junto, Claude Code intenta responder todo superficialmente en vez de profundizar
- **Redundante:** "desbloquear las mejores características y funcionalidades" es vago y no accionable

### Mejoras aplicadas:
- **Fases independientes:** cada prompt es enfocado y ejecutable por separado
- **Proyecto real definido:** usa el REQUIREMENTS.md de DrumHero que ya tienes
- **Stack decidido:** React + TS + Vite (ya definido en los requerimientos)
- **Instrucciones accionables:** cada punto es algo que Claude Code puede ejecutar
- **Control del usuario:** "espera mi confirmación" evita que Claude Code se desboque
- **Progresión lógica:** configurar → planificar → construir → técnicas avanzadas
