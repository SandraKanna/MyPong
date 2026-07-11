import { describe, it, expect, vi } from 'vitest';
import { Game } from '../src/physics/game';

// DEFAULT_PHYSICS_CONFIG values referenced throughout:
//   fieldWidth=800, fieldHeight=600, ballRadius=10, ballInitialSpeed=8
//   paddleWidth=12, paddleHeight=80, paddleSpeed=7, paddleXOffset=20, maxScore=11
//   left paddle face at x = paddleXOffset + paddleWidth = 32
//   right paddle face at x = fieldWidth - paddleXOffset - paddleWidth = 768
//   initial leftPaddleY = rightPaddleY = (600-80)/2 = 260  (spans y=260..340)

describe('Game — getState() initial state', () => {
  it('returns ball at field centre, paddles centred, score 0–0', () => {
    const state = new Game().getState();
    expect(state.ball).toEqual({ x: 400, y: 300 });
    expect(state.paddles).toEqual({ leftY: 260, rightY: 260 });
    expect(state.score).toEqual({ left: 0, right: 0 });
  });
});

describe('Game — paddle movement', () => {
  it('moves the left paddle up by paddleSpeed after one update()', () => {
    const game = new Game();
    game.setPaddleDirection('left', 'up');
    game.update();
    expect(game.getState().paddles.leftY).toBe(253); // 260 - 7
  });

  it('moves the right paddle down by paddleSpeed after one update()', () => {
    const game = new Game();
    game.setPaddleDirection('right', 'down');
    game.update();
    expect(game.getState().paddles.rightY).toBe(267); // 260 + 7
  });

  it('does not move the paddle when direction is stop', () => {
    const game = new Game();
    game.setPaddleDirection('left', 'stop');
    game.update();
    expect(game.getState().paddles.leftY).toBe(260);
  });

  it('clamps left paddle at top bound (leftY cannot go below 0)', () => {
    const game = new Game();
    game.setPaddleDirection('left', 'up');
    // 260 / paddleSpeed=7 = 37.1 ticks to reach 0; 55 ticks ensures it stays clamped.
    for (let i = 0; i < 55; i++) game.update();
    expect(game.getState().paddles.leftY).toBe(0);
  });

  it('clamps right paddle at bottom bound (rightY cannot exceed fieldHeight - paddleHeight)', () => {
    const game = new Game();
    game.setPaddleDirection('right', 'down');
    for (let i = 0; i < 55; i++) game.update();
    expect(game.getState().paddles.rightY).toBe(520); // 600 - 80
  });
});

describe('Game — pause and resume', () => {
  it('pause() freezes all state updates', () => {
    const game = new Game();
    const before = game.getState();
    game.pause();
    game.update();
    game.update();
    expect(game.isPaused).toBe(true);
    expect(game.getState()).toEqual(before);
  });

  it('resume() clears isPaused so update() advances state again', () => {
    const game = new Game();
    game.pause();
    game.resume();
    expect(game.isPaused).toBe(false);
    const before = game.getState();
    game.update();
    expect(game.getState().ball).not.toEqual(before.ball);
  });
});

describe('Game — scoring', () => {
  // For scoring tests the ball is placed at y=50, which is above the paddle's
  // vertical range (260..340), so it misses the paddle and exits the side wall.

  it('increments score.right when the ball exits the left wall', () => {
    const game = new Game();
    game.ball.reset(5, 50, -10, 0); // after update: x=-5, misses left paddle (y outside 260–340)
    game.update();
    expect(game.getState().score).toEqual({ left: 0, right: 1 });
  });

  it('increments score.left when the ball exits the right wall', () => {
    const game = new Game();
    game.ball.reset(795, 50, 10, 0); // after update: x=805, misses right paddle
    game.update();
    expect(game.getState().score).toEqual({ left: 1, right: 0 });
  });

  it('resets ball to field centre after a point is scored', () => {
    const game = new Game();
    game.ball.reset(5, 50, -10, 0);
    game.update();
    expect(game.getState().ball).toEqual({ x: 400, y: 300 });
  });

  it('sets isGameOver when a player reaches maxScore', () => {
    const game = new Game({ maxScore: 1 });
    game.ball.reset(5, 50, -10, 0);
    game.update();
    expect(game.isGameOver).toBe(true);
  });

  it('does not advance state after isGameOver is set', () => {
    const game = new Game({ maxScore: 1 });
    game.ball.reset(5, 50, -10, 0);
    game.update(); // right scores → isGameOver
    const frozen = game.getState();
    game.update();
    expect(game.getState()).toEqual(frozen);
  });
});

