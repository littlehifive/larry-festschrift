export type Theme = {
  id: string
  label: string
  color: string
  description: string
  brainRegionId: string
  sortOrder: number
}

export type MilestoneType =
  | 'education'
  | 'appointment'
  | 'grant'
  | 'award'
  | 'research'
  | 'publication'

export type Milestone = {
  id: string
  yearStart: number
  yearEnd?: number
  type: MilestoneType
  lane: 'formation' | 'institutions' | 'themes' | 'impact'
  title: string
  subtitle?: string
  description: string
  themeIds: string[]
  importance: number
}

export type WorkType = 'journal' | 'book' | 'chapter' | 'report'

export type Work = {
  id: string
  title: string
  year: number
  type: WorkType
  venue?: string | null
  themeIds: string[]
  highlight: boolean
  doi?: string | null
  openAlexId?: string | null
  citationCount: number
  authorIds: string[]
}

export type Collaborator = {
  id: string
  name: string
  themeIds: string[]
  workIds: string[]
  brainRegionId: string
  prominence: number
}

export type CitationLink = {
  sourceWorkId: string
  targetWorkIdOrExternalId: string
  kind: 'cites' | 'cited_by' | 'coauthor_bridge'
  weight: number
}

export type BrainRegion = {
  id: string
  label: string
  themeId: string
  color: string
  anchor3D: [number, number, number]
  radius: number
  intensityRange: [number, number]
  workIds: string[]
  collaboratorIds: string[]
}

export type GraphSceneConfig = {
  autoRotateSpeed: number
  nodeScaleRange: [number, number]
  edgeOpacity: number
  brainShellOpacity: number
  effectsLevel: 'minimal' | 'balanced' | 'high'
}

export type GraphSelection = {
  selectedWorkId?: string
  selectedCollaboratorId?: string
  isAutoRotating: boolean
}

export type RendererCapability = {
  canMount3D: boolean
  failureReason?: string
}

export type BustAssetManifest = {
  portraitImage: string
  alphaMask: string
  depthMap: string
  regionMask: string
  silhouetteMesh: string
  cameraConstraints: {
    minAzimuth: number
    maxAzimuth: number
    minPolar: number
    maxPolar: number
    distance: number
  }
  postFxProfile: {
    bloomStrength: number
    bloomRadius: number
    noise: number
    scanlines: number
  }
}

export type SceneContent = {
  heroCopy: {
    eyebrow: string
    headline: string
    lede: string
    stats: Array<{ label: string; value: string }>
  }
  timelineIntro: string
  networkIntro: string
  quote?: string
  credits: string
}
