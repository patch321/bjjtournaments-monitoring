function validDay(value) {
  if (!/^\d{8}$/.test(value ?? '')) return false;
  const iso = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;
  const time = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === iso;
}
export function publicFeedCheck(status, contentType, body) {
  const result = (state, detail) => ({ key: 'public:feed', state, detail });
  if (status !== 200) return result('failed', `Public calendar HTTP ${status}`);
  if (!/^text\/calendar(?:;|$)/i.test(contentType ?? '')) return result('failed', 'Public calendar returned an unexpected content type');
  const lines = body.replace(/\r\n[ \t]/g, '').trimEnd().split(/\r?\n/);
  if (lines[0] !== 'BEGIN:VCALENDAR' || lines.filter(Boolean).at(-1) !== 'END:VCALENDAR') return result('failed', 'Public calendar is incomplete or malformed');
  const records = [];
  let current = null;
  for (const line of lines.slice(1, -1)) {
    if (line === 'BEGIN:VEVENT') {
      if (current) return result('failed', 'Public calendar contains nested event records');
      current = [];
    } else if (line === 'END:VEVENT') {
      if (!current) return result('failed', 'Public calendar contains unmatched event boundaries');
      records.push(current);
      current = null;
    } else if (current) current.push(line);
  }
  if (current) return result('failed', 'Public calendar contains an incomplete event');
  if (!records.length) return result('unknown', 'Public calendar contains no events; verify inventory before treating it as healthy');
  const ids = new Set();
  const valid = records.every(record => {
    const field = prefix => {
      const values = record.filter(line => line.startsWith(prefix));
      return values.length === 1 ? values[0].slice(prefix.length).trim() : null;
    };
    const uid = field('UID:');
    const start = field('DTSTART;VALUE=DATE:');
    const end = field('DTEND;VALUE=DATE:');
    if (!uid || ids.has(uid) || !field('SUMMARY:') || !validDay(start) ||
        !validDay(end) || end <= start) return false;
    ids.add(uid);
    return true;
  });
  return result(valid ? 'healthy' : 'failed', valid ? `${records.length} public calendar records have required event fields` : 'Public calendar records are missing required event fields');
}
