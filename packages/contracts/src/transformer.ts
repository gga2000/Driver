import superjson from 'superjson';

/** superjson keeps Date (and other rich types) intact across the wire for every client. */
export const transformer = superjson;
