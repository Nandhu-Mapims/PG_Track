export class HisError extends Error {
  constructor(
    message: string,
    public statusCode: number = 503,
  ) {
    super(message);
    this.name = "HisError";
  }
}
