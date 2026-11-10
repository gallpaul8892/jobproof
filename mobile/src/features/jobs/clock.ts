/** The phone's clock, replaceable in tests (`jest.spyOn(clock, "now")`). Used only to decide whether a saved list is from today. */
export const clock = { now: (): Date => new Date() };
