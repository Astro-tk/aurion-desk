/**
 * The ONLY place that says who may do what.
 *
 * - Pages, server actions and API routes call can() / requireCapability(); never compare roles inline.
 * - The database enforces the same table through desk.role_capabilities, which is generated
 *   from this file by `npm run gen:capabilities`. tests/permissions.test.ts fails if they drift.
 */

export const ROLES = ['owner', 'viewer', 'assistant'] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  'pipeline.read',
  'pipeline.write',
  'pipeline.import',
  'contacts.forget',
  'inbox.read',
  'inbox.decide',
  'blueprint.read',
  'blueprint.write',
  'blueprint.import',
  'scorecard.read',
  'scorecard.write',
  'platforms.read',
  'platforms.write',
  'events.read',
  'events.write',
  'audit.read',
  'settings.read',
  'settings.write',
  'data.export',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const READ_ONLY: Capability[] = [
  'pipeline.read',
  'inbox.read',
  'blueprint.read',
  'scorecard.read',
  'platforms.read',
  'events.read',
];

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  // You.
  owner: CAPABILITIES,
  // Reserved: a future helper who does day-to-day pipeline and blueprint work,
  // but cannot export data, delete contacts, import, or change settings and platforms.
  assistant: [
    ...READ_ONLY,
    'pipeline.write',
    'inbox.decide',
    'blueprint.write',
    'scorecard.write',
    'events.write',
  ],
  // Reserved: someone who may look but not touch.
  viewer: READ_ONLY,
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role].includes(capability);
}

/** Flat list of [role, capability] pairs, used by the SQL generator and the drift test. */
export function capabilityRows(): Array<[Role, Capability]> {
  return ROLES.flatMap((role) => ROLE_CAPABILITIES[role].map((cap) => [role, cap] as [Role, Capability]));
}
