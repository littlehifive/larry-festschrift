import type { CSSProperties } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { coauthorNetwork } from '../content'
import type {
  BrainRegion,
  CoauthorAuthor,
  CoauthorEdge,
  CoauthorPaper,
  GraphSceneConfig,
  RendererCapability,
  Theme,
} from '../types/content'

type NetworkSectionProps = {
  brainRegions: BrainRegion[]
  themes: Theme[]
  rendererCapability: RendererCapability
  sceneConfig: GraphSceneConfig
  activeThemeId: string
  activeAuthorId: string | null
  isAutoRotating: boolean
  reducedMotion: boolean
  resetNonce: number
  onThemeSelect: (themeId: string) => void
  onAuthorSelect: (authorId: string) => void
  onToggleAutoRotate: () => void
  onResetView: () => void
}

type GraphNode = {
  id: string
  name: string
  themeId: string
  color: string
  position: [number, number, number]
  size: number
  paperCount: number
  isCentral: boolean
}

type GraphEdge = {
  id: string
  sourceId: string
  targetId: string
  weight: number
  color: string
  withCentral: boolean
  points: [number, number, number][]
  themeIds: [string, string]
}

type GraphLayout = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  nodeMap: Map<string, GraphNode>
}

type NodeVisual = {
  datum: GraphNode
  core: any
  halo: any
}

type EdgeVisual = {
  datum: GraphEdge
  line: any
}

type RegionVisual = {
  themeId: string
  fill: any
  aura: any
}

type BrainSceneHandle = {
  applyState: (next: { activeThemeId: string; activeAuthorId: string | null }) => void
  setAutoRotate: (enabled: boolean, speed: number) => void
  resetView: () => void
  dispose: () => void
}

const LABEL_NODE_COUNT = 14

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0.4, 0.55, 6.6)
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 0.05, 0)
const CENTRAL_POSITION: [number, number, number] = [0, 0.05, 0]

function hashNumber(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0
  }
  return (hash % 1000) / 1000
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function toVector3(point: [number, number, number]) {
  return new THREE.Vector3(point[0], point[1], point[2])
}

function project2D(position: [number, number, number]) {
  const x = clamp(50 + position[0] * 16 + position[2] * 8, 8, 92)
  const y = clamp(58 - position[1] * 14 - position[2] * 4, 10, 90)
  return { x, y }
}

function brainSurfaceRadius(direction: { x: number; y: number; z: number }): number {
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1
  const nx = direction.x / length
  const ny = direction.y / length
  const nz = direction.z / length

  const gyri =
    Math.sin(nx * 9.4 + ny * 4.6) * 0.06 +
    Math.cos(ny * 8.2 - nz * 5.1) * 0.05 +
    Math.sin(nz * 11.0 + nx * 3.1) * 0.04

  let scale = 1 + gyri
  const fissureFalloff = Math.max(0, 0.18 - Math.abs(nx))
  scale -= fissureFalloff * 0.34 * Math.max(0, ny + 0.1)

  const stretchY = 0.96 + ny * 0.04
  const squashZ = 0.92 + Math.abs(nz) * 0.06
  const lateralStretch = 1.04
  const baseRadius = 1.55 * scale
  return Math.sqrt(
    Math.pow(nx * baseRadius * lateralStretch, 2) +
      Math.pow(ny * baseRadius * stretchY, 2) +
      Math.pow(nz * baseRadius * squashZ, 2),
  )
}

function fitInBrain(
  position: [number, number, number],
  fillFactor: number,
): [number, number, number] {
  const length = Math.hypot(position[0], position[1], position[2])
  if (length < 1e-6) return position
  const envelope = brainSurfaceRadius({ x: position[0], y: position[1], z: position[2] })
  const limit = envelope * fillFactor
  if (length <= limit) return position
  const scale = limit / length
  return [position[0] * scale, position[1] * scale, position[2] * scale]
}

function buildCurve(
  start: [number, number, number],
  end: [number, number, number],
  _weight: number,
  withCentral: boolean,
): [number, number, number][] {
  const startVector = toVector3(start)
  const endVector = toVector3(end)
  const distance = startVector.distanceTo(endVector)
  // Mostly-straight lines with a tiny arc so overlapping edges remain distinguishable.
  const lift = withCentral ? distance * 0.015 : distance * 0.04

  const mid = startVector.clone().lerp(endVector, 0.5)
  const tangent = new THREE.Vector3().subVectors(endVector, startVector).normalize()
  const up = new THREE.Vector3(0, 1, 0)
  const orthogonal = new THREE.Vector3().crossVectors(tangent, up)
  if (orthogonal.lengthSq() < 1e-6) orthogonal.set(1, 0, 0)
  orthogonal.normalize()

  mid.add(orthogonal.multiplyScalar(lift))

  if (lift < 0.01) {
    return [
      [startVector.x, startVector.y, startVector.z],
      [endVector.x, endVector.y, endVector.z],
    ]
  }

  const curve = new THREE.QuadraticBezierCurve3(startVector, mid, endVector)
  const segments = withCentral ? 4 : 6
  return curve.getPoints(segments).map((point: { x: number; y: number; z: number }) =>
    [point.x, point.y, point.z] as [number, number, number],
  )
}

function blendColors(hex1: string, hex2: string): string {
  const a = new THREE.Color(hex1)
  const b = new THREE.Color(hex2)
  return `#${a.lerp(b, 0.5).getHexString()}`
}

