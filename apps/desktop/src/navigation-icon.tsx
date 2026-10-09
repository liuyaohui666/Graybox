import React from 'react';

const paths={
  home:'M3 3h14v14H3z M3 8h14 M8 8v9',
  projects:'M3 5h5l2 2h7v10H3z M3 5V3h6l2 2h6v2',
  experiments:'M7 3h6 M8 3v5l-4 7a1.4 1.4 0 0 0 1.2 2h9.6a1.4 1.4 0 0 0 1.2-2l-4-7V3 M6 12h8',
  activity:'M3 5h2 M8 5h9 M3 10h2 M8 10h9 M3 15h2 M8 15h9',
};
export function NavigationIcon({name}:{name:keyof typeof paths}) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]}/></svg>;
}
