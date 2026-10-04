/** Storage keys and the pre-paint script (server-safe: no 'use client', inlined by the root layout). */

export const PREF_KEYS = {
  theme: 'driver.console.theme',
  density: 'driver.console.density',
  sidebar: 'driver.console.sidebar',
} as const;

/** Inlined in <head>: reads the stored prefs and sets the attributes before first paint. */
export const PREPAINT_SCRIPT = `(function(){try{var d=document.documentElement;var t=localStorage.getItem('${PREF_KEYS.theme}');d.setAttribute('data-theme',t==='dark'?'dark':'light');var s=localStorage.getItem('${PREF_KEYS.density}');d.setAttribute('data-density',s==='compact'?'compact':'comfortable');if(localStorage.getItem('${PREF_KEYS.sidebar}')==='collapsed')d.setAttribute('data-sidebar','collapsed');}catch(e){}})();`;
