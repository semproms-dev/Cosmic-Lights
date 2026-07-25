import type { ModelPrompt } from './types'

/**
 * The prompt geometry `SamProcessor` accepts, in the pixels of the image that was
 * fed to the model. Shapes follow the processor's contract:
 * `input_points` `[point_batch, points, 2]`, `input_labels` `[point_batch,
 * points]`, `input_boxes` `[batch, boxes, 4]`.
 */
export interface SamPromptArrays {
  input_points?: number[][][]
  input_labels?: number[][]
  input_boxes?: number[][][]
}

/**
 * Scales a normalised prompt to the pixels SAM was fed and shapes it the way the
 * processor expects.
 *
 * **A box with no points gets one added at its centre**, and not for taste:
 * `SamModel.forward` fills in missing labels with
 * `input_labels ??= ones(input_points.dims…)`, which throws outright when there
 * are no points, while the processor refuses labels that come without points.
 * A box-only prompt is therefore unrepresentable in transformers.js 4.2.0 — and
 * a box plus its centre point is what SAM is normally prompted with anyway.
 *
 * @param prompt - Points/box in normalised [0,1] image coordinates.
 * @param width - Width, in pixels, of the image fed to the model.
 * @param height - Height, in pixels, of the image fed to the model.
 * @returns The processor options. Empty when the prompt says nothing.
 */
export function buildPromptArrays(
  prompt: ModelPrompt,
  width: number,
  height: number,
): SamPromptArrays {
  const options: SamPromptArrays = {}
  const points = [...prompt.points]

  if (prompt.box !== null) {
    const { x0, y0, x1, y1 } = prompt.box
    options.input_boxes = [[[x0 * width, y0 * height, x1 * width, y1 * height]]]
    if (points.length === 0) {
      points.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, label: 1 })
    }
  }

  if (points.length > 0) {
    options.input_points = [points.map((point) => [point.x * width, point.y * height])]
    options.input_labels = [points.map((point) => point.label)]
  }

  return options
}
