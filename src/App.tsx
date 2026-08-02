import { AppProvider, useApp } from './state/app.tsx'
import { Inventory } from './ui/Inventory.tsx'
import { RecipeDetail } from './ui/RecipeDetail.tsx'
import { Results } from './ui/Results.tsx'
import { Saved } from './ui/Saved.tsx'
import { TargetEntry } from './ui/TargetEntry.tsx'

function Screen() {
  const { route } = useApp()
  switch (route.name) {
    case 'inventory':
      return <Inventory />
    case 'target':
      return <TargetEntry />
    case 'results':
      return <Results target={route.target} />
    case 'recipe':
      return <RecipeDetail recipe={route.recipe} saved={route.saved} />
    case 'saved':
      return <Saved />
  }
}

function Nav() {
  const { route, nav } = useApp()
  const tab = route.name === 'results' || route.name === 'target' ? 'target' : route.name === 'recipe' ? 'saved' : route.name
  return (
    <nav className="tabs">
      {(
        [
          ['inventory', 'Tubes'],
          ['target', 'Mix'],
          ['saved', 'Saved'],
        ] as const
      ).map(([name, label]) => (
        <button key={name} className={tab === name ? 'tab active' : 'tab'} onClick={() => nav({ name })}>
          {label}
        </button>
      ))}
    </nav>
  )
}

export default function App() {
  return (
    <AppProvider>
      <div className="shell">
        <header className="app-head">
          <h1>Pigment</h1>
          <p className="tagline">Which tubes, what ratio, how wrong.</p>
        </header>
        <main>
          <Screen />
        </main>
        <Nav />
      </div>
    </AppProvider>
  )
}
