import { describe, it, expect } from 'vitest';
import { Ball } from '../src/physics/ball';

// minSpeed=2, maxSpeed=10, radius=5 — sufficient for all Ball tests.
function makeBall(x = 0, y = 0, vx = 0, vy = 0): Ball {
  return new Ball(x, y, vx, vy, 5, 2, 10);
}

describe('Ball — update()', () => {
  it('advances x and y by velocity when no wall is hit', () => {
    const ball = makeBall(50, 50, 3, -2);
    ball.update(100);
    expect(ball.x).toBe(53);
    expect(ball.y).toBe(48);
  });

  it('flips vy positive and corrects y when hitting the top wall', () => {
    // y=3, vy=-5, radius=5: after update y=-2, which is below top edge (0).
    const ball = makeBall(50, 3, 0, -5);
    ball.update(100);
    expect(ball.vy).toBeGreaterThan(0);
    expect(ball.y).toBe(5); // corrected to radius
  });

  it('flips vy negative and corrects y when hitting the bottom wall', () => {
    // y=97, vy=5, radius=5: after update y=102, above bottom edge (100).
    const ball = makeBall(50, 97, 0, 5);
    ball.update(100);
    expect(ball.vy).toBeLessThan(0);
    expect(ball.y).toBe(95); // corrected to fieldHeight - radius
  });
});

describe('Ball — reverseX()', () => {
  it('negates vx and leaves vy unchanged', () => {
    const ball = makeBall(0, 0, 4, -3);
    ball.reverseX();
    expect(ball.vx).toBe(-4);
    expect(ball.vy).toBe(-3);
  });
});

describe('Ball — setSpeed()', () => {
  it('preserves velocity unchanged when magnitude is within [minSpeed, maxSpeed]', () => {
    const ball = makeBall();
    ball.setSpeed(3, 4); // magnitude = 5, within [2, 10]
    expect(ball.vx).toBeCloseTo(3);
    expect(ball.vy).toBeCloseTo(4);
  });

  it('scales vector down to maxSpeed when magnitude exceeds it', () => {
    const ball = makeBall();
    ball.setSpeed(12, 16); // magnitude = 20, clamped to maxSpeed=10
    const mag = Math.sqrt(ball.vx ** 2 + ball.vy ** 2);
    expect(mag).toBeCloseTo(10);
    expect(ball.vx / ball.vy).toBeCloseTo(12 / 16); // direction preserved
  });

  it('scales vector up to minSpeed when magnitude is below it', () => {
    const ball = makeBall();
    ball.setSpeed(0.6, 0.8); // magnitude = 1, clamped to minSpeed=2
    const mag = Math.sqrt(ball.vx ** 2 + ball.vy ** 2);
    expect(mag).toBeCloseTo(2);
    expect(ball.vx / ball.vy).toBeCloseTo(0.6 / 0.8); // direction preserved
  });
});

describe('Ball — reset()', () => {
  it('sets position and velocity to the supplied values', () => {
    const ball = makeBall(10, 20, 3, 4);
    ball.reset(100, 200, -5, 7);
    expect(ball.x).toBe(100);
    expect(ball.y).toBe(200);
    expect(ball.vx).toBe(-5);
    expect(ball.vy).toBe(7);
  });
});
