/* State shared between modules: the data loaded at start-up, the region and range being explored, and which sections have drawn. */
export const st = {
  S: {}, LB: [], BR: {}, LIVE: {},
  selected: null, compare: "", rangeDays: 14,
  drawn: new Set(),
};
