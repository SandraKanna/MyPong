/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.createTable('user_profiles', {
    user_id: {
      type: 'integer',
      primaryKey: true,
      references: '"users"',
      onDelete: 'CASCADE',
    },
    username:   { type: 'text', unique: true }, // nullable until first PATCH /me
    avatar_url: { type: 'text' },                // nullable; reserved for avatar-upload PR
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropTable('user_profiles');
};
