import type { ComponentType } from 'react';
import type { IconName } from '@/components/ui/AppIcon';
import type { Capability } from '@/lib/auth/permissions';
import type { DeskClient } from '@/lib/db/server';

/** What the digest asks each module for. Runs with the service-role client inside the cron job. */
export interface DigestContext {
  /** The SAST date the digest is for, "YYYY-MM-DD". */
  date: string;
  now: Date;
  /** Service-role client (the cron job has no user). Read only what the section needs. */
  db: DeskClient;
  appUrl: string;
}
export interface DigestSection {
  key: string;
  title: string;
  /** Plain lines; the digest renders them as a list. Empty = section omitted. */
  lines: Array<{ text: string; href?: string }>;
}
export type DigestProvider = (ctx: DigestContext) => Promise<DigestSection[]>;

/**
 * One entry per module. Adding a module = one folder + one line in registry.ts.
 * - status 'later' shows it in the sidebar as a disabled "Coming later" item.
 * - home: cards the Home page shows, in registry order.
 * - digest: sections the 18:00 digest email includes.
 */
export interface ModuleManifest {
  key: string;
  label: string;
  href: string;
  icon: IconName;
  phase: 1 | 2 | 3;
  status: 'live' | 'later';
  /** Hidden from the sidebar when the member lacks it. */
  capability?: Capability;
  /** Shown in the phone bottom bar. */
  mobilePrimary?: boolean;
  description: string;
  home?: () => Promise<{ default: ComponentType }>;
  digest?: () => Promise<{ default: DigestProvider }>;
}
