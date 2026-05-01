import type { CSSProperties } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { externalCitations } from '../content'
import type {
  BrainRegion,
  CitationLink,
  Collaborator,
  ExternalEdge,
  ExternalNode,
  GraphSceneConfig,
  RendererCapability,
  Theme,
  Work,
} from '../types/content'

type NetworkSectionProps = {
  works: Work[]
  collaborators: Collaborator[]
  citationLinks: CitationLink[]
  brainRegions: BrainRegion[]
  themes: Theme[]
  rendererCapability: RendererCapability
  sceneConfig: GraphSceneConfig
  activeThemeId: string
  activeWorkId: string | null
  activeCollaboratorId: string | null
  isAutoRotating: boolean
  reducedMotion: boolean
  resetNonce: number
  onThemeSelect: (themeId: string) => void
  onWorkSelect: (workId: string) => void
  onCollaboratorSelect: (collaboratorId: string) => void
  onToggleAutoRotate: () => void
  onResetView: () => void
}

type GraphNode = {
  id: string
  kind: 'work' | 'collaborator' | 'external'
  label: string
  themeIds: string[]
  primaryThemeId: string
  color: string
  position: [number, number, number]
  size: number
  citationCount?: number
  year?: number | null
  venue?: string | null
  doi?: string | null
  workIds?: string[]
  prominence?: number
  parentWorkId?: string
  authors?: string[]
}

type GraphEdge = {
  id: string
  sourceId: string
  targetId: string
  kind: CitationLink['kind'] | 'external_cites' | 'external_cited_by'
  weight: number
  color: string
  themeIds: string[]
  points: [number, number, number][]
  isExternal: boolean
}

type GraphLayout = {
  workNodes: GraphNode[]
  collaboratorNodes: GraphNode[]
  externalNodes: GraphNode[]
  edges: GraphEdge[]
  nodeMap: Map<string, GraphNode>
}

type NodeVisual = {
  datum: GraphNode
  core: any
  halo: any
  shell?: any
}

type EdgeVisual = {
  datum: GraphEdge
  line: any
}

type RegionVisual = {
  regionId: string
  themeId: string
  fill: any
  aura: any
}

type BrainSceneHandle = {
  applyState: (nextState: {
    activeThemeId: string
    activeWorkId: string | null
    activeCollaboratorId: string | null
  }) => void
  setAutoRotate: (enabled: boolean, speed: number) => void
  resetView: () => void
  dispose: () => void
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0.4, 0.55, 6.6)
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 0.18, 0.06)

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

