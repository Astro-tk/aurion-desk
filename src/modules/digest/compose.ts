import type { OutboundMessage } from '@/integrations/types';
import { formatDateWithWeekday } from '@/lib/format';
import type { DigestSection } from '../types';

/** The order sections appear in the email. Anything not listed goes at the end. */
export const SECTION_ORDER = ['inbox', 'promising', 'due_tomorrow', 'overdue', 'tasks', 'renewals', 'job_failures'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function composeDigest(date: string, sections: DigestSection[], appUrl: string): OutboundMessage {
  const ordered = [...sections].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a.key);
    const ib = SECTION_ORDER.indexOf(b.key);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const withLines = ordered.filter((s) => s.lines.length > 0);
  const total = withLines.reduce((n, s) => n + s.lines.length, 0);
  const subject = `Aurion Desk, ${formatDateWithWeekday(date)}: ${total === 0 ? 'nothing needs you' : `${total} item${total === 1 ? '' : 's'}`}`;

  const textParts = [`Aurion Desk daily digest for ${formatDateWithWeekday(date)}.`, ''];
  const htmlParts = [
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1F2A2E;max-width:640px">`,
    `<p style="margin:0 0 12px">Aurion Desk daily digest for <strong>${esc(formatDateWithWeekday(date))}</strong>.</p>`,
  ];
  if (withLines.length === 0) {
    textParts.push('Nothing needs you today. Rest well.');
    htmlParts.push('<p>Nothing needs you today. Rest well.</p>');
  }
  for (const s of withLines) {
    textParts.push(`${s.title} (${s.lines.length})`);
    s.lines.forEach((l) => textParts.push(`- ${l.text}${l.href ? `\n  ${l.href}` : ''}`));
    textParts.push('');
    htmlParts.push(`<h3 style="font-size:15px;margin:16px 0 6px;border-bottom:2px solid #C1FF72;padding-bottom:2px">${esc(s.title)} (${s.lines.length})</h3><ul style="margin:0;padding-left:18px">`);
    s.lines.forEach((l) => htmlParts.push(`<li style="margin:2px 0">${l.href ? `<a href="${esc(l.href)}" style="color:#1F2A2E">${esc(l.text)}</a>` : esc(l.text)}</li>`));
    htmlParts.push('</ul>');
  }
  textParts.push(`Open Desk: ${appUrl}`);
  htmlParts.push(`<p style="margin-top:20px;font-size:13px"><a href="${esc(appUrl)}" style="color:#1F2A2E">Open Aurion Desk</a></p></div>`);
  return { subject, text: textParts.join('\n'), html: htmlParts.join('') };
}
