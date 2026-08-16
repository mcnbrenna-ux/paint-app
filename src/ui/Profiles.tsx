// Lighting-profile management (calibration PRD §4, §7, §8).

import { useState } from 'react'
import { needsReverification } from '../profiles/correction.ts'
import type { AnchorKind, LightingProfile, ProfileKind } from '../engine/types.ts'
import { useApp } from '../state/app.tsx'
import { EmptyLine } from './components.tsx'
import { ProfileCapture } from './ProfileCapture.tsx'

export function Profiles() {
  const app = useApp()
  const [creating, setCreating] = useState(false)
  const [capture, setCapture] = useState<{ mode: 'anchor' | 'swatches'; profile: LightingProfile } | null>(null)

  return (
    <section>
      <header className="screen-head">
        <h2>Lighting profiles</h2>
        <button className="primary" onClick={() => setCreating(true)}>
          New profile
        </button>
      </header>

      {/* §2 honest scope limitation — stated in the UI, verbatim in spirit. */}
      <p className="hint">
        A profile makes colors <strong>repeatable under one lighting setup</strong> — every photo is corrected
        against your own white dab, so comparisons within a profile hold. This is not absolute color accuracy:
        titanium white is a paint with a slight cast, not a lab-neutral reference. For a step closer to absolute,
        create a profile anchored on a photographic 18% gray card instead.
      </p>

      {app.profiles.length === 0 && <EmptyLine>No profiles yet — create one for each place you paint.</EmptyLine>}

      <ul className="rows">
        {app.profiles.map((p) => (
          <ProfileRow
            key={p.id}
            profile={p}
            onCapture={(mode) => setCapture({ mode, profile: p })}
          />
        ))}
      </ul>

      {creating && <CreateProfileWizard onClose={() => setCreating(false)} />}
      {capture && (
        <ProfileCapture
          mode={capture.mode}
          profile={capture.profile}
          onAnchor={(anchor) => {
            app.reshootAnchor(capture.profile.id, anchor)
            setCapture(null)
          }}
          onClose={() => setCapture(null)}
        />
      )}
    </section>
  )
}

