import { useEffect, useState } from 'react'
import { brainRegions, themes } from './content'
import { NetworkSection } from './components/NetworkSection'
import { useReducedMotion } from './hooks/useReducedMotion'
import { useWebGLSupport } from './hooks/useWebGLSupport'
import type { GraphSceneConfig } from './types/content'

const graphSceneConfig: GraphSceneConfig = {
  autoRotateSpeed: 0.36,
  nodeScaleRange: [0.04, 0.085],
  edgeOpacity: 0.18,
  brainShellOpacity: 0.16,
  effectsLevel: 'minimal',
}

export default function App() {
  const reducedMotion = useReducedMotion()
  const rendererCapability = useWebGLSupport()

  const [activeThemeId, setActiveThemeId] = useState(themes[0]?.id ?? '')
  const [activeAuthorId, setActiveAuthorId] = useState<string | null>(null)
  const [isAutoRotating, setAutoRotating] = useState(true)
  const [resetNonce, setResetNonce] = useState(0)

  useEffect(() => {
    if (!reducedMotion) return
    setAutoRotating((value) => (value ? false : value))
  }, [reducedMotion])

  return (
    <NetworkSection
      brainRegions={brainRegions}
      themes={themes}
      rendererCapability={rendererCapability}
      sceneConfig={graphSceneConfig}
      activeThemeId={activeThemeId}
      activeAuthorId={activeAuthorId}
      isAutoRotating={isAutoRotating && !reducedMotion}
      reducedMotion={reducedMotion}
      resetNonce={resetNonce}
      onThemeSelect={(themeId) => {
        setActiveThemeId(themeId)
        setActiveAuthorId(null)
      }}
      onAuthorSelect={(authorId) => setActiveAuthorId(authorId)}
      onToggleAutoRotate={() => setAutoRotating((value) => !value)}
      onResetView={() => {
        setActiveAuthorId(null)
        setResetNonce((value) => value + 1)
      }}
    />
  )
}
