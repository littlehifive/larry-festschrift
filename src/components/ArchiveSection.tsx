import type { CSSProperties } from 'react'
import type { Theme, Work } from '../types/content'

type ArchiveSectionProps = {
  works: Work[]
  themes: Theme[]
  credits: string
}

export function ArchiveSection({
  works,
  themes,
  credits,
}: ArchiveSectionProps) {
  const grouped = themes.map((theme) => ({
    theme,
    works: works.filter((work) => work.themeIds.includes(theme.id)),
  }))

  return (
    <section className="archive-section" id="archive">
      <div className="section-heading">
        <p className="section-heading__label">Archive</p>
        <h2>The broader record behind the scenes</h2>
        <p>
          The main visual narrative uses a curated highlight set. The full CV remains
          available as a source document, and the works below show the prototype
          archive grouped by theme.
        </p>
      </div>

      <div className="archive-actions">
        <a className="button button--primary" href="/larry-festschrift/assets/larry-cv.pdf">
          Download the CV
        </a>
        <a className="button button--ghost" href="#top">
          Back to top
        </a>
      </div>

      <div className="archive-grid">
        {grouped.map(({ theme, works: themeWorks }) => (
          <section
            className="archive-card"
            key={theme.id}
            style={{ '--theme-color': theme.color } as CSSProperties}
          >
            <header>
              <span className="archive-card__swatch" />
              <h3>{theme.label}</h3>
              <p>{theme.description}</p>
            </header>
            <ul>
              {themeWorks.map((work) => (
                <li key={`${theme.id}-${work.id}`}>
                  <strong>{work.year}</strong>
                  <div>
                    <p>{work.title}</p>
                    <span>
                      {work.venue ?? 'Publication'} • {work.citationCount} citations
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <footer className="archive-footer">
        <p>{credits}</p>
        <p>
          Prototype note: books and reports are included where they are structurally
          important to the narrative, even when the citation network centers journal work.
        </p>
      </footer>
    </section>
  )
}
