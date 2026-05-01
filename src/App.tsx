import { useEffect, useState } from 'react'
import {
  brainRegions,
  citationLinks,
  collaborators,
  highlightedWorks,
  themes,
} from './content'
import { NetworkSection } from './components/NetworkSection'
import { useReducedMotion } from './hooks/useReducedMotion'
import { useWebGLSupport } from './hooks/useWebGLSupport'
import type { GraphSceneConfig, GraphSelection } from './types/content'

const graphSceneConfig: GraphSceneConfig = {
  autoRotateSpeed: 0.42,
  nodeScaleRange: [0.12, 0.24],
  edgeOpacity: 0.22,
  brainShellOpacity: 0.16,
  effectsLevel: 'minimal',
}

export default function App() {
  const reducedMotion = useReducedMotion()
  const rendererCapability = useWebGLSupport()

  const [activeThemeId, setActiveThemeId] = useState(themes[0]?.id ?? '')
  const [selection, setSelection] = useState<GraphSelection>({
    selectedWorkId: highlightedWorks[0]?.id,
    selectedCollaboratorId: undefined,
    isAutoRotating: true,
  })
  const [resetNonce, setResetNonce] = useState(0)

  useEffect(() => {
    if (!reducedMotion) return

    setSelection((current) =>
      current.isAutoRotating ? { ...current, isAutoRotating: false } : current,
    )
  }, [reducedMotion])

  const handleThemeSelect = (themeId: string) => {
    setActiveThemeId(themeId)

    const nextWork =
      highlightedWorks.find((work) => work.themeIds.includes(themeId)) ??
      highlightedWorks[0]

    setSelection((current) => ({
      ...current,
      selectedWorkId: nextWork?.id,
      selectedCollaboratorId: undefined,
    }))
  }

  const handleWorkSelect = (workId: string) => {
    const work = highlightedWorks.find((candidate) => candidate.id === workId)

    setSelection((current) => ({
      ...current,
      selectedWorkId: workId,
      selectedCollaboratorId: undefined,
    }))

    if (work) setActiveThemeId(work.themeIds[0])
  }

  const handleCollaboratorSelect = (collaboratorId: string) => {
    const collaborator = collaborators.find(
      (candidate) => candidate.id === collaboratorId,
    )

    setSelection((current) => ({
      ...current,
      selectedWorkId: undefined,
      selectedCollaboratorId: collaboratorId,
    }))

    if (collaborator) setActiveThemeId(collaborator.themeIds[0])
  }

  return (
    <NetworkSection
      works={highlightedWorks}
      collaborators={collaborators}
      citationLinks={citationLinks}
      brainRegions={brainRegions}
      themes={themes}
      rendererCapability={rendererCapability}
      sceneConfig={graphSceneConfig}
      activeThemeId={activeThemeId}
      activeWorkId={selection.selectedWorkId ?? null}
      activeCollaboratorId={selection.selectedCollaboratorId ?? null}
      isAutoRotating={selection.isAutoRotating && !reducedMotion}
      reducedMotion={reducedMotion}
      resetNonce={resetNonce}
      onThemeSelect={handleThemeSelect}
      onWorkSelect={handleWorkSelect}
      onCollaboratorSelect={handleCollaboratorSelect}
      onToggleAutoRotate={() =>
        setSelection((current) => ({
          ...current,
          isAutoRotating: !current.isAutoRotating,
        }))
      }
      onResetView={() => setResetNonce((value) => value + 1)}
    />
  )
}
