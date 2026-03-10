// node-pg-migrate configuration
// Must be CommonJS for compatibility

module.exports = {
  'migrations-dir': 'migrations',
  'migrations-table': 'pgmigrations',
  'schema': 'public',
  'decamelize': false,
  'check-order': true,
};
