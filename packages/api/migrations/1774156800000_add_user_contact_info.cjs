/**
 * Migration: Add contact_info to users table
 *
 * Stores registrant contact info on the user profile so it can be
 * reused across projects without re-entering each time.
 */

exports.up = (pgm) => {
  pgm.addColumn('users', {
    contact_info: {
      type: 'jsonb',
      notNull: false,
      comment: 'Saved registrant contact info for domain registration. Reused across projects.',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('users', 'contact_info');
};
