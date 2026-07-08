import { Link } from 'react-router';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center gap-10 px-4 py-16">
      <div className="flex flex-col items-center gap-2">
        <p className="font-sans text-muted text-xl">Welcome to</p>
        <h1 className="font-display text-primary text-5xl md:text-6xl uppercase tracking-widest">MyPong</h1>
      </div>

      <p className="font-sans text-fg text-base max-w-xl text-center">
        A real-time multiplayer Pong game with 1v1 matchmaking, player profiles, and match statistics.
        Built as a portfolio project using React, Node.js/Fastify, PostgreSQL, and Docker in a
        microservices architecture.
      </p>

      <div className="flex gap-4">
        <Link
          to="/login"
          className="bg-primary text-primary-fg font-display text-sm uppercase tracking-wide py-2 px-6 hover:bg-primary-hover transition-colors"
        >
          Log In
        </Link>
        <Link
          to="/register"
          className="border border-accent text-accent font-display text-sm uppercase tracking-wide py-2 px-6 hover:bg-accent hover:text-bg transition-colors"
        >
          Create Account
        </Link>
      </div>

      <div className="border border-dashed border-border bg-surface p-8 max-w-md text-center">
        <h2 className="font-display text-muted text-sm uppercase tracking-widest mb-3">Guest Mode</h2>
        <p className="font-sans text-muted text-sm">
          Play locally against a friend, same keyboard — coming in a future update.
        </p>
      </div>
    </div>
  );
}
