/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.createTable('game', {
    id:            { type: 'serial',      primaryKey: true },
    player1_id:    { type: 'integer',     notNull: true },
    player2_id:    { type: 'integer',     notNull: true },
    player1_score: { type: 'integer',     notNull: true },
    player2_score: { type: 'integer',     notNull: true },
    // No FK to users — cross-service FK would couple game-service to
    // auth-service's schema. Integrity comes from the validated JWT/x-user-id
    // at request time, not from a database constraint.
    winner_id:     { type: 'integer',     notNull: true },
    played_at:     { type: 'timestamptz', notNull: true },
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropTable('game');
};