function ProfileRow({
  profile,
  onCapture,
}: {
  profile: LightingProfile
  onCapture: (mode: 'anchor' | 'swatches') => void
}) {
  const app = useApp()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(profile.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notes, setNotes] = useState(profile.notes)

  const verified = profile.lastVerifiedAt > 0
  const isActive = app.activeProfile?.id === profile.id
  const stale = needsReverification(profile, Date.now())

  return (
    <li className={`row profile-row ${isActive ? 'active-profile' : ''}`}>
      <div className="row-main">
        {renaming ? (
          <span className="palette-confirm">
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <button
              className="primary small"
              disabled={!name.trim()}
              onClick={() => {
                app.updateProfile(profile.id, { name: name.trim() })
                setRenaming(false)
              }}
            >
              Save
            </button>
            <button className="ghost small" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <span className="row-title">
            {profile.name}
            {isActive && <em className="tag-active">active</em>}
            {profile.kind === 'daylight' && (
              <em className="tag-unusable" title="Window light shifts by hour, season, and cloud — the white dab absorbs some but not all of that. Results here carry lower confidence; use a lamp profile when precision matters.">
                variable light
              </em>
            )}
          </span>
        )}
        <span className="row-sub">
          {verified
            ? `${profile.swatches.length} swatch${profile.swatches.length === 1 ? '' : 'es'} · anchor ${
                profile.anchorKind === 'gray_card' ? 'gray card' : 'white paint'
              } · verified ${new Date(profile.lastVerifiedAt).toLocaleDateString()}`
            : 'Needs setup — shoot the anchor to start using it'}
        </span>
        {profile.kind === 'daylight' && (
          <span className="row-sub">
            Window light shifts by hour, season, and cloud — matches here carry lower confidence. Use a lamp
            profile when precision matters.
          </span>
        )}
        {stale && (
          <span className="warn-banner">
            It’s been over 6 months since this lamp setup was verified — re-shoot the anchor (one tap, keeps all
            your swatches). Bulb changed? Same fix.
          </span>
        )}
        {editingNotes ? (
          <span className="palette-confirm">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. overhead off, lamp at 4 o'clock"
              autoFocus
            />
            <button
              className="primary small"
              onClick={() => {
                app.updateProfile(profile.id, { notes })
                setEditingNotes(false)
              }}
            >
              Save
            </button>
          </span>
        ) : (
          <span className="row-sub profile-notes" onClick={() => setEditingNotes(true)}>
            {profile.notes || 'Add a note about this setup…'}
          </span>
        )}
        <div className="pin-actions">
          {verified && !isActive && (
            <button className="primary small" onClick={() => app.setActiveProfile(profile.id)}>
              Use this profile
            </button>
          )}
          {isActive && (
            <button className="ghost small" onClick={() => app.setActiveProfile(null)}>
              Stop using
            </button>
          )}
          {verified && (
            <button className="ghost small" onClick={() => onCapture('swatches')}>
              Capture swatches
            </button>
          )}
          <button className="ghost small" onClick={() => onCapture('anchor')}>
            {verified ? 'Re-shoot anchor' : 'Shoot anchor'}
          </button>
          {verified && profile.kind === 'artificial' && (
            <button
              className="ghost small"
              title="A new bulb changes the light — re-verify now rather than waiting."
              onClick={() => onCapture('anchor')}
            >
              Bulb changed?
            </button>
          )}
          <button className="ghost small" onClick={() => setRenaming(true)}>
            Rename
          </button>
          {!confirmDelete ? (
            <button className="ghost small" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          ) : (
            <>
              <button className="ghost small danger" onClick={() => app.deleteProfile(profile.id)}>
                Really delete{profile.swatches.length ? ` + ${profile.swatches.length} swatches` : ''}
              </button>
              <button className="ghost small" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  )
}

function CreateProfileWizard({ onClose }: { onClose: () => void }) {
  const app = useApp()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ProfileKind>('artificial')
  const [anchorKind, setAnchorKind] = useState<AnchorKind>('white_paint')
  const [step, setStep] = useState<'details' | 'anchor'>('details')

  if (step === 'anchor') {
    return (
      <ProfileCapture
        mode="anchor"
        onAnchor={(anchor) => {
          app.createProfile(name.trim(), kind, anchorKind, anchor)
          onClose()
        }}
        onClose={onClose}
      />
    )
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="screen-head">
          <h3>New lighting profile</h3>
          <button className="ghost small" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="custom-form">
          <label>
            Name it after when and where you paint
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Night — desk lamp, Weekend afternoon"
              autoFocus
            />
          </label>
          <fieldset>
            <legend>What kind of light?</legend>
            <label className="pig-check">
              <input type="radio" checked={kind === 'artificial'} onChange={() => setKind('artificial')} />
              Lamp / bulb — stable, best precision
            </label>
            <label className="pig-check">
              <input type="radio" checked={kind === 'daylight'} onChange={() => setKind('daylight')} />
              Daylight / window — inherently variable; results carry lower confidence
            </label>
          </fieldset>
          <fieldset>
            <legend>Anchor</legend>
            <label className="pig-check">
              <input type="radio" checked={anchorKind === 'white_paint'} onChange={() => setAnchorKind('white_paint')} />
              A dab of my titanium white ($0 — keep it on the palette, in every photo)
            </label>
            <label className="pig-check">
              <input type="radio" checked={anchorKind === 'gray_card'} onChange={() => setAnchorKind('gray_card')} />
              An 18% gray card (optional, a step closer to absolute color)
            </label>
          </fieldset>
          <div className="btn-row">
            <button className="primary" disabled={!name.trim()} onClick={() => setStep('anchor')}>
              Next: shoot the anchor where you paint
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
