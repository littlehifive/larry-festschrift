import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const cwd = process.cwd()
const cv = JSON.parse(readFileSync(path.join(cwd, 'src/content/cv-sections.json'), 'utf8'))

const SECTIONS = ['Books & Monographs', 'Journal Articles', 'Chapters']
const rawText = SECTIONS.map((key) => cv.sections[key] ?? '').join('\n\n')

const cleaned = rawText
  // strip page-break artifacts
  .replace(/J\.\s*Lawrence Aber,\s*Ph\.D\.[\s\S]*?Page\s*\d+/g, ' ')
  .replace(/\bOctober \d+,\s*2024\b/g, ' ')
  .replace(/https?:\/\/\S+/g, ' ')
  .replace(/doi:\s*\S+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim()

// Year-marker patterns we recognize as the end of an author block.
const YEAR_BOUNDARY = /\(((?:19|20)\d{2}(?:[,\/–\-\s]+(?:in\s+press|submitted|under\s+review|in\s+submission|(?:19|20)?\d{2,4}))?|in press|in submission|submitted|under review)[^)]*\)\s*\.?\s*/gi

const ABER_INITIAL_PATTERNS = [
  /^J\.?\s*L\.?$/i,
  /^J\.\s*L\.$/,
  /^J\.L\.$/,
  /^J\.\s*Lawrence$/i,
  /^Lawrence$/i,
]

function isAber(surname, initials) {
  if (!/^Aber$/i.test(surname.trim())) return false
  if (ABER_INITIAL_PATTERNS.some((re) => re.test(initials.trim()))) return true
  // Treat any "Aber" with a leading "J" initial as Larry — handles stray multi-letter parses.
  return /^J/i.test(initials.replace(/\s+/g, '').trim())
}

