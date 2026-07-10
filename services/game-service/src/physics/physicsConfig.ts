export interface PhysicsConfig {
  fieldWidth:         number; // TUNE: wider field gives the ball more travel time between paddles
  fieldHeight:        number; // TUNE: taller field makes edge-hitting harder and spin more rewarding
  ballRadius:         number; // TUNE: larger = easier to hit; smaller = harder and faster-feeling
  ballInitialSpeed:   number; // TUNE: base pace of every rally; all speed bounds scale from this
  ballMinSpeedFactor: number; // TUNE: lower = ball can slow almost to a stop after a centre hit
  ballMaxSpeedFactor: number; // TUNE: higher = rallies escalate to faster speeds over time
  paddleWidth:        number; // TUNE: thicker paddle = more forgiving collision window depth-wise
  paddleHeight:       number; // TUNE: taller paddle = easier to reach the ball; shorter = harder
  paddleSpeed:        number; // TUNE: higher = more responsive paddle control
  paddleXOffset:      number; // TUNE: larger = paddle sits further from the wall, shrinking the safe zone
  maxScore:           number; // TUNE: higher = longer matches
}

export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  fieldWidth:         800,
  fieldHeight:        600,
  ballRadius:         10,
  ballInitialSpeed:   8,
  ballMinSpeedFactor: 0.5,
  ballMaxSpeedFactor: 3.0,
  paddleWidth:        12,
  paddleHeight:       80,
  paddleSpeed:        5,
  paddleXOffset:      20,
  maxScore:           11,
};
