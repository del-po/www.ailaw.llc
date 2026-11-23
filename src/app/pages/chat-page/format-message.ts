// Turns an answer's plain text into simple HTML: bold, bullet lists, links, line breaks.
// Everything is escaped first, so no HTML from the answer itself can reach the page.

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function formatMessage(text: string): string {
  const escaped = text.replace(/[&<>"']/g, (c) => ESCAPES[c]);

  const lines = escaped.split('\n');
  const html: string[] = [];
  let inList = false;

  for (const line of lines) {
    const item = line.match(/^\s*[-*]\s+(.*)$/);
    if (item) {
      if (!inList) html.push('<ul>');
      inList = true;
      html.push(`<li>${inline(item[1])}</li>`);
      continue;
    }
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
    html.push(line.trim() ? `<p>${inline(line)}</p>` : '');
  }
  if (inList) html.push('</ul>');

  return html.join('');
}

function inline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(
      /(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
    );
}