const NAME_OVERRIDES = new Map([
  ['Aber|J.L.', 'J. Lawrence Aber'],
  ['Brooks-Gunn|J.', 'Jeanne Brooks-Gunn'],
  ['Yoshikawa|H.', 'Hirokazu Yoshikawa'],
  ['Cicchetti|D.', 'Dante Cicchetti'],
  ['Belsky|J.', 'Jay Belsky'],
  ['Slade|A.', 'Arietta Slade'],
  ['Crnic|K.', 'Keith Crnic'],
  ['Mischel|W.', 'Walter Mischel'],
  ['Allen|J.P.', 'Joseph P. Allen'],
  ['Allen|J.', 'Joseph P. Allen'],
  ['Trickett|P.K.', 'Penelope K. Trickett'],
  ['Carlson|V.', 'Vicki Carlson'],
  ['Macksoud|M.S.', 'Mona S. Macksoud'],
  ['Macksoud|M.', 'Mona S. Macksoud'],
  ['Bennett|N.G.', 'Neil G. Bennett'],
  ['Bennett|N.', 'Neil G. Bennett'],
  ['Conley|D.', 'Dalton Conley'],
  ['Li|J.', 'Jiali Li'],
  ['Duncan|G.J.', 'Greg J. Duncan'],
  ['Duncan|G.', 'Greg J. Duncan'],
  ['Beardslee|W.R.', 'William R. Beardslee'],
  ['Beardslee|W.', 'William R. Beardslee'],
  ['Gershoff|E.T.', 'Elizabeth T. Gershoff'],
  ['Gershoff|E.', 'Elizabeth T. Gershoff'],
  ['Raver|C.C.', 'C. Cybele Raver'],
  ['Raver|C.', 'C. Cybele Raver'],
  ['Lennon|M.C.', 'Mary Clare Lennon'],
  ['Lennon|M.', 'Mary Clare Lennon'],
  ['Morris|P.', 'Pamela Morris'],
  ['Morris|P.A.', 'Pamela Morris'],
  ['Berg|J.', 'Juliette Berg'],
  ['Wolf|S.', 'Sharon Wolf'],
  ['Tubbs Dolan|C.', 'Carly Tubbs Dolan'],
  ['Tubbs|C.', 'Carly Tubbs Dolan'],
  ['Kim|H.Y.', 'Ha Yeon Kim'],
  ['Kim|H.', 'Ha Yeon Kim'],
  ['Brown|L.', 'Lindsay Brown'],
  ['Brown|L.E.', 'Lindsay Brown'],
  ['Brown|J.L.', 'Joshua L. Brown'],
  ['Brown|J.', 'Joshua L. Brown'],
  ['Jones|S.M.', 'Stephanie M. Jones'],
  ['Jones|S.', 'Stephanie M. Jones'],
  ['Torrente|C.', 'Catalina Torrente'],
  ['Seidman|E.', 'Edward Seidman'],
  ['Halpin|P.F.', 'Peter F. Halpin'],
  ['Halpin|P.', 'Peter F. Halpin'],
  ['Annan|J.', 'Jeannie Annan'],
  ['Starkey|L.', 'Leighann Starkey'],
  ['Shivshanker|A.', 'Anjuli Shivshanker'],
  ['Johnston|B.', 'Brian Johnston'],
  ['Behrman|J.R.', 'Jere R. Behrman'],
  ['Behrman|J.', 'Jere R. Behrman'],
  ['Tsinigo|E.', 'Edward Tsinigo'],
  ['Gjicali|K.', 'Kalina Gjicali'],
  ['Sheridan|M.A.', 'Margaret A. Sheridan'],
  ['Sheridan|M.', 'Margaret A. Sheridan'],
  ['Wu|Z.', 'Zezhen Wu'],
  ['Sethi|A.', 'Anita Sethi'],
  ['Shoda|Y.', 'Yuichi Shoda'],
  ['Cappella|E.', 'Elise Cappella'],
  ['Wuermli|A.', 'Alice Wuermli'],
  ['Wuermli|A.J.', 'Alice Wuermli'],
  ['Dryden-Peterson|S.', 'Sarah Dryden-Peterson'],
  ['Burde|D.', 'Dana Burde'],
  ['Suárez-Orozco|M.', 'Marcelo Suárez-Orozco'],
  ['Sternberg|R.J.', 'Robert J. Sternberg'],
  ['Lombardi|J.', 'Joan Lombardi'],
  ['Klaus|S.', 'Sara Klaus'],
  ['Campion|K.', 'Kim Campion'],
  ['Hauser|R.M.', 'Robert M. Hauser'],
  ['Phillips|D.A.', 'Deborah A. Phillips'],
  ['Maholmes|V.', 'Valerie Maholmes'],
  ['McLearn|K.T.', 'Kathryn Taaffe McLearn'],
  ['Halfon|N.', 'Neal Halfon'],
  ['Boothby|N.', 'Neil Boothby'],
  ['Huebner|G.', 'Gillian Huebner'],
  ['Darmstadt|G.L.', 'Gary L. Darmstadt'],
  ['Diaz|A.', 'Angela Diaz'],
  ['Masten|A.S.', 'Ann S. Masten'],
  ['Sachs|J.', 'Jeffrey Sachs'],
  ['Redlener|I.', 'Irwin Redlener'],
  ['Pollak|S.D.', 'Seth D. Pollak'],
  ['Nelson|C.A.', 'Charles A. Nelson III'],
  ['Zeanah|C.H.', 'Charles H. Zeanah'],
  ['Wessells|M.', 'Mike Wessells'],
  ['Stark|L.', 'Lindsay Stark'],
  ['Berman|B.', 'Brad Berman'],
  ['Blum|R.', 'Robert Blum'],
  ['Canavera|M.', 'Mark Canavera'],
  ['Eckerle|J.', 'Judith Eckerle'],
  ['Fox|N.A.', 'Nathan A. Fox'],
  ['Gibbons|J.L.', 'Judith L. Gibbons'],
  ['Hargarten|S.W.', 'Stephen W. Hargarten'],
  ['Landers|C.', 'Cassie Landers'],
  ['Raugh|V.', 'Virginia Rauh'],
  ['Samson|M.', 'Michael Samson'],
  ['Ssewamala|F.', 'Fred Ssewamala'],
  ['St Clair|N.', 'Nicole St Clair'],
  ['Waldman|R.', 'Ronald Waldman'],
  ['Wilson|S.L.', 'Sandra L. Wilson'],
  ['Pitt|M.', 'Mark Pitt'],
  ['Arnold|L.', 'Lynne Arnold'],
  ['Barber|B.', 'Brian Barber'],
  ['Emmel|A.', 'Alma Emmel'],
  ['Butler|S.', 'Stuart Butler'],
  ['Danziger|S.', 'Sheldon Danziger'],
  ['Doar|R.', 'Robert Doar'],
  ['Ellwood|D.T.', 'David T. Ellwood'],
  ['Gueron|J.M.', 'Judith M. Gueron'],
  ['Haidt|J.', 'Jonathan Haidt'],
  ['Haskins|R.', 'Ron Haskins'],
  ['Holzer|H.J.', 'Harry J. Holzer'],
  ['Hymowitz|K.', 'Kay Hymowitz'],
  ['Mead|L.', 'Lawrence Mead'],
  ['Mincy|R.', 'Ronald Mincy'],
  ['Reeves|R.V.', 'Richard V. Reeves'],
  ['Strain|M.R.', 'Michael R. Strain'],
  ['Waldfogel|J.', 'Jane Waldfogel'],
  ['Berliner|L.', 'Lucy Berliner'],
  ['Briere|J.', 'John Briere'],
  ['Bulkley|J.A.', 'Josephine A. Bulkley'],
  ['Jenny|C.', 'Carole Jenny'],
  ['Reid|T.A.', 'Theresa A. Reid'],
  ['Hoover|S.', 'Sherril Hoover'],
  ['Voran|M.', 'Monica Voran'],
])

