/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE user_stats (
      user_id       INTEGER PRIMARY KEY REFERENCES users ON DELETE CASCADE,
      games_played  INTEGER NOT NULL DEFAULT 0,
      games_won     INTEGER NOT NULL DEFAULT 0,
      highest_score INTEGER NOT NULL DEFAULT 0,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE user_match_history (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
      match_id    INTEGER NOT NULL,
      opponent_id INTEGER NOT NULL,
      result      TEXT NOT NULL CHECK (result IN ('win', 'loss')),
      my_score    INTEGER NOT NULL,
      opp_score   INTEGER NOT NULL,
      status      TEXT NOT NULL,
      played_at   TIMESTAMPTZ NOT NULL,
      UNIQUE (user_id, match_id)
    );

    CREATE INDEX ON user_match_history (user_id, played_at DESC);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS user_match_history;
    DROP TABLE IF EXISTS user_stats;
  `);
};
