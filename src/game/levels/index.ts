import { level1 } from './level1'
import type { LevelConfig } from './LevelConfig'

export type { LevelConfig, RowConfig } from './LevelConfig'

/** Ordered list of levels. Add a new level by authoring a config file and appending it here. */
export const LEVELS: LevelConfig[] = [level1]
