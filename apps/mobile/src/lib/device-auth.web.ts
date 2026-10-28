/** Browser UI preview only: no biometrics in the browser, always allowed. */
export function confirmDeviceOwner(_reason: string): Promise<boolean> {
  return Promise.resolve(true);
}
