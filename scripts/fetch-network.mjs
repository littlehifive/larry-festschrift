import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const cwd = process.cwd()
const works = JSON.parse(
  readFileSync(path.join(cwd, 'src/content/works.json'), 'utf8'),
)

const MAILTO = 'larry.festschrift@example.com'
const TOP_CITING_PER_WORK = 6
const TOP_REFERENCED_PER_WORK = 4

const headers = { 'User-Agent': `larry-festschrift (${MAILTO})` }

function openAlexShortId(value) {
  if (!value) return null
  return value.replace('https://openalex.org/', '').trim()
}

function compactWork(raw) {
  if (!raw) return null
  return {
    id: openAlexShortId(raw.id),
    title: raw.display_name ?? raw.title ?? '',
    year: raw.publication_year ?? null,
    venue:
      raw.primary_location?.source?.display_name ??
      raw.host_venue?.display_name ??
      null,
    citationCount: raw.cited_by_count ?? 0,
    doi: raw.doi ?? null,
    authors: (raw.authorships ?? [])
      .slice(0, 4)
      .map((entry) => entry.author?.display_name)
      .filter(Boolean),
  }
}

async function fetchTopCiting(openAlexId) {
  const shortId = openAlexShortId(openAlexId)
  if (!shortId) return []
  const url = new URL('https://api.openalex.org/works')
  url.searchParams.set('filter', `cites:${shortId}`)
  url.searchParams.set('sort', 'cited_by_count:desc')
  url.searchParams.set('per-page', String(TOP_CITING_PER_WORK))
  url.searchParams.set('mailto', MAILTO)
  url.searchParams.set(
    'select',
    'id,display_name,publication_year,cited_by_count,doi,primary_location,authorships',
  )
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`OpenAlex ${response.status} on ${url}`)
  const body = await response.json()
  return (body.results ?? []).map(compactWork).filter(Boolean)
}

async function fetchReferenced(openAlexId) {
  const shortId = openAlexShortId(openAlexId)
  if (!shortId) return []
  const detailUrl = new URL(`https://api.openalex.org/works/${shortId}`)
  detailUrl.searchParams.set('mailto', MAILTO)
  detailUrl.searchParams.set('select', 'referenced_works')
  const detailResponse = await fetch(detailUrl, { headers })
  if (!detailResponse.ok) {
    throw new Error(`OpenAlex ${detailResponse.status} on ${detailUrl}`)
  }
  const detail = await detailResponse.json()
  const refIds = (detail.referenced_works ?? []).map(openAlexShortId).filter(Boolean)
  if (refIds.length === 0) return []

  const filterIds = refIds.slice(0, 80).join('|')
  const listUrl = new URL('https://api.openalex.org/works')
  listUrl.searchParams.set('filter', `openalex_id:${filterIds}`)
  listUrl.searchParams.set('sort', 'cited_by_count:desc')
  listUrl.searchParams.set('per-page', String(TOP_REFERENCED_PER_WORK))
  listUrl.searchParams.set('mailto', MAILTO)
  listUrl.searchParams.set(
    'select',
    'id,display_name,publication_year,cited_by_count,doi,primary_location,authorships',
  )
  const listResponse = await fetch(listUrl, { headers })
  if (!listResponse.ok) {
    throw new Error(`OpenAlex ${listResponse.status} on ${listUrl}`)
  }
  const listBody = await listResponse.json()
  return (listBody.results ?? []).map(compactWork).filter(Boolean)
}

async function main() {
  const externalNodes = new Map()
  const edges = []

  const seedWorks = works.filter(
    (work) => work.openAlexId && work.openAlexId.includes('openalex.org/'),
  )
  console.log(`Fetching network for ${seedWorks.length} OpenAlex-linked works...`)

  for (const work of seedWorks) {
    try {
      const citing = await fetchTopCiting(work.openAlexId)
      citing.forEach((node) => {
        if (!node || !node.id) return
        if (!externalNodes.has(node.id)) externalNodes.set(node.id, node)
        edges.push({
          sourceExternalId: node.id,
          targetWorkId: work.id,
          kind: 'cited_by',
          weight: Math.min(0.9, 0.2 + Math.log10((node.citationCount || 1) + 1) * 0.18),
        })
      })

      const referenced = await fetchReferenced(work.openAlexId)
      referenced.forEach((node) => {
        if (!node || !node.id) return
        if (!externalNodes.has(node.id)) externalNodes.set(node.id, node)
        edges.push({
          sourceWorkId: work.id,
          targetExternalId: node.id,
          kind: 'cites',
          weight: Math.min(0.85, 0.18 + Math.log10((node.citationCount || 1) + 1) * 0.16),
        })
      })

      process.stdout.write('.')
    } catch (error) {
      console.warn(`\n  Skipped ${work.id}: ${error.message}`)
    }
  }
  console.log('')

  const payload = {
    generatedAt: new Date().toISOString(),
    externalNodes: [...externalNodes.values()],
    edges,
  }

  writeFileSync(
    path.join(cwd, 'src/content/external-citations.json'),
    JSON.stringify(payload, null, 2),
  )
  console.log(
    `Wrote ${payload.externalNodes.length} external nodes and ${payload.edges.length} edges.`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
