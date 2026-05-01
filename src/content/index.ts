import themesJson from './themes.json'
import milestonesJson from './milestones.json'
import worksJson from './works.json'
import collaboratorsJson from './collaborators.json'
import citationLinksJson from './citation-links.json'
import brainRegionsJson from './brain-regions.json'
import bustAssetManifestJson from './bust-asset-manifest.json'
import sceneContentJson from './scene-content.json'
import externalCitationsJson from './external-citations.json'
import coauthorNetworkJson from './coauthor-network.json'
import type {
  BrainRegion,
  BustAssetManifest,
  CitationLink,
  CoauthorNetwork,
  Collaborator,
  ExternalCitationData,
  Milestone,
  SceneContent,
  Theme,
  Work,
} from '../types/content'

export const themes = [...(themesJson as Theme[])].sort(
  (left, right) => left.sortOrder - right.sortOrder,
)

export const milestones = [...(milestonesJson as Milestone[])].sort(
  (left, right) => left.yearStart - right.yearStart,
)

export const works = [...(worksJson as Work[])].sort(
  (left, right) => left.year - right.year,
)

export const collaborators = collaboratorsJson as Collaborator[]
export const citationLinks = citationLinksJson as CitationLink[]
export const brainRegions = brainRegionsJson as BrainRegion[]
export const bustAssetManifest = bustAssetManifestJson as BustAssetManifest
export const sceneContent = sceneContentJson as SceneContent
export const externalCitations = externalCitationsJson as ExternalCitationData
export const coauthorNetwork = coauthorNetworkJson as CoauthorNetwork

export const themeMap = new Map(themes.map((theme) => [theme.id, theme]))
export const workMap = new Map(works.map((work) => [work.id, work]))
export const collaboratorMap = new Map(
  collaborators.map((collaborator) => [collaborator.id, collaborator]),
)
export const brainRegionMap = new Map(
  brainRegions.map((region) => [region.id, region]),
)

export const highlightedWorks = works.filter((work) => work.highlight)
export const publicationCounts = {
  works: highlightedWorks.length,
  collaborators: collaborators.length,
  citations: citationLinks.filter((link) => link.kind === 'cites').length,
}
