import type { SceneContent } from '../types/content'

type HeroSectionProps = {
  sceneContent: SceneContent
}

export function HeroSection({ sceneContent }: HeroSectionProps) {
  return (
    <section className="hero" id="top">
      <div className="hero__backdrop" aria-hidden="true">
        <div className="hero__halo hero__halo--left" />
        <div className="hero__halo hero__halo--right" />
        <div className="hero__grid" />
      </div>

      <div className="hero__content">
        <p className="hero__eyebrow">{sceneContent.heroCopy.eyebrow}</p>
        <h1>{sceneContent.heroCopy.headline}</h1>
        <p className="hero__lede">{sceneContent.heroCopy.lede}</p>

        <div className="hero__stats">
          {sceneContent.heroCopy.stats.map((stat) => (
            <article key={stat.label} className="hero__stat">
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </article>
          ))}
        </div>

        <div className="hero__actions">
          <a href="#timeline" className="button button--primary">
            Enter the timeline
          </a>
          <a href="#network" className="button button--ghost">
            Jump to the brain map
          </a>
        </div>
      </div>
    </section>
  )
}