function rgbaFromHex(hex: string, opacity: number) {
  const color = new THREE.Color(hex)
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(
    color.b * 255,
  )}, ${opacity})`
}

function project2D(position: [number, number, number]) {
  const x = clamp(50 + position[0] * 15 + position[2] * 8, 8, 92)
  const y = clamp(58 - position[1] * 14 - position[2] * 4, 10, 90)
  return { x, y }
}

function dedupeById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function buildCurvePoints(
  start: [number, number, number],
  end: [number, number, number],
  weight: number,
  kind: GraphEdge['kind'],
): [number, number, number][] {
  const startVector = toVector3(start)
  const endVector = toVector3(end)
  const mid = startVector.clone().lerp(endVector, 0.5)
  const distance = startVector.distanceTo(endVector)
  const lift = 0.18 + distance * 0.18 + weight * 0.34

  mid.x += (endVector.z - startVector.z) * 0.18
  mid.y += kind === 'coauthor_bridge' ? lift * 0.6 : lift * 0.85
  mid.z += (startVector.x - endVector.x) * 0.16

  const curve = new THREE.QuadraticBezierCurve3(startVector, mid, endVector)
  const segments =
    kind === 'coauthor_bridge'
      ? 14
      : kind === 'external_cites' || kind === 'external_cited_by'
        ? 10
        : 22
  return curve
    .getPoints(segments)
    .map(
      (point: { x: number; y: number; z: number }) =>
        [point.x, point.y, point.z] as [number, number, number],
    )
}

function createWorkPosition(
  region: BrainRegion,
  work: Work,
  index: number,
  total: number,
): [number, number, number] {
  const seed = hashNumber(work.id)
  const angle = GOLDEN_ANGLE * index + seed * Math.PI * 0.9
  const spread = region.radius * (0.32 + ((index % 4) / 4) * 0.32 + seed * 0.1)
  const vertical = Math.sin(angle * 1.16) * region.radius * 0.36
  const depth = Math.sin(angle) * region.radius * 0.46
  const lift = total > 4 ? (index / Math.max(1, total - 1) - 0.5) * 0.18 : 0

  return [
    region.anchor3D[0] + Math.cos(angle) * spread * 0.95,
    region.anchor3D[1] + vertical + lift,
    region.anchor3D[2] + depth,
  ]
}

function createCollaboratorPosition(
  region: BrainRegion,
  collaborator: Collaborator,
  index: number,
  total: number,
): [number, number, number] {
  const seed = hashNumber(collaborator.id)
  const direction = region.anchor3D[0] >= 0 ? 1 : -1
  const orbitAngle =
    (index / Math.max(total, 1)) * Math.PI * 1.7 - Math.PI * 0.85 + seed * 0.5
  const orbitRadius = region.radius + 0.42 + collaborator.prominence * 0.42

  return [
    region.anchor3D[0] + Math.cos(orbitAngle) * orbitRadius + direction * 0.16,
    region.anchor3D[1] + Math.sin(orbitAngle * 1.18) * 0.32 + 0.018 * index,
    region.anchor3D[2] + Math.sin(orbitAngle) * orbitRadius * 0.5,
  ]
}

function createExternalPosition(
  parent: GraphNode,
  index: number,
  externalSeed: string,
): [number, number, number] {
  const seed = hashNumber(externalSeed)
  const angle = GOLDEN_ANGLE * (index + 1) + seed * Math.PI * 2
  const radius = 0.62 + seed * 0.42
  const tilt = (seed - 0.5) * 0.7
  return [
    parent.position[0] + Math.cos(angle) * radius,
    parent.position[1] + Math.sin(angle * 1.4) * 0.42 + tilt,
    parent.position[2] + Math.sin(angle) * radius * 0.7,
  ]
}

function buildGraphLayout(
  works: Work[],
  collaborators: Collaborator[],
  citationLinks: CitationLink[],
  brainRegions: BrainRegion[],
  themes: Theme[],
  externalNodesData: ExternalNode[],
  externalEdgesData: ExternalEdge[],
  sceneConfig: GraphSceneConfig,
): GraphLayout {
  const workById = new Map(works.map((work) => [work.id, work]))
  const collaboratorById = new Map(collaborators.map((entry) => [entry.id, entry]))
  const themeById = new Map(themes.map((theme) => [theme.id, theme]))
  const worksByRegion = new Map(brainRegions.map((region) => [region.id, [] as Work[]]))
  const collaboratorsByRegion = new Map(
    brainRegions.map((region) => [region.id, [] as Collaborator[]]),
  )
  const assignedWorkIds = new Set<string>()

  brainRegions.forEach((region) => {
    region.workIds.forEach((workId) => {
      const work = workById.get(workId)
      if (!work) return
      worksByRegion.get(region.id)?.push(work)
      assignedWorkIds.add(work.id)
    })
  })

  works.forEach((work) => {
    if (assignedWorkIds.has(work.id)) return
    const theme = themeById.get(work.themeIds[0])
    if (!theme) return
    worksByRegion.get(theme.brainRegionId)?.push(work)
  })

  brainRegions.forEach((region) => {
    region.collaboratorIds.forEach((collaboratorId) => {
      const collaborator = collaboratorById.get(collaboratorId)
      if (!collaborator) return
      collaboratorsByRegion.get(region.id)?.push(collaborator)
    })
  })

  collaborators.forEach((collaborator) => {
    if (brainRegions.some((region) => region.collaboratorIds.includes(collaborator.id))) {
      return
    }
    collaboratorsByRegion.get(collaborator.brainRegionId)?.push(collaborator)
  })

  const citationCounts = works.map((work) => work.citationCount)
  const minCitation = Math.min(...citationCounts)
  const maxCitation = Math.max(...citationCounts)
  const citationSpan = Math.max(1, maxCitation - minCitation)

  const workNodes: GraphNode[] = []
  const collaboratorNodes: GraphNode[] = []

  brainRegions.forEach((region) => {
    const regionTheme = themeById.get(region.themeId)
    const regionColor = regionTheme?.color ?? region.color
    const regionWorks = dedupeById(
      [...(worksByRegion.get(region.id) ?? [])].sort((left, right) => left.year - right.year),
    )
    const regionCollaborators = dedupeById(
      [...(collaboratorsByRegion.get(region.id) ?? [])].sort(
        (left, right) => right.prominence - left.prominence,
      ),
    )

    regionWorks.forEach((work, index) => {
      const normalizedCitation = clamp(
        Math.sqrt((work.citationCount - minCitation) / citationSpan || 0.08),
        0.08,
        1,
      )

      workNodes.push({
        id: work.id,
        kind: 'work',
        label: work.title,
        themeIds: work.themeIds,
        primaryThemeId: work.themeIds[0],
        color: themeById.get(work.themeIds[0])?.color ?? regionColor,
        position: createWorkPosition(region, work, index, regionWorks.length),
        size: THREE.MathUtils.lerp(
          sceneConfig.nodeScaleRange[0],
          sceneConfig.nodeScaleRange[1],
          normalizedCitation,
        ),
        citationCount: work.citationCount,
        year: work.year,
        venue: work.venue,
        doi: work.doi,
      })
    })

    regionCollaborators.forEach((collaborator, index) => {
      collaboratorNodes.push({
        id: collaborator.id,
        kind: 'collaborator',
        label: collaborator.name,
        themeIds: collaborator.themeIds,
        primaryThemeId: collaborator.themeIds[0],
        color: themeById.get(collaborator.themeIds[0])?.color ?? regionColor,
        position: createCollaboratorPosition(
          region,
          collaborator,
          index,
          regionCollaborators.length,
        ),
        size: THREE.MathUtils.lerp(
          sceneConfig.nodeScaleRange[0] * 0.78,
          sceneConfig.nodeScaleRange[1] * 1.15,
          collaborator.prominence,
        ),
        workIds: collaborator.workIds,
        prominence: collaborator.prominence,
      })
    })
  })

  const interimNodeMap = new Map(
    [...workNodes, ...collaboratorNodes].map((node) => [node.id, node] as const),
  )

  const externalById = new Map(externalNodesData.map((entry) => [entry.id, entry]))
  const externalLinkAssignments = new Map<string, GraphNode>()
  const externalNodes: GraphNode[] = []
  const externalEdges: GraphEdge[] = []
  const externalUsageCounter = new Map<string, number>()

  externalEdgesData.forEach((rawEdge, index) => {
    const isCitedBy = rawEdge.kind === 'cited_by'
    const externalId = isCitedBy ? rawEdge.sourceExternalId : rawEdge.targetExternalId
    const aberWorkId = isCitedBy ? rawEdge.targetWorkId : rawEdge.sourceWorkId
    const externalRaw = externalById.get(externalId)
    const parent = interimNodeMap.get(aberWorkId)
    if (!externalRaw || !parent) return

    let placed = externalLinkAssignments.get(externalId)
    if (!placed) {
      const used = externalUsageCounter.get(parent.id) ?? 0
      externalUsageCounter.set(parent.id, used + 1)
      const position = createExternalPosition(parent, used, externalId)
      placed = {
        id: `external:${externalId}`,
        kind: 'external',
        label: externalRaw.title,
        themeIds: parent.themeIds,
        primaryThemeId: parent.primaryThemeId,
        color: parent.color,
        position,
        size: clamp(
          0.04 + Math.log10((externalRaw.citationCount || 1) + 1) * 0.012,
          0.04,
          0.085,
        ),
        citationCount: externalRaw.citationCount,
        year: externalRaw.year,
        venue: externalRaw.venue,
        doi: externalRaw.doi,
        parentWorkId: parent.id,
        authors: externalRaw.authors,
      }
      externalLinkAssignments.set(externalId, placed)
      externalNodes.push(placed)
    }

    const sourceId = isCitedBy ? placed.id : parent.id
    const targetId = isCitedBy ? parent.id : placed.id
    const sourcePosition = isCitedBy ? placed.position : parent.position
    const targetPosition = isCitedBy ? parent.position : placed.position

    externalEdges.push({
      id: `ext-${index}-${sourceId}-${targetId}`,
      sourceId,
      targetId,
      kind: isCitedBy ? 'external_cited_by' : 'external_cites',
      weight: rawEdge.weight,
      color: parent.color,
      themeIds: parent.themeIds,
      points: buildCurvePoints(
        sourcePosition,
        targetPosition,
        rawEdge.weight,
        isCitedBy ? 'external_cited_by' : 'external_cites',
      ),
      isExternal: true,
    })
  })

  const nodeMap = new Map(
    [...workNodes, ...collaboratorNodes, ...externalNodes].map(
      (node) => [node.id, node] as const,
    ),
  )

  const internalEdges: GraphEdge[] = citationLinks
    .map((link, index) => {
      const source = nodeMap.get(link.sourceWorkId)
      const target = nodeMap.get(link.targetWorkIdOrExternalId)
      if (!source || !target) return null

      const themeIds = [...new Set([...source.themeIds, ...target.themeIds])]

      return {
        id: `${link.kind}-${index}-${source.id}-${target.id}`,
        sourceId: source.id,
        targetId: target.id,
        kind: link.kind,
        weight: link.weight,
        color: source.color,
        themeIds,
        points: buildCurvePoints(source.position, target.position, link.weight, link.kind),
        isExternal: false,
      } as GraphEdge
    })
    .filter((edge): edge is GraphEdge => edge !== null)

  return {
    workNodes,
    collaboratorNodes,
    externalNodes,
    edges: [...internalEdges, ...externalEdges],
    nodeMap,
  }
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
    const fissureDepth = fissureFalloff * 0.34 * Math.max(0, normalized.y + 0.1)
    scale -= fissureDepth

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
  layout: GraphLayout
  brainRegions: BrainRegion[]
  themeById: Map<string, Theme>
  sceneConfig: GraphSceneConfig
  activeThemeId: string
  activeWorkId: string | null
  activeCollaboratorId: string | null
  isAutoRotating: boolean
  reducedMotion: boolean
  onWorkSelect: (workId: string) => void
  onCollaboratorSelect: (collaboratorId: string) => void
  onRuntimeFailure: (reason: string) => void
}): BrainSceneHandle {
  const {
    mount,
    layout,
    brainRegions,
    themeById,
    sceneConfig,
    activeThemeId,
    activeWorkId,
    activeCollaboratorId,
    isAutoRotating,
    reducedMotion,
    onWorkSelect,
    onCollaboratorSelect,
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
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.25)
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
    color: '#bce6ff',
    transparent: true,
    opacity: clamp(sceneConfig.brainShellOpacity * 1.4, 0.16, 0.32),
    roughness: 0.62,
    metalness: 0.05,
    transmission: 0.4,
    thickness: 1.6,
    ior: 1.18,
    emissive: '#0a3852',
    emissiveIntensity: 0.45,
    clearcoat: 0.28,
    clearcoatRoughness: 0.6,
    side: THREE.DoubleSide,
  })

  const brainMesh = new THREE.Mesh(brainGeometry, brainShellMaterial)
  brainShellGroup.add(brainMesh)

  const brainWireMaterial = new THREE.LineBasicMaterial({
    color: '#7feeff',
    transparent: true,
    opacity: 0.18,
  })
  const brainWire = new THREE.LineSegments(
    new THREE.WireframeGeometry(brainGeometry),
    brainWireMaterial,
  )
  brainShellGroup.add(brainWire)

  const innerGlowMaterial = new THREE.MeshBasicMaterial({
    color: '#3aa6ff',
    transparent: true,
    opacity: 0.05,
    side: THREE.BackSide,
    depthWrite: false,
  })
  const innerGlow = new THREE.Mesh(brainGeometry.clone().scale(1.08, 1.08, 1.08), innerGlowMaterial)
  brainShellGroup.add(innerGlow)

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

  const cerebellumWire = new THREE.LineSegments(
    new THREE.WireframeGeometry(cerebellumGeometry),
    brainWireMaterial.clone(),
  )
  cerebellumWire.position.copy(cerebellum.position)
  cerebellumWire.scale.copy(cerebellum.scale)
  brainShellGroup.add(cerebellumWire)

  const stemGeometry = new THREE.CylinderGeometry(0.16, 0.22, 0.8, 18, 4, true)
  const stem = new THREE.Mesh(stemGeometry, brainShellMaterial.clone())
  stem.position.set(0, -1.0, -0.55)
  stem.rotation.x = -0.18
  brainShellGroup.add(stem)

  brainRegions.forEach((region) => {
    const theme = themeById.get(region.themeId)
    const color = theme?.color ?? region.color

    const aura = new THREE.Mesh(
      new THREE.IcosahedronGeometry(region.radius * 1.4, 3),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
      }),
    )
    aura.position.set(region.anchor3D[0], region.anchor3D[1], region.anchor3D[2])
    aura.scale.set(1.1, 0.92, 0.92)

    const fill = new THREE.Mesh(
      new THREE.IcosahedronGeometry(region.radius * 0.92, 3),
      new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0.18,
        emissive: color,
        emissiveIntensity: 0.42,
        roughness: 0.62,
        metalness: 0.16,
        flatShading: true,
      }),
    )
    fill.position.copy(aura.position)
    fill.scale.set(1.04, 0.84, 0.78)

    root.add(aura, fill)
    regionVisuals.set(region.id, {
      regionId: region.id,
      themeId: region.themeId,
      fill,
      aura,
    })
  })

  const neuronCount = reducedMotion ? 320 : 720
  const neuronPositions = new Float32Array(neuronCount * 3)
  const neuronColors = new Float32Array(neuronCount * 3)
  const baseNeuronColor = new THREE.Color('#7feeff')
  for (let index = 0; index < neuronCount; index += 1) {
    const seed = hashNumber(`neuron-${index}`)
    const seed2 = hashNumber(`neuron-y-${index}`)
    const seed3 = hashNumber(`neuron-z-${index}`)
    const radius = 0.15 + seed * 1.45
    const theta = seed2 * Math.PI * 2
    const phi = Math.acos(1 - 2 * seed3)
    const offset = index * 3
    neuronPositions[offset] = Math.cos(theta) * Math.sin(phi) * radius
    neuronPositions[offset + 1] = (Math.cos(phi) - 0.05) * radius * 1.05
    neuronPositions[offset + 2] = Math.sin(theta) * Math.sin(phi) * radius * 0.92
    const tint = 0.7 + seed * 0.3
    neuronColors[offset] = baseNeuronColor.r * tint
    neuronColors[offset + 1] = baseNeuronColor.g * tint
    neuronColors[offset + 2] = baseNeuronColor.b * tint
  }
  const neuronGeometry = new THREE.BufferGeometry()
  neuronGeometry.setAttribute('position', new THREE.BufferAttribute(neuronPositions, 3))
  neuronGeometry.setAttribute('color', new THREE.BufferAttribute(neuronColors, 3))
  const neuronMaterial = new THREE.PointsMaterial({
    map: radialTexture,
    size: reducedMotion ? 0.04 : 0.055,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  })
  const neurons = new THREE.Points(neuronGeometry, neuronMaterial)
  root.add(neurons)

  const starCount = reducedMotion ? 220 : 420
  const starPositions = new Float32Array(starCount * 3)
  for (let index = 0; index < starCount; index += 1) {
    const offset = index * 3
    const seed = hashNumber(`star-${index}`)
    const seed2 = hashNumber(`star-y-${index}`)
    const radius = 4.6 + seed * 7.2
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
      opacity: reducedMotion ? 0.32 : 0.54,
      size: reducedMotion ? 0.08 : 0.12,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  scene.add(stars)

  const ringGeometry = new THREE.TorusGeometry(2.85, 0.012, 6, 96)
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: '#5bc7ff',
    transparent: true,
    opacity: 0.16,
  })
  const ringA = new THREE.Mesh(ringGeometry, ringMaterial.clone())
  ringA.rotation.set(Math.PI / 2.6, 0.18, 0.06)
  const ringB = new THREE.Mesh(
    new THREE.TorusGeometry(3.18, 0.008, 6, 96),
    ringMaterial.clone(),
  )
  ringB.rotation.set(Math.PI / 2, 0.42, Math.PI / 9)
  brainShellGroup.add(ringA, ringB)

  layout.edges.forEach((edge) => {
    const points = edge.points.map((point) => toVector3(point))
    const geometry = new THREE.BufferGeometry().setFromPoints(points)

    const isCoauthor = edge.kind === 'coauthor_bridge'
    const isExternal = edge.isExternal
    const baseOpacity = isExternal
      ? sceneConfig.edgeOpacity * 0.55
      : isCoauthor
        ? sceneConfig.edgeOpacity * 1.05
        : sceneConfig.edgeOpacity * 1.25

    const material = isCoauthor
      ? new THREE.LineDashedMaterial({
          color: edge.color,
          transparent: true,
          opacity: baseOpacity,
          dashSize: 0.14,
          gapSize: 0.08,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      : new THREE.LineBasicMaterial({
          color: edge.color,
          transparent: true,
          opacity: baseOpacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })

    const line = new THREE.Line(geometry, material)
    if (line.material instanceof THREE.LineDashedMaterial) {
      line.computeLineDistances()
    }
    root.add(line)
    edgeVisuals.push({ datum: edge, line })
  })

  const workGeometry = new THREE.SphereGeometry(1, 22, 22)
  const collaboratorGeometry = new THREE.OctahedronGeometry(1, 0)
  const externalGeometry = new THREE.SphereGeometry(1, 12, 12)

  const createNodeVisual = (node: GraphNode) => {
    const geometry =
      node.kind === 'work'
        ? workGeometry
        : node.kind === 'collaborator'
          ? collaboratorGeometry
          : externalGeometry

    const coreColor = new THREE.Color(node.color)
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: coreColor,
      transparent: true,
      opacity: node.kind === 'external' ? 0.78 : 0.95,
      emissive: coreColor,
      emissiveIntensity: node.kind === 'work' ? 1.4 : node.kind === 'collaborator' ? 1.1 : 0.8,
      roughness: 0.45,
      metalness: 0.2,
    })
    const core = new THREE.Mesh(geometry, coreMaterial)
    core.scale.setScalar(node.size)
    core.position.set(node.position[0], node.position[1], node.position[2])
    core.userData.nodeId = node.id
    core.userData.kind = node.kind

    const haloMaterial = new THREE.SpriteMaterial({
      map: radialTexture,
      color: coreColor,
      transparent: true,
      opacity:
        node.kind === 'work' ? 0.85 : node.kind === 'collaborator' ? 0.7 : 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const halo = new THREE.Sprite(haloMaterial)
    const haloScale =
      node.size *
      (node.kind === 'work' ? 6.4 : node.kind === 'collaborator' ? 5.0 : 4.0)
    halo.scale.set(haloScale, haloScale, 1)
    halo.position.copy(core.position)
    halo.userData.highlightScale = 1
    halo.userData.baseScale = haloScale

    root.add(halo, core)

    let shell: any | undefined
    if (node.kind === 'collaborator') {
      shell = new THREE.Mesh(
        new THREE.TorusGeometry(node.size * 1.7, 0.014, 6, 28),
        new THREE.MeshBasicMaterial({
          color: node.color,
          transparent: true,
          opacity: 0.32,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      )
      shell.rotation.set(Math.PI / 2.3, 0.26, 0)
      shell.position.copy(core.position)
      root.add(shell)
    }

    const visual = { datum: node, core, halo, shell }
    nodeVisuals.set(node.id, visual)
    if (node.kind !== 'external') interactiveMeshes.push(core)
  }

  layout.workNodes.forEach(createNodeVisual)
  layout.collaboratorNodes.forEach(createNodeVisual)
  layout.externalNodes.forEach(createNodeVisual)

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let pointerDown = { x: 0, y: 0 }
  let disposed = false
  let frame = 0
  let bootElapsed = 0
  const clock = new THREE.Clock()
  const initialCameraOffset = camera.position.clone().sub(DEFAULT_CAMERA_TARGET)
  const dollyStart = initialCameraOffset.clone().multiplyScalar(1.35)

  function setSize() {
    const width = Math.max(1, mount.clientWidth)
    const height = Math.max(1, mount.clientHeight)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    if (composer) {
      composer.setSize(width, height)
    }
  }

  setSize()

  const resizeObserver = new ResizeObserver(() => setSize())
  resizeObserver.observe(mount)

  const applyState: BrainSceneHandle['applyState'] = ({
    activeThemeId: nextThemeId,
    activeWorkId: nextWorkId,
    activeCollaboratorId: nextCollaboratorId,
  }) => {
    const selectedId = nextCollaboratorId ?? nextWorkId
    const linkedIds = new Set<string>()

    if (selectedId) {
      linkedIds.add(selectedId)
      layout.edges.forEach((edge) => {
        if (edge.sourceId === selectedId || edge.targetId === selectedId) {
          linkedIds.add(edge.sourceId)
          linkedIds.add(edge.targetId)
        }
      })

      const selectedNode = layout.nodeMap.get(selectedId)
      selectedNode?.workIds?.forEach((workId) => linkedIds.add(workId))
    }

    nodeVisuals.forEach((visual) => {
      const themeMatch = visual.datum.themeIds.includes(nextThemeId)
      const isSelected = visual.datum.id === selectedId
      const isLinked = linkedIds.has(visual.datum.id)
      const isExternal = visual.datum.kind === 'external'
      const baseEmphasis = isSelected
        ? 1
        : isLinked
          ? 0.86
          : selectedId
            ? isExternal
              ? 0.06
              : 0.16
            : themeMatch
              ? isExternal
                ? 0.5
                : 0.78
              : isExternal
                ? 0.26
                : 0.36

      visual.core.material.opacity =
        (isExternal ? 0.18 : 0.28) + baseEmphasis * (isExternal ? 0.6 : 0.72)
      visual.core.material.emissiveIntensity =
        (visual.datum.kind === 'work' ? 0.7 : visual.datum.kind === 'collaborator' ? 0.5 : 0.32) +
        baseEmphasis * (visual.datum.kind === 'work' ? 1.1 : 0.7)
      visual.halo.material.opacity =
        (visual.datum.kind === 'work'
          ? 0.18
          : visual.datum.kind === 'collaborator'
            ? 0.14
            : 0.08) + baseEmphasis * (visual.datum.kind === 'work' ? 0.7 : 0.45)

      const nodeScale = isSelected ? 1.55 : isLinked ? 1.22 : 1
      visual.core.scale.setScalar(visual.datum.size * nodeScale)
      visual.halo.userData.highlightScale = isSelected ? 1.45 : isLinked ? 1.18 : 1

      if (visual.shell) {
        visual.shell.material.opacity = isSelected
          ? 0.78
          : isLinked
            ? 0.55
            : themeMatch
              ? 0.32
              : 0.18
        visual.shell.scale.setScalar(isSelected ? 1.18 : 1)
      }
    })

    edgeVisuals.forEach((edgeVisual) => {
      const connectsSelection =
        selectedId !== null &&
        selectedId !== undefined &&
        (edgeVisual.datum.sourceId === selectedId || edgeVisual.datum.targetId === selectedId)
      const themeMatch = edgeVisual.datum.themeIds.includes(nextThemeId)
      const isExternal = edgeVisual.datum.isExternal

      const opacity = connectsSelection
        ? isExternal
          ? 0.7
          : 0.85
        : selectedId
          ? isExternal
            ? 0.04
            : 0.08
          : themeMatch
            ? isExternal
              ? 0.18
              : 0.4
            : isExternal
              ? 0.07
              : 0.14

      edgeVisual.line.material.opacity = opacity
      edgeVisual.line.material.color.set(
        connectsSelection ? '#ffffff' : edgeVisual.datum.color,
      )
    })

    regionVisuals.forEach((visual) => {
      const emphasized = visual.themeId === nextThemeId
      visual.fill.material.opacity = emphasized ? 0.28 : 0.12
      visual.fill.material.emissiveIntensity = emphasized ? 0.62 : 0.26
      visual.aura.material.opacity = emphasized ? 0.14 : 0.05
    })
  }

  const handlePointerDown = (event: PointerEvent) => {
    pointerDown = { x: event.clientX, y: event.clientY }
  }

  const handlePointerMove = (event: PointerEvent) => {
    if (disposed) return
    const bounds = renderer.domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const intersects = raycaster.intersectObjects(interactiveMeshes, false)
    renderer.domElement.style.cursor = intersects.length > 0 ? 'pointer' : 'grab'
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

    const { nodeId, kind } = hit.object.userData as { nodeId: string; kind: GraphNode['kind'] }
    if (kind === 'work') onWorkSelect(nodeId)
    if (kind === 'collaborator') onCollaboratorSelect(nodeId)
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

    brainShellGroup.rotation.y += reducedMotion ? 0.0005 : 0.001
    ringA.rotation.z += reducedMotion ? 0.0006 : 0.0015
    ringB.rotation.z -= reducedMotion ? 0.0004 : 0.0012
    neurons.rotation.y += reducedMotion ? 0.0002 : 0.0006
    neuronMaterial.opacity = 0.62 + Math.sin(elapsed * 0.6) * 0.08

    nodeVisuals.forEach((visual) => {
      const phase = hashNumber(visual.datum.id) * Math.PI * 2
      const pulse = 1 + Math.sin(elapsed * 1.6 + phase) * (reducedMotion ? 0.025 : 0.07)
      const highlight =
        typeof visual.halo.userData.highlightScale === 'number'
          ? visual.halo.userData.highlightScale
          : 1
      const baseScale =
        (visual.halo.userData.baseScale as number) * pulse * highlight
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
  }

  applyState({ activeThemeId, activeWorkId, activeCollaboratorId })
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
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost)
      controls.dispose()

      scene.traverse((object: { geometry?: { dispose: () => void }; material?: unknown }) => {
        const mesh = object as any
        if (mesh.geometry) mesh.geometry.dispose()

        const material = (mesh as { material?: any | any[] }).material
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
        else material?.dispose()
      })

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
  activeWorkId: string | null
  activeCollaboratorId: string | null
  onWorkSelect: (workId: string) => void
  onCollaboratorSelect: (collaboratorId: string) => void
}) {
  const {
    layout,
    brainRegions,
    themeById,
    activeThemeId,
    activeWorkId,
    activeCollaboratorId,
    onWorkSelect,
    onCollaboratorSelect,
  } = props

  const selectedId = activeCollaboratorId ?? activeWorkId

  return (
    <div className="brain-fallback">
      <svg className="brain-fallback__shell" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <filter id="brainGlow">
            <feGaussianBlur stdDeviation="1.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          className="brain-fallback__outline"
          d="M 17 55 C 13 28, 28 12, 47 13 C 58 8, 81 18, 85 41 C 89 55, 84 77, 67 86 C 57 92, 46 91, 38 86 C 21 81, 13 68, 17 55 Z"
        />

        {brainRegions.map((region) => {
          const theme = themeById.get(region.themeId)
          const point = project2D(region.anchor3D)
          return (
            <ellipse
              key={region.id}
              cx={point.x}
              cy={point.y}
              rx={region.radius * 17}
              ry={region.radius * 11}
              fill={rgbaFromHex(
                theme?.color ?? region.color,
                region.themeId === activeThemeId ? 0.32 : 0.14,
              )}
              filter="url(#brainGlow)"
            />
          )
        })}

        {layout.edges.map((edge) => {
          const source = layout.nodeMap.get(edge.sourceId)
          const target = layout.nodeMap.get(edge.targetId)
          if (!source || !target) return null
          const start = project2D(source.position)
          const end = project2D(target.position)
          const highlighted = selectedId
            ? edge.sourceId === selectedId || edge.targetId === selectedId
            : edge.themeIds.includes(activeThemeId)

          return (
            <path
              key={edge.id}
              d={`M ${start.x} ${start.y} Q ${(start.x + end.x) / 2} ${
                Math.min(start.y, end.y) - 6
              } ${end.x} ${end.y}`}
              fill="none"
              stroke={highlighted ? '#ffffff' : edge.color}
              strokeDasharray={edge.kind === 'coauthor_bridge' ? '1.4 1.2' : undefined}
              strokeOpacity={highlighted ? 0.9 : edge.isExternal ? 0.16 : 0.28}
              strokeWidth={edge.kind === 'coauthor_bridge' ? 0.45 : edge.isExternal ? 0.22 : 0.38}
            />
          )
        })}
      </svg>

      <div className="brain-fallback__nodes">
        {[...layout.workNodes, ...layout.collaboratorNodes, ...layout.externalNodes].map(
          (node) => {
            const point = project2D(node.position)
            const isSelected = node.id === selectedId
            const isThemeActive = node.themeIds.includes(activeThemeId)

            return (
              <button
                key={node.id}
                aria-label={node.label}
                className={[
                  'brain-fallback__node',
                  node.kind === 'collaborator' ? 'is-collaborator' : '',
                  node.kind === 'external' ? 'is-external' : '',
                  node.kind === 'work' ? 'is-work' : '',
                  isSelected ? 'is-selected' : '',
                  isThemeActive ? 'is-theme-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={node.kind === 'external'}
                onClick={() => {
                  if (node.kind === 'work') onWorkSelect(node.id)
                  if (node.kind === 'collaborator') onCollaboratorSelect(node.id)
                }}
                style={
                  {
                    '--theme-color': node.color,
                    '--node-size': `${node.size * (node.kind === 'external' ? 80 : 54)}px`,
                    left: `${point.x}%`,
                    top: `${point.y}%`,
                  } as CSSProperties
                }
                type="button"
              />
            )
          },
        )}
      </div>
    </div>
  )
}

export function NetworkSection({
  works,
  collaborators,
  citationLinks,
  brainRegions,
  themes,
  rendererCapability,
  sceneConfig,
  activeThemeId,
  activeWorkId,
  activeCollaboratorId,
  isAutoRotating,
  reducedMotion,
  resetNonce,
  onThemeSelect,
  onWorkSelect,
  onCollaboratorSelect,
  onToggleAutoRotate,
  onResetView,
}: NetworkSectionProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const sceneHandleRef = useRef<BrainSceneHandle | null>(null)
  const onWorkSelectRef = useRef(onWorkSelect)
  const onCollaboratorSelectRef = useRef(onCollaboratorSelect)
  const [runtimeFailure, setRuntimeFailure] = useState<string | null>(null)

  const themeById = useMemo(() => new Map(themes.map((theme) => [theme.id, theme])), [themes])
  const workById = useMemo(() => new Map(works.map((work) => [work.id, work])), [works])
  const collaboratorById = useMemo(
    () => new Map(collaborators.map((collaborator) => [collaborator.id, collaborator])),
    [collaborators],
  )

  const layout = useMemo(
    () =>
      buildGraphLayout(
        works,
        collaborators,
        citationLinks,
        brainRegions,
        themes,
        externalCitations.externalNodes,
        externalCitations.edges,
        sceneConfig,
      ),
    [brainRegions, citationLinks, collaborators, sceneConfig, themes, works],
  )

  const selectedWork =
    (activeWorkId ? workById.get(activeWorkId) : undefined) ??
    works.find((work) => work.themeIds.includes(activeThemeId)) ??
    works[0]

  const selectedCollaborator = activeCollaboratorId
    ? collaboratorById.get(activeCollaboratorId) ?? null
    : null

  const selectedThemes = (
    selectedCollaborator ? selectedCollaborator.themeIds : selectedWork?.themeIds ?? []
  )
    .map((themeId) => themeById.get(themeId))
    .filter((theme): theme is Theme => Boolean(theme))

  const linkedWorks = useMemo(() => {
    if (selectedCollaborator) {
      return selectedCollaborator.workIds
        .map((workId) => workById.get(workId))
        .filter((work): work is Work => Boolean(work))
    }

    if (!selectedWork) return []

    const relatedIds = new Set<string>()
    citationLinks.forEach((link) => {
      if (link.sourceWorkId === selectedWork.id) relatedIds.add(link.targetWorkIdOrExternalId)
      if (link.targetWorkIdOrExternalId === selectedWork.id) relatedIds.add(link.sourceWorkId)
    })

    return [...relatedIds]
      .map((workId) => workById.get(workId))
      .filter((work): work is Work => Boolean(work))
      .slice(0, 6)
  }, [citationLinks, selectedCollaborator, selectedWork, workById])

  const linkedCollaborators = useMemo(() => {
    if (selectedCollaborator) return []
    if (!selectedWork) return []

    return selectedWork.authorIds
      .map((authorId) => collaboratorById.get(authorId))
      .filter((collaborator): collaborator is Collaborator => Boolean(collaborator))
  }, [collaboratorById, selectedCollaborator, selectedWork])

  const externalCitedBy = useMemo(() => {
    if (!selectedWork) return []
    return externalCitations.edges
      .filter(
        (edge) =>
          edge.kind === 'cited_by' && edge.targetWorkId === selectedWork.id,
      )
      .map((edge) =>
        externalCitations.externalNodes.find(
          (node) => node.id === (edge as { sourceExternalId: string }).sourceExternalId,
        ),
      )
      .filter((node): node is ExternalNode => Boolean(node))
      .sort((left, right) => right.citationCount - left.citationCount)
      .slice(0, 5)
  }, [selectedWork])

  const externalRefs = useMemo(() => {
    if (!selectedWork) return []
    return externalCitations.edges
      .filter(
        (edge) => edge.kind === 'cites' && edge.sourceWorkId === selectedWork.id,
      )
      .map((edge) =>
        externalCitations.externalNodes.find(
          (node) => node.id === (edge as { targetExternalId: string }).targetExternalId,
        ),
      )
      .filter((node): node is ExternalNode => Boolean(node))
      .sort((left, right) => right.citationCount - left.citationCount)
      .slice(0, 4)
  }, [selectedWork])

  const show3D = rendererCapability.canMount3D && runtimeFailure === null
  const fallbackReason = runtimeFailure ?? rendererCapability.failureReason ?? null

  useEffect(() => {
    onWorkSelectRef.current = onWorkSelect
    onCollaboratorSelectRef.current = onCollaboratorSelect
  }, [onCollaboratorSelect, onWorkSelect])

  useEffect(() => {
    if (!show3D || !stageRef.current) return

    let cancelled = false

    try {
      const sceneHandle = createBrainScene({
        mount: stageRef.current,
        layout,
        brainRegions,
        themeById,
        sceneConfig,
        activeThemeId,
        activeWorkId,
        activeCollaboratorId,
        isAutoRotating,
        reducedMotion,
        onWorkSelect: (workId) => onWorkSelectRef.current(workId),
        onCollaboratorSelect: (collaboratorId) =>
          onCollaboratorSelectRef.current(collaboratorId),
        onRuntimeFailure: (reason) => {
          if (!cancelled) setRuntimeFailure(reason)
        },
      })

      if (cancelled) {
        sceneHandle.dispose()
        return
      }

      sceneHandleRef.current = sceneHandle
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
  }, [
    brainRegions,
    layout,
    reducedMotion,
    sceneConfig,
    show3D,
    themeById,
  ])

  useEffect(() => {
    sceneHandleRef.current?.applyState({
      activeThemeId,
      activeWorkId,
      activeCollaboratorId,
    })
  }, [activeCollaboratorId, activeThemeId, activeWorkId])

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
            <div className="brain-graph-stage__canvas" ref={stageRef} />
          ) : (
            <FallbackGraph
              layout={layout}
              brainRegions={brainRegions}
              themeById={themeById}
              activeThemeId={activeThemeId}
              activeWorkId={activeWorkId}
              activeCollaboratorId={activeCollaboratorId}
              onWorkSelect={onWorkSelect}
              onCollaboratorSelect={onCollaboratorSelect}
            />
          )}

          <header className="brain-graph-stage__intro panel">
            <p className="brain-graph-stage__eyebrow">Larry Aber Festschrift</p>
            <h1>Inside the citation cortex</h1>
            <p className="brain-graph-stage__lede">
              An interactive 3D map of Larry Aber&apos;s scholarship — major papers as luminous
              cores, co-authors orbiting their region, and a halo of {externalCitations.externalNodes.length} real
              citing and referenced papers from OpenAlex.
            </p>
            <div className="brain-graph-stage__metrics">
              <div>
                <span>Highlighted papers</span>
                <strong>{works.length}</strong>
              </div>
              <div>
                <span>Co-authors</span>
                <strong>{collaborators.length}</strong>
              </div>
              <div>
                <span>Network edges</span>
                <strong>{layout.edges.length}</strong>
              </div>
            </div>
          </header>

          <div className="brain-graph-stage__controls panel">
            <div className="brain-graph-stage__mode">
              <span className={show3D ? 'is-live' : 'is-fallback'}>
                {show3D ? '3D live' : 'Fallback'}
              </span>
              {fallbackReason ? (
                <p>{fallbackReason}</p>
              ) : (
                <p>Click a paper or co-author. Drag to orbit, scroll to zoom.</p>
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

            {reducedMotion ? (
              <p className="brain-graph-stage__microcopy">
                Motion is reduced by browser preference, so cinematic autorotation is disabled.
              </p>
            ) : null}
          </div>
        </div>

        <aside className="brain-graph-sidebar">
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
                </button>
              ))}
            </div>
          </div>

          <div className="panel brain-graph-sidebar__selection">
            {selectedCollaborator ? (
              <>
                <p className="brain-graph-sidebar__label">Selected co-author</p>
                <h2>{selectedCollaborator.name}</h2>
                <p className="brain-graph-sidebar__meta">
                  Prominence {Math.round(selectedCollaborator.prominence * 100)}% ·{' '}
                  {selectedCollaborator.workIds.length} linked works
                </p>
              </>
            ) : selectedWork ? (
              <>
                <p className="brain-graph-sidebar__label">Selected paper</p>
                <h2>{selectedWork.title}</h2>
                <p className="brain-graph-sidebar__meta">
                  {selectedWork.year} · {selectedWork.venue ?? 'Scholarly publication'} ·{' '}
                  {selectedWork.citationCount.toLocaleString()} citations
                </p>
                {selectedWork.authorIds.length > 0 ? (
                  <p className="brain-graph-sidebar__authors">
                    With {selectedWork.authorIds
                      .map((authorId) => collaboratorById.get(authorId)?.name)
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                ) : null}
              </>
            ) : null}

            <div className="brain-graph-sidebar__theme-badges">
              {selectedThemes.map((theme) => (
                <span
                  key={theme.id}
                  className="brain-graph-sidebar__theme-badge"
                  style={{ '--theme-color': theme.color } as CSSProperties}
                >
                  {theme.label}
                </span>
              ))}
            </div>

            {selectedWork?.doi ? (
              <a
                className="brain-graph-sidebar__link"
                href={selectedWork.doi.startsWith('http') ? selectedWork.doi : `https://doi.org/${selectedWork.doi}`}
                rel="noreferrer"
                target="_blank"
              >
                Open DOI
              </a>
            ) : null}

            {selectedCollaborator ? (
              <div className="brain-graph-sidebar__linked">
                <p className="brain-graph-sidebar__subhead">Linked papers</p>
                <div className="brain-graph-sidebar__list">
                  {linkedWorks.slice(0, 6).map((work) => (
                    <button key={work.id} onClick={() => onWorkSelect(work.id)} type="button">
                      <strong>{work.year}</strong>
                      <span>{work.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {linkedCollaborators.length > 0 ? (
                  <div className="brain-graph-sidebar__linked">
                    <p className="brain-graph-sidebar__subhead">Co-authors on this paper</p>
                    <div className="brain-graph-sidebar__list">
                      {linkedCollaborators.map((collaborator) => (
                        <button
                          key={collaborator.id}
                          onClick={() => onCollaboratorSelect(collaborator.id)}
                          type="button"
                        >
                          <strong>{Math.round(collaborator.prominence * 100)}%</strong>
                          <span>{collaborator.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {linkedWorks.length > 0 ? (
                  <div className="brain-graph-sidebar__linked">
                    <p className="brain-graph-sidebar__subhead">Internal citation neighbors</p>
                    <div className="brain-graph-sidebar__list">
                      {linkedWorks.map((work) => (
                        <button key={work.id} onClick={() => onWorkSelect(work.id)} type="button">
                          <strong>{work.year}</strong>
                          <span>{work.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {externalCitedBy.length > 0 ? (
                  <div className="brain-graph-sidebar__linked">
                    <p className="brain-graph-sidebar__subhead">Most-cited papers citing this</p>
                    <div className="brain-graph-sidebar__list">
                      {externalCitedBy.map((node) => (
                        <a
                          key={node.id}
                          href={node.doi ?? `https://openalex.org/${node.id}`}
                          rel="noreferrer"
                          target="_blank"
                          className="brain-graph-sidebar__external"
                        >
                          <strong>{node.year ?? '—'}</strong>
                          <span>{node.title}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                {externalRefs.length > 0 ? (
                  <div className="brain-graph-sidebar__linked">
                    <p className="brain-graph-sidebar__subhead">Key references</p>
                    <div className="brain-graph-sidebar__list">
                      {externalRefs.map((node) => (
                        <a
                          key={node.id}
                          href={node.doi ?? `https://openalex.org/${node.id}`}
                          rel="noreferrer"
                          target="_blank"
                          className="brain-graph-sidebar__external"
                        >
                          <strong>{node.year ?? '—'}</strong>
                          <span>{node.title}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}
