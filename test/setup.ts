import { GlobalRegistrator } from '@happy-dom/global-registrator'

/**
 * A document, for the tests that render one.
 *
 * Registered globally rather than per-file because half the value of these tests
 * is that they run the real components — the words on screen are the thing being
 * asserted, and a fake renderer would let a component say something different
 * from what it says in a browser.
 */
GlobalRegistrator.register()

/**
 * A `ResizeObserver`, which happy-dom does not ship.
 *
 * The page constructs one at mount to measure its scroll container, and without
 * a global the render throws before a single line is drawn — a component test
 * that fails with `ResizeObserver is not defined` says nothing about the
 * component.
 *
 * It observes nothing and never fires, and that is the honest stub: a test that
 * asserted on a resize would be asserting on this file's behaviour rather than
 * on the app's. The size-dependent decisions are tested where they live, in
 * `room.test.ts`, which is a pure function precisely so that they can be.
 */
if (!('ResizeObserver' in globalThis)) {
  class Stub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = Stub
}

/**
 * `scrollIntoView`, which happy-dom also does not ship.
 *
 * This module calls it on every file that arrives with a range, which is the
 * behaviour the whole "bring it into view" half of the program exists for. A
 * stub that throws would fail every render test for a reason unrelated to what
 * they check.
 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}