describe('Game — ball-paddle collision', () => {
  // Left paddle face at x=32 (paddleXOffset=20 + paddleWidth=12).
  // Right paddle face at x=768 (800 - 20 - 12).
  // Both paddles initially centred at leftPaddleY=rightPaddleY=260 (spans y=260..340).
  // Ball radius=10.

  it('bounces ball off the left paddle and corrects ball.x', () => {
    const game = new Game();
    // Ball at x=43: (43-10=33), just outside face (32). vx=-5 moves it to x=38.
    // 38-10=28 <= 32 → collision. vx flips to +5. x corrected to 32+10=42.
    game.ball.reset(43, 300, -5, 0);
    game.update();
    expect(game.getState().ball.x).toBe(42);
    // Subsequent tick must move the ball to the right (away from paddle).
    game.update();
    expect(game.getState().ball.x).toBeGreaterThan(42);
  });

  it('bounces ball off the right paddle and corrects ball.x', () => {
    const game = new Game();
    // Ball at x=757: (757+10=767), just outside face (768). vx=12 moves it to x=769.
    // 769+10=779 >= 768 → collision. vx flips to -12. x corrected to 768-10=758.
    game.ball.reset(757, 300, 12, 0);
    game.update();
    expect(game.getState().ball.x).toBe(758);
    game.update();
    expect(game.getState().ball.x).toBeLessThan(758);
  });

  it('does not bounce when ball misses the paddle vertically', () => {
    const game = new Game();
    // Ball at y=50 is above the paddle y-range (260..340). No collision.
    // Ball exits left without bouncing: x=43-5=38, no x correction applied.
    game.ball.reset(43, 50, -5, 0);
    game.update();
    expect(game.getState().ball.x).toBe(38); // uncorrected
  });

  // Spin tests — paddle centre at y=300 (leftPaddleY=260, paddleHeight=80).
  // Ball x=43, vx=-5: one tick moves to x=38, triggering left-paddle collision.

  it('deflects ball upward (negative vy) when hit lands above paddle centre', () => {
    const game = new Game();
    game.ball.reset(43, 265, -5, 0); // y=265 < paddleCentreY=300
    game.update();
    expect(game.ball.vy).toBeLessThan(0);
  });

  it('deflects ball downward (positive vy) when hit lands below paddle centre', () => {
    const game = new Game();
    game.ball.reset(43, 335, -5, 0); // y=335 > paddleCentreY=300
    game.update();
    expect(game.ball.vy).toBeGreaterThan(0);
  });

  it('gives vy ≈ 0 when hit lands at dead centre of paddle', () => {
    const game = new Game();
    game.ball.reset(43, 300, -5, 0); // y=300 = paddleCentreY
    game.update();
    expect(game.ball.vy).toBeCloseTo(0);
  });
});

describe('Game — resetBall() serve direction', () => {
  // resetBall() is triggered by scoring. vx is determined by which side just
  // scored (deterministic); vy remains a random coin flip via Math.random.
  // ball.reset(5, 50, -10, 0) → exits left wall → right scores.
  // ball.reset(795, 50, 10, 0) → exits right wall → left scores.

  it('serves toward the right (vx > 0) when the right side just scored', () => {
    const game = new Game();
    game.ball.reset(5, 50, -10, 0); // exits left wall → right scores → resetBall('right')
    game.update();
    expect(game.ball.vx).toBeGreaterThan(0);
  });

  it('serves toward the left (vx < 0) when the left side just scored', () => {
    const game = new Game();
    game.ball.reset(795, 50, 10, 0); // exits right wall → left scores → resetBall('left')
    game.update();
    expect(game.ball.vx).toBeLessThan(0);
  });

  it('randomises vy independently of the scoring side', () => {
    // vy is still a coin flip; confirm both signs are reachable regardless of
    // which side scored.
    const spy = vi.spyOn(Math, 'random');

    spy.mockReturnValue(0.1); // < 0.5 → positive vy
    const game1 = new Game();
    game1.ball.reset(5, 50, -10, 0);
    game1.update();
    expect(game1.ball.vy).toBeGreaterThan(0);

    spy.mockReturnValue(0.9); // ≥ 0.5 → negative vy
    const game2 = new Game();
    game2.ball.reset(5, 50, -10, 0);
    game2.update();
    expect(game2.ball.vy).toBeLessThan(0);

    spy.mockRestore();
  });
});
