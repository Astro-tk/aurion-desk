'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

export async function toggleThemeAction(): Promise<void> {
  const store = await cookies();
  const next = store.get('desk_theme')?.value === 'light' ? 'dark' : 'light';
  store.set('desk_theme', next, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
}