function buildLayout(
  network: typeof coauthorNetwork,
  brainRegions: BrainRegion[],
  themes: Theme[],
  centralColor: string,
): GraphLayout {
  const themeById = new Map(themes.map((theme) => [theme.id, theme]))
  const regionsByTheme = new Map(brainRegions.map((region) => [region.themeId, region]))

  // Group authors by theme; sort by paperCount desc within each
  const authorsByTheme = new Map<string, CoauthorAuthor[]>()
  themes.forEach((theme) => authorsByTheme.set(theme.id, []))
  network.authors
    .filter((author) => author.id !== network.centralAuthorId)
    .forEach((author) => {
      const list = authorsByTheme.get(author.themeId)
      if (list) list.push(author)
    })
  authorsByTheme.forEach((list) =>
    list.sort((left, right) => right.paperCount - left.paperCount),
  )

  const minPapers = 1
  const maxPapers = network.authors.reduce(
    (max, author) =>
      author.id === network.centralAuthorId ? max : Math.max(max, author.paperCount),
    1,
  )
  const paperSpan = Math.max(1, maxPapers - minPapers)

  const nodes: GraphNode[] = []

  // Central node
  nodes.push({
    id: network.centralAuthorId,
    name:
      network.authors.find((author) => author.id === network.centralAuthorId)?.name ??
      'J. Lawrence Aber',
    themeId: 'central',
    color: centralColor,
    position: CENTRAL_POSITION,
    size: 0.16,
    paperCount: network.authors.find((author) => author.id === network.centralAuthorId)?.paperCount ?? 0,
    isCentral: true,
  })

  // Position authors per region using a Fibonacci-like distribution within the region's local volume
  authorsByTheme.forEach((list, themeId) => {
    const region = regionsByTheme.get(themeId)
    const theme = themeById.get(themeId)
    if (!region || !theme) return

    const total = list.length
    list.forEach((author, index) => {
      const seed = hashNumber(author.id)
      const seedB = hashNumber(`${author.id}-b`)
      const normalizedRank = total > 1 ? index / (total - 1) : 0
      const orbitAngle = GOLDEN_ANGLE * index + seed * Math.PI * 2
      // High-paper authors orbit closer to the region center; low-paper authors push outward
      const radial = region.radius * (0.18 + normalizedRank * 0.95 + seed * 0.18)
      const verticalSwing = (seedB - 0.5) * region.radius * 0.85
      const depthSwing = Math.sin(orbitAngle * 0.7) * region.radius * 0.65

      const raw: [number, number, number] = [
        region.anchor3D[0] + Math.cos(orbitAngle) * radial,
        region.anchor3D[1] + verticalSwing,
        region.anchor3D[2] + depthSwing,
      ]
      const placed = fitInBrain(raw, 0.92)

      const normalizedSize = Math.sqrt((author.paperCount - minPapers) / paperSpan || 0.05)
      const size = clamp(0.022 + normalizedSize * 0.052, 0.022, 0.085)

      nodes.push({
        id: author.id,
        name: author.name,
        themeId: author.themeId,
        color: theme.color,
        position: placed,
        size,
        paperCount: author.paperCount,
        isCentral: false,
      })
    })
  })

  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const))

  const edges: GraphEdge[] = network.edges
    .map((edge, index) => {
      const source = nodeMap.get(edge.sourceId)
      const target = nodeMap.get(edge.targetId)
      if (!source || !target) return null

      const withCentral =
        source.id === network.centralAuthorId || target.id === network.centralAuthorId
      const color = withCentral
        ? blendColors(centralColor, source.id === network.centralAuthorId ? target.color : source.color)
        : blendColors(source.color, target.color)

      return {
        id: `edge-${index}`,
        sourceId: source.id,
        targetId: target.id,
        weight: edge.weight,
        color,
        withCentral,
        points: buildCurve(source.position, target.position, edge.weight, withCentral),
        themeIds: [source.themeId, target.themeId] as [string, string],
      } as GraphEdge
    })
    .filter((edge): edge is GraphEdge => edge !== null)

  return { nodes, edges, nodeMap }
}

function buildBrainGeometry(): any {
  const geometry = new THREE.IcosahedronGeometry(1.55, 6)
  const positionAttr = geometry.attributes.position
  const vertex = new THREE.Vector3()

  for (let index = 0; index < positionAttr.count; index += 1) {
    vertex.fromBufferAttribute(positionAttr, index)
    const length = vertex.length()
    const normalized = vertex.clone().normalize()

    const gyri =
      Math.sin(normalized.x * 9.4 + normalized.y * 4.6) * 0.06 +
      Math.cos(normalized.y * 8.2 - normalized.z * 5.1) * 0.05 +
      Math.sin(normalized.z * 11.0 + normalized.x * 3.1) * 0.04

    let scale = 1 + gyri
    const fissureFalloff = Math.max(0, 0.18 - Math.abs(normalized.x))
    scale -= fissureFalloff * 0.34 * Math.max(0, normalized.y + 0.1)

    const stretchY = 0.96 + normalized.y * 0.04
    const squashZ = 0.92 + Math.abs(normalized.z) * 0.06

    const radial = length * scale
    vertex.copy(normalized).multiplyScalar(radial)
    vertex.y *= stretchY
    vertex.z *= squashZ
    vertex.x *= 1.04

    positionAttr.setXYZ(index, vertex.x, vertex.y, vertex.z)
  }

  geometry.computeVertexNormals()
  return geometry
}

