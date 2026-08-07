// How much of a command's output is kept when an error message includes it —
// long install/build logs would otherwise drown the message.

/** Tail of combined stdout+stderr kept in error messages */
export const MAX_ERROR_OUTPUT_CHARS = 3000;

/** Tail of a command's stderr kept in error messages */
export const MAX_ERROR_STDERR_CHARS = 2000;
