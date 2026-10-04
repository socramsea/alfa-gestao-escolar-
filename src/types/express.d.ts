import type { StaffRole } from '../modules/access/permissions.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        school_id: string;
        role: StaffRole;
        name: string;
      };
      guardian?: {
        id: string;
        school_id: string;
        name: string;
      };
    }
  }
}

export {};
