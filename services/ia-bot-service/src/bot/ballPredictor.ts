/**
 * Predicts where the ball's Y coordinate will be after `stepsToImpact` physics
 * ticks, accounting for top/bottom wall bounces via analytical reflection.
 *
 * The bounce is periodic with period = 2 * (maxY - minY). A single modulo
 * operation maps the unbounded linear trajectory onto the bounce range, then a
 * fold maps it back into [minY, maxY]. No loop required — O(1) for any depth.
 */
export function predictBallY(
  ballY:          number,
  vy:             number,
  stepsToImpact:  number,
  fieldHeight:    number,
  ballRadius:     number,
): number {
  const minY   = ballRadius;
  const maxY   = fieldHeight - ballRadius;
  const range  = maxY - minY;
  const period = 2 * range;

  // Project ball Y forward by stepsToImpact ticks, shift to [0, range] basis.
  const shifted = ((ballY - minY + stepsToImpact * vy) % period + period) % period;

  // First half of the period is the outbound leg; second half folds back.
  return shifted <= range ? minY + shifted : maxY - (shifted - range);
}
