import {calendarShift, validCalendarDay} from './release-window.mjs';

// Evidence that a shoe turned up while we were looking, which is not the same
// thing as a launch date and is never shown as one.
//
// A brand that publishes no date anywhere still tells us something by putting
// a shoe on its shelf. If we read that shelf last week and the shoe was not
// on it, and we read it this week and it is, then it was newly listed this
// week. That is our own observation - dated, repeatable, and as weak or
// strong as the watch behind it.
//
// Three things have to hold, and each is a way the claim could be false:
//
//   - We were already watching the brand before the shoe appeared. If it was
//     there the first time we ever looked, everything on that shelf is new to
//     us and most of it is old to the world, so nothing can be concluded.
//   - The watch had no long gap. Looking away for a month and finding a new
//     shoe on return proves only that it arrived sometime in that month.
//   - The sighting is inside the three-month window, like every other date
//     this catalogue works with.
export function observedArrivalDay(product) {
  const value = product?.observedArrivalAt || product?.firstSeen;
  return Number.isFinite(Date.parse(value))
    ? new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 10) : '';
}

export function watchingSince(watch, brand) {
  return watch?.brands?.[brand]?.watchingSince || '';
}

export function hasObservedArrival(product, today, watch) {
  if (!validCalendarDay(today)) return false;
  const seen = observedArrivalDay(product);
  const since = watchingSince(watch, product?.brand);
  if (!seen || !since) return false;
  // Strictly after: a shoe first seen on the very day the watch began was on
  // the shelf when we arrived.
  if (seen <= since) return false;
  if (seen > today) return false;
  return seen >= calendarShift(today, -3);
}

/** What the card says. Never 출시일 - the date is ours, not the brand's. */
export function observedArrivalLabel(product) {
  const seen = observedArrivalDay(product);
  return seen ? `${seen} 최초 확인 (출시일 미공개)` : '';
}
