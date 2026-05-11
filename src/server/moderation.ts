export const parseDurationToExpiration = (durationInput: string | undefined | null) => {
  const value = String(durationInput || 'permanent').trim().toLowerCase();
  if (!value || value === 'permanent' || value === 'perm' || value === 'forever') return null;

  const match = value.match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks)$/);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    m: 60 * 1000,
    min: 60 * 1000,
    mins: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
  };

  return new Date(Date.now() + amount * multipliers[unit]).toISOString();
};

export const cleanIdentifierList = (value: unknown) => (
  Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())))
    : []
);

export const listsOverlap = (left: string[], right: string[]) => {
  if (left.length === 0 || right.length === 0) return false;
  const rightSet = new Set(right.map(item => item.toLowerCase()));
  return left.some(item => rightSet.has(item.toLowerCase()));
};