const aberSurnameVariants = new Set(['Aber'])

function lookupOverride(surname, initials) {
  const key = `${surname}|${initials}`
  if (NAME_OVERRIDES.has(key)) return NAME_OVERRIDES.get(key)
  // try without spaces in initials
  const compactKey = `${surname}|${initials.replace(/\s+/g, '')}`
  if (NAME_OVERRIDES.has(compactKey)) return NAME_OVERRIDES.get(compactKey)
  // try first-initial only
  const firstInitial = initials.replace(/\s+/g, '').match(/^[A-Z]\./)
  if (firstInitial) {
    const shortKey = `${surname}|${firstInitial[0]}`
    if (NAME_OVERRIDES.has(shortKey)) return NAME_OVERRIDES.get(shortKey)
  }
  return null
}

function canonicalName(surname, initials) {
  const trimmedSurname = surname.replace(/\.$/, '').trim()
  const trimmedInitials = initials.replace(/\s+/g, ' ').trim()
  if (isAber(trimmedSurname, trimmedInitials)) {
    return 'J. Lawrence Aber'
  }
  const override = lookupOverride(trimmedSurname, trimmedInitials)
  if (override) return override
  return `${trimmedInitials} ${trimmedSurname}`
}

function slugifyName(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parseAuthors(rawBlock) {
  let block = rawBlock
    .replace(/\s+/g, ' ')
    .replace(/\(\s*Eds?\.\s*\)/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim()

  // remove parenthetical institution mentions
  block = block.replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim()

  // Strip leading "In " editor mentions for chapters
  block = block.replace(/^In\s+/i, '')

  // Use a regex that matches "Surname[, F. F.]" with allowance for hyphen, accents,
  // multi-word surnames, suffixes, prefixes, and stray periods.
  const authorRe =
    /([\p{Lu}][\p{L}'\-]+(?:\s+[\p{Lu}][\p{L}'\-]+){0,2})\.?,\s+((?:[\p{Lu}]\.?\s*)+(?:\s*(?:de\s+la|del?|van|von)\s+[\p{Lu}]\.?)?(?:\s+III|\s+II|\s+Jr\.?|\s+Sr\.?)?)/gu

  const authors = []
  let m
  while ((m = authorRe.exec(block)) !== null) {
    const rawSurname = m[1].trim()
    let initials = m[2].trim()
    // Normalize initials spacing: "J.L." vs "J. L."
    initials = initials.replace(/([A-Z])\s*\./g, '$1.').replace(/\.([A-Z])/g, '. $1').trim()
    // Skip junk like "In M. Suárez-Orozco"
    if (/^(In|Eds?|And|Or)$/i.test(rawSurname)) continue
    authors.push({ surname: rawSurname, initials })
  }
  return authors
}

const THEME_KEYWORDS = {
  attachment: [
    'attachment',
    'toddler',
    'mother',
    'maternal',
    'infant',
    'parenting',
    'parent development',
    'representations',
    'caregiver',
    'separation',
    'delay of gratification',
    'self-regulation',
    'effectance',
  ],
  risk: [
    'maltreatment',
    'abuse',
    'neglect',
    'violence',
    'trauma',
    '9/11',
    'september 11',
    'psychopathology',
    'risk',
    'aggression',
    'externalizing',
  ],
  poverty: [
    'poverty',
    'income',
    'neighborhood',
    'welfare',
    'cash transfer',
    'public policy',
    'tanf',
    'ssbg',
    'material hardship',
    'family policy',
    'social policy',
    'opportunity',
    'inequality',
  ],
  sel: [
    'social-emotional',
    'social and emotional',
    'social emotional',
    'rccp',
    'resolving conflict',
    'school-based',
    'classroom',
    'school climate',
    'literacy',
    '4rs',
    'creatively',
    'sel',
    'mindfulness',
    'reading and math',
    'achievement test',
    'teaching',
    'preschool',
  ],
  global: [
    'lebanon',
    'syrian',
    'refugee',
    'congo',
    'drc',
    'niger',
    'ghana',
    'rwanda',
    'humanitarian',
    'crisis',
    'conflict-affected',
    'global',
    'low-income countries',
    'low- and middle-income',
    'displaced',
    'migration',
    'displacement',
    'cross-cultural',
  ],
}

function classifyTheme(text) {
  const lower = (text || '').toLowerCase()
  let best = null
  let bestScore = 0
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    let score = 0
    for (const kw of keywords) if (lower.includes(kw)) score += 1
    if (score > bestScore) {
      bestScore = score
      best = theme
    }
  }
  return best ?? 'sel'
}

