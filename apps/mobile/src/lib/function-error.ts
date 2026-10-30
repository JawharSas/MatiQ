/** A server function answered with an error status; `context` is the response, as with supabase-js. */
export class FunctionError extends Error {
  override name = 'FunctionError';
  readonly context: Response;
  constructor(context: Response) {
    super(`The server answered ${context.status}`);
    this.context = context;
  }
}
