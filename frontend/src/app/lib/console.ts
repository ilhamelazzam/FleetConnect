export function silenceConsoleInProduction(): void {
  if (import.meta.env.DEV) {
    return;
  }

  const noop = () => undefined;
  console.log = noop;
  console.info = noop;
  console.debug = noop;
  console.warn = noop;
  console.error = noop;
}
