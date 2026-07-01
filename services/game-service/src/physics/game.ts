import { Ball } from './ball';
import { DEFAULT_PHYSICS_CONFIG, type PhysicsConfig } from './physicsConfig';

export interface GameState {
  ball:    { x: number; y: number };
  paddles: { leftY: number; rightY: number };
  score:   { left: number; right: number };
}

type Side      = 'left' | 'right';
type Direction = 'up' | 'down' | 'stop';

export class Game {
  isPaused:   boolean = false;
  isGameOver: boolean = false;

  // Public so tests (and a future session manager) can read or reposition the
  // ball directly without going through getState().
  ball: Ball;

  private readonly cfg: PhysicsConfig;
  private leftPaddleY:    number;
  private rightPaddleY:   number;
  private leftDirection:  Direction = 'stop';
  private rightDirection: Direction = 'stop';
  private score: { left: number; right: number } = { left: 0, right: 0 };

  constructor(overrides?: Partial<PhysicsConfig>) {
    this.cfg = { ...DEFAULT_PHYSICS_CONFIG, ...overrides };

    const { fieldWidth, fieldHeight, ballInitialSpeed, ballRadius,
            ballMinSpeedFactor, ballMaxSpeedFactor, paddleHeight } = this.cfg;

    this.ball = new Ball(
      fieldWidth  / 2,
      fieldHeight / 2,
      ballInitialSpeed,
      ballInitialSpeed,
      ballRadius,
      ballInitialSpeed * ballMinSpeedFactor,
      ballInitialSpeed * ballMaxSpeedFactor,
    );

    this.leftPaddleY  = (fieldHeight - paddleHeight) / 2;
    this.rightPaddleY = (fieldHeight - paddleHeight) / 2;
  }

  update(): void {
    if (this.isPaused || this.isGameOver) return;

    // Integrate paddle positions from stored directions.
    this.leftPaddleY  = this.clampPaddleY(this.leftPaddleY  + this.dirDelta(this.leftDirection));
    this.rightPaddleY = this.clampPaddleY(this.rightPaddleY + this.dirDelta(this.rightDirection));

    // Advance ball; top/bottom wall bounces handled inside ball.update().
    this.ball.update(this.cfg.fieldHeight);

    // Paddle collision: reverse X, correct position, and apply spin.
    if (this.hitLeftPaddle()) {
      this.ball.reverseX();
      this.ball.x = this.cfg.paddleXOffset + this.cfg.paddleWidth + this.ball.radius;
      this.applySpin(this.leftPaddleY);
    } else if (this.hitRightPaddle()) {
      this.ball.reverseX();
      this.ball.x = this.cfg.fieldWidth - this.cfg.paddleXOffset - this.cfg.paddleWidth - this.ball.radius;
      this.applySpin(this.rightPaddleY);
    }

    // Scoring: ball exits a side wall.
    if (this.ball.x - this.ball.radius <= 0) {
      this.score.right++;
      this.resetBall();
      if (this.score.right >= this.cfg.maxScore) this.isGameOver = true;
    } else if (this.ball.x + this.ball.radius >= this.cfg.fieldWidth) {
      this.score.left++;
      this.resetBall();
      if (this.score.left >= this.cfg.maxScore) this.isGameOver = true;
    }
  }

  setPaddleDirection(side: Side, direction: Direction): void {
    if (side === 'left') {
      this.leftDirection  = direction;
    } else {
      this.rightDirection = direction;
    }
  }

  pause(): void  { this.isPaused = true;  }
  resume(): void { this.isPaused = false; }

  getState(): GameState {
    return {
      ball:    { x: this.ball.x,     y: this.ball.y },
      paddles: { leftY: this.leftPaddleY, rightY: this.rightPaddleY },
      score:   { left: this.score.left,   right: this.score.right },
    };
  }

  private clampPaddleY(y: number): number {
    return Math.max(0, Math.min(this.cfg.fieldHeight - this.cfg.paddleHeight, y));
  }

  private dirDelta(dir: Direction): number {
    if (dir === 'up')   return -this.cfg.paddleSpeed;
    if (dir === 'down') return  this.cfg.paddleSpeed;
    return 0;
  }

  private hitLeftPaddle(): boolean {
    const faceX = this.cfg.paddleXOffset + this.cfg.paddleWidth;
    return (
      this.ball.vx < 0 &&
      this.ball.x - this.ball.radius <= faceX &&
      this.ball.y + this.ball.radius >  this.leftPaddleY &&
      this.ball.y - this.ball.radius <  this.leftPaddleY + this.cfg.paddleHeight
    );
  }

  private hitRightPaddle(): boolean {
    const faceX = this.cfg.fieldWidth - this.cfg.paddleXOffset - this.cfg.paddleWidth;
    return (
      this.ball.vx > 0 &&
      this.ball.x + this.ball.radius >= faceX &&
      this.ball.y + this.ball.radius >  this.rightPaddleY &&
      this.ball.y - this.ball.radius <  this.rightPaddleY + this.cfg.paddleHeight
    );
  }

  // Offset from paddle centre (~[-1, 1]): centre hit → vy≈0, edge hit → steeper deflection.
  private applySpin(paddleY: number): void {
    const offset = (this.ball.y - (paddleY + this.cfg.paddleHeight / 2)) / (this.cfg.paddleHeight / 2);
    this.ball.setSpeed(this.ball.vx, offset * this.cfg.ballInitialSpeed);
  }

  private resetBall(): void {
    const { fieldWidth, fieldHeight, ballInitialSpeed } = this.cfg;
    const vx = ballInitialSpeed * (Math.random() < 0.5 ? 1 : -1);
    const vy = ballInitialSpeed * (Math.random() < 0.5 ? 1 : -1);
    this.ball.reset(fieldWidth / 2, fieldHeight / 2, vx, vy);
  }
}
