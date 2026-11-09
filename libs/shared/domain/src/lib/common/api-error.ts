/** Standard error envelope returned by the API for 4xx/5xx responses. */
export interface ApiErrorResponse {
  message: string;
  error: string;
  statusCode?: number;
}
