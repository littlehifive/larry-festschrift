# Larry Aber Festschrift

Interactive festschrift microsite for Larry Aber, built as a single full-screen scholarly graph with:

- an abstract 3D brain rendered in a luminous, tech-forward aesthetic
- paper nodes, collaborator anchors, and citation/coauthor edges
- a cinematic `Play / Pause` autorotation control
- a non-crashing static fallback when WebGL cannot mount
- a curated scholarly dataset with static build-time enrichment
- GitHub Pages deployment via Actions

## Stack

- `Vite`
- `React + TypeScript`
- `Three.js`

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Data scripts

Extract structured sections from the CV PDF:

```bash
npm run extract:cv
```

Refresh OpenAlex metadata for the curated work set:

```bash
npm run enrich:openalex
```

Validate the repo-local content graph:

```bash
npm run validate
```

## Content structure

- `src/content/` contains the curated themes, works, collaborators, citation links, brain regions, and extracted CV sections.
- `src/components/NetworkSection.tsx` contains the single-scene graph renderer and the static fallback renderer.
- `.github/workflows/deploy.yml` builds and deploys the site to GitHub Pages.

## Notes

- The site is configured for GitHub Pages under the repository base path `/larry-festschrift/`.
- The current dataset renders 22 highlighted works, 14 collaborators, and 34 graph links.
- A few legacy publications in the curated set do not have modern OpenAlex matches, so the prototype preserves them with curated metadata while using enriched IDs where available.
