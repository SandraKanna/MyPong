/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.createTable('match', {
    id:            { type: 'serial',    primaryKey: true },
    player1_id:    { type: 'integer',   notNull: true },
    player2_id:    { type: 'integer',   notNull: true },
    // Scores and winner are null until the match is closed.
    player1_score: { type: 'integer' },
    player2_score: { type: 'integer' },
    // No FK to users — cross-service FK would couple match-service to
    // auth-service's schema. Integrity comes from the validated JWT/x-user-id
    // at request time, not from a database constraint.
    winner_id:     { type: 'integer' },
    status:        { type: 'text',      notNull: true, default: 'active' },
    created_at:    { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    // closed_at is null until the match reaches a terminal status.
    closed_at:     { type: 'timestamp' },
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropTable('match');
};
