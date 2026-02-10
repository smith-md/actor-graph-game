/**
 * Date utilities for puzzle generation
 */

/**
 * Get current date in Central Time as YYYY-MM-DD string
 */
export function getDateKey(): string {
  // Create date in Central Time (America/Chicago)
  const now = new Date();

  // Format with timezone offset for Central Time
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };

  const formatter = new Intl.DateTimeFormat('en-CA', options); // en-CA gives YYYY-MM-DD format
  return formatter.format(now);
}

/**
 * Get Central Time date object
 */
export function getCentralTime(): Date {
  const now = new Date();
  const centralOffset = -6 * 60; // CST offset in minutes (adjust for DST if needed)

  // Get UTC time and adjust for Central
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (centralOffset * 60000));
}

/**
 * Check if we're in Daylight Saving Time for Central Time
 */
export function isCentralDST(date: Date = new Date()): boolean {
  // DST in US: Second Sunday in March to First Sunday in November
  const year = date.getFullYear();

  // March: second Sunday
  const march = new Date(year, 2, 1);
  const marchSecondSunday = new Date(year, 2, 8 + (7 - march.getDay()) % 7);

  // November: first Sunday
  const november = new Date(year, 10, 1);
  const novFirstSunday = new Date(year, 10, 1 + (7 - november.getDay()) % 7);

  return date >= marchSecondSunday && date < novFirstSunday;
}
