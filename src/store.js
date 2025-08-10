// Minimal Redux-like store for incremental refactor
// Usage: import { createStore } from './store.js'
// const store = createStore(reducer, initialState)

export function createStore(reducer, preloadedState) {
  let currentState = preloadedState;
  const listeners = new Set();

  function getState() {
    return currentState;
  }

  function dispatch(action) {
    const next = reducer(currentState, action);
    if (next !== currentState) {
      currentState = next;
      for (const l of Array.from(listeners)) {
        try { l(); } catch {}
      }
    }
    return action;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // Initialize
  dispatch({ type: '@@INIT' });

  return { getState, dispatch, subscribe };
} 