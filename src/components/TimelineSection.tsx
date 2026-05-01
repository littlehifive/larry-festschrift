import type { CSSProperties } from 'react'
import { themeMap } from '../content'
import type { Milestone, Theme } from '../types/content'

type TimelineSectionProps = {
  milestones: Milestone[]
  themes: Theme[]
  selectedMilestoneId: string
  activeThemeId: string
  progress: number
  onMilestoneSelect: (milestoneId: string) => void
  timelineIntro: string
}

const lanes: Array<Milestone['lane']> = [
  'formation',
  'institutions',
  'themes',
  'impact',
]

const laneLabels: Record<Milestone['lane'], string> = {
  formation: 'Formation',
  institutions: 'Institutions',
  themes: 'Themes',
  impact: 'Impact',
}

export function TimelineSection({
  milestones,
  themes,
  selectedMilestoneId,
  activeThemeId,
  progress,
  onMilestoneSelect,
  timelineIntro,
}: TimelineSectionProps) {
  const selectedMilestone =
    milestones.find((milestone) => milestone.id === selectedMilestoneId) ?? milestones[0]

  const minYear = Math.min(...milestones.map((milestone) => milestone.yearStart))
  const maxYear = Math.max(
    ...milestones.map((milestone) => milestone.yearEnd ?? milestone.yearStart),
  )

  return (
    <section className="timeline-section" id="timeline">
      <div className="sticky-shell">
        <div className="section-heading">
          <p className="section-heading__label">Scene I</p>
          <h2>Academic life as a layered timeline</h2>
          <p>{timelineIntro}</p>
        </div>

        <div className="timeline-layout">
          <div className="timeline-board">
            <div
              className="timeline-board__scanline"
              style={{ left: `${progress * 100}%` }}
            />

            <div className="timeline-board__years">
              {[1973, 1985, 1995, 2005, 2015, 2024].map((year) => (
                <span
                  key={year}
                  style={{
                    left: `${((year - minYear) / (maxYear - minYear)) * 100}%`,
                  }}
                >
                  {year}
                </span>
              ))}
            </div>

            {lanes.map((lane, laneIndex) => (
              <div key={lane} className="timeline-lane">
                <div className="timeline-lane__label">{laneLabels[lane]}</div>
                <div className="timeline-lane__track" />

                {milestones
                  .filter((milestone) => milestone.lane === lane)
                  .map((milestone) => {
                    const primaryTheme = themeMap.get(milestone.themeIds[0])
                    const left =
                      ((milestone.yearStart - minYear) / (maxYear - minYear)) * 100
                    const isSelected = milestone.id === selectedMilestoneId
                    const hasActiveTheme = milestone.themeIds.includes(activeThemeId)

                    return (
                      <button
                        key={milestone.id}
                        className={[
                          'timeline-node',
                          isSelected ? 'is-selected' : '',
                          hasActiveTheme ? 'is-active-theme' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={
                          {
                            left: `${left}%`,
                            '--theme-color': primaryTheme?.color ?? '#fff7ed',
                            '--lane-index': `${laneIndex}`,
                          } as CSSProperties
                        }
                        onClick={() => onMilestoneSelect(milestone.id)}
                        type="button"
                      >
                        <span className="timeline-node__dot" />
                        <span className="timeline-node__year">{milestone.yearStart}</span>
                        {isSelected ? (
                          <span className="timeline-node__title">{milestone.title}</span>
                        ) : null}
                      </button>
                    )
                  })}
              </div>
            ))}
          </div>

          <aside className="timeline-detail">
            <div className="timeline-detail__card">
              <p className="timeline-detail__eyebrow">
                {selectedMilestone.type} • {selectedMilestone.yearStart}
                {selectedMilestone.yearEnd ? `-${selectedMilestone.yearEnd}` : ''}
              </p>
              <h3>{selectedMilestone.title}</h3>
              {selectedMilestone.subtitle ? <p>{selectedMilestone.subtitle}</p> : null}
              <p className="timeline-detail__description">
                {selectedMilestone.description}
              </p>

              <div className="theme-pill-list">
                {selectedMilestone.themeIds.map((themeId) => {
                  const theme = themeMap.get(themeId)
                  if (!theme) return null

                  return (
                    <span
                      className="theme-pill"
                      key={themeId}
                      style={{ '--theme-color': theme.color } as CSSProperties}
                    >
                      {theme.label}
                    </span>
                  )
                })}
              </div>
            </div>

            <div className="timeline-detail__legend">
              {themes.map((theme) => (
                <div className="legend-row" key={theme.id}>
                  <span
                    className="legend-row__swatch"
                    style={{ backgroundColor: theme.color }}
                  />
                  <div>
                    <strong>{theme.label}</strong>
                    <p>{theme.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </section>
  )
}