function makeRadialTexture(size = 128) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.Texture()
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.78)')
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.18)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function createBrainScene(options: {
  mount: HTMLDivElement
  labelHost: HTMLDivElement
  tooltipHost: HTMLDivElement
  layout: GraphLayout
  brainRegions: BrainRegion[]
  themeById: Map<string, Theme>
  sceneConfig: GraphSceneConfig
  activeThemeId: string
  activeAuthorId: string | null
  isAutoRotating: boolean
  reducedMotion: boolean
  centralAuthorId: string
  onAuthorSelect: (authorId: string) => void
  onAuthorHover: (authorId: string | null) => void
  onRuntimeFailure: (reason: string) => void
}): BrainSceneHandle {
  const {
    mount,
    labelHost,
    tooltipHost,
    layout,
    brainRegions,
    themeById,
    sceneConfig,
    activeThemeId,
    activeAuthorId,
    isAutoRotating,
    reducedMotion,
    centralAuthorId,
    onAuthorSelect,
    onAuthorHover,
    onRuntimeFailure,
  } = options

  const renderer = new THREE.WebGLRenderer({
    antialias: !reducedMotion,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.setClearColor(0x02080d, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, reducedMotion ? 1.4 : 1.85))

  mount.innerHTML = ''
  mount.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x02080d, 0.078)

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
  camera.position.copy(DEFAULT_CAMERA_POSITION)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.07
  controls.minDistance = 4.2
  controls.maxDistance = 10.5
  controls.minPolarAngle = Math.PI * 0.22
  controls.maxPolarAngle = Math.PI * 0.78
  controls.enablePan = false
  controls.target.copy(DEFAULT_CAMERA_TARGET)
  controls.autoRotate = isAutoRotating && !reducedMotion
  controls.autoRotateSpeed = sceneConfig.autoRotateSpeed

  let composer: any | null = null
  try {
    composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.5, 0.78)
    composer.addPass(bloom)
  } catch {
    composer = null
  }

  const root = new THREE.Group()
  scene.add(root)

  const brainShellGroup = new THREE.Group()
  root.add(brainShellGroup)

  const regionVisuals = new Map<string, RegionVisual>()
  const nodeVisuals = new Map<string, NodeVisual>()
  const edgeVisuals: EdgeVisual[] = []
  const interactiveMeshes: any[] = []

  scene.add(new THREE.AmbientLight(0xb8e2ff, 0.85))
  const keyLight = new THREE.DirectionalLight(0xa8d4ff, 1.5)
  keyLight.position.set(4.2, 6.4, 5.6)
  scene.add(keyLight)
  const rimLight = new THREE.PointLight(0x4f9bff, 26, 18, 1.6)
  rimLight.position.set(-3.6, 1.4, -3.4)
  scene.add(rimLight)
  const warmLight = new THREE.PointLight(0xffb85a, 14, 14, 1.8)
  warmLight.position.set(2.6, -1.6, 3.4)
  scene.add(warmLight)

  const radialTexture = makeRadialTexture(160)
  const brainGeometry = buildBrainGeometry()

  const brainShellMaterial = new THREE.MeshPhysicalMaterial({
    color: '#9ed8f5',
    transparent: true,
    opacity: 0.06,
    roughness: 0.7,
    metalness: 0.02,
    transmission: 0.6,
    thickness: 1.6,
    ior: 1.12,
    emissive: '#072636',
    emissiveIntensity: 0.18,
    clearcoat: 0.16,
    clearcoatRoughness: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const brainMesh = new THREE.Mesh(brainGeometry, brainShellMaterial)
  brainShellGroup.add(brainMesh)

  const brainWireMaterial = new THREE.LineBasicMaterial({
    color: '#7feeff',
    transparent: true,
    opacity: 0.06,
    depthWrite: false,
  })
  const brainWire = new THREE.LineSegments(
    new THREE.WireframeGeometry(brainGeometry),
    brainWireMaterial,
  )
  brainShellGroup.add(brainWire)

  // Cerebellum
  const cerebellumGeometry = new THREE.SphereGeometry(0.55, 32, 24)
  const cerebellumPositions = cerebellumGeometry.attributes.position
  const tmp = new THREE.Vector3()
  for (let index = 0; index < cerebellumPositions.count; index += 1) {
    tmp.fromBufferAttribute(cerebellumPositions, index)
    const noise =
      Math.sin(tmp.x * 16) * 0.025 + Math.cos(tmp.y * 14) * 0.02 + Math.sin(tmp.z * 18) * 0.022
    tmp.multiplyScalar(1 + noise)
    cerebellumPositions.setXYZ(index, tmp.x, tmp.y, tmp.z)
  }
  cerebellumGeometry.computeVertexNormals()
  const cerebellum = new THREE.Mesh(cerebellumGeometry, brainShellMaterial.clone())
  cerebellum.position.set(0, -0.55, -1.05)
  cerebellum.scale.set(1.1, 0.78, 0.92)
  brainShellGroup.add(cerebellum)

  brainRegions.forEach((region) => {
    const theme = themeById.get(region.themeId)
    const color = theme?.color ?? region.color

    const aura = new THREE.Mesh(
      new THREE.IcosahedronGeometry(region.radius * 1.45, 3),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
      }),
    )
    aura.position.set(region.anchor3D[0], region.anchor3D[1], region.anchor3D[2])
    aura.scale.set(1.1, 0.92, 0.92)

    const fill = new THREE.Mesh(
      new THREE.IcosahedronGeometry(region.radius * 0.95, 3),
      new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0.08,
        emissive: color,
        emissiveIntensity: 0.18,
        roughness: 0.62,
        metalness: 0.16,
        flatShading: true,
        depthWrite: false,
      }),
    )
    fill.position.copy(aura.position)
    fill.scale.set(1.04, 0.84, 0.78)

    root.add(aura, fill)
    regionVisuals.set(region.id, { themeId: region.themeId, fill, aura })
  })

  // Edges
  layout.edges.forEach((edge) => {
    const points = edge.points.map((point) => toVector3(point))
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({
      color: edge.color,
      transparent: true,
      opacity: edge.withCentral ? 0.45 : 0.18,
      depthWrite: false,
    })
    const line = new THREE.Line(geometry, material)
    root.add(line)
    edgeVisuals.push({ datum: edge, line })
  })

  const sphereGeometry = new THREE.SphereGeometry(1, 16, 16)
  const centralGeometry = new THREE.SphereGeometry(1, 32, 24)

  layout.nodes.forEach((node) => {
    const coreColor = new THREE.Color(node.color)
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: coreColor,
      transparent: true,
      opacity: 1,
    })
    const core = new THREE.Mesh(node.isCentral ? centralGeometry : sphereGeometry, coreMaterial)
    core.scale.setScalar(node.size)
    core.position.set(node.position[0], node.position[1], node.position[2])
    core.userData.nodeId = node.id

    const haloMaterial = new THREE.SpriteMaterial({
      map: radialTexture,
      color: coreColor,
      transparent: true,
      opacity: node.isCentral ? 0.55 : 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const halo = new THREE.Sprite(haloMaterial)
    const haloScale = node.size * (node.isCentral ? 3.6 : 2.0)
    halo.scale.set(haloScale, haloScale, 1)
    halo.position.copy(core.position)
    halo.userData.highlightScale = 1
    halo.userData.baseScale = haloScale

    root.add(halo, core)
    nodeVisuals.set(node.id, { datum: node, core, halo })
    interactiveMeshes.push(core)
  })

  // Enlarge raycaster hit-area for tiny dots so they remain easy to click
  const raycasterThreshold = Math.max(...layout.nodes.map((node) => node.size)) * 1.4

  // Subtle particles inside the brain (kept very faint so they don't compete with the dots)
  const neuronCount = reducedMotion ? 60 : 140
  const neuronPositions = new Float32Array(neuronCount * 3)
  for (let index = 0; index < neuronCount; index += 1) {
    const seed = hashNumber(`neuron-${index}`)
    const seed2 = hashNumber(`neuron-y-${index}`)
    const seed3 = hashNumber(`neuron-z-${index}`)
    const radius = 0.4 + seed * 1.1
    const theta = seed2 * Math.PI * 2
    const phi = Math.acos(1 - 2 * seed3)
    const offset = index * 3
    neuronPositions[offset] = Math.cos(theta) * Math.sin(phi) * radius
    neuronPositions[offset + 1] = (Math.cos(phi) - 0.05) * radius * 1.05
    neuronPositions[offset + 2] = Math.sin(theta) * Math.sin(phi) * radius * 0.92
  }
  const neuronGeometry = new THREE.BufferGeometry()
  neuronGeometry.setAttribute('position', new THREE.BufferAttribute(neuronPositions, 3))
  const neuronMaterial = new THREE.PointsMaterial({
    size: 0.015,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.18,
    color: '#7feeff',
    depthWrite: false,
  })
  const neurons = new THREE.Points(neuronGeometry, neuronMaterial)
  root.add(neurons)

  // Distant stars
  const starCount = reducedMotion ? 180 : 360
  const starPositions = new Float32Array(starCount * 3)
  for (let index = 0; index < starCount; index += 1) {
    const offset = index * 3
    const seed = hashNumber(`star-${index}`)
    const seed2 = hashNumber(`star-y-${index}`)
    const radius = 5 + seed * 7
    const theta = seed * Math.PI * 5.2
    const phi = (seed2 * 17.2) % Math.PI
    starPositions[offset] = Math.cos(theta) * Math.sin(phi) * radius
    starPositions[offset + 1] = Math.cos(phi) * radius * 0.6
    starPositions[offset + 2] = Math.sin(theta) * Math.sin(phi) * radius
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
      map: radialTexture,
      color: '#9fdcff',
      transparent: true,
      opacity: reducedMotion ? 0.3 : 0.5,
      size: reducedMotion ? 0.07 : 0.1,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  scene.add(stars)

  // Pre-compute neighbor sets for fast highlight
  const neighborMap = new Map<string, Set<string>>()
  layout.edges.forEach((edge) => {
    if (!neighborMap.has(edge.sourceId)) neighborMap.set(edge.sourceId, new Set())
    if (!neighborMap.has(edge.targetId)) neighborMap.set(edge.targetId, new Set())
    neighborMap.get(edge.sourceId)!.add(edge.targetId)
    neighborMap.get(edge.targetId)!.add(edge.sourceId)
  })

  // Pick the always-on label set: central + top-N by paper count.
  const persistentLabelIds = new Set<string>([centralAuthorId])
  ;[...layout.nodes]
    .filter((node) => !node.isCentral)
    .sort((left, right) => right.paperCount - left.paperCount)
    .slice(0, LABEL_NODE_COUNT)
    .forEach((node) => persistentLabelIds.add(node.id))

  type LabelEntry = {
    nodeId: string
    el: HTMLElement
    persistent: boolean
  }
  const labelEntries = new Map<string, LabelEntry>()

  while (labelHost.firstChild) labelHost.removeChild(labelHost.firstChild)

  function makeLabel(node: GraphNode, persistent: boolean) {
    const el = document.createElement('div')
    el.className = `brain-label${persistent ? ' brain-label--persistent' : ''}${
      node.isCentral ? ' brain-label--central' : ''
    }`
    el.style.setProperty('--theme-color', node.color)
    el.textContent = node.name
    labelHost.appendChild(el)
    labelEntries.set(node.id, { nodeId: node.id, el, persistent })
  }

  layout.nodes.forEach((node) => {
    if (persistentLabelIds.has(node.id)) makeLabel(node, true)
  })

  function ensureFloatingLabel(nodeId: string) {
    if (labelEntries.has(nodeId)) return
    const node = layout.nodeMap.get(nodeId)
    if (!node) return
    makeLabel(node, false)
  }

  function clearFloatingLabel(nodeId: string | null) {
    if (!nodeId) return
    const entry = labelEntries.get(nodeId)
    if (!entry || entry.persistent) return
    labelHost.removeChild(entry.el)
    labelEntries.delete(nodeId)
  }

  // Tooltip
  const tooltipEl = document.createElement('div')
  tooltipEl.className = 'brain-tooltip'
  tooltipEl.style.opacity = '0'
  tooltipHost.innerHTML = ''
  tooltipHost.appendChild(tooltipEl)

  let hoveredId: string | null = null

  const raycaster = new THREE.Raycaster()
  raycaster.params.Mesh = { threshold: raycasterThreshold } as any
  const pointer = new THREE.Vector2()
  let pointerDown = { x: 0, y: 0 }
  let disposed = false
  let frame = 0
  let bootElapsed = 0
  const clock = new THREE.Clock()
  const initialCameraOffset = camera.position.clone().sub(DEFAULT_CAMERA_TARGET)
  const dollyStart = initialCameraOffset.clone().multiplyScalar(1.35)
  const projectionVector = new THREE.Vector3()

  function setSize() {
    const width = Math.max(1, mount.clientWidth)
    const height = Math.max(1, mount.clientHeight)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    if (composer) composer.setSize(width, height)
  }
  setSize()

  const resizeObserver = new ResizeObserver(() => setSize())
  resizeObserver.observe(mount)

  let currentThemeId = activeThemeId
  let currentAuthorId: string | null = activeAuthorId

  const applyState: BrainSceneHandle['applyState'] = ({
    activeThemeId: nextThemeId,
    activeAuthorId: nextAuthorId,
  }) => {
    currentThemeId = nextThemeId
    currentAuthorId = nextAuthorId
    refreshHighlight()
  }

  function refreshHighlight() {
    const selectedNeighbors = currentAuthorId ? neighborMap.get(currentAuthorId) : null
    const hoveredNeighbors = hoveredId ? neighborMap.get(hoveredId) : null
    const focusId = currentAuthorId ?? hoveredId
    const focusNeighbors = currentAuthorId ? selectedNeighbors : hoveredNeighbors

    nodeVisuals.forEach((visual) => {
      const isCentral = visual.datum.isCentral
      const themeMatch = visual.datum.themeId === currentThemeId
      const isSelected = visual.datum.id === currentAuthorId
      const isHovered = visual.datum.id === hoveredId
      const isLinked = !!focusNeighbors && focusNeighbors.has(visual.datum.id)

      let emphasis: number
      if (isCentral) emphasis = 1
      else if (isSelected) emphasis = 1
      else if (focusId) emphasis = isLinked ? 0.85 : isHovered ? 1 : 0.08
      else emphasis = themeMatch ? 0.95 : 0.18

      visual.core.material.opacity = 0.18 + emphasis * 0.82
      visual.halo.material.opacity =
        (isCentral ? 0.2 : 0.04) + emphasis * (isCentral ? 0.55 : 0.4)

      const nodeScale = isSelected || isHovered ? 1.55 : isCentral ? 1.2 : isLinked ? 1.25 : 1
      visual.core.scale.setScalar(visual.datum.size * nodeScale)
      visual.halo.userData.highlightScale =
        isSelected || isHovered ? 1.4 : isCentral ? 1.2 : isLinked ? 1.18 : 1
    })

    edgeVisuals.forEach((edgeVisual) => {
      const connectsFocus =
        focusId &&
        (edgeVisual.datum.sourceId === focusId || edgeVisual.datum.targetId === focusId)
      const themeMatch =
        edgeVisual.datum.themeIds.includes(currentThemeId) ||
        edgeVisual.datum.themeIds[0] === 'central' ||
        edgeVisual.datum.themeIds[1] === 'central'

      let opacity: number
      if (connectsFocus) opacity = edgeVisual.datum.withCentral ? 0.95 : 0.85
      else if (focusId) opacity = 0.025
      else if (edgeVisual.datum.withCentral && themeMatch) opacity = 0.55
      else if (edgeVisual.datum.withCentral) opacity = 0.32
      else if (themeMatch) opacity = 0.4
      else opacity = 0.1

      edgeVisual.line.material.opacity = opacity
      edgeVisual.line.material.color.set(connectsFocus ? '#ffffff' : edgeVisual.datum.color)
    })

    regionVisuals.forEach((visual) => {
      const emphasized = visual.themeId === currentThemeId
      visual.fill.material.opacity = emphasized ? 0.22 : 0.04
      visual.fill.material.emissiveIntensity = emphasized ? 0.5 : 0.12
      visual.aura.material.opacity = emphasized ? 0.12 : 0.02
    })
  }

  let lastPointerEvent: PointerEvent | null = null

  function setHovered(nextId: string | null, event?: PointerEvent | null) {
    if (nextId === hoveredId) return
    if (hoveredId) clearFloatingLabel(hoveredId)
    hoveredId = nextId
    if (nextId) ensureFloatingLabel(nextId)
    onAuthorHover(nextId)
    refreshHighlight()
    if (nextId) {
      const node = layout.nodeMap.get(nextId)
      if (node && event) {
        tooltipEl.innerHTML = `<strong>${node.name}</strong><span>${node.paperCount} paper${
          node.paperCount === 1 ? '' : 's'
        }</span>`
        tooltipEl.style.opacity = '1'
        const hostBounds = tooltipHost.getBoundingClientRect()
        tooltipEl.style.transform = `translate3d(${event.clientX - hostBounds.left + 14}px, ${
          event.clientY - hostBounds.top + 14
        }px, 0)`
      }
    } else {
      tooltipEl.style.opacity = '0'
    }
  }

  const handlePointerDown = (event: PointerEvent) => {
    pointerDown = { x: event.clientX, y: event.clientY }
  }

  const handlePointerMove = (event: PointerEvent) => {
    if (disposed) return
    lastPointerEvent = event
    const bounds = renderer.domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const intersects = raycaster.intersectObjects(interactiveMeshes, false)
    const nextHover = intersects[0]?.object?.userData?.nodeId ?? null
    renderer.domElement.style.cursor = nextHover ? 'pointer' : 'grab'
    setHovered(nextHover, event)

    if (hoveredId) {
      const hostBounds = tooltipHost.getBoundingClientRect()
      tooltipEl.style.transform = `translate3d(${event.clientX - hostBounds.left + 14}px, ${
        event.clientY - hostBounds.top + 14
      }px, 0)`
    }
  }

  const handlePointerLeave = () => {
    lastPointerEvent = null
    setHovered(null)
  }

  const handlePointerUp = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6) return
    const bounds = renderer.domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const intersects = raycaster.intersectObjects(interactiveMeshes, false)
    const hit = intersects[0]
    if (!hit?.object?.userData?.nodeId) return
    onAuthorSelect(hit.object.userData.nodeId)
  }

  const handleContextLost = (event: Event) => {
    event.preventDefault()
    if (disposed) return
    onRuntimeFailure(
      'The browser lost the WebGL context. The site switched to the static graph fallback.',
    )
  }

  renderer.domElement.addEventListener('pointerdown', handlePointerDown)
  renderer.domElement.addEventListener('pointermove', handlePointerMove)
  renderer.domElement.addEventListener('pointerup', handlePointerUp)
  renderer.domElement.addEventListener('pointerleave', handlePointerLeave)
  renderer.domElement.addEventListener('webglcontextlost', handleContextLost, false)
  renderer.domElement.style.cursor = 'grab'

  const animate = () => {
    if (disposed) return
    frame = window.requestAnimationFrame(animate)
    const delta = clock.getDelta()
    const elapsed = clock.getElapsedTime()

    if (bootElapsed < 1.4 && !reducedMotion) {
      bootElapsed += delta
      const t = clamp(bootElapsed / 1.4, 0, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      const offset = dollyStart.clone().lerp(initialCameraOffset, eased)
      camera.position.copy(DEFAULT_CAMERA_TARGET.clone().add(offset))
    }

    brainShellGroup.rotation.y += reducedMotion ? 0.0004 : 0.0008
    neurons.rotation.y += reducedMotion ? 0.0002 : 0.0004

    nodeVisuals.forEach((visual) => {
      const phase = hashNumber(visual.datum.id) * Math.PI * 2
      const pulse = 1 + Math.sin(elapsed * 1.4 + phase) * (reducedMotion ? 0.02 : 0.045)
      const highlight =
        typeof visual.halo.userData.highlightScale === 'number'
          ? visual.halo.userData.highlightScale
          : 1
      const baseScale = (visual.halo.userData.baseScale as number) * pulse * highlight
      visual.halo.scale.set(baseScale, baseScale, 1)
    })

    controls.update()
    try {
      if (composer) composer.render(delta)
      else renderer.render(scene, camera)
    } catch (error) {
      onRuntimeFailure(
        error instanceof Error
          ? error.message
          : 'The 3D renderer failed at draw time and was disabled.',
      )
    }

    // Project labels to screen
    if (labelEntries.size > 0) {
      const width = renderer.domElement.clientWidth
      const height = renderer.domElement.clientHeight
      labelEntries.forEach((entry) => {
        const node = layout.nodeMap.get(entry.nodeId)
        if (!node) {
          entry.el.style.display = 'none'
          return
        }
        projectionVector.set(node.position[0], node.position[1], node.position[2])
        const worldPos = projectionVector.clone().applyMatrix4(root.matrixWorld)
        worldPos.project(camera)
        const x = (worldPos.x * 0.5 + 0.5) * width
        const y = (-worldPos.y * 0.5 + 0.5) * height
        if (
          worldPos.z > 1 ||
          worldPos.z < -1 ||
          x < -100 ||
          x > width + 100 ||
          y < -40 ||
          y > height + 40
        ) {
          entry.el.style.opacity = '0'
        } else {
          entry.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -120%)`
          // Fade by depth so far-side labels don't crowd the front
          const depthFade = clamp(1 - Math.max(0, worldPos.z) * 1.4, 0.18, 1)
          entry.el.style.opacity = String(depthFade)
        }
      })
    }

    // Track tooltip position even when not actively moving the cursor (e.g., during autorotate)
    if (hoveredId && lastPointerEvent) {
      const hostBounds = tooltipHost.getBoundingClientRect()
      tooltipEl.style.transform = `translate3d(${
        lastPointerEvent.clientX - hostBounds.left + 14
      }px, ${lastPointerEvent.clientY - hostBounds.top + 14}px, 0)`
    }
  }

  applyState({ activeThemeId, activeAuthorId })
  animate()

  return {
    applyState,
    setAutoRotate(enabled, speed) {
      controls.autoRotate = enabled
      controls.autoRotateSpeed = speed
    },
    resetView() {
      camera.position.copy(DEFAULT_CAMERA_POSITION)
      controls.target.copy(DEFAULT_CAMERA_TARGET)
      bootElapsed = 1.4
      controls.update()
    },
    dispose() {
      disposed = true
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      renderer.domElement.removeEventListener('pointermove', handlePointerMove)
      renderer.domElement.removeEventListener('pointerup', handlePointerUp)
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost)
      controls.dispose()
      scene.traverse((object: { geometry?: { dispose: () => void }; material?: unknown }) => {
        const mesh = object as any
        if (mesh.geometry) mesh.geometry.dispose()
        const material = (mesh as { material?: any | any[] }).material
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
        else material?.dispose()
      })
      labelEntries.forEach((entry) => {
        if (labelHost.contains(entry.el)) labelHost.removeChild(entry.el)
      })
      labelEntries.clear()
      if (tooltipHost.contains(tooltipEl)) tooltipHost.removeChild(tooltipEl)
      radialTexture.dispose?.()
      composer?.dispose?.()
      renderer.dispose()
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement)
      }
    },
  }
}

function FallbackGraph(props: {
  layout: GraphLayout
  brainRegions: BrainRegion[]
  themeById: Map<string, Theme>
  activeThemeId: string
  activeAuthorId: string | null
  onAuthorSelect: (authorId: string) => void
}) {
  const { layout, brainRegions, themeById, activeThemeId, activeAuthorId, onAuthorSelect } = props

  return (
    <div className="brain-fallback">
      <svg className="brain-fallback__shell" viewBox="0 0 100 100" aria-hidden="true">
        <path
          className="brain-fallback__outline"
          d="M 17 55 C 13 28, 28 12, 47 13 C 58 8, 81 18, 85 41 C 89 55, 84 77, 67 86 C 57 92, 46 91, 38 86 C 21 81, 13 68, 17 55 Z"
        />
        {brainRegions.map((region) => {
          const theme = themeById.get(region.themeId)
          const point = project2D(region.anchor3D)
          const color = theme?.color ?? '#7feeff'
          return (
            <ellipse
              key={region.id}
              cx={point.x}
              cy={point.y}
              rx={region.radius * 17}
              ry={region.radius * 11}
              fill={`${color}26`}
            />
          )
        })}
        {layout.edges
          .filter((edge) => edge.withCentral)
          .map((edge) => {
            const source = layout.nodeMap.get(edge.sourceId)
            const target = layout.nodeMap.get(edge.targetId)
            if (!source || !target) return null
            const start = project2D(source.position)
            const end = project2D(target.position)
            return (
              <line
                key={edge.id}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={edge.color}
                strokeOpacity={0.38}
                strokeWidth={0.3}
              />
            )
          })}
      </svg>

      <div className="brain-fallback__nodes">
        {layout.nodes.map((node) => {
          const point = project2D(node.position)
          const isSelected = node.id === activeAuthorId
          const isThemeActive = node.themeId === activeThemeId || node.isCentral
          return (
            <button
              key={node.id}
              aria-label={node.name}
              title={node.name}
              className={[
                'brain-fallback__node',
                node.isCentral ? 'is-central' : '',
                isSelected ? 'is-selected' : '',
                isThemeActive ? 'is-theme-active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onAuthorSelect(node.id)}
              style={
                {
                  '--theme-color': node.color,
                  '--node-size': `${Math.max(node.size * (node.isCentral ? 80 : 40), 4)}px`,
                  left: `${point.x}%`,
                  top: `${point.y}%`,
                } as CSSProperties
              }
              type="button"
            />
          )
        })}
      </div>
    </div>
  )
}

const CENTRAL_COLOR = '#ffd166'

export function NetworkSection({
  brainRegions,
  themes,
  rendererCapability,
  sceneConfig,
  activeThemeId,
  activeAuthorId,
  isAutoRotating,
  reducedMotion,
  resetNonce,
  onThemeSelect,
  onAuthorSelect,
  onToggleAutoRotate,
  onResetView,
}: NetworkSectionProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const labelHostRef = useRef<HTMLDivElement | null>(null)
  const tooltipHostRef = useRef<HTMLDivElement | null>(null)
  const sceneHandleRef = useRef<BrainSceneHandle | null>(null)
  const onAuthorSelectRef = useRef(onAuthorSelect)
  const [runtimeFailure, setRuntimeFailure] = useState<string | null>(null)

  const themeById = useMemo(() => new Map(themes.map((theme) => [theme.id, theme])), [themes])
  const authorById = useMemo(
    () => new Map(coauthorNetwork.authors.map((author) => [author.id, author])),
    [],
  )
  const paperById = useMemo(
    () => new Map(coauthorNetwork.papers.map((paper) => [paper.id, paper])),
    [],
  )

  const layout = useMemo(
    () => buildLayout(coauthorNetwork, brainRegions, themes, CENTRAL_COLOR),
    [brainRegions, themes],
  )

  const centralAuthor = authorById.get(coauthorNetwork.centralAuthorId)
  const selectedAuthor = activeAuthorId ? authorById.get(activeAuthorId) ?? null : null

  const selectedTheme = selectedAuthor
    ? themeById.get(selectedAuthor.themeId)
    : themeById.get(activeThemeId)

  const selectedAuthorEdges = useMemo(() => {
    if (!activeAuthorId) return [] as Array<CoauthorEdge & { partner: CoauthorAuthor }>
    return coauthorNetwork.edges
      .filter((edge) => edge.sourceId === activeAuthorId || edge.targetId === activeAuthorId)
      .map((edge) => {
        const partnerId = edge.sourceId === activeAuthorId ? edge.targetId : edge.sourceId
        const partner = authorById.get(partnerId)
        return partner ? { ...edge, partner } : null
      })
      .filter(
        (entry): entry is CoauthorEdge & { partner: CoauthorAuthor } => entry !== null,
      )
      .sort((left, right) => right.weight - left.weight)
  }, [activeAuthorId, authorById])

  const selectedAuthorPapers = useMemo(() => {
    if (!activeAuthorId) return [] as CoauthorPaper[]
    return coauthorNetwork.papers
      .filter((paper) => paper.authorIds.includes(activeAuthorId))
      .sort((left, right) => (right.year ?? 0) - (left.year ?? 0))
  }, [activeAuthorId])

  const themeStats = useMemo(() => {
    const stats = new Map<string, number>()
    coauthorNetwork.authors.forEach((author) => {
      if (author.id === coauthorNetwork.centralAuthorId) return
      stats.set(author.themeId, (stats.get(author.themeId) ?? 0) + 1)
    })
    return stats
  }, [])

  const show3D = rendererCapability.canMount3D && runtimeFailure === null
  const fallbackReason = runtimeFailure ?? rendererCapability.failureReason ?? null

  useEffect(() => {
    onAuthorSelectRef.current = onAuthorSelect
  }, [onAuthorSelect])

  useEffect(() => {
    if (!show3D || !stageRef.current || !labelHostRef.current || !tooltipHostRef.current) return
    let cancelled = false

    try {
      const handle = createBrainScene({
        mount: stageRef.current,
        labelHost: labelHostRef.current,
        tooltipHost: tooltipHostRef.current,
        layout,
        brainRegions,
        themeById,
        sceneConfig,
        activeThemeId,
        activeAuthorId,
        isAutoRotating,
        reducedMotion,
        centralAuthorId: coauthorNetwork.centralAuthorId,
        onAuthorSelect: (authorId) => onAuthorSelectRef.current(authorId),
        onAuthorHover: () => undefined,
        onRuntimeFailure: (reason) => {
          if (!cancelled) setRuntimeFailure(reason)
        },
      })
      if (cancelled) {
        handle.dispose()
        return
      }
      sceneHandleRef.current = handle
    } catch (error) {
      if (!cancelled) {
        setRuntimeFailure(
          error instanceof Error
            ? error.message
            : 'The 3D scene failed to initialize, so the static graph fallback was rendered instead.',
        )
      }
    }

    return () => {
      cancelled = true
      sceneHandleRef.current?.dispose()
      sceneHandleRef.current = null
    }
  }, [brainRegions, layout, reducedMotion, sceneConfig, show3D, themeById])

  useEffect(() => {
    sceneHandleRef.current?.applyState({ activeThemeId, activeAuthorId })
  }, [activeAuthorId, activeThemeId])

  useEffect(() => {
    sceneHandleRef.current?.setAutoRotate(
      isAutoRotating && !reducedMotion,
      sceneConfig.autoRotateSpeed,
    )
  }, [isAutoRotating, reducedMotion, sceneConfig.autoRotateSpeed])

  useEffect(() => {
    sceneHandleRef.current?.resetView()
  }, [resetNonce])

  return (
    <section className="brain-graph-page">
      <div className="brain-graph-page__chrome" aria-hidden="true">
        <span className="brain-graph-page__halo brain-graph-page__halo--amber" />
        <span className="brain-graph-page__halo brain-graph-page__halo--blue" />
        <span className="brain-graph-page__grid" />
      </div>

      <div className="brain-graph-stage">
        <div className="brain-graph-stage__viewport">
          {show3D ? (
            <>
              <div className="brain-graph-stage__canvas" ref={stageRef} />
              <div className="brain-graph-stage__labels" ref={labelHostRef} aria-hidden="true" />
              <div
                className="brain-graph-stage__tooltip-host"
                ref={tooltipHostRef}
                aria-hidden="true"
              />
            </>
          ) : (
            <FallbackGraph
              layout={layout}
              brainRegions={brainRegions}
              themeById={themeById}
              activeThemeId={activeThemeId}
              activeAuthorId={activeAuthorId}
              onAuthorSelect={onAuthorSelect}
            />
          )}

          <div className="brain-graph-stage__controls panel">
            <div className="brain-graph-stage__mode">
              <span className={show3D ? 'is-live' : 'is-fallback'}>
                {show3D ? '3D live' : 'Fallback'}
              </span>
              {fallbackReason ? (
                <p>{fallbackReason}</p>
              ) : (
                <p>Click any node. Drag to orbit, scroll to zoom.</p>
              )}
            </div>

            <div className="brain-graph-stage__button-row">
              <button
                className="button button--primary"
                disabled={!show3D || reducedMotion}
                onClick={onToggleAutoRotate}
                type="button"
              >
                {isAutoRotating && !reducedMotion ? 'Pause rotation' : 'Play rotation'}
              </button>
              <button
                className="button button--ghost"
                disabled={!show3D}
                onClick={onResetView}
                type="button"
              >
                Reset view
              </button>
            </div>
          </div>
        </div>

        <aside className="brain-graph-sidebar">
          <header className="panel brain-graph-sidebar__intro">
            <p className="brain-graph-sidebar__label">Larry Aber Festschrift</p>
            <h1>Inside Larry Aber</h1>
            <p className="brain-graph-sidebar__lede">
              Every node is a co-author from Larry&apos;s CV. Larry sits at the center, connected
              by an edge for every shared paper. Co-authors also link to each other when their
              names appear together.
            </p>
            <div className="brain-graph-sidebar__metrics">
              <div>
                <span>Papers</span>
                <strong>{coauthorNetwork.paperCount}</strong>
              </div>
              <div>
                <span>Co-authors</span>
                <strong>{coauthorNetwork.authorCount - 1}</strong>
              </div>
              <div>
                <span>Edges</span>
                <strong>{coauthorNetwork.edgeCount}</strong>
              </div>
            </div>
          </header>

          <div className="panel brain-graph-sidebar__themes">
            <p className="brain-graph-sidebar__label">Theme regions</p>
            <div className="brain-graph-sidebar__theme-list">
              {themes.map((theme) => (
                <button
                  key={theme.id}
                  aria-pressed={theme.id === activeThemeId}
                  className={[
                    'theme-chip',
                    theme.id === activeThemeId ? 'is-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onThemeSelect(theme.id)}
                  style={{ '--theme-color': theme.color } as CSSProperties}
                  type="button"
                >
                  <span className="theme-chip__dot" />
                  <span>{theme.label}</span>
                  <span className="theme-chip__count">{themeStats.get(theme.id) ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="panel brain-graph-sidebar__selection">
            {selectedAuthor ? (
              <>
                <p className="brain-graph-sidebar__label">
                  {selectedAuthor.id === coauthorNetwork.centralAuthorId
                    ? 'Central node'
                    : 'Selected co-author'}
                </p>
                <h2>{selectedAuthor.name}</h2>
                <p className="brain-graph-sidebar__meta">
                  {selectedAuthor.paperCount} CV papers ·{' '}
                  {selectedAuthorEdges.length} co-author{selectedAuthorEdges.length === 1 ? '' : 's'}
                </p>
                {selectedTheme ? (
                  <div className="brain-graph-sidebar__theme-badges">
                    <span
                      className="brain-graph-sidebar__theme-badge"
                      style={{ '--theme-color': selectedTheme.color } as CSSProperties}
                    >
                      {selectedTheme.label}
                    </span>
                  </div>
                ) : null}

                {selectedAuthorEdges.length > 0 ? (
                  <div className="brain-graph-sidebar__linked">
                    <p className="brain-graph-sidebar__subhead">
                      Top co-authors of {selectedAuthor.name.split(' ').slice(-1)[0]}
                    </p>
                    <div className="brain-graph-sidebar__list">
                      {selectedAuthorEdges.slice(0, 8).map((entry) => (
                        <button
                          key={entry.partner.id}
                          onClick={() => onAuthorSelect(entry.partner.id)}
                          type="button"
                        >
                          <strong>×{entry.weight}</strong>
                          <span>{entry.partner.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedAuthorPapers.length > 0 ? (
                  <div className="brain-graph-sidebar__linked">
                    <p className="brain-graph-sidebar__subhead">CV citations</p>
                    <div className="brain-graph-sidebar__list">
                      {selectedAuthorPapers.slice(0, 8).map((paper) => (
                        <div className="brain-graph-sidebar__paper" key={paper.id}>
                          <strong>{paper.year ?? paper.yearLabel}</strong>
                          <span>{paper.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : centralAuthor ? (
              <>
                <p className="brain-graph-sidebar__label">Central node</p>
                <h2>{centralAuthor.name}</h2>
                <p className="brain-graph-sidebar__meta">
                  {centralAuthor.paperCount} papers · the gold node at the center of the brain.
                  Click it, or any other node, to trace its links.
                </p>
              </>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  )
}
