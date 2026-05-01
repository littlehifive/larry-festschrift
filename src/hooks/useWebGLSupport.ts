import { useEffect, useState } from 'react'
import * as THREE from 'three'
import type { RendererCapability } from '../types/content'

function detectWebGLSupport() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false
  }

  try {
    const canvas = document.createElement('canvas')
    const contexts = ['webgl2', 'webgl', 'experimental-webgl'] as const
    const hasContext = contexts.some((name) => canvas.getContext(name))
    if (!hasContext) return false

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: 'low-power',
    })
    renderer.dispose()
    return true
  } catch {
    return false
  }
}

export function useWebGLSupport() {
  const [capability, setCapability] = useState<RendererCapability>({
    canMount3D: false,
    failureReason: 'pending',
  })

  useEffect(() => {
    try {
      if (detectWebGLSupport()) {
        setCapability({ canMount3D: true })
      } else {
        setCapability({
          canMount3D: false,
          failureReason: 'This browser could not pass the WebGL preflight.',
        })
      }
    } catch (error) {
      setCapability({
        canMount3D: false,
        failureReason:
          error instanceof Error ? error.message : 'WebGL renderer preflight failed.',
      })
    }
  }, [])

  return capability
}
