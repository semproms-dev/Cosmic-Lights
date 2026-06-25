import { basicAdjustments, buildDefaults } from './adjustments'

export type EditorAction =
  | { type: 'SET'; key: string; value: number }
  | { type: 'RESET' }

export function editorReducer(
  state: Record<string, number>,
  action: EditorAction,
): Record<string, number> {
  switch (action.type) {
    case 'SET':
      return { ...state, [action.key]: action.value }
    case 'RESET':
      return buildDefaults(basicAdjustments)
    default:
      return state
  }
}