// ---------- Main parse ----------

// Split into citation chunks. A boundary is whitespace immediately followed by a
// new "Surname, F." pattern at the start of an author block.
const CITATION_SPLIT =
  /(?<=[\.\)\]])\s+(?=\p{Lu}[\p{L}'\-]+(?:\s+\p{Lu}[\p{L}'\-]+){0,2}\.?,\s+\p{Lu}\.(?:\s*\p{Lu}\.)*[,\s])/u

const chunks = cleaned.split(CITATION_SPLIT)

const yearLocator = /\(((?:19|20)\d{2}(?:[,\/–\-\s]+(?:in\s+press|submitted|under\s+review|in\s+submission|(?:19|20)?\d{2,4}))?|in press|in submission|submitted|under review)[^)]*\)/i

const papers = []
for (const chunk of chunks) {
  const yearMatch = yearLocator.exec(chunk)
  if (!yearMatch) continue

  const yearStr = yearMatch[1]
  const yearNum = (() => {
    const m = String(yearStr).match(/(19|20)\d{2}/)
    return m ? parseInt(m[0], 10) : null
  })()

  const authorBlock = chunk.slice(0, yearMatch.index).trim()
  const titleArea = chunk
    .slice(yearMatch.index + yearMatch[0].length)
    .replace(/^\s*\.\s*/, '')
  const titleEnd = titleArea.search(/(?<=[a-z\)\]\d])\.\s+\p{Lu}/u)
  const title = (titleEnd > 0 ? titleArea.slice(0, titleEnd + 1) : titleArea.slice(0, 240)).trim()

  const parsedAuthors = parseAuthors(authorBlock)
  if (parsedAuthors.length === 0) continue

  const themeId = classifyTheme(title)
  papers.push({ year: yearNum, yearLabel: yearStr, title, authors: parsedAuthors, themeId })
}

