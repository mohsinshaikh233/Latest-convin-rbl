export const BASE_PATH = '/convin';

export const withBase = (p = '') => `${BASE_PATH}${String(p).startsWith('/') ? p : '/' + p}`;
