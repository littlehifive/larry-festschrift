import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const cwd = process.cwd()
const readJson = (relativePath) =>
  JSON.parse(readFileSync(path.join(cwd, relativePath), 'utf8'))

const themes = readJson('src/content/themes.json')
const milestones = readJson('src/content/milestones.json')
const works = readJson('src/content/works.json')
const collaborators = readJson('src/content/collaborators.json')
const links = readJson('src/content/citation-links.json')
const brainRegions = readJson('src/content/brain-regions.json')
const bustAssetManifest = readJson('src/content/bust-asset-manifest.json')

const themeIds = new Set(themes.map((theme) => theme.id))
const workIds = new Set(works.map((work) => work.id))
const collaboratorIds = new Set(collaborators.map((collaborator) => collaborator.id))
const brainRegionIds = new Set(brainRegions.map((region) => region.id))

const errors = []

const pushError = (message) => errors.push(message)

for (const milestone of milestones) {
  for (const themeId of milestone.themeIds) {
    if (!themeIds.has(themeId)) {
      pushError(`Milestone ${milestone.id} references unknown theme ${themeId}.`)
    }
  }
}

for (const collaborator of collaborators) {
  if (!brainRegionIds.has(collaborator.brainRegionId)) {
    pushError(
      `Collaborator ${collaborator.id} references unknown brain region ${collaborator.brainRegionId}.`,
    )
  }
  for (const themeId of collaborator.themeIds) {
    if (!themeIds.has(themeId)) {
      pushError(`Collaborator ${collaborator.id} references unknown theme ${themeId}.`)
    }
  }
  for (const workId of collaborator.workIds) {
    if (!workIds.has(workId)) {
      pushError(`Collaborator ${collaborator.id} references unknown work ${workId}.`)
    }
  }
}

for (const work of works) {
  if (work.highlight && !work.year) {
    pushError(`Highlighted work ${work.id} is missing a year.`)
  }
  if (work.highlight && work.themeIds.length === 0) {
    pushError(`Highlighted work ${work.id} has no theme assignments.`)
  }
  for (const themeId of work.themeIds) {
    if (!themeIds.has(themeId)) {
      pushError(`Work ${work.id} references unknown theme ${themeId}.`)
    }
  }
  for (const authorId of work.authorIds) {
    if (!collaboratorIds.has(authorId)) {
      pushError(`Work ${work.id} references unknown collaborator ${authorId}.`)
    }
  }
  if (
    work.highlight &&
    !(work.openAlexId || work.doi || work.type === 'book' || work.year < 2000)
  ) {
    pushError(
      `Highlighted work ${work.id} is missing an OpenAlex id or DOI. Run npm run enrich:openalex.`,
    )
  }
}

for (const region of brainRegions) {
  if (!themeIds.has(region.themeId)) {
    pushError(`Brain region ${region.id} references unknown theme ${region.themeId}.`)
  }
  for (const workId of region.workIds) {
    if (!workIds.has(workId)) {
      pushError(`Brain region ${region.id} references unknown work ${workId}.`)
    }
  }
  for (const collaboratorId of region.collaboratorIds) {
    if (!collaboratorIds.has(collaboratorId)) {
      pushError(
        `Brain region ${region.id} references unknown collaborator ${collaboratorId}.`,
      )
    }
  }
}

for (const link of links) {
  if (!workIds.has(link.sourceWorkId)) {
    pushError(`Citation link source ${link.sourceWorkId} does not exist.`)
  }
  const targetExists =
    workIds.has(link.targetWorkIdOrExternalId) ||
    collaboratorIds.has(link.targetWorkIdOrExternalId)
  if (!targetExists) {
    pushError(
      `Citation link target ${link.targetWorkIdOrExternalId} does not exist as work or collaborator.`,
    )
  }
}

for (const assetPath of [
  bustAssetManifest.portraitImage,
  bustAssetManifest.alphaMask,
  bustAssetManifest.depthMap,
  bustAssetManifest.regionMask,
  bustAssetManifest.silhouetteMesh,
]) {
  const absolute = path.join(cwd, 'public', assetPath.replace(/^\/assets\//, 'assets/'))
  if (!existsSync(absolute)) {
    pushError(`Bust asset missing: ${assetPath}`)
  }
}

if (errors.length > 0) {
  console.error('Data validation failed:\n')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log(
  `Validated ${themes.length} themes, ${milestones.length} milestones, ${works.length} works, ${collaborators.length} collaborators, ${links.length} links.`,
)
