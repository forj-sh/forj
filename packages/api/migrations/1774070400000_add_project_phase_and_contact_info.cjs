/**
 * Migration: Add phase, contact_info, and stripe columns to projects table
 *
 * Supports the two-phase init flow:
 * Phase 1 (domain): project created → contact info stored → payment → domain registered
 * Phase 2 (services): user selects GitHub/Cloudflare → provisioned
 *
 * New columns:
 * - phase: tracks where the project is in the init flow
 * - contact_info: JSONB with ICANN-required registrant data
 * - stripe_session_id: Stripe checkout session for domain payment
 * - stripe_payment_status: payment state (pending/paid/failed)
 */

exports.up = (pgm) => {
  // Project phase in the two-phase init flow
  pgm.addColumn('projects', {
    phase: {
      type: 'varchar(20)',
      notNull: true,
      default: 'domain',
      comment: 'Init flow phase: domain, services, complete',
    },
  });

  pgm.addConstraint('projects', 'chk_projects_phase', {
    check: "phase IN ('domain', 'services', 'complete')",
  });

  // ICANN-required contact information for domain registration
  // NOTE: Contains PII (name, address, phone, email). This data is used only
  // for domain registration and should not be returned by project read endpoints.
  // Consider encrypting at rest in a future migration if compliance requires it.
  pgm.addColumn('projects', {
    contact_info: {
      type: 'jsonb',
      notNull: false,
      comment: 'Registrant contact info (ICANN-required). Contains PII — do not expose in read APIs.',
    },
  });

  // Stripe checkout session tracking
  pgm.addColumn('projects', {
    stripe_session_id: {
      type: 'varchar(255)',
      notNull: false,
      comment: 'Stripe checkout session ID for domain payment',
    },
  });

  pgm.addColumn('projects', {
    stripe_payment_status: {
      type: 'varchar(20)',
      notNull: false,
      comment: 'Payment status: pending, paid, failed',
    },
  });

  pgm.addConstraint('projects', 'chk_projects_stripe_payment_status', {
    check: "stripe_payment_status IS NULL OR stripe_payment_status IN ('pending', 'paid', 'failed')",
  });

  // Whether to enable WHOIS privacy (WhoisGuard)
  pgm.addColumn('projects', {
    use_whois_privacy: {
      type: 'boolean',
      notNull: true,
      default: true,
      comment: 'Enable WHOIS privacy protection (WhoisGuard)',
    },
  });

  // Index for looking up projects by Stripe session (webhook handler)
  pgm.createIndex('projects', 'stripe_session_id', {
    where: 'stripe_session_id IS NOT NULL',
    name: 'idx_projects_stripe_session',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('projects', [], { name: 'idx_projects_stripe_session' });
  pgm.dropColumn('projects', 'use_whois_privacy');
  pgm.dropConstraint('projects', 'chk_projects_stripe_payment_status');
  pgm.dropColumn('projects', 'stripe_payment_status');
  pgm.dropColumn('projects', 'stripe_session_id');
  pgm.dropColumn('projects', 'contact_info');
  pgm.dropConstraint('projects', 'chk_projects_phase');
  pgm.dropColumn('projects', 'phase');
};
