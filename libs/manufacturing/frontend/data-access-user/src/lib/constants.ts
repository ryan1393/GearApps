export const LOCAL_STORAGE_KEY_ACCESS_TOKEN = `app-access-token`;
export const LOCAL_STORAGE_KEY_REFRESH_TOKEN = `app-refresh-token`;

/** Exchanges the refresh token (sent as the Bearer credential) for a new token pair. */
export const AUTH_REFRESH_PATH = '/api/v1/auth/refresh';
/** Where the sign-in page returns to after a successful sign-in. */
export const REDIRECT_URL_QUERY_PARAM = 'redirectUrl';

export const LOADING_FOR_ADD_USER = 'add-user';
export const LOADING_FOR_UPDATE_USER = 'update-user';
