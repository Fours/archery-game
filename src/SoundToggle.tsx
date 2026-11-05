type SoundToggleProps = {
    muted: boolean
    onToggle: () => void
}

/** Speaker button in the bottom-right corner. While pointer-locked the cursor is hidden, so M toggles too. */
export function SoundToggle({ muted, onToggle }: SoundToggleProps) {
    return (
        <button
            className="plaque sound-toggle"
            aria-label={muted ? 'Unmute sound' : 'Mute sound'}
            aria-pressed={muted}
            title={muted ? 'Unmute (M)' : 'Mute (M)'}
            onClick={(e) => {
                // Don't let the click fall through to the container and grab pointer lock.
                e.stopPropagation()
                onToggle()
            }}
        >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
                {muted ? (
                    <path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                ) : (
                    <path
                        d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        fill="none"
                    />
                )}
            </svg>
        </button>
    )
}
