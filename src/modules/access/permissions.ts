/**
 * Matriz de autorização da equipe escolar.
 *
 * Toda rota protegida declara a permissão que exige; esta tabela é a única fonte
 * que liga permissões a perfis. Ao criar uma rota nova, adicione a permissão aqui
 * e atualize docs/regras-de-isolamento-multi-escola.md.
 */
export const STAFF_ROLES = [
  'school_admin',
  'director',
  'secretary',
  'finance',
  'coordinator',
  'teacher',
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const PERMISSIONS = {
  'school:read': ['school_admin', 'director', 'secretary', 'finance', 'coordinator', 'teacher'],
  'users:read': ['school_admin', 'director'],
  'users:manage': ['school_admin'],
  'academic:read': ['school_admin', 'director', 'secretary', 'coordinator', 'teacher'],
  'academic:manage': ['school_admin', 'secretary'],
  'students:read': ['school_admin', 'director', 'secretary', 'coordinator'],
  'students:manage': ['school_admin', 'secretary'],
  'guardians:invite': ['school_admin', 'secretary'],
  'renewals:read': ['school_admin', 'director', 'secretary'],
  'renewals:manage': ['school_admin', 'secretary'],
  'renewals:review': ['school_admin', 'secretary'],
  'dashboard:read': ['school_admin', 'director', 'secretary'],
  'audit:read': ['school_admin', 'director'],
  'units:manage': ['school_admin'],
  'admissions:read': ['school_admin', 'director', 'secretary'],
  'admissions:manage': ['school_admin', 'secretary'],
  'site:manage': ['school_admin', 'secretary'],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function roleHasPermission(role: StaffRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly StaffRole[]).includes(role);
}

export function permissionsForRole(role: StaffRole): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((permission) =>
    roleHasPermission(role, permission),
  );
}
