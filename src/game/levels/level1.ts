import { ROOF_Y } from '../Booth'
import type { LevelConfig } from './LevelConfig'

// Rows are arranged front→middle→back (closest to player first):
//   - The furthest row sits at the booth's vertical middle.
//   - The nearer two rows sit above and below it.
//   - Adjacent rows move in opposite horizontal directions.
//   - Front = green ×1, middle = blue ×2, back = purple ×3 (handled by Tier).
export const level1: LevelConfig = {
    name: 'Level 1',
    rows: [
        { z: -4.5,  y: 1.4,                        tier: 'green',  speed: 2.0, direction:  1, startCenterX:  0.0 },
        { z: -7.5,  y: ROOF_Y - 1.6,               tier: 'blue',   speed: 1.5, direction: -1, startCenterX: -1.0 },
        { z: -10.5, y: (1.4 + (ROOF_Y - 1.6)) / 2, tier: 'purple', speed: 1.1, direction:  1, startCenterX:  1.0 },
    ],
    targetsPerRow: 3,
    targetSpacing: 2.6,
    edgePadding: 0.7,
}