// ---------- Build authors and edges ----------

const authorIdByCanonical = new Map()
const authorRecords = new Map()

function ensureAuthor(rawAuthor) {
  const canonical = canonicalName(rawAuthor.surname, rawAuthor.initials)
  if (authorIdByCanonical.has(canonical)) return authorIdByCanonical.get(canonical)
  const id = slugifyName(canonical)
  authorIdByCanonical.set(canonical, id)
  authorRecords.set(id, {
    id,
    name: canonical,
    paperCount: 0,
    themeCounts: {},
    surnameVariants: new Set([rawAuthor.surname]),
  })
  return id
}

const decoratedPapers = papers.map((paper, index) => {
  const authorIds = paper.authors.map((author) => ensureAuthor(author))
  authorIds.forEach((id) => {
    const record = authorRecords.get(id)
    record.paperCount += 1
    record.themeCounts[paper.themeId] = (record.themeCounts[paper.themeId] ?? 0) + 1
  })
  return { id: `paper-${index.toString().padStart(4, '0')}`, ...paper, authorIds }
})

// Determine each author's dominant theme
authorRecords.forEach((record) => {
  let bestTheme = 'sel'
  let bestCount = -1
  for (const [theme, count] of Object.entries(record.themeCounts)) {
    if (count > bestCount) {
      bestTheme = theme
      bestCount = count
    }
  }
  record.themeId = bestTheme
  delete record.themeCounts
  delete record.surnameVariants
})

// Edges: weight = number of co-authored papers
const edgeMap = new Map()
function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

decoratedPapers.forEach((paper) => {
  const ids = [...new Set(paper.authorIds)]
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const key = pairKey(ids[i], ids[j])
      const existing = edgeMap.get(key)
      if (existing) {
        existing.weight += 1
        existing.papers.push(paper.id)
      } else {
        edgeMap.set(key, {
          sourceId: ids[i] < ids[j] ? ids[i] : ids[j],
          targetId: ids[i] < ids[j] ? ids[j] : ids[i],
          weight: 1,
          papers: [paper.id],
        })
      }
    }
  }
})

const centralId = slugifyName('J. Lawrence Aber')

const authors = [...authorRecords.values()].sort((left, right) => right.paperCount - left.paperCount)
const edges = [...edgeMap.values()]

// Drop authors that never appear with Larry AND have no other links — keep network connected
const linkedToCentral = new Set([centralId])
edges.forEach((edge) => {
  if (edge.sourceId === centralId) linkedToCentral.add(edge.targetId)
  if (edge.targetId === centralId) linkedToCentral.add(edge.sourceId)
})

const filteredAuthors = authors.filter(
  (author) => linkedToCentral.has(author.id) || author.paperCount >= 1,
)

const summary = {
  generatedAt: new Date().toISOString(),
  centralAuthorId: centralId,
  authorCount: filteredAuthors.length,
  paperCount: decoratedPapers.length,
  edgeCount: edges.length,
}

const payload = {
  ...summary,
  authors: filteredAuthors,
  papers: decoratedPapers.map((paper) => ({
    id: paper.id,
    year: paper.year,
    yearLabel: paper.yearLabel,
    title: paper.title,
    themeId: paper.themeId,
    authorIds: paper.authorIds,
  })),
  edges,
}

writeFileSync(
  path.join(cwd, 'src/content/coauthor-network.json'),
  JSON.stringify(payload, null, 2),
)

console.log(
  `Parsed ${decoratedPapers.length} papers, ${filteredAuthors.length} authors, ${edges.length} edges.`,
)
console.log(`Central node: ${centralId}`)
const top = filteredAuthors.slice(0, 12)
console.log('Top co-authors:')
top.forEach((author) => {
  console.log(`  ${author.name.padEnd(32)} papers=${author.paperCount} theme=${author.themeId}`)
})
