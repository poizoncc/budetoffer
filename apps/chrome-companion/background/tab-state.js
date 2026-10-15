// A minimized window is supported. A discarded or frozen document cannot run
// injected work; never activate it or replay a mutation to recover implicitly.
export function requireRunnableTab(tab) {
  if (tab?.discarded || tab?.frozen) throw new Error('hh_tab_suspended');
  return tab;
}
