import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const cwd = process.cwd()
const pdfPath = path.join(cwd, 'Aber_cv_ October 2024-accessible.pdf')
const outputPath = path.join(cwd, 'src/content/cv-sections.json')

const rawText = execFileSync('pdftotext', [pdfPath, '-'], {
  cwd,
  encoding: 'utf8',
})

const sectionNames = [
  'Education',
  'Employment History',
  'Research Interests',
  'Publications',
  'Books & Monographs',
  'Journal Articles',
  'Chapters',
  'Civic and Professional Activities, 1984-2022',
]

const sections = {}

for (let index = 0; index < sectionNames.length; index += 1) {
  const name = sectionNames[index]
  const start = rawText.indexOf(name)
  const endCandidates = sectionNames
    .slice(index + 1)
    .map((candidate) => rawText.indexOf(candidate))
    .filter((position) => position > start)
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : rawText.length
  sections[name] = start === -1 ? '' : rawText.slice(start, end).trim()
}

writeFileSync(
  outputPath,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), sections }, null, 2)}\n`,
)

console.log(`Wrote CV section extract to ${outputPath}`)
