import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const cwd = process.cwd()
const worksPath = path.join(cwd, 'src/content/works.json')
const works = JSON.parse(readFileSync(worksPath, 'utf8'))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const normalize = (value) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const scoreResult = (work, candidate) => {
  const normalizedTarget = normalize(work.title)
  const normalizedCandidate = normalize(candidate.display_name ?? '')
  let score = 0

  if (normalizedCandidate === normalizedTarget) score += 6
  if (normalizedCandidate.includes(normalizedTarget)) score += 4
  if (normalizedTarget.includes(normalizedCandidate)) score += 3
  if (candidate.publication_year === work.year) score += 2
  if (Math.abs((candidate.publication_year ?? 0) - work.year) <= 1) score += 1

  const hasAber = (candidate.authorships ?? []).some((authorship) =>
    (authorship.author?.display_name ?? '').toLowerCase().includes('aber'),
  )
  if (hasAber) score += 2

  return score
}

for (const work of works) {
  const searchUrl = new URL('https://api.openalex.org/works')
  searchUrl.searchParams.set('search', work.title)
  searchUrl.searchParams.set('per-page', '6')
  searchUrl.searchParams.set(
    'select',
    'id,display_name,publication_year,cited_by_count,doi,authorships',
  )

  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'larry-festschrift-openalex-enricher/0.1',
    },
  })

  if (!response.ok) {
    console.warn(`OpenAlex request failed for ${work.id}: ${response.status}`)
    continue
  }

  const payload = await response.json()
  const candidates = payload.results ?? []
  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreResult(work, candidate) }))
    .sort((left, right) => right.score - left.score)

  const best = scored[0]
  if (!best || best.score < 5) {
    console.warn(`No confident OpenAlex match for ${work.id}`)
    await sleep(150)
    continue
  }

  work.openAlexId = best.candidate.id ?? work.openAlexId
  work.citationCount = best.candidate.cited_by_count ?? work.citationCount
  work.doi = work.doi ?? best.candidate.doi ?? null

  console.log(
    `Matched ${work.id} -> ${best.candidate.id} (${best.candidate.publication_year}, citations ${best.candidate.cited_by_count})`,
  )

  await sleep(150)
}

writeFileSync(worksPath, `${JSON.stringify(works, null, 2)}\n`)
console.log(`Updated ${worksPath}`)
